import { EventEmitter } from "events";
import { spawn, spawnSync } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "../db";
import { aiSettings, clips, sermonAssets, sermons } from "../db/schema";
import { generateAllSermonResources } from "../ai/generators";
import { getEffectiveGenerationPrompts } from "../ai/default-generation-prompts";
import type { LlmConfig } from "../ai/provider";
import { withLocalBinPath } from "../env-path";
import { decryptSecret, assertSafeDataPath } from "../security";
import type { CaptionSettings, LlmProvider, TranscriptSegment } from "../types";
import { DEFAULT_CAPTION_SETTINGS } from "../types";

const globalForBus = globalThis as unknown as {
  __amboJobBus?: EventEmitter;
  __amboRunningJobs?: Set<string>;
};

export const jobBus = globalForBus.__amboJobBus || new EventEmitter();
jobBus.setMaxListeners(100);
globalForBus.__amboJobBus = jobBus;

const runningJobs = globalForBus.__amboRunningJobs || new Set<string>();
globalForBus.__amboRunningJobs = runningJobs;

const VENV_PYTHON = path.join(process.cwd(), "python-worker", ".venv", "bin", "python");
const TRANSCRIBE_SCRIPT = path.join(process.cwd(), "python-worker", "transcribe.py");
const EXTRACT_SCRIPT = path.join(process.cwd(), "python-worker", "extract_doc.py");
const RENDER_SCRIPT = path.join(process.cwd(), "python-worker", "render_clip.py");
const YOUTUBE_SCRIPT = path.join(process.cwd(), "python-worker", "download_youtube.py");
const FONTS_DIR = path.join(process.cwd(), "data", "fonts");

function resolvePythonBin(): string {
  const env = withLocalBinPath();
  if (fs.existsSync(VENV_PYTHON)) {
    const check = spawnSync(VENV_PYTHON, ["-c", "import sys"], { env, timeout: 3000 });
    if (check.status === 0) return VENV_PYTHON;
  }
  for (const candidate of ["python3", "python"]) {
    const check = spawnSync(candidate, ["-c", "import sys"], { env, timeout: 3000 });
    if (check.status === 0) return candidate;
  }
  return VENV_PYTHON;
}

export function emitSermonEvent(sermonId: string, payload: Record<string, unknown>) {
  jobBus.emit(`sermon:${sermonId}`, payload);
  jobBus.emit("sermons:all", { sermonId, ...payload });
}

function updateSermonProgress(
  sermonId: string,
  fields: Partial<{
    status: string;
    progress: number;
    progressMessage: string;
    errorMessage: string | null;
    durationSec: number;
    isVideo: number;
    thumbnailPath: string | null;
    transcriptText: string | null;
    segmentsJson: string | null;
    faceTrackJson: string | null;
    manuscriptText: string | null;
    topic: string;
    title: string;
    speaker: string;
    mediaPath: string | null;
    mediaMime: string | null;
    mediaFileName: string | null;
  }>
) {
  const now = Date.now();
  db.update(sermons)
    .set({ ...fields, updatedAt: now })
    .where(eq(sermons.id, sermonId))
    .run();

  emitSermonEvent(sermonId, {
    type: "status",
    status: fields.status,
    progress: fields.progress,
    progressMessage: fields.progressMessage,
    errorMessage: fields.errorMessage,
  });
}

function runCommand(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      env: withLocalBinPath(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
    });
    child.on("error", reject);
  });
}

async function probeMedia(mediaPath: string): Promise<{ durationSec: number; isVideo: boolean }> {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type",
    "-of",
    "json",
    mediaPath,
  ]);
  const parsed = JSON.parse(stdout);
  const durationSec = Math.round(Number(parsed?.format?.duration || 0));
  const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
  const isVideo = streams.some((s: { codec_type?: string }) => s.codec_type === "video");
  return { durationSec, isVideo };
}

export async function extractDocumentText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase();
  if ([".txt", ".md", ".csv", ".tsv"].includes(ext)) {
    return fs.readFileSync(filePath, "utf8").replace(/\n{3,}/g, "\n\n").trim();
  }
  const outJson = `${filePath}.extracted.json`;
  await runCommand(resolvePythonBin(), [EXTRACT_SCRIPT, "--input", filePath, "--output", outJson]);
  const data = JSON.parse(fs.readFileSync(outJson, "utf8"));
  fs.unlinkSync(outJson);
  return data.text || "";
}

function runWhisper(
  inputPath: string,
  modelSize: string,
  language: string,
  outJson: string,
  onProgress: (pct: number, msg: string) => void
): Promise<{ text: string; duration: number; segments: TranscriptSegment[] }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      resolvePythonBin(),
      [
        TRANSCRIBE_SCRIPT,
        "--input",
        inputPath,
        "--model",
        modelSize || "base",
        "--language",
        language || "auto",
        "--output",
        outJson,
      ],
      { env: withLocalBinPath(), stdio: ["ignore", "pipe", "pipe"] }
    );

    let errBuf = "";
    let lineBuf = "";
    child.stdout.on("data", (chunk) => {
      lineBuf += chunk.toString();
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() || "";
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.type === "progress") {
            onProgress(Number(msg.percent || 10), msg.message || "Transcribing...");
          }
        } catch {
          // ignore non-json stdout
        }
      }
    });
    child.stderr.on("data", (d) => (errBuf += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`faster-whisper failed (${code}): ${errBuf.slice(-400)}`));
      }
      try {
        const result = JSON.parse(fs.readFileSync(outJson, "utf8"));
        resolve(result);
      } catch (e) {
        reject(e);
      }
    });
    child.on("error", reject);
  });
}

function getUserLlmConfig(userId: string): {
  llm: LlmConfig;
  whisperModel: string;
  whisperLanguage: string;
  captionDefaults: CaptionSettings;
} {
  const row = db.select().from(aiSettings).where(eq(aiSettings.userId, userId)).get();
  if (!row) {
    return {
      llm: { provider: "offline", apiKey: "", baseUrl: "", model: "" },
      whisperModel: "base",
      whisperLanguage: "auto",
      captionDefaults: DEFAULT_CAPTION_SETTINGS,
    };
  }
  let captionDefaults = DEFAULT_CAPTION_SETTINGS;
  try {
    captionDefaults = { ...DEFAULT_CAPTION_SETTINGS, ...JSON.parse(row.defaultCaptionSettingsJson || "{}") };
  } catch {}
  const rawProvider = row.llmProvider || "offline";
  const normalizedProvider = rawProvider === "claude_web" ? "claude_cli" : rawProvider;
  return {
    llm: {
      provider: normalizedProvider as LlmProvider,
      apiKey: decryptSecret(row.apiKey || ""),
      baseUrl: normalizedProvider === "claude_cli" && rawProvider === "claude_web" ? "" : row.baseUrl || "",
      model: normalizedProvider === "claude_cli" && rawProvider === "claude_web" ? "sonnet" : row.model || "",
    },
    whisperModel: row.whisperModel || "base",
    whisperLanguage: row.whisperLanguage || "auto",
    captionDefaults,
  };
}

function runYoutubeDownload(
  youtubeUrl: string,
  outDir: string,
  metaOut: string,
  onProgress: (pct: number, msg: string) => void
): Promise<{
  title: string;
  uploader: string;
  duration: number;
  output_path: string;
  file_name: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      resolvePythonBin(),
      [YOUTUBE_SCRIPT, "--url", youtubeUrl, "--out-dir", outDir, "--meta-out", metaOut],
      { env: withLocalBinPath(), stdio: ["ignore", "pipe", "pipe"] }
    );
    let stderr = "";
    let lineBuf = "";
    child.stdout.on("data", (chunk) => {
      lineBuf += chunk.toString();
      const lines = lineBuf.split("\n");
      lineBuf = lines.pop() || "";
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.type === "progress") {
            onProgress(Number(msg.percent || 5), msg.message || "Downloading from YouTube...");
          }
        } catch {}
      }
    });
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`YouTube download failed (${code}): ${stderr.slice(-400)}`));
      }
      try {
        resolve(JSON.parse(fs.readFileSync(metaOut, "utf8")));
      } catch (e) {
        reject(e);
      }
    });
    child.on("error", reject);
  });
}

export function startSermonPipeline(sermonId: string) {
  ensureDbInitialized();
  if (runningJobs.has(sermonId)) return;
  runningJobs.add(sermonId);

  (async () => {
    try {
      let sermon = db.select().from(sermons).where(eq(sermons.id, sermonId)).get();
      if (!sermon) return;

      const { llm, whisperModel, whisperLanguage, captionDefaults } = getUserLlmConfig(sermon.userId);
      const userPrompts = getEffectiveGenerationPrompts(sermon.userId);
      const workDir = path.join(process.cwd(), "data", "uploads", sermonId);
      fs.mkdirSync(workDir, { recursive: true });

      let segments: TranscriptSegment[] = [];
      let transcriptText = sermon.transcriptText || "";
      let manuscriptText = sermon.manuscriptText || "";
      let durationSec = sermon.durationSec || 0;

      // 0. Download YouTube media if requested and not yet on disk
      if (sermon.youtubeUrl && (!sermon.mediaPath || !fs.existsSync(sermon.mediaPath))) {
        const metaOut = path.join(workDir, "youtube_meta.json");
        updateSermonProgress(sermonId, {
          status: "transcribing",
          progress: 3,
          progressMessage: "Connecting to YouTube...",
        });
        const yt = await runYoutubeDownload(sermon.youtubeUrl, workDir, metaOut, (pct, msg) => {
          updateSermonProgress(sermonId, {
            status: "transcribing",
            progress: 3 + Math.round((pct / 100) * 11),
            progressMessage: msg,
          });
        });
        const resolvedTitle =
          sermon.title === "YouTube Sermon" && yt.title ? yt.title.slice(0, 180) : sermon.title;
        const resolvedSpeaker = !sermon.speaker && yt.uploader ? yt.uploader.slice(0, 120) : sermon.speaker;
        updateSermonProgress(sermonId, {
          mediaPath: yt.output_path,
          mediaMime: "video/mp4",
          mediaFileName: yt.file_name,
          title: resolvedTitle,
          speaker: resolvedSpeaker,
          durationSec: yt.duration || 0,
        });
        sermon = db.select().from(sermons).where(eq(sermons.id, sermonId)).get() || sermon;
      }

      // 1. Extract manuscript if provided without text yet
      if (sermon.manuscriptPath && !manuscriptText) {
        updateSermonProgress(sermonId, {
          status: "transcribing",
          progress: 12,
          progressMessage: "Reading sermon manuscript...",
        });
        manuscriptText = await extractDocumentText(sermon.manuscriptPath);
        updateSermonProgress(sermonId, { manuscriptText });
      }

      // 2. Process media if mediaPath exists
      if (sermon.mediaPath && fs.existsSync(sermon.mediaPath)) {
        updateSermonProgress(sermonId, {
          status: "transcribing",
          progress: 15,
          progressMessage: "Analyzing media stream & extracting audio...",
        });

        const probe = await probeMedia(sermon.mediaPath);
        durationSec = probe.durationSec;
        const isVideo = probe.isVideo ? 1 : 0;

        let thumbPath: string | null = sermon.thumbnailPath;
        if (probe.isVideo && !thumbPath) {
          thumbPath = path.join(workDir, "thumb.jpg");
          await runCommand("ffmpeg", [
            "-y",
            "-ss",
            String(Math.min(3, Math.max(0, Math.floor(durationSec / 4)))),
            "-i",
            sermon.mediaPath,
            "-frames:v",
            "1",
            "-q:v",
            "3",
            thumbPath,
          ]).catch(() => {
            thumbPath = null;
          });
        }

        // Convert audio to clean 16kHz mono wav for fast, accurate faster-whisper processing
        const wavPath = path.join(workDir, "audio16k.wav");
        await runCommand("ffmpeg", [
          "-y",
          "-i",
          sermon.mediaPath,
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "pcm_s16le",
          wavPath,
        ]);

        updateSermonProgress(sermonId, {
          durationSec,
          isVideo,
          thumbnailPath: thumbPath,
          progress: 22,
          progressMessage: `Transcribing with faster-whisper (${whisperModel})...`,
        });

        const whisperOut = path.join(workDir, "transcript.json");
        const wRes = await runWhisper(wavPath, whisperModel, whisperLanguage, whisperOut, (pct, msg) => {
          const mappedPct = 22 + Math.round((pct / 100) * 43);
          updateSermonProgress(sermonId, {
            status: "transcribing",
            progress: mappedPct,
            progressMessage: msg,
          });
        });

        segments = wRes.segments || [];
        transcriptText = wRes.text || "";
        if (!durationSec && wRes.duration) {
          durationSec = Math.round(wRes.duration);
        }

        // Facial tracking for video files
        let faceTrackJson = sermon.faceTrackJson;
        if (probe.isVideo) {
          updateSermonProgress(sermonId, {
            status: "transcribing",
            progress: 68,
            progressMessage: "Tracking speaker framing for 9:16 clips...",
          });
          const trackOut = path.join(workDir, "face_track.json");
          await runCommand(resolvePythonBin(), [
            RENDER_SCRIPT,
            "--mode",
            "track",
            "--input",
            sermon.mediaPath,
            "--output",
            trackOut,
          ]).catch(() => {});
          if (fs.existsSync(trackOut)) {
            faceTrackJson = fs.readFileSync(trackOut, "utf8");
          }
        }

        updateSermonProgress(sermonId, {
          transcriptText,
          segmentsJson: JSON.stringify(segments),
          faceTrackJson,
          durationSec,
        });
      }

      // 3. Generate 20+ ministry resources + clip candidates
      const sourceText = [transcriptText, manuscriptText].filter(Boolean).join("\n\n---\n\n");
      updateSermonProgress(sermonId, {
        status: "generating",
        progress: 75,
        progressMessage: "Generating study guides, devotionals, posts & coaching...",
      });

      const generated = await generateAllSermonResources({
        title: sermon.title,
        text: sourceText || sermon.title,
        segments,
        durationSec,
        config: llm,
        userPrompts,
      });

      const now = Date.now();
      for (const [assetType, content] of Object.entries(generated.assets)) {
        const existing = db
          .select()
          .from(sermonAssets)
          .where(eq(sermonAssets.sermonId, sermonId))
          .all()
          .find((a) => a.assetType === assetType);

        if (existing) {
          db.update(sermonAssets)
            .set({ content, updatedAt: now })
            .where(eq(sermonAssets.id, existing.id))
            .run();
        } else {
          db.insert(sermonAssets)
            .values({
              id: crypto.randomUUID(),
              sermonId,
              assetType,
              content,
              updatedAt: now,
            })
            .run();
        }
      }

      // 4. Create auto-curated clips if media exists and clips aren't created yet
      if (sermon.mediaPath && generated.clips.length > 0) {
        updateSermonProgress(sermonId, {
          status: "processing_clips",
          progress: 90,
          progressMessage: "Preparing auto-curated vertical sermon clips...",
          topic: generated.topic,
        });

        const existingClips = db.select().from(clips).where(eq(clips.sermonId, sermonId)).all();
        if (existingClips.length === 0) {
          for (const c of generated.clips) {
            db.insert(clips)
              .values({
                id: crypto.randomUUID(),
                sermonId,
                title: c.title,
                category: c.category,
                startMs: c.startMs,
                endMs: c.endMs,
                transcriptExcerpt: c.transcriptExcerpt,
                captionSettingsJson: JSON.stringify(captionDefaults),
                renderStatus: "pending",
                createdAt: now,
                updatedAt: now,
              })
              .run();
          }
        }
      }

      updateSermonProgress(sermonId, {
        status: "completed",
        progress: 100,
        progressMessage: "Ready",
        topic: generated.topic,
        errorMessage: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Pipeline] Sermon error:", sermonId, msg);
      updateSermonProgress(sermonId, {
        status: "error",
        progress: 0,
        progressMessage: "Processing error",
        errorMessage: msg,
      });
    } finally {
      runningJobs.delete(sermonId);
    }
  })();
}

export async function renderClipMp4(clipId: string): Promise<string> {
  ensureDbInitialized();
  const clip = db.select().from(clips).where(eq(clips.id, clipId)).get();
  if (!clip) throw new Error("Clip not found");

  const sermon = db.select().from(sermons).where(eq(sermons.id, clip.sermonId)).get();
  if (!sermon || !sermon.mediaPath || !fs.existsSync(sermon.mediaPath)) {
    throw new Error("Source media file not found for this sermon");
  }

  db.update(clips)
    .set({ renderStatus: "rendering", renderError: null, updatedAt: Date.now() })
    .where(eq(clips.id, clipId))
    .run();
  emitSermonEvent(sermon.id, { type: "clip", clipId, renderStatus: "rendering" });

  try {
    const renderDir = path.join(process.cwd(), "data", "renders", sermon.id);
    fs.mkdirSync(renderDir, { recursive: true });

    const segments: TranscriptSegment[] = sermon.segmentsJson ? JSON.parse(sermon.segmentsJson) : [];
    const allWords = segments.flatMap((s) => s.words || []);
    const wordsFile = path.join(renderDir, `${clipId}.words.json`);
    const styleFile = path.join(renderDir, `${clipId}.style.json`);
    const outFile = path.join(renderDir, `${clipId}.mp4`);

    fs.writeFileSync(wordsFile, JSON.stringify(allWords), "utf8");
    fs.writeFileSync(styleFile, clip.captionSettingsJson || JSON.stringify(DEFAULT_CAPTION_SETTINGS), "utf8");

    const args = [
      RENDER_SCRIPT,
      "--mode",
      "render",
      "--input",
      sermon.mediaPath,
      "--output",
      outFile,
      "--start-ms",
      String(clip.startMs),
      "--end-ms",
      String(clip.endMs),
      "--words-json",
      wordsFile,
      "--style-json",
      styleFile,
      "--fonts-dir",
      FONTS_DIR,
    ];

    const trackPath = path.join(process.cwd(), "data", "uploads", sermon.id, "face_track.json");
    if (fs.existsSync(trackPath)) {
      args.push("--face-track-json", trackPath);
    }

    await runCommand(resolvePythonBin(), args);

    db.update(clips)
      .set({
        renderStatus: "completed",
        renderedPath: outFile,
        renderError: null,
        updatedAt: Date.now(),
      })
      .where(eq(clips.id, clipId))
      .run();
    emitSermonEvent(sermon.id, { type: "clip", clipId, renderStatus: "completed" });
    return outFile;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.update(clips)
      .set({ renderStatus: "error", renderError: msg, updatedAt: Date.now() })
      .where(eq(clips.id, clipId))
      .run();
    emitSermonEvent(sermon.id, { type: "clip", clipId, renderStatus: "error", error: msg });
    throw err;
  }
}

export async function renderClipThumbnailJpg(clipId: string): Promise<string> {
  ensureDbInitialized();
  const clip = db.select().from(clips).where(eq(clips.id, clipId)).get();
  if (!clip) throw new Error("Clip not found");

  const sermon = db.select().from(sermons).where(eq(sermons.id, clip.sermonId)).get();
  if (!sermon || !sermon.mediaPath || !fs.existsSync(sermon.mediaPath)) {
    throw new Error("Source media file not found for this sermon");
  }

  const renderDir = assertSafeDataPath(path.join(process.cwd(), "data", "renders", sermon.id));
  fs.mkdirSync(renderDir, { recursive: true });

  const styleFile = assertSafeDataPath(path.join(renderDir, `${clipId}.style.json`));
  const outFile = assertSafeDataPath(path.join(renderDir, `${clipId}_cover.jpg`));

  fs.writeFileSync(
    styleFile,
    clip.captionSettingsJson || JSON.stringify(DEFAULT_CAPTION_SETTINGS),
    "utf8"
  );

  const args = [
    RENDER_SCRIPT,
    "--mode",
    "thumbnail",
    "--input",
    sermon.mediaPath,
    "--output",
    outFile,
    "--start-ms",
    String(clip.startMs),
    "--end-ms",
    String(clip.endMs),
    "--style-json",
    styleFile,
    "--fonts-dir",
    FONTS_DIR,
    "--title",
    clip.title || sermon.title,
  ];

  const trackPath = path.join(process.cwd(), "data", "uploads", sermon.id, "face_track.json");
  if (fs.existsSync(trackPath)) {
    args.push("--face-track-json", trackPath);
  }

  await runCommand(resolvePythonBin(), args);
  return outFile;
}

export async function ensureSermonMp3(sermonId: string, mediaPath: string): Promise<string> {
  const safeMediaPath = assertSafeDataPath(mediaPath);
  const workDir = assertSafeDataPath(path.join(process.cwd(), "data", "uploads", sermonId));
  fs.mkdirSync(workDir, { recursive: true });
  const mp3Path = assertSafeDataPath(path.join(workDir, "sermon_spotify_192k.mp3"));

  const mediaStat = fs.statSync(safeMediaPath);
  const needEncode =
    !fs.existsSync(mp3Path) || fs.statSync(mp3Path).mtimeMs < mediaStat.mtimeMs;

  if (needEncode) {
    await runCommand("ffmpeg", [
      "-y",
      "-i",
      safeMediaPath,
      "-vn",
      "-ac",
      "2",
      "-ar",
      "44100",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      mp3Path,
    ]);
  }
  return mp3Path;
}
