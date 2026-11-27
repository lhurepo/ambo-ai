import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { and, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { sermons } from "@/lib/db/schema";
import { ensureUserAiSettings, getCurrentUser } from "@/lib/auth";
import { startSermonPipeline } from "@/lib/jobs/pipeline";
import { parseYoutubeVideoId } from "@/lib/youtube";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidUuid, logAuditEvent, safeErrorResponse } from "@/lib/security";

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    ensureDbInitialized();

    const rl = checkRateLimit(`yt:${user.id}`, 10, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many YouTube imports. Please wait ${rl.retryAfterSec}s.` },
        { status: 429 }
      );
    }

    const body = await req.json();
    const rawUrl = String(body.youtubeUrl || "");
    const customTitle = typeof body.title === "string" ? body.title.trim().slice(0, 160) : "";
    const seriesName = typeof body.seriesName === "string" ? body.seriesName.trim().slice(0, 100) : "";
    const tags = typeof body.tags === "string"
      ? body.tags
          .split(",")
          .map((t: string) => t.trim().slice(0, 32))
          .filter(Boolean)
          .slice(0, 12)
      : Array.isArray(body.tags)
        ? body.tags
            .filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0)
            .map((t: string) => t.trim().slice(0, 32))
            .slice(0, 12)
        : [];
    const attachToId = typeof body.sermonId === "string" ? body.sermonId.trim() : null;

    const parsed = parseYoutubeVideoId(rawUrl);
    if (!parsed) {
      return NextResponse.json(
        { error: "Please enter a valid youtube.com or youtu.be video link." },
        { status: 400 }
      );
    }

    const now = Date.now();
    if (attachToId) {
      if (!isValidUuid(attachToId)) {
        return NextResponse.json({ error: "Invalid sermon id." }, { status: 400 });
      }
      const existing = db
        .select()
        .from(sermons)
        .where(and(eq(sermons.id, attachToId), eq(sermons.userId, user.id)))
        .get();
      if (!existing) {
        return NextResponse.json({ error: "Sermon not found." }, { status: 404 });
      }

      db.update(sermons)
        .set({
          youtubeUrl: parsed.canonicalUrl,
          sourceType: existing.manuscriptPath ? "both" : "media",
          status: "queued",
          progress: 2,
          progressMessage: "Queued for YouTube import...",
          errorMessage: null,
          updatedAt: now,
        })
        .where(eq(sermons.id, attachToId))
        .run();

      startSermonPipeline(attachToId);
      logAuditEvent(user.id, "sermon_youtube_attached", `${attachToId}:${parsed.videoId}`);
      return NextResponse.json({ ok: true, sermonId: attachToId });
    }

    const sermonId = crypto.randomUUID();
    const workDir = path.join(process.cwd(), "data", "uploads", sermonId);
    fs.mkdirSync(workDir, { recursive: true });

    const userSettings = ensureUserAiSettings(user.id);
    db.insert(sermons)
      .values({
        id: sermonId,
        userId: user.id,
        title: customTitle || "YouTube Sermon",
        speaker: userSettings.defaultSpeaker || "",
        topic: "Faith & Discipleship",
        seriesName,
        tagsJson: JSON.stringify(tags),
        sourceType: "media",
        status: "queued",
        progress: 2,
        progressMessage: "Connecting to YouTube...",
        youtubeUrl: parsed.canonicalUrl,
        mediaFileName: `youtube_${parsed.videoId}.mp4`,
        isVideo: 1,
        durationSec: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    startSermonPipeline(sermonId);
    logAuditEvent(user.id, "sermon_youtube_created", `${sermonId}:${parsed.videoId}`);
    return NextResponse.json({ ok: true, sermonId });
  } catch (err) {
    return safeErrorResponse(err, "Could not start YouTube sermon import.");
  }
}
