import { NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { and, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { sermons } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { withLocalBinPath } from "@/lib/env-path";
import { assertSafeDataPath, isValidUuid, safeErrorResponse } from "@/lib/security";

const BUCKETS = 220;

function extractWaveformPeaks(mediaPath: string): Promise<number[]> {
  return new Promise((resolve) => {
    const child = spawn(
      "ffmpeg",
      ["-v", "error", "-i", mediaPath, "-vn", "-ac", "1", "-ar", "100", "-f", "s8", "-"],
      { env: withLocalBinPath(), stdio: ["ignore", "pipe", "ignore"] }
    );
    const chunks: Buffer[] = [];
    child.stdout.on("data", (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
    child.on("close", (code) => {
      if (code !== 0 || chunks.length === 0) {
        return resolve([]);
      }
      const raw = Buffer.concat(chunks);
      if (raw.length === 0) return resolve([]);
      const step = Math.max(1, Math.floor(raw.length / BUCKETS));
      const peaks: number[] = [];
      let maxVal = 1;
      for (let i = 0; i < BUCKETS; i++) {
        const start = Math.floor((i * raw.length) / BUCKETS);
        const end = Math.min(raw.length, Math.max(start + 1, Math.floor(((i + 1) * raw.length) / BUCKETS)));
        let sumSq = 0;
        let count = 0;
        for (let j = start; j < end; j += Math.max(1, Math.floor(step / 12))) {
          const v = raw.readInt8(j);
          sumSq += v * v;
          count++;
        }
        const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
        if (rms > maxVal) maxVal = rms;
        peaks.push(rms);
      }
      resolve(peaks.map((p) => Number(Math.max(0.08, Math.min(1, p / maxVal)).toFixed(3))));
    });
    child.on("error", () => resolve([]));
  });
}

export async function GET(
  _req: Request,
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

    if (!sermon.mediaPath || !fs.existsSync(sermon.mediaPath)) {
      return NextResponse.json({ peaks: [], durationSec: sermon.durationSec || 0 });
    }

    const safeMediaPath = assertSafeDataPath(sermon.mediaPath);
    const cachePath = assertSafeDataPath(
      path.join(process.cwd(), "data", "uploads", id, "waveform.json")
    );

    if (fs.existsSync(cachePath)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"));
        if (Array.isArray(cached.peaks) && cached.peaks.length > 0) {
          return NextResponse.json({
            peaks: cached.peaks,
            durationSec: sermon.durationSec || cached.durationSec || 0,
          });
        }
      } catch {}
    }

    const peaks = await extractWaveformPeaks(safeMediaPath);
    if (peaks.length > 0) {
      fs.writeFileSync(
        cachePath,
        JSON.stringify({ peaks, durationSec: sermon.durationSec || 0 }),
        "utf8"
      );
    }

    return NextResponse.json({ peaks, durationSec: sermon.durationSec || 0 });
  } catch (err) {
    return safeErrorResponse(err, "Could not load audio waveform.");
  }
}
