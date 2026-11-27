import fs from "fs";
import os from "os";
import path from "path";

export function formatHomeDisplayPath(absPath: string): string {
  const home = os.homedir();
  const clean = path.resolve(absPath);
  if (home && (clean === home || clean.startsWith(home + path.sep))) {
    return "~" + clean.slice(home.length);
  }
  return clean;
}

export function isPathWithinAllowedExportRoots(absPath: string): boolean {
  const home = path.resolve(os.homedir());
  const resolved = path.resolve(absPath);
  const tmpRoot = path.resolve(os.tmpdir());
  const allowedRoots = [home, "/Volumes", "/tmp", tmpRoot];
  return allowedRoots.some(
    (root) => resolved === root || resolved.startsWith(root.endsWith(path.sep) ? root : root + path.sep)
  );
}

/**
 * Expands leading `~/`, validates the folder is within the user's home directory,
 * `/Volumes/` (external Mac drives), or `/tmp/`, and creates it if missing.
 */
export function validateAndResolveExportDir(rawPath: string): {
  absDir: string;
  displayDir: string;
} {
  const trimmed = (rawPath || "").trim();
  if (!trimmed) {
    return { absDir: "", displayDir: "" };
  }
  if (trimmed.includes("\0")) {
    throw new Error("Invalid folder path.");
  }

  const home = os.homedir();
  let expanded = trimmed;
  if (expanded === "~") {
    expanded = home;
  } else if (expanded.startsWith("~/") || expanded.startsWith("~\\")) {
    expanded = path.join(home, expanded.slice(2));
  }

  const absDir = path.resolve(expanded);
  if (!isPathWithinAllowedExportRoots(absDir)) {
    throw new Error(
      "Export folder must be inside your Home folder (e.g. ~/Downloads or ~/Desktop) or /Volumes."
    );
  }

  fs.mkdirSync(absDir, { recursive: true });
  return {
    absDir,
    displayDir: formatHomeDisplayPath(absDir),
  };
}

function getUniqueTargetPath(absDir: string, rawFileName: string): string {
  const safeBase = path.basename(rawFileName).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "export";
  const ext = path.extname(safeBase);
  const stem = ext ? safeBase.slice(0, -ext.length) : safeBase;

  let candidate = path.join(absDir, safeBase);
  let counter = 2;
  while (fs.existsSync(candidate) && counter < 500) {
    candidate = path.join(absDir, `${stem} (${counter})${ext}`);
    counter += 1;
  }
  return candidate;
}

export function saveBufferToExportDir(
  rawDir: string,
  fileName: string,
  buf: Buffer
): { savedPath: string; displayPath: string; fileName: string } {
  const { absDir } = validateAndResolveExportDir(rawDir);
  if (!absDir) {
    throw new Error("No export folder is configured.");
  }
  const target = getUniqueTargetPath(absDir, fileName);
  fs.writeFileSync(target, buf);
  return {
    savedPath: target,
    displayPath: formatHomeDisplayPath(target),
    fileName: path.basename(target),
  };
}

export function copyFileToExportDir(
  rawDir: string,
  fileName: string,
  srcPath: string
): { savedPath: string; displayPath: string; fileName: string } {
  const { absDir } = validateAndResolveExportDir(rawDir);
  if (!absDir) {
    throw new Error("No export folder is configured.");
  }
  const target = getUniqueTargetPath(absDir, fileName);
  fs.copyFileSync(srcPath, target);
  return {
    savedPath: target,
    displayPath: formatHomeDisplayPath(target),
    fileName: path.basename(target),
  };
}
