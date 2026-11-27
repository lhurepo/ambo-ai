import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { desc, eq, and } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { clips, sermonAssets, sermons } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { startSermonPipeline } from "@/lib/jobs/pipeline";
import { checkRateLimit } from "@/lib/rate-limit";
import { assertSafeDataPath, isValidUuid, logAuditEvent, safeErrorResponse } from "@/lib/security";

const MAX_MEDIA_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
const MAX_MANUSCRIPT_BYTES = 25 * 1024 * 1024; // 25 MB

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  ensureDbInitialized();
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim().toLowerCase();
  const filter = searchParams.get("filter") || "all";

  const rows = db
    .select({
      id: sermons.id,
      title: sermons.title,
      speaker: sermons.speaker,
      topic: sermons.topic,
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
      createdAt: sermons.createdAt,
      updatedAt: sermons.updatedAt,
    })
    .from(sermons)
    .where(eq(sermons.userId, user.id))
    .orderBy(desc(sermons.createdAt))
    .all();

  const filtered = rows.filter((r) => {
    if (filter === "media" && r.sourceType === "manuscript") return false;
    if (filter === "manuscript" && r.sourceType === "media") return false;
    if (q) {
      const hay = `${r.title} ${r.topic} ${r.speaker} ${r.mediaFileName || ""} ${r.manuscriptFileName || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  // Also attach clip count per sermon
  const withCounts = filtered.map((s) => {
    const clipCount = db.select({ id: clips.id }).from(clips).where(eq(clips.sermonId, s.id)).all().length;
    return { ...s, clipCount };
  });

  return NextResponse.json({ sermons: withCounts });
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
      db.insert(sermons)
        .values({
          id: sermonId,
          userId: user.id,
          title: cleanTitle,
          speaker: user.fullName || "",
          topic: "Analyzing...",
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
