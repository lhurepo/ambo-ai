import { NextResponse } from "next/server";
import fs from "fs";
import { and, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { clips, sermons } from "@/lib/db/schema";
import { ensureUserAiSettings, getCurrentUser } from "@/lib/auth";
import { copyFileToExportDir } from "@/lib/local-export";
import { renderClipMp4 } from "@/lib/jobs/pipeline";
import { safeErrorResponse } from "@/lib/security";

export async function GET(
  req: Request,
  context: { params: Promise<{ clipId: string }> }
) {
  try {
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

    let mp4Path = clip.renderedPath;
    if (!mp4Path || !fs.existsSync(mp4Path) || clip.renderStatus !== "completed") {
      mp4Path = await renderClipMp4(clipId);
    }

    const safeName =
      clip.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "ambo-clip";
    const fileName = `${safeName}.mp4`;

    const { searchParams } = new URL(req.url);
    if (searchParams.get("saveToDisk") === "1") {
      const settings = ensureUserAiSettings(user.id);
      if (!settings.mediaExportDir) {
        return NextResponse.json(
          { error: "No Video & Audio folder configured in Settings." },
          { status: 400 }
        );
      }
      const saved = copyFileToExportDir(settings.mediaExportDir, fileName, mp4Path);
      return NextResponse.json({ ok: true, ...saved });
    }

    const stat = fs.statSync(mp4Path);
    const stream = fs.createReadStream(mp4Path);
    const webStream = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) => controller.enqueue(chunk));
        stream.on("end", () => controller.close());
        stream.on("error", (e) => controller.error(e));
      },
      cancel() {
        stream.destroy();
      },
    });

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, "Could not download clip.");
  }
}
