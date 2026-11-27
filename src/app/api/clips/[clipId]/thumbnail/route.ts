import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { and, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { clips, sermons } from "@/lib/db/schema";
import { ensureUserAiSettings, getCurrentUser } from "@/lib/auth";
import { renderClipThumbnailJpg } from "@/lib/jobs/pipeline";
import { copyFileToExportDir } from "@/lib/local-export";
import { assertSafeDataPath, isValidUuid, safeErrorResponse } from "@/lib/security";

export async function GET(
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

    const { searchParams } = new URL(req.url);
    const refresh = searchParams.get("refresh") === "1";

    const expectedPath = assertSafeDataPath(
      path.join(process.cwd(), "data", "renders", sermon.id, `${clipId}_cover.jpg`)
    );
    const needRender =
      refresh ||
      !fs.existsSync(expectedPath) ||
      fs.statSync(expectedPath).mtimeMs < clip.updatedAt;

    const thumbPath = needRender ? await renderClipThumbnailJpg(clipId) : expectedPath;

    const slug =
      clip.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "clip";
    const fileName = `${slug}-cover.jpg`;

    if (searchParams.get("saveToDisk") === "1") {
      const settings = ensureUserAiSettings(user.id);
      const targetDir = settings.mediaExportDir || settings.pdfExportDir;
      if (!targetDir) {
        return NextResponse.json(
          { error: "No Video & Audio folder configured in Settings." },
          { status: 400 }
        );
      }
      const saved = copyFileToExportDir(targetDir, fileName, thumbPath);
      return NextResponse.json({ ok: true, ...saved });
    }

    const buf = fs.readFileSync(thumbPath);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(buf.length),
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return safeErrorResponse(err, "Could not generate clip cover image.");
  }
}
