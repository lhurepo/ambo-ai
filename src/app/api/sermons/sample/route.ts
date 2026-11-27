import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { db, ensureDbInitialized } from "@/lib/db";
import { sermons } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { withLocalBinPath } from "@/lib/env-path";
import { startSermonPipeline } from "@/lib/jobs/pipeline";
import { safeErrorResponse } from "@/lib/security";

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    ensureDbInitialized();

    const sermonId = crypto.randomUUID();
    const workDir = path.join(process.cwd(), "data", "uploads", sermonId);
    fs.mkdirSync(workDir, { recursive: true });

    const speechPath = path.join(workDir, "sample_speech.txt");
    const mediaPath = path.join(workDir, "media_peace_in_the_storm.mp4");
    const manuscriptPath = path.join(workDir, "manuscript_peace_in_the_storm.txt");

    const speechText =
      "Good morning church. Today we are looking at what Jesus promises when life feels overwhelming. " +
      "In Matthew chapter eleven verse twenty eight, Jesus says, Come to me, all you who are weary and burdened, and I will give you rest. " +
      "Notice he does not say come to me when you have everything figured out. He invites us right in the middle of our exhaustion. " +
      "Remember Romans chapter eight verse twenty eight, that in all things God works for the good of those who love him. " +
      "God does not waste your waiting season. Here is your practical step this week. " +
      "Take ten quiet minutes each morning before checking your phone, open the Psalms, and surrender one worry to God in prayer.";

    fs.writeFileSync(speechPath, speechText, "utf8");
    fs.writeFileSync(
      manuscriptPath,
      `Title: Peace in the Middle of the Storm\nScripture: Matthew 11:28-30, Romans 8:28\n\n${speechText}`,
      "utf8"
    );

    const env = withLocalBinPath();
    const filtersProbe = spawnSync("ffmpeg", ["-filters", "-hide_banner"], {
      env,
      encoding: "utf8",
    });
    const ffmpegAvailable = filtersProbe.status === 0;
    const filtersOut = filtersProbe.stdout || "";
    const hasDrawtext = /\bdrawtext\b/.test(filtersOut);
    const hasFlite = /\bflite\b/.test(filtersOut);

    let mediaCreated = false;
    if (ffmpegAvailable) {
      const macAudioPath = path.join(workDir, "sample_say.aiff");
      let useMacSayAudio = false;

      if (process.platform === "darwin" && fs.existsSync("/usr/bin/say")) {
        const sayRes = spawnSync("/usr/bin/say", ["-o", macAudioPath, "-f", speechPath], {
          env,
          encoding: "utf8",
        });
        if (sayRes.status === 0 && fs.existsSync(macAudioPath)) {
          useMacSayAudio = true;
        }
      }

      const vf = [
        "drawbox=x=520:y=150:w=240:h=240:color=#2A7B96@0.9:t=fill",
        "drawbox=x=470:y=405:w=340:h=240:color=#0B435B@0.95:t=fill",
        ...(hasDrawtext
          ? [
              "drawtext=text='Sunday Message - Peace in the Storm':fontcolor=white:fontsize=34:x=(w-text_w)/2:y=56",
            ]
          : []),
      ].join(",");

      const ffArgs: string[] = [
        "-y",
        "-f",
        "lavfi",
        "-i",
        "color=c=#002A3C:s=1280x720:r=30",
      ];

      if (useMacSayAudio) {
        ffArgs.push("-i", macAudioPath);
      } else if (hasFlite) {
        ffArgs.push("-f", "lavfi", "-i", `flite=textfile=${speechPath}:voice=kal16`);
      } else {
        ffArgs.push("-f", "lavfi", "-i", "sine=frequency=220:duration=22");
      }

      ffArgs.push(
        "-vf",
        vf,
        "-shortest",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-ar",
        "44100",
        "-b:a",
        "128k",
        mediaPath
      );

      const ff = spawnSync("ffmpeg", ffArgs, { env, encoding: "utf8" });
      mediaCreated = ff.status === 0 && fs.existsSync(mediaPath);
      if (fs.existsSync(macAudioPath)) {
        fs.rmSync(macAudioPath, { force: true });
      }
    }

    const now = Date.now();
    db.insert(sermons)
      .values({
        id: sermonId,
        userId: user.id,
        title: "Peace in the Middle of the Storm (Sample Sermon)",
        speaker: user.fullName || "Pastor",
        topic: "Peace & Trust",
        sourceType: mediaCreated ? "both" : "manuscript",
        status: "queued",
        progress: 5,
        progressMessage: mediaCreated
          ? "Sample sermon ready — starting transcription..."
          : "Sample sermon manuscript ready — generating study guides...",
        mediaPath: mediaCreated ? mediaPath : null,
        mediaMime: mediaCreated ? "video/mp4" : null,
        mediaFileName: mediaCreated ? "peace_in_the_storm.mp4" : null,
        manuscriptPath,
        manuscriptFileName: "peace_in_the_storm_notes.txt",
        isVideo: mediaCreated ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    startSermonPipeline(sermonId);
    return NextResponse.json({ ok: true, sermonId });
  } catch (err) {
    return safeErrorResponse(err, "Could not create sample sermon.");
  }
}
