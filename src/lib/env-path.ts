import fs from "fs";
import path from "path";

function resolveNvmNodeBin(home: string): string[] {
  if (!home) return [];
  const nvmDir = path.join(home, ".nvm", "versions", "node");
  try {
    if (!fs.existsSync(nvmDir)) return [];
    const versions = fs
      .readdirSync(nvmDir)
      .filter((v) => v.startsWith("v"))
      .sort()
      .reverse();
    if (versions.length > 0) {
      return [path.join(nvmDir, versions[0], "bin")];
    }
  } catch {}
  return [];
}

/**
 * Returns a copy of process environment with standard macOS/Linux user-local
 * and Homebrew binary directories prepended to PATH so Finder-launched apps
 * reliably locate `node`, `claude`, `ffmpeg`, `ffprobe`, and `python3`.
 */
export function withLocalBinPath(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const home = baseEnv.HOME || process.env.HOME || "";
  const extraDirs = [
    home ? path.join(home, ".local", "bin") : "",
    home ? path.join(home, ".claude", "local") : "",
    "/opt/homebrew/opt/ffmpeg-full/bin",
    "/opt/homebrew/bin",
    "/usr/local/opt/ffmpeg-full/bin",
    "/usr/local/bin",
    home ? path.join(home, ".volta", "bin") : "",
    home ? path.join(home, ".npm-global", "bin") : "",
    ...resolveNvmNodeBin(home),
  ].filter(Boolean);

  const existing = (baseEnv.PATH || "").split(path.delimiter).filter(Boolean);
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const dir of [...extraDirs, ...existing]) {
    if (!seen.has(dir)) {
      seen.add(dir);
      merged.push(dir);
    }
  }

  return {
    ...baseEnv,
    PATH: merged.join(path.delimiter),
  };
}
