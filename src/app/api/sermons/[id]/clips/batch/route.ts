import { NextResponse } from "next/server";
import archiver from "archiver";
import fs from "fs";
import path from "path";
import { and, asc, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { clips, sermons } from "@/lib/db/schema";
import { ensureUserAiSettings, getCurrentUser } from "@/lib/auth";
import { renderClipMp4, renderClipThumbnailJpg } from "@/lib/jobs/pipeline";
import { copyFileToExportDir } from "@/lib/local-export";
import { assertSafeDataPath, isValidUuid, safeErrorResponse } from "@/lib/security";

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
    if (!sermon) return NextResponse.json({ error: "Sermon not found" }, { status: 404 });

    const body = await req.json().catch(() => ({}));
    const rawIds: string[] = Array.isArray(body.clipIds)
      ? body.clipIds.filter((c: unknown): c is string => typeof c === "string" && isValidUuid(c))
      : [];

    if (rawIds.length === 0) {
      return NextResponse.json({ error: "Select at least one clip to export." }, { status: 400 });
    }

    const wantedSet = new Set(rawIds);
    const allSermonClips = db
      .select()
      .from(clips)
      .where(eq(clips.sermonId, id))
      .orderBy(asc(clips.startMs))
      .all();

    const selectedClips = allSermonClips.filter((c) => wantedSet.has(c.id));
    if (selectedClips.length === 0) {
      return NextResponse.json({ error: "No matching clips found." }, { status: 404 });
    }

    const includeThumbnails = Boolean(body.includeThumbnails);
    const rendered: Array<{ fileStem: string; mp4Path: string; thumbPath: string | null }> = [];

    for (let i = 0; i < selectedClips.length; i++) {
      const c = selectedClips[i];
      const safeTitle =
        c.title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "") || `clip-${i + 1}`;
      const mp4Path =
        c.renderedPath && fs.existsSync(c.renderedPath) && c.renderStatus === "completed"
          ? c.renderedPath
          : await renderClipMp4(c.id);
      const thumbPath = includeThumbnails
        ? await renderClipThumbnailJpg(c.id).catch(() => null)
        : null;
      rendered.push({ fileStem: safeTitle, mp4Path, thumbPath });
    }

    const settings = ensureUserAiSettings(user.id);
    if (body.saveToDisk === true && settings.mediaExportDir) {
      let lastSaved = { savedPath: "", displayPath: "", fileName: "" };
      for (const item of rendered) {
        lastSaved = copyFileToExportDir(settings.mediaExportDir, `${item.fileStem}.mp4`, item.mp4Path);
        if (item.thumbPath && fs.existsSync(item.thumbPath)) {
          copyFileToExportDir(settings.mediaExportDir, `${item.fileStem}-cover.jpg`, item.thumbPath);
        }
      }
      return NextResponse.json({
        ok: true,
        count: rendered.length,
        savedPath: lastSaved.savedPath,
        displayPath: path.dirname(lastSaved.displayPath),
      });
    }

    const renderDir = assertSafeDataPath(path.join(process.cwd(), "data", "renders", id));
    fs.mkdirSync(renderDir, { recursive: true });
    const slug =
      sermon.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "clips";
    const tmpZip = assertSafeDataPath(path.join(renderDir, `${slug}-selected-tmp.zip`));

    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(tmpZip);
      const archive = archiver("zip", { zlib: { level: 5 } });
      out.on("close", () => resolve());
      out.on("error", reject);
      archive.on("error", reject);
      archive.pipe(out);
      rendered.forEach((item, idx) => {
        const prefix = `${String(idx + 1).padStart(2, "0")}-${item.fileStem}`;
        archive.file(item.mp4Path, { name: `${prefix}.mp4` });
        if (item.thumbPath && fs.existsSync(item.thumbPath)) {
          archive.file(item.thumbPath, { name: `${prefix}-cover.jpg` });
        }
      });
      archive.finalize();
    });

    const stat = fs.statSync(tmpZip);
    const stream = fs.createReadStream(tmpZip);
    stream.on("close", () => {
      fs.rmSync(tmpZip, { force: true });
    });

    const webStream = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) => controller.enqueue(chunk));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
      cancel() {
        stream.destroy();
        fs.rmSync(tmpZip, { force: true });
      },
    });

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${slug}-selected-clips.zip"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return safeErrorResponse(err, "Batch clip export failed.");
  }
}
