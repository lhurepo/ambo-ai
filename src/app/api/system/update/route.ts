import { NextResponse } from "next/server";
import { execFileSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { getCurrentUser } from "@/lib/auth";
import { withLocalBinPath } from "@/lib/env-path";
import { checkRateLimit } from "@/lib/rate-limit";
import { safeErrorResponse } from "@/lib/security";

interface UpdateStatusFile {
  state: "updating" | "installing" | "building" | "completed" | "error";
  step: string;
  commit?: string;
  error?: string | null;
  updatedAt: number;
}

const STATUS_PATH = path.join(process.cwd(), "data", "update-status.json");
const UPDATE_SCRIPT = path.join(process.cwd(), "scripts", "update-app.sh");

const globalForUpdateCache = globalThis as unknown as {
  __amboUpdateCache?: {
    checkedAt: number;
    data: {
      gitAvailable: boolean;
      currentCommit: string;
      remoteCommit: string;
      behindCount: number;
      upToDate: boolean;
      pendingChanges: string[];
    };
  };
};

function runGit(args: string[], timeout = 6000): string {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    env: { ...withLocalBinPath(), GIT_TERMINAL_PROMPT: "0" },
    encoding: "utf8",
    timeout,
  }).trim();
}

function readStatusFile(includeFinished: boolean): UpdateStatusFile | null {
  try {
    if (!fs.existsSync(STATUS_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(STATUS_PATH, "utf8")) as UpdateStatusFile;
    if (!raw || typeof raw.updatedAt !== "number") return null;
    const ageMs = Date.now() - raw.updatedAt;
    if (raw.state === "completed" || raw.state === "error") {
      if (!includeFinished && ageMs > 2 * 60 * 1000) return null;
    } else if (ageMs > 10 * 60 * 1000) {
      return null;
    }
    return raw;
  } catch {
    return null;
  }
}

function hasGitRepo(): boolean {
  return fs.existsSync(path.join(process.cwd(), ".git"));
}

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const isPoll = searchParams.get("poll") === "1";
    const isFresh = searchParams.get("fresh") === "1";

    const updateStatus = readStatusFile(isPoll);

    if (!hasGitRepo()) {
      return NextResponse.json({
        gitAvailable: false,
        currentCommit: "",
        remoteCommit: "",
        behindCount: 0,
        upToDate: true,
        pendingChanges: [],
        updateStatus,
      });
    }

    let currentCommit = "";
    try {
      currentCommit = runGit(["rev-parse", "--short", "HEAD"], 3000);
    } catch {}

    if (isPoll) {
      return NextResponse.json({
        gitAvailable: true,
        currentCommit,
        remoteCommit: "",
        behindCount: 0,
        upToDate: true,
        pendingChanges: [],
        updateStatus,
      });
    }

    const cached = globalForUpdateCache.__amboUpdateCache;
    if (!isFresh && cached && Date.now() - cached.checkedAt < 60_000) {
      return NextResponse.json({ ...cached.data, updateStatus });
    }

    let remoteCommit = currentCommit;
    let behindCount = 0;
    let pendingChanges: string[] = [];

    try {
      runGit(["fetch", "origin", "main", "--quiet"], 8000);
      remoteCommit = runGit(["rev-parse", "--short", "origin/main"], 3000);
      const countStr = runGit(["rev-list", "HEAD..origin/main", "--count"], 3000);
      behindCount = Math.max(0, parseInt(countStr, 10) || 0);
      if (behindCount > 0) {
        const logOut = runGit(["log", "HEAD..origin/main", "--pretty=format:%s", "-n", "5"], 3000);
        pendingChanges = logOut ? logOut.split("\n").filter(Boolean) : [];
      }
    } catch {
      // Offline or remote unreachable — degrade gracefully without blocking UI
    }

    const data = {
      gitAvailable: true,
      currentCommit,
      remoteCommit,
      behindCount,
      upToDate: behindCount === 0,
      pendingChanges,
    };

    globalForUpdateCache.__amboUpdateCache = { checkedAt: Date.now(), data };
    return NextResponse.json({ ...data, updateStatus });
  } catch (err) {
    return safeErrorResponse(err, "Could not check for updates.");
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

    const rl = checkRateLimit(`sys-update:${user.id}`, 6, 5 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Please wait ${rl.retryAfterSec}s before trying another update.` },
        { status: 429 }
      );
    }

    if (!hasGitRepo()) {
      return NextResponse.json(
        {
          error:
            "This copy was not downloaded with git clone, so automatic updates aren't linked yet. Follow README.md to clone once from GitHub.",
        },
        { status: 400 }
      );
    }

    runGit(["fetch", "origin", "main", "--quiet"], 10000);
    const currentCommit = runGit(["rev-parse", "--short", "HEAD"], 3000);
    const remoteCommit = runGit(["rev-parse", "--short", "origin/main"], 3000);
    const behindCount = Math.max(
      0,
      parseInt(runGit(["rev-list", "HEAD..origin/main", "--count"], 3000), 10) || 0
    );

    if (behindCount === 0) {
      return NextResponse.json({
        ok: true,
        status: "up_to_date",
        currentCommit,
      });
    }

    fs.mkdirSync(path.dirname(STATUS_PATH), { recursive: true });
    fs.writeFileSync(
      STATUS_PATH,
      JSON.stringify(
        {
          state: "updating",
          step: "Starting update...",
          commit: remoteCommit,
          error: null,
          updatedAt: Date.now(),
        },
        null,
        2
      )
    );

    globalForUpdateCache.__amboUpdateCache = undefined;

    const child = spawn("bash", [UPDATE_SCRIPT], {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
      env: { ...withLocalBinPath(), GIT_TERMINAL_PROMPT: "0" },
    });
    child.unref();

    return NextResponse.json({
      ok: true,
      status: "started",
      previousCommit: currentCommit,
      targetCommit: remoteCommit,
    });
  } catch (err) {
    return safeErrorResponse(err, "Could not start update.");
  }
}
