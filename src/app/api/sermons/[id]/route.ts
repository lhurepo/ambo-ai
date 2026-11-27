import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { and, asc, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { chatMessages, clips, sermonAssets, sermons } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  ensureDbInitialized();

  const { id } = await context.params;
  const sermon = db
    .select()
    .from(sermons)
    .where(and(eq(sermons.id, id), eq(sermons.userId, user.id)))
    .get();
  if (!sermon) return NextResponse.json({ error: "Sermon not found" }, { status: 404 });

  const assetsRows = db
    .select()
    .from(sermonAssets)
    .where(eq(sermonAssets.sermonId, id))
    .all();

  const assets: Record<string, string> = {};
  for (const row of assetsRows) {
    assets[row.assetType] = row.content;
  }

  const clipRows = db
    .select()
    .from(clips)
    .where(eq(clips.sermonId, id))
    .orderBy(asc(clips.startMs))
    .all()
    .map((c) => ({
      ...c,
      captionSettings: (() => {
        try {
          return JSON.parse(c.captionSettingsJson);
        } catch {
          return {};
        }
      })(),
    }));

  const chats = db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.sermonId, id))
    .orderBy(asc(chatMessages.createdAt))
    .all();

  let segments = [];
  try {
    segments = sermon.segmentsJson ? JSON.parse(sermon.segmentsJson) : [];
  } catch {}

  let faceTrack = null;
  try {
    faceTrack = sermon.faceTrackJson ? JSON.parse(sermon.faceTrackJson) : null;
  } catch {}

  return NextResponse.json({
    sermon: {
      id: sermon.id,
      title: sermon.title,
      speaker: sermon.speaker,
      topic: sermon.topic,
      sourceType: sermon.sourceType,
      status: sermon.status,
      progress: sermon.progress,
      progressMessage: sermon.progressMessage,
      errorMessage: sermon.errorMessage,
      hasMedia: Boolean(sermon.mediaPath),
      hasManuscript: Boolean(sermon.manuscriptPath || sermon.manuscriptText),
      mediaFileName: sermon.mediaFileName,
      manuscriptFileName: sermon.manuscriptFileName,
      manuscriptText: sermon.manuscriptText,
      transcriptText: sermon.transcriptText,
      isVideo: Boolean(sermon.isVideo),
      durationSec: sermon.durationSec,
      clipsUnseen: Boolean(sermon.clipsUnseen),
      segments,
      faceTrack,
      createdAt: sermon.createdAt,
      updatedAt: sermon.updatedAt,
    },
    assets,
    clips: clipRows,
    chatMessages: chats,
  });
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  ensureDbInitialized();

  const { id } = await context.params;
  const sermon = db
    .select()
    .from(sermons)
    .where(and(eq(sermons.id, id), eq(sermons.userId, user.id)))
    .get();
  if (!sermon) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const updates: Partial<{
    title: string;
    speaker: string;
    topic: string;
    clipsUnseen: number;
    updatedAt: number;
  }> = { updatedAt: Date.now() };

  if (typeof body.title === "string" && body.title.trim()) updates.title = body.title.trim();
  if (typeof body.speaker === "string") updates.speaker = body.speaker.trim();
  if (typeof body.topic === "string" && body.topic.trim()) updates.topic = body.topic.trim();
  if (typeof body.clipsUnseen === "boolean") updates.clipsUnseen = body.clipsUnseen ? 1 : 0;

  db.update(sermons).set(updates).where(eq(sermons.id, id)).run();
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  ensureDbInitialized();

  const { id } = await context.params;
  const sermon = db
    .select()
    .from(sermons)
    .where(and(eq(sermons.id, id), eq(sermons.userId, user.id)))
    .get();
  if (!sermon) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { searchParams } = new URL(req.url);
  if (searchParams.get("only") === "manuscript") {
    if (sermon.manuscriptPath) fs.rmSync(sermon.manuscriptPath, { force: true });
    db.update(sermons)
      .set({
        manuscriptPath: null,
        manuscriptFileName: null,
        manuscriptText: null,
        sourceType: sermon.mediaPath ? "media" : "manuscript",
        updatedAt: Date.now(),
      })
      .where(eq(sermons.id, id))
      .run();
    return NextResponse.json({ ok: true });
  }

  db.delete(chatMessages).where(eq(chatMessages.sermonId, id)).run();
  db.delete(clips).where(eq(clips.sermonId, id)).run();
  db.delete(sermonAssets).where(eq(sermonAssets.sermonId, id)).run();
  db.delete(sermons).where(eq(sermons.id, id)).run();

  fs.rmSync(path.join(process.cwd(), "data", "uploads", id), { recursive: true, force: true });
  fs.rmSync(path.join(process.cwd(), "data", "renders", id), { recursive: true, force: true });

  return NextResponse.json({ ok: true });
}
