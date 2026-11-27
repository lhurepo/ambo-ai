import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { and, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { sermons } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";

function getMime(filePath: string, fallback: string | null): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".mp4" || ext === ".m4v") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".m4a") return "audio/mp4";
  if (ext === ".ogg") return "audio/ogg";
  return fallback || "application/octet-stream";
}

export async function GET(
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

  if (!sermon || !sermon.mediaPath || !fs.existsSync(sermon.mediaPath)) {
    return NextResponse.json({ error: "Media not found" }, { status: 404 });
  }

  const filePath = sermon.mediaPath;
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const contentType = getMime(filePath, sermon.mediaMime);
  const rangeHeader = req.headers.get("range");

  if (rangeHeader) {
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? Math.min(parseInt(match[2], 10), fileSize - 1) : Math.min(start + 1024 * 1024 * 2 - 1, fileSize - 1);
      if (start >= fileSize || start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${fileSize}` },
        });
      }
      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(filePath, { start, end });
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
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": contentType,
          "Cache-Control": "private, max-age=3600",
        },
      });
    }
  }

  const stream = fs.createReadStream(filePath);
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
      "Content-Length": String(fileSize),
      "Accept-Ranges": "bytes",
      "Content-Type": contentType,
    },
  });
}
