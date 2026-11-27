import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { sermons } from "@/lib/db/schema";
import { ensureUserAiSettings, getCurrentUser } from "@/lib/auth";
import { segmentsToSrt, segmentsToVtt } from "@/lib/captions";
import { saveBufferToExportDir } from "@/lib/local-export";
import { isValidUuid, safeErrorResponse } from "@/lib/security";
import type { TranscriptSegment } from "@/lib/types";

export async function GET(
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
    if (!sermon) {
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }

    let segments: TranscriptSegment[] = [];
    try {
      segments = sermon.segmentsJson ? JSON.parse(sermon.segmentsJson) : [];
    } catch {}

    const fallbackText = sermon.transcriptText || sermon.manuscriptText || "";
    if (segments.length === 0 && !fallbackText.trim()) {
      return NextResponse.json(
        { error: "No transcript available yet for captions." },
        { status: 404 }
      );
    }

    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format") === "vtt" ? "vtt" : "srt";
    const content =
      format === "vtt"
        ? segmentsToVtt(segments, fallbackText, sermon.durationSec)
        : segmentsToSrt(segments, fallbackText, sermon.durationSec);

    const slug =
      sermon.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "sermon";
    const fileName = `${slug}-captions.${format}`;

    if (searchParams.get("saveToDisk") === "1") {
      const settings = ensureUserAiSettings(user.id);
      const targetDir = settings.mediaExportDir || settings.pdfExportDir;
      if (!targetDir) {
        return NextResponse.json(
          { error: "No download folder configured in Settings." },
          { status: 400 }
        );
      }
      const saved = saveBufferToExportDir(targetDir, fileName, Buffer.from(content, "utf8"));
      return NextResponse.json({ ok: true, ...saved });
    }

    return new NextResponse(content, {
      status: 200,
      headers: {
        "Content-Type": format === "vtt" ? "text/vtt; charset=utf-8" : "application/x-subrip; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return safeErrorResponse(err, "Could not export captions.");
  }
}
