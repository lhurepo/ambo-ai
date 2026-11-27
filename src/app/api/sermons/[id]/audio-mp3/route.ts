import { NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { and, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { sermons } from "@/lib/db/schema";
import { ensureUserAiSettings, getCurrentUser } from "@/lib/auth";
import { copyFileToExportDir } from "@/lib/local-export";
import { assertSafeDataPath, isValidUuid, safeErrorResponse } from "@/lib/security";
import { withLocalBinPath } from "@/lib/env-path";

function runFfmpegMp3(inputPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      [
        "-y",
        "-i",
        inputPath,
        "-vn",
        "-ac",
        "2",
        "-ar",
        "44100",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        outputPath,
      ],
      { env: withLocalBinPath(), stdio: ["ignore", "ignore", "pipe"] }
    );
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`));
    });
    child.on("error", reject);
  });
}

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

    if (!sermon || !sermon.mediaPath || !fs.existsSync(sermon.mediaPath)) {
      return NextResponse.json(
        { error: "No audio/video media file attached to this sermon." },
        { status: 404 }
      );
    }

    const safeMediaPath = assertSafeDataPath(sermon.mediaPath);
    const workDir = path.join(process.cwd(), "data", "uploads", id);
    const mp3Path = assertSafeDataPath(path.join(workDir, "sermon_spotify_192k.mp3"));

    const mediaStat = fs.statSync(safeMediaPath);
    const needEncode =
      !fs.existsSync(mp3Path) || fs.statSync(mp3Path).mtimeMs < mediaStat.mtimeMs;

    if (needEncode) {
      await runFfmpegMp3(safeMediaPath, mp3Path);
    }

    const safeTitle =
      sermon.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "garden-church-sermon";
    const fileName = `${safeTitle}-audio.mp3`;

    const { searchParams } = new URL(req.url);
    if (searchParams.get("saveToDisk") === "1") {
      const settings = ensureUserAiSettings(user.id);
      if (!settings.mediaExportDir) {
        return NextResponse.json(
          { error: "No Video & Audio folder configured in Settings." },
          { status: 400 }
        );
      }
      const saved = copyFileToExportDir(settings.mediaExportDir, fileName, mp3Path);
      return NextResponse.json({ ok: true, ...saved });
    }

    const mp3Stat = fs.statSync(mp3Path);
    const stream = fs.createReadStream(mp3Path);
    const webStream = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) => controller.enqueue(chunk));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
      cancel() {
        stream.destroy();
      },
    });

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(mp3Stat.size),
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return safeErrorResponse(err, "Could not export MP3 audio.");
  }
}
