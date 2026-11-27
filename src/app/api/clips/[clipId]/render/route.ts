import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { clips, sermons } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { renderClipMp4 } from "@/lib/jobs/pipeline";
import { isValidUuid, safeErrorResponse } from "@/lib/security";

export async function POST(
  _req: Request,
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

    const outPath = await renderClipMp4(clipId);
    return NextResponse.json({ ok: true, renderStatus: "completed", renderedPath: outPath });
  } catch (err) {
    return safeErrorResponse(err, "Clip rendering failed.");
  }
}
