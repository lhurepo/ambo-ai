import { NextResponse } from "next/server";
import archiver from "archiver";
import fs from "fs";
import path from "path";
import { and, asc, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { clips, sermonAssets, sermons } from "@/lib/db/schema";
import { ensureUserAiSettings, getCurrentUser } from "@/lib/auth";
import { generateOfflineBundle } from "@/lib/ai/offline-engine";
import { GENERATION_PROMPT_SLOTS } from "@/lib/ai/default-generation-prompts";
import { segmentsToSrt, segmentsToVtt } from "@/lib/captions";
import { ensureSermonMp3, renderClipMp4, renderClipThumbnailJpg } from "@/lib/jobs/pipeline";
import { createDatedExportSubfolder } from "@/lib/local-export";
import { renderGardenChurchPdf, type GardenPdfSection } from "@/lib/pdf/garden-pdf";
import { assertSafeDataPath, isValidUuid, logAuditEvent, safeErrorResponse } from "@/lib/security";
import { DEFAULT_PDF_DESIGN, type PdfDesignSpec, type TranscriptSegment } from "@/lib/types";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    ensureDbInitialized();

    const { id } = await context.params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "Invalid sermon id" }, { status: 400 });
    }

    const sermon = db
      .select()
      .from(sermons)
      .where(and(eq(sermons.id, id), eq(sermons.userId, user.id)))
      .get();
    if (!sermon) return NextResponse.json({ error: "Sermon not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const settings = ensureUserAiSettings(user.id);

    const savedRows = db.select().from(sermonAssets).where(eq(sermonAssets.sermonId, id)).all();
    const assetsMap = new Map(savedRows.map((r) => [r.assetType, r.content]));

    let segments: TranscriptSegment[] = [];
    try {
      segments = sermon.segmentsJson ? JSON.parse(sermon.segmentsJson) : [];
    } catch {}

    const sourceText = sermon.transcriptText || sermon.manuscriptText || sermon.title;
    const offlineFallback = generateOfflineBundle({
      title: sermon.title,
      text: sourceText,
      segments,
      durationSec: sermon.durationSec || 180,
    });

    const getAsset = (key: string) => assetsMap.get(key)?.trim() || offlineFallback.assets[key] || "";

    let pdfDesign: PdfDesignSpec = DEFAULT_PDF_DESIGN;
    try {
      const parsed = JSON.parse(settings.defaultPdfDesignJson || "{}");
      pdfDesign = {
        ...DEFAULT_PDF_DESIGN,
        ...parsed,
        palette: { ...DEFAULT_PDF_DESIGN.palette, ...(parsed.palette || {}) },
      };
    } catch {}
    if (!pdfDesign.qrUrl && sermon.youtubeUrl) {
      pdfDesign = { ...pdfDesign, showQrCode: true, qrUrl: sermon.youtubeUrl };
    }

    const pdfSectionKeys = ["overview", "points", "scripture", "discussion_questions"];
    const pdfSections: GardenPdfSection[] = pdfSectionKeys
      .map((k) => ({
        title: GENERATION_PROMPT_SLOTS.find((s) => s.key === k)?.label || k,
        content: getAsset(k),
      }))
      .filter((s) => s.content.trim().length > 0);

    const dateLabel = new Date(sermon.createdAt).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    const speaker = sermon.speaker || settings.defaultSpeaker || user.fullName || "The Garden Church";

    const [guidePdf, bulletinPdf, answerKeyPdf] = await Promise.all([
      renderGardenChurchPdf({
        sermonTitle: sermon.title,
        speaker,
        topic: sermon.topic || undefined,
        dateLabel,
        documentTitle: "Sermon Notes & Discussion Guide",
        sections: pdfSections,
        includeNoteLines: true,
        design: { ...pdfDesign, fillInTheBlanks: false },
      }),
      renderGardenChurchPdf({
        sermonTitle: sermon.title,
        speaker,
        topic: sermon.topic || undefined,
        dateLabel,
        documentTitle: "Sunday Bulletin",
        sections: pdfSections,
        includeNoteLines: true,
        answerKeyMode: false,
        design: { ...pdfDesign, fillInTheBlanks: true },
      }),
      renderGardenChurchPdf({
        sermonTitle: sermon.title,
        speaker,
        topic: sermon.topic || undefined,
        dateLabel,
        documentTitle: "Sunday Bulletin",
        sections: pdfSections,
        includeNoteLines: false,
        answerKeyMode: true,
        design: { ...pdfDesign, fillInTheBlanks: true },
      }),
    ]);

    const showNotesMd = getAsset("podcast_show_notes");
    const commsParts = [
      `# ${sermon.title}\n\nSpeaker: ${speaker} | Topic: ${sermon.topic}\n`,
      "email_recap",
      "blog_post",
      "social_instagram",
      "social_facebook",
      "social_twitter",
      "social_captions",
      "discussion_questions",
      "small_group_guide",
      "devotional",
    ].map((k, idx) =>
      idx === 0
        ? k
        : `\n---\n\n## ${k.replace(/_/g, " ").toUpperCase()}\n\n${getAsset(k)}\n`
    );

    const hasMedia = Boolean(sermon.mediaPath && fs.existsSync(sermon.mediaPath));
    let mp3Path: string | null = null;
    if (hasMedia && sermon.mediaPath) {
      mp3Path = await ensureSermonMp3(id, sermon.mediaPath).catch(() => null);
    }

    const srtContent =
      segments.length > 0 || sourceText.trim()
        ? segmentsToSrt(segments, sourceText, sermon.durationSec || 180)
        : "";
    const vttContent =
      segments.length > 0 || sourceText.trim()
        ? segmentsToVtt(segments, sourceText, sermon.durationSec || 180)
        : "";

    const clipRows = db
      .select()
      .from(clips)
      .where(eq(clips.sermonId, id))
      .orderBy(asc(clips.startMs))
      .all()
      .slice(0, 3);

    const renderedClips: Array<{ baseName: string; mp4Path: string; thumbPath: string | null }> = [];
    if (hasMedia) {
      for (let i = 0; i < clipRows.length; i++) {
        const c = clipRows[i];
        const safeClip =
          c.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "") || `clip-${i + 1}`;
        try {
          const mp4Path =
            c.renderedPath && fs.existsSync(c.renderedPath) && c.renderStatus === "completed"
              ? c.renderedPath
              : await renderClipMp4(c.id);
          const thumbPath = await renderClipThumbnailJpg(c.id).catch(() => null);
          renderedClips.push({
            baseName: `${String(i + 1).padStart(2, "0")}-${safeClip}`,
            mp4Path,
            thumbPath,
          });
        } catch {
          // Continue assembling remaining Launch Pack assets if one clip fails
        }
      }
    }

    const entries: Array<{ relPath: string; buffer?: Buffer; srcFile?: string }> = [
      { relPath: "01-garden-sermon-guide.pdf", buffer: guidePdf },
      { relPath: "02-sunday-bulletin-fill-in-blanks.pdf", buffer: bulletinPdf },
      { relPath: "03-small-group-leader-answer-key.pdf", buffer: answerKeyPdf },
      { relPath: "04-podcast-show-notes.md", buffer: Buffer.from(showNotesMd, "utf8") },
      { relPath: "05-social-and-comms-kit.md", buffer: Buffer.from(commsParts.join("\n"), "utf8") },
    ];
    if (mp3Path && fs.existsSync(mp3Path)) {
      entries.push({ relPath: "06-spotify-podcast-192k.mp3", srcFile: mp3Path });
    }
    if (srtContent) {
      entries.push({ relPath: "07-captions.srt", buffer: Buffer.from(srtContent, "utf8") });
    }
    if (vttContent) {
      entries.push({ relPath: "08-captions.vtt", buffer: Buffer.from(vttContent, "utf8") });
    }
    for (const rc of renderedClips) {
      entries.push({ relPath: `clips/${rc.baseName}.mp4`, srcFile: rc.mp4Path });
      if (rc.thumbPath && fs.existsSync(rc.thumbPath)) {
        entries.push({ relPath: `clips/${rc.baseName}-cover.jpg`, srcFile: rc.thumbPath });
      }
    }

    const baseExportDir = settings.mediaExportDir || settings.pdfExportDir;
    if (body.saveToDisk === true && baseExportDir) {
      const folder = createDatedExportSubfolder(baseExportDir, sermon.title);
      for (const item of entries) {
        const dest = path.resolve(folder.absDir, item.relPath);
        if (!dest.startsWith(folder.absDir + path.sep)) continue;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (item.buffer) fs.writeFileSync(dest, item.buffer);
        else if (item.srcFile) fs.copyFileSync(item.srcFile, dest);
      }
      logAuditEvent(user.id, "sunday_launch_pack_saved", `${id}:${entries.length}`);
      return NextResponse.json({
        ok: true,
        savedPath: folder.absDir,
        displayPath: folder.displayDir,
        fileCount: entries.length,
      });
    }

    const renderDir = assertSafeDataPath(path.join(process.cwd(), "data", "renders", id));
    fs.mkdirSync(renderDir, { recursive: true });
    const slug =
      sermon.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "sermon";
    const tmpZip = assertSafeDataPath(path.join(renderDir, `${slug}-launch-pack-tmp.zip`));

    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(tmpZip);
      const archive = archiver("zip", { zlib: { level: 5 } });
      out.on("close", () => resolve());
      out.on("error", reject);
      archive.on("error", reject);
      archive.pipe(out);
      for (const item of entries) {
        if (item.buffer) archive.append(item.buffer, { name: item.relPath });
        else if (item.srcFile) archive.file(item.srcFile, { name: item.relPath });
      }
      archive.finalize();
    });

    const zipStat = fs.statSync(tmpZip);
    const stream = fs.createReadStream(tmpZip);
    stream.on("close", () => {
      fs.rmSync(tmpZip, { force: true });
    });

    const webStream = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) => controller.enqueue(chunk));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
      cancel() {
        stream.destroy();
        fs.rmSync(tmpZip, { force: true });
      },
    });

    logAuditEvent(user.id, "sunday_launch_pack_zip", `${id}:${entries.length}`);
    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(zipStat.size),
        "Content-Disposition": `attachment; filename="${slug}-sunday-launch-pack.zip"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return safeErrorResponse(err, "Could not create Sunday Launch Pack.");
  }
}
