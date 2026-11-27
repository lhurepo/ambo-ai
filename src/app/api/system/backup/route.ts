import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import {
  db,
  ensureDbInitialized,
  exportSqliteBackupToFile,
  restoreSqliteFromValidatedFile,
} from "@/lib/db";
import { sessions, users } from "@/lib/db/schema";
import { ensureUserAiSettings, getCurrentUser } from "@/lib/auth";
import { saveBufferToExportDir } from "@/lib/local-export";
import { checkRateLimit } from "@/lib/rate-limit";
import { assertSafeDataPath, logAuditEvent, safeErrorResponse } from "@/lib/security";
import { cookies } from "next/headers";

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "ascii");
const MAX_RESTORE_BYTES = 250 * 1024 * 1024;
const REQUIRED_TABLES = ["users", "sermons", "sermon_assets", "clips", "ai_settings"];

export async function GET(req: Request) {
  let tmpPath = "";
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    ensureDbInitialized();

    const token = crypto.randomUUID();
    tmpPath = assertSafeDataPath(path.join(process.cwd(), "data", `tmp-backup-${token}.db`));
    await exportSqliteBackupToFile(tmpPath);

    const buf = fs.readFileSync(tmpPath);
    const today = new Date().toISOString().slice(0, 10);
    const fileName = `amboai-backup-${today}.db`;

    const { searchParams } = new URL(req.url);
    if (searchParams.get("saveToDisk") === "1") {
      const settings = ensureUserAiSettings(user.id);
      const targetDir = settings.pdfExportDir || settings.mediaExportDir;
      if (!targetDir) {
        return NextResponse.json(
          { error: "No save folder configured in Settings." },
          { status: 400 }
        );
      }
      const saved = saveBufferToExportDir(targetDir, fileName, buf);
      logAuditEvent(user.id, "system_backup_saved", fileName);
      return NextResponse.json({ ok: true, ...saved });
    }

    logAuditEvent(user.id, "system_backup_downloaded", fileName);
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(buf.length),
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return safeErrorResponse(err, "Could not create local database backup.");
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) {
      fs.rmSync(tmpPath, { force: true });
    }
  }
}

export async function POST(req: Request) {
  let tmpPath = "";
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const origin = req.headers.get("origin");
    if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
      return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
    }

    const rl = checkRateLimit(`restore:${user.id}`, 5, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many restore attempts. Wait ${rl.retryAfterSec}s.` },
        { status: 429 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No backup file provided." }, { status: 400 });
    }

    if (file.size < 4096 || file.size > MAX_RESTORE_BYTES) {
      return NextResponse.json(
        { error: "Backup file size is invalid or exceeds 250 MB." },
        { status: 400 }
      );
    }

    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.subarray(0, 16).compare(SQLITE_MAGIC) !== 0) {
      return NextResponse.json(
        { error: "Invalid backup file: expected an Ambo AI SQLite (.db) backup." },
        { status: 400 }
      );
    }

    tmpPath = assertSafeDataPath(
      path.join(process.cwd(), "data", `tmp-restore-${crypto.randomUUID()}.db`)
    );
    fs.writeFileSync(tmpPath, buf);

    // Validate SQLite integrity and expected application tables before touching live DB
    const testDb = new Database(tmpPath, { readonly: true });
    try {
      const checkRes = testDb.pragma("quick_check", { simple: true });
      if (checkRes !== "ok") {
        return NextResponse.json(
          { error: "Backup file failed SQLite integrity verification." },
          { status: 400 }
        );
      }
      const tables = testDb
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as Array<{ name: string }>;
      const tableNames = new Set(tables.map((t) => t.name));
      for (const reqTable of REQUIRED_TABLES) {
        if (!tableNames.has(reqTable)) {
          return NextResponse.json(
            { error: `Backup file is missing required table "${reqTable}".` },
            { status: 400 }
          );
        }
      }
    } finally {
      testDb.close();
    }

    await restoreSqliteFromValidatedFile(tmpPath);

    // Preserve active cookie session seamlessly if user exists in restored DB
    let requiresSignIn = false;
    const restoredUser = db.select().from(users).where(eq(users.id, user.id)).get();
    if (restoredUser) {
      const cookieStore = await cookies();
      const token = cookieStore.get("ambo_session")?.value;
      if (token) {
        const existingSession = db.select().from(sessions).where(eq(sessions.id, token)).get();
        if (!existingSession) {
          db.insert(sessions)
            .values({
              id: token,
              userId: restoredUser.id,
              expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30,
              createdAt: Date.now(),
            })
            .onConflictDoNothing()
            .run();
        }
      }
    } else {
      requiresSignIn = true;
    }

    logAuditEvent(restoredUser ? restoredUser.id : null, "system_backup_restored", file.name || "backup.db");
    return NextResponse.json({
      ok: true,
      requiresSignIn,
      message: "Workspace backup restored successfully.",
    });
  } catch (err) {
    return safeErrorResponse(err, "Could not restore backup file.");
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) {
      fs.rmSync(tmpPath, { force: true });
    }
  }
}
