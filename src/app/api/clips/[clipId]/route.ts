import { NextResponse } from "next/server";
import fs from "fs";
import { and, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { aiSettings, clips, sermons } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { DEFAULT_CAPTION_SETTINGS } from "@/lib/types";
import { isValidUuid, safeErrorResponse } from "@/lib/security";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ clipId: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    ensureDbInitialized();

    const { clipId } = await context.params;
    if (!isValidUuid(clipId)) {
      return NextResponse.json({ error: "Invalid clip id" }, { status: 400 });
    }
    const clip = db.select().from(clips).where(eq(clips.id, clipId)).get();
    if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

    const sermon = db
      .select()
      .from(sermons)
      .where(and(eq(sermons.id, clip.sermonId), eq(sermons.userId, user.id)))
      .get();
    if (!sermon) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const updates: Partial<{
      title: string;
      startMs: number;
      endMs: number;
      captionSettingsJson: string;
      renderStatus: string;
      updatedAt: number;
    }> = { updatedAt: Date.now() };

    if (typeof body.title === "string" && body.title.trim()) {
      updates.title = body.title.trim();
    }
    if (typeof body.startMs === "number") {
      updates.startMs = Math.max(0, Math.round(body.startMs));
      updates.renderStatus = "pending";
    }
    if (typeof body.endMs === "number") {
      updates.endMs = Math.max((updates.startMs ?? clip.startMs) + 1000, Math.round(body.endMs));
      updates.renderStatus = "pending";
    }

    if (body.captionSettings && typeof body.captionSettings === "object") {
      let current = DEFAULT_CAPTION_SETTINGS;
      try {
        current = { ...DEFAULT_CAPTION_SETTINGS, ...JSON.parse(clip.captionSettingsJson || "{}") };
      } catch {}
      const merged = { ...current, ...body.captionSettings };
      updates.captionSettingsJson = JSON.stringify(merged);
      updates.renderStatus = "pending";

      if (body.applyToAll) {
        const allSermonClips = db.select().from(clips).where(eq(clips.sermonId, sermon.id)).all();
        for (const c of allSermonClips) {
          db.update(clips)
            .set({ captionSettingsJson: JSON.stringify(merged), renderStatus: "pending", updatedAt: Date.now() })
            .where(eq(clips.id, c.id))
            .run();
        }
        db.update(aiSettings)
          .set({ defaultCaptionSettingsJson: JSON.stringify(merged), updatedAt: Date.now() })
          .where(eq(aiSettings.userId, user.id))
          .run();
      }
    }

    db.update(clips).set(updates).where(eq(clips.id, clipId)).run();
    const updated = db.select().from(clips).where(eq(clips.id, clipId)).get();
    return NextResponse.json({
      ok: true,
      clip: updated ? { ...updated, captionSettings: JSON.parse(updated.captionSettingsJson) } : null,
    });
  } catch (err) {
    return safeErrorResponse(err, "Could not update clip.");
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ clipId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  ensureDbInitialized();

  const { clipId } = await context.params;
  const clip = db.select().from(clips).where(eq(clips.id, clipId)).get();
  if (!clip) return NextResponse.json({ error: "Clip not found" }, { status: 404 });

  const sermon = db
    .select()
    .from(sermons)
    .where(and(eq(sermons.id, clip.sermonId), eq(sermons.userId, user.id)))
    .get();
  if (!sermon) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (clip.renderedPath) fs.rmSync(clip.renderedPath, { force: true });
  db.delete(clips).where(eq(clips.id, clipId)).run();
  return NextResponse.json({ ok: true });
}
