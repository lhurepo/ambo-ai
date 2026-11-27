import { NextResponse } from "next/server";
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { clips, sermons } from "@/lib/db/schema";
import { ensureUserAiSettings, getCurrentUser } from "@/lib/auth";
import { findMoreClipCandidates } from "@/lib/ai/generators";
import { DEFAULT_CAPTION_SETTINGS, type LlmProvider, type TranscriptSegment } from "@/lib/types";
import { isValidUuid, safeErrorResponse } from "@/lib/security";

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

    const body = await req.json();
    const segments: TranscriptSegment[] = sermon.segmentsJson ? JSON.parse(sermon.segmentsJson) : [];
    const existingClips = db.select().from(clips).where(eq(clips.sermonId, id)).all();
    const settings = ensureUserAiSettings(user.id);
    let captionDefaults = DEFAULT_CAPTION_SETTINGS;
    try {
      captionDefaults = { ...DEFAULT_CAPTION_SETTINGS, ...JSON.parse(settings.defaultCaptionSettingsJson || "{}") };
    } catch {}

    // Mode 1: Find more clips automatically
    if (body.mode === "find_more") {
      const candidates = await findMoreClipCandidates({
        segments,
        transcriptText: sermon.transcriptText || "",
        existingRanges: existingClips.map((c) => ({ startMs: c.startMs, endMs: c.endMs })),
        config: {
          provider: (settings.llmProvider as LlmProvider) || "offline",
          apiKey: settings.decryptedApiKey || "",
          baseUrl: settings.baseUrl,
          model: settings.model,
        },
      });
      const now = Date.now();
      const inserted = [];
      for (const cand of candidates) {
        const row = {
          id: crypto.randomUUID(),
          sermonId: id,
          title: cand.title,
          category: cand.category,
          startMs: cand.startMs,
          endMs: cand.endMs,
          transcriptExcerpt: cand.transcriptExcerpt,
          captionSettingsJson: JSON.stringify(captionDefaults),
          renderStatus: "pending",
          renderedPath: null,
          renderError: null,
          createdAt: now,
          updatedAt: now,
        };
        db.insert(clips).values(row).run();
        inserted.push({ ...row, captionSettings: captionDefaults });
      }
      return NextResponse.json({ ok: true, clips: inserted });
    }

    // Mode 2: Create custom clip with duplicate-clip detection
    const startMs = Math.max(0, Math.round(Number(body.startMs ?? 0)));
    const endMs = Math.max(startMs + 1000, Math.round(Number(body.endMs ?? startMs + 15000)));

    const duplicate = existingClips.find(
      (c) => Math.abs(c.startMs - startMs) < 1500 && Math.abs(c.endMs - endMs) < 1500
    );
    if (duplicate && !body.allowDuplicate) {
      return NextResponse.json({
        duplicate: true,
        existingClip: {
          ...duplicate,
          captionSettings: JSON.parse(duplicate.captionSettingsJson || "{}"),
        },
        message: "Good news! This clip already exists.",
      });
    }

    const allWords = segments.flatMap((s) => s.words || []);
    const excerpt =
      String(body.transcriptExcerpt || "").trim() ||
      allWords
        .filter((w) => w.end > startMs / 1000 && w.start < endMs / 1000)
        .map((w) => w.word)
        .join(" ")
        .trim();

    const userCount = existingClips.filter((c) => c.category === "userCreated").length + 1;
    const title = String(body.title || "").trim() || `My Clip ${userCount}`;
    const captionSettings = body.captionSettings ? { ...captionDefaults, ...body.captionSettings } : captionDefaults;
    const now = Date.now();

    const row = {
      id: crypto.randomUUID(),
      sermonId: id,
      title,
      category: "userCreated",
      startMs,
      endMs,
      transcriptExcerpt: excerpt,
      captionSettingsJson: JSON.stringify(captionSettings),
      renderStatus: "pending",
      renderedPath: null,
      renderError: null,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(clips).values(row).run();
    return NextResponse.json({ ok: true, clip: { ...row, captionSettings } });
  } catch (err) {
    return safeErrorResponse(err, "Could not create clip.");
  }
}
