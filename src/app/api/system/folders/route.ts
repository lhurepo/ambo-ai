import { NextResponse } from "next/server";
import { execFile, spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { ensureUserAiSettings, getCurrentUser } from "@/lib/auth";
import { checkClaudeCliStatus } from "@/lib/ai/provider";
import { withLocalBinPath } from "@/lib/env-path";
import {
  formatHomeDisplayPath,
  isPathWithinAllowedExportRoots,
  saveBufferToExportDir,
  validateAndResolveExportDir,
} from "@/lib/local-export";
import { safeErrorResponse } from "@/lib/security";

function execFileAsync(
  cmd: string,
  args: string[],
  timeout = 120_000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { env: withLocalBinPath(), timeout }, (err, stdout, stderr) => {
      if (err) reject(err);
      else resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const env = withLocalBinPath();
    const settings = ensureUserAiSettings(user.id);

    const claude = await checkClaudeCliStatus(settings.decryptedApiKey || undefined);

    const ffProbe = spawnSync("ffmpeg", ["-filters", "-hide_banner"], {
      env,
      encoding: "utf8",
      timeout: 4000,
    });
    const ffmpegInstalled = ffProbe.status === 0;
    const libassAvailable =
      ffmpegInstalled && /\bass\b|libass/.test(ffProbe.stdout || "");

    const venvPy = path.join(process.cwd(), "python-worker", ".venv", "bin", "python");
    const pyBin = fs.existsSync(venvPy) ? venvPy : "python3";
    const pyCheck = spawnSync(pyBin, ["-c", "import faster_whisper; print('ok')"], {
      env,
      encoding: "utf8",
      timeout: 6000,
    });
    const whisperReady = pyCheck.status === 0;

    return NextResponse.json({
      platform: process.platform,
      homeDir: os.homedir(),
      suggestedPdfDir: "~/Downloads",
      suggestedDesktopDir: "~/Desktop/Ambo AI Exports",
      health: {
        claudeCli: {
          installed: claude.installed,
          loggedIn: claude.loggedIn,
          email: claude.email || null,
          message: claude.message,
        },
        ffmpeg: {
          installed: ffmpegInstalled,
          libass: libassAvailable,
        },
        whisper: {
          ready: whisperReady,
        },
        database: {
          ready: true,
        },
      },
    });
  } catch (err) {
    return safeErrorResponse(err, "Could not inspect system health.");
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const origin = req.headers.get("origin");
    if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
      return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "pick") {
      if (process.platform === "darwin") {
        try {
          const { stdout } = await execFileAsync("osascript", [
            "-e",
            'POSIX path of (choose folder with prompt "Choose Save Folder for Ambo AI")',
          ]);
          const chosen = stdout.trim().replace(/\/+$/, "");
          if (!chosen) return NextResponse.json({ ok: true, cancelled: true });
          const resolved = validateAndResolveExportDir(chosen);
          return NextResponse.json({
            ok: true,
            cancelled: false,
            path: resolved.displayDir,
            absPath: resolved.absDir,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("-128") || msg.toLowerCase().includes("cancel")) {
            return NextResponse.json({ ok: true, cancelled: true });
          }
          return NextResponse.json(
            { ok: false, error: "Could not open Finder folder picker." },
            { status: 500 }
          );
        }
      }

      // Linux fallback if zenity is installed
      const zen = spawnSync("which", ["zenity"], { encoding: "utf8" });
      if (zen.status === 0) {
        try {
          const { stdout } = await execFileAsync("zenity", [
            "--file-selection",
            "--directory",
            "--title=Choose Save Folder for Ambo AI",
          ]);
          const chosen = stdout.trim();
          if (!chosen) return NextResponse.json({ ok: true, cancelled: true });
          const resolved = validateAndResolveExportDir(chosen);
          return NextResponse.json({
            ok: true,
            cancelled: false,
            path: resolved.displayDir,
            absPath: resolved.absDir,
          });
        } catch {
          return NextResponse.json({ ok: true, cancelled: true });
        }
      }

      return NextResponse.json({
        ok: false,
        unsupported: true,
        message: "Type a folder path directly (for example ~/Downloads or ~/Desktop/Sermons).",
      });
    }

    if (action === "reveal") {
      const rawTarget = String(body.path || "").trim();
      if (!rawTarget) {
        return NextResponse.json({ error: "Missing path." }, { status: 400 });
      }
      const home = os.homedir();
      const expanded =
        rawTarget === "~"
          ? home
          : rawTarget.startsWith("~/")
            ? path.join(home, rawTarget.slice(2))
            : rawTarget;
      const absTarget = path.resolve(expanded);
      if (!isPathWithinAllowedExportRoots(absTarget)) {
        return NextResponse.json({ error: "Invalid path." }, { status: 400 });
      }

      if (!fs.existsSync(absTarget)) {
        fs.mkdirSync(absTarget, { recursive: true });
      }
      const stat = fs.statSync(absTarget);

      if (process.platform === "darwin") {
        const args = stat.isDirectory() ? [absTarget] : ["-R", absTarget];
        await execFileAsync("open", args, 10_000);
      } else {
        const dirToOpen = stat.isDirectory() ? absTarget : path.dirname(absTarget);
        spawnSync("xdg-open", [dirToOpen], { env: withLocalBinPath() });
      }

      return NextResponse.json({
        ok: true,
        revealed: formatHomeDisplayPath(absTarget),
      });
    }

    if (action === "save_markdown") {
      const settings = ensureUserAiSettings(user.id);
      if (!settings.pdfExportDir) {
        return NextResponse.json(
          { error: "No PDF & notes folder configured in Settings." },
          { status: 400 }
        );
      }
      const fileName = String(body.fileName || "sermon-notes.md").trim() || "sermon-notes.md";
      const content = String(body.content || "");
      const saved = saveBufferToExportDir(
        settings.pdfExportDir,
        fileName,
        Buffer.from(content, "utf8")
      );
      return NextResponse.json({ ok: true, ...saved });
    }

    return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
  } catch (err) {
    return safeErrorResponse(err, "Folder action failed.");
  }
}
