import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { desc, eq, and } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { clips, sermonAssets, sermons } from "@/lib/db/schema";
import { ensureUserAiSettings, getCurrentUser } from "@/lib/auth";
import { startSermonPipeline } from "@/lib/jobs/pipeline";
import { checkRateLimit } from "@/lib/rate-limit";
import { assertSafeDataPath, isValidUuid, logAuditEvent, safeErrorResponse } from "@/lib/security";

const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const MAX_MANUSCRIPT_BYTES = 25 * 1024 * 1024; // 25 MB

function parseTagsJson(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter((t): t is string => typeof t === "string" && t.trim().length > 0).slice(0, 12)
      : [];
  } catch {
    return [];
  }
}

function normalizeTagInput(raw: FormDataEntryValue | null): string[] {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((s) => s.trim().slice(0, 32))
    .filter(Boolean)
    .slice(0, 12);
}

function makeSnippet(text: string, q: string, maxLen = 115): string {
  const clean = text.replace(/[#*_>`]/g, "").replace(/\s+/g, " ").trim();
  const idx = clean.toLowerCase().indexOf(q);
  if (idx === -1) return clean.slice(0, maxLen) + (clean.length > maxLen ? "..." : "");
  const start = Math.max(0, idx - 32);
  const end = Math.min(clean.length, idx + q.length + 68);
  return (
    (start > 0 ? "..." : "") +
    clean.slice(start, end).trim() +
    (end < clean.length ? "..." : "")
  );
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  ensureDbInitialized();
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim().toLowerCase();
  const filter = searchParams.get("filter") || "all";
  const seriesFilter = (searchParams.get("series") || "").trim();

  const rows = db
    .select({
      id: sermons.id,
      title: sermons.title,
      speaker: sermons.speaker,
      topic: sermons.topic,
      seriesName: sermons.seriesName,
      tagsJson: sermons.tagsJson,
      sourceType: sermons.sourceType,
      status: sermons.status,
      progress: sermons.progress,
      progressMessage: sermons.progressMessage,
      errorMessage: sermons.errorMessage,
      mediaFileName: sermons.mediaFileName,
      manuscriptFileName: sermons.manuscriptFileName,
      isVideo: sermons.isVideo,
      durationSec: sermons.durationSec,
      clipsUnseen: sermons.clipsUnseen,
      transcriptText: sermons.transcriptText,
      manuscriptText: sermons.manuscriptText,
      segmentsJson: sermons.segmentsJson,
      createdAt: sermons.createdAt,
      updatedAt: sermons.updatedAt,
    })
    .from(sermons)
    .where(eq(sermons.userId, user.id))
    .orderBy(desc(sermons.createdAt))
    .all();

  const allSeries = Array.from(
    new Set(rows.map((r) => (r.seriesName || "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  // Batch clip counts in one query instead of N+1 per sermon
  const clipCountMap = new Map<string, number>();
  for (const c of db.select({ sermonId: clips.sermonId }).from(clips).all()) {
    clipCountMap.set(c.sermonId, (clipCountMap.get(c.sermonId) || 0) + 1);
  }

  // Only load sermon_assets when performing a search query >= 2 chars
  const assetsBySermon = new Map<string, Array<{ assetType: string; content: string }>>();
  if (q.length >= 2) {
    const sermonIdSet = new Set(rows.map((r) => r.id));
    for (const a of db
      .select({
        sermonId: sermonAssets.sermonId,
        assetType: sermonAssets.assetType,
        content: sermonAssets.content,
      })
      .from(sermonAssets)
      .all()) {
      if (!sermonIdSet.has(a.sermonId)) continue;
      const list = assetsBySermon.get(a.sermonId) || [];
      list.push({ assetType: a.assetType, content: a.content });
      assetsBySermon.set(a.sermonId, list);
    }
  }

  type SearchMatch = {
    kind: "transcript" | "scripture" | "quotes" | "notes";
    snippet: string;
    startSec: number | null;
  };

  const results = [];
  for (const r of rows) {
    if (filter === "media" && r.sourceType === "manuscript") continue;
    if (filter === "manuscript" && r.sourceType === "media") continue;
    if (seriesFilter && (r.seriesName || "").trim() !== seriesFilter) continue;

    const tags = parseTagsJson(r.tagsJson);
    const searchMatches: SearchMatch[] = [];

    if (q) {
      const metaHay = `${r.title} ${r.topic} ${r.speaker} ${r.seriesName} ${tags.join(" ")} ${
        r.mediaFileName || ""
      } ${r.manuscriptFileName || ""}`.toLowerCase();
      let matched = metaHay.includes(q);

      if (q.length >= 2) {
        if (r.segmentsJson && r.segmentsJson.toLowerCase().includes(q)) {
          try {
            const segs = JSON.parse(r.segmentsJson) as Array<{ start: number; text: string }>;
            for (const seg of segs) {
              if (seg.text && seg.text.toLowerCase().includes(q)) {
                searchMatches.push({
                  kind: "transcript",
                  snippet: makeSnippet(seg.text, q),
                  startSec: Math.max(0, Math.floor(seg.start || 0)),
                });
                matched = true;
                if (searchMatches.length >= 2) break;
              }
            }
          } catch {}
        } else if (r.transcriptText && r.transcriptText.toLowerCase().includes(q)) {
          searchMatches.push({
            kind: "transcript",
            snippet: makeSnippet(r.transcriptText, q),
            startSec: 0,
          });
          matched = true;
        }

        if (r.manuscriptText && r.manuscriptText.toLowerCase().includes(q) && searchMatches.length < 3) {
          searchMatches.push({
            kind: "notes",
            snippet: makeSnippet(r.manuscriptText, q),
            startSec: null,
          });
          matched = true;
        }

        const assetsList = assetsBySermon.get(r.id) || [];
        for (const a of assetsList) {
          if (searchMatches.length >= 3) break;
          if (a.content.toLowerCase().includes(q)) {
            const kind: SearchMatch["kind"] =
              a.assetType === "scripture"
                ? "scripture"
                : a.assetType === "quotes"
                  ? "quotes"
                  : "notes";
            searchMatches.push({
              kind,
              snippet: makeSnippet(a.content, q),
              startSec: null,
            });
            matched = true;
          }
        }
      }

      if (!matched) continue;
    }

    results.push({
      id: r.id,
      title: r.title,
      speaker: r.speaker,
      topic: r.topic,
      seriesName: r.seriesName || "",
      tags,
      sourceType: r.sourceType,
      status: r.status,
      progress: r.progress,
      progressMessage: r.progressMessage,
      errorMessage: r.errorMessage,
      mediaFileName: r.mediaFileName,
      manuscriptFileName: r.manuscriptFileName,
      isVideo: r.isVideo,
      durationSec: r.durationSec,
      clipsUnseen: r.clipsUnseen,
      clipCount: clipCountMap.get(r.id) || 0,
      searchMatches,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    });
  }

  return NextResponse.json({ sermons: results, allSeries });
}

export async function POST(req: Request) {
  // Handle streaming/multipart upload or attach manuscript/media to existing sermon
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    ensureDbInitialized();

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const kind = String(formData.get("kind") || "auto"); // media | manuscript | auto
    const attachToId = formData.get("sermonId") ? String(formData.get("sermonId")) : null;
    const customTitle = formData.get("title") ? String(formData.get("title")).trim() : "";
    const seriesName = formData.get("seriesName")
      ? String(formData.get("seriesName")).trim().slice(0, 100)
      : "";
    const tags = normalizeTagInput(formData.get("tags"));

    if (!file) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }

    const rl = checkRateLimit(`upload:${user.id}`, 15, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many uploads. Wait ${rl.retryAfterSec}s.` },
        { status: 429 }
      );
    }

    const originalName = file.name || "sermon-upload";
    const ext = path.extname(originalName).toLowerCase();
    const isMediaExt = [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".mp3", ".wav", ".m4a", ".mpeg", ".ogg", ".aac"].includes(ext);
    const detectedKind = kind === "auto" ? (isMediaExt ? "media" : "manuscript") : kind;

    const sizeLimit = detectedKind === "media" ? MAX_MEDIA_BYTES : MAX_MANUSCRIPT_BYTES;
    if (file.size > sizeLimit) {
      return NextResponse.json(
        {
          error:
            detectedKind === "media"
              ? "Media file exceeds 2 GB maximum."
              : "Manuscript file exceeds 25 MB maximum.",
        },
        { status: 413 }
      );
    }

    if (attachToId && !isValidUuid(attachToId)) {
      return NextResponse.json({ error: "Invalid sermon id." }, { status: 400 });
    }

    const sermonId = attachToId || crypto.randomUUID();
    const workDir = assertSafeDataPath(path.join(process.cwd(), "data", "uploads", sermonId));
    fs.mkdirSync(workDir, { recursive: true });

    const safeName = path.basename(originalName).replace(/[^a-zA-Z0-9._-]/g, "_") || "upload.bin";
    const targetPath = assertSafeDataPath(path.join(workDir, `${detectedKind}_${safeName}`));
    const arrayBuf = await file.arrayBuffer();
    fs.writeFileSync(targetPath, Buffer.from(arrayBuf));

    const now = Date.now();
    const cleanTitle =
      customTitle ||
      path
        .basename(originalName, ext)
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim() ||
      "Untitled Sermon";

    if (attachToId) {
      const existing = db
        .select()
        .from(sermons)
        .where(and(eq(sermons.id, attachToId), eq(sermons.userId, user.id)))
        .get();
      if (!existing) {
        return NextResponse.json({ error: "Sermon not found." }, { status: 404 });
      }

      const nextSourceType =
        (detectedKind === "media" && existing.manuscriptPath) ||
        (detectedKind === "manuscript" && existing.mediaPath)
          ? "both"
          : detectedKind;

      if (detectedKind === "media") {
        db.update(sermons)
          .set({
            mediaPath: targetPath,
            mediaMime: file.type || "video/mp4",
            mediaFileName: originalName,
            sourceType: nextSourceType,
            status: "queued",
            progress: 5,
            progressMessage: "Media attached — starting transcription...",
            updatedAt: now,
          })
          .where(eq(sermons.id, sermonId))
          .run();
      } else {
        db.update(sermons)
          .set({
            manuscriptPath: targetPath,
            manuscriptFileName: originalName,
            manuscriptText: null,
            sourceType: nextSourceType,
            status: "queued",
            progress: 5,
            progressMessage: "Manuscript attached — reprocessing...",
            updatedAt: now,
          })
          .where(eq(sermons.id, sermonId))
          .run();
      }
    } else {
      const userSettings = ensureUserAiSettings(user.id);
      db.insert(sermons)
        .values({
          id: sermonId,
          userId: user.id,
          title: cleanTitle,
          speaker: userSettings.defaultSpeaker || user.fullName || "",
          topic: "Analyzing...",
          seriesName,
          tagsJson: JSON.stringify(tags),
          sourceType: detectedKind,
          status: "queued",
          progress: 4,
          progressMessage: "Upload complete — queued for processing...",
          mediaPath: detectedKind === "media" ? targetPath : null,
          mediaMime: detectedKind === "media" ? file.type || "video/mp4" : null,
          mediaFileName: detectedKind === "media" ? originalName : null,
          manuscriptPath: detectedKind === "manuscript" ? targetPath : null,
          manuscriptFileName: detectedKind === "manuscript" ? originalName : null,
          isVideo: detectedKind === "media" && ![".mp3", ".wav", ".m4a", ".ogg", ".aac"].includes(ext) ? 1 : 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }

    startSermonPipeline(sermonId);
    logAuditEvent(user.id, "sermon_uploaded", `${sermonId}:${detectedKind}`);
    return NextResponse.json({ ok: true, sermonId });
  } catch (err) {
    return safeErrorResponse(err, "Upload could not be processed.");
  }
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = String(searchParams.get("id") || "");
  if (!isValidUuid(id)) return NextResponse.json({ error: "Invalid sermon id" }, { status: 400 });

  ensureDbInitialized();
  const row = db.select().from(sermons).where(and(eq(sermons.id, id), eq(sermons.userId, user.id))).get();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });

  db.delete(clips).where(eq(clips.sermonId, id)).run();
  db.delete(sermonAssets).where(eq(sermonAssets.sermonId, id)).run();
  db.delete(sermons).where(eq(sermons.id, id)).run();

  const upDir = assertSafeDataPath(path.join(process.cwd(), "data", "uploads", id));
  const renDir = assertSafeDataPath(path.join(process.cwd(), "data", "renders", id));
  fs.rmSync(upDir, { recursive: true, force: true });
  fs.rmSync(renDir, { recursive: true, force: true });

  logAuditEvent(user.id, "sermon_deleted", id);
  return NextResponse.json({ ok: true });
}
