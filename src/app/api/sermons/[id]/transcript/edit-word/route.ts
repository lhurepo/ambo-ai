import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { clips, sermons } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isValidUuid, safeErrorResponse } from "@/lib/security";
import type { TranscriptSegment } from "@/lib/types";

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
    if (!sermon) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { segmentIdx, wordIdx, newWord } = await req.json();
    const cleanedWord = String(newWord || "").trim();
    if (!cleanedWord) {
      return NextResponse.json({ error: "Word cannot be empty" }, { status: 400 });
    }

    const segments: TranscriptSegment[] = sermon.segmentsJson ? JSON.parse(sermon.segmentsJson) : [];
    const seg = segments[Number(segmentIdx)];
    if (!seg || !seg.words || !seg.words[Number(wordIdx)]) {
      return NextResponse.json({ error: "Word position not found" }, { status: 404 });
    }

    seg.words[Number(wordIdx)].word = cleanedWord;
    seg.text = seg.words.map((w) => w.word).join(" ");
    const fullText = segments.map((s) => s.text).join(" ").trim();

    db.update(sermons)
      .set({
        segmentsJson: JSON.stringify(segments),
        transcriptText: fullText,
        updatedAt: Date.now(),
      })
      .where(eq(sermons.id, id))
      .run();

    // Update excerpts on matching clips
    const allWords = segments.flatMap((s) => s.words || []);
    const sermonClips = db.select().from(clips).where(eq(clips.sermonId, id)).all();
    for (const c of sermonClips) {
      const startSec = c.startMs / 1000;
      const endSec = c.endMs / 1000;
      const excerpt = allWords
        .filter((w) => w.end > startSec && w.start < endSec)
        .map((w) => w.word)
        .join(" ")
        .trim();
      if (excerpt) {
        db.update(clips).set({ transcriptExcerpt: excerpt, updatedAt: Date.now() }).where(eq(clips.id, c.id)).run();
      }
    }

    return NextResponse.json({ ok: true, segments, transcriptText: fullText });
  } catch (err) {
    return safeErrorResponse(err, "Could not update transcript word.");
  }
}
