import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import path from "path";
import fs from "fs";
import * as schema from "./schema";
import { BUILTIN_V2_PROMPTS } from "./seed-prompts";

const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, "amboai.db");

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

const globalForDb = globalThis as unknown as {
  __amboSqlite?: Database.Database;
  __amboDrizzle?: DrizzleDb;
  __amboInitialized?: boolean;
};

export function getSqliteClient(): Database.Database {
  if (globalForDb.__amboSqlite && globalForDb.__amboSqlite.open) {
    return globalForDb.__amboSqlite;
  }
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  globalForDb.__amboSqlite = sqlite;
  globalForDb.__amboDrizzle = drizzle(sqlite, { schema });
  return sqlite;
}

function getDrizzleDb(): DrizzleDb {
  const sqlite = getSqliteClient();
  if (!globalForDb.__amboDrizzle) {
    globalForDb.__amboDrizzle = drizzle(sqlite, { schema });
  }
  return globalForDb.__amboDrizzle;
}

export const db: DrizzleDb = new Proxy({} as DrizzleDb, {
  get(_target, prop) {
    const active = getDrizzleDb();
    const val = Reflect.get(active, prop, active);
    return typeof val === "function" ? val.bind(active) : val;
  },
});

export function ensureDbInitialized() {
  if (globalForDb.__amboInitialized) return;
  const sqlite = getSqliteClient();

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL DEFAULT 'Pastor',
      ministry_name TEXT NOT NULL DEFAULT 'Local Church',
      ministry_website TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_settings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      llm_provider TEXT NOT NULL DEFAULT 'offline',
      api_key TEXT NOT NULL DEFAULT '',
      base_url TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      whisper_model TEXT NOT NULL DEFAULT 'base',
      whisper_language TEXT NOT NULL DEFAULT 'auto',
      default_caption_settings_json TEXT NOT NULL DEFAULT '{}',
      pdf_export_dir TEXT NOT NULL DEFAULT '',
      media_export_dir TEXT NOT NULL DEFAULT '',
      export_mode TEXT NOT NULL DEFAULT 'browser',
      default_pdf_design_json TEXT NOT NULL DEFAULT '{}',
      theme_preference TEXT NOT NULL DEFAULT 'light',
      default_speaker TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sermons (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      speaker TEXT NOT NULL DEFAULT '',
      topic TEXT NOT NULL DEFAULT 'Faith & Discipleship',
      series_name TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      source_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      progress INTEGER NOT NULL DEFAULT 0,
      progress_message TEXT NOT NULL DEFAULT 'Queued',
      error_message TEXT,
      media_path TEXT,
      media_mime TEXT,
      media_file_name TEXT,
      is_video INTEGER NOT NULL DEFAULT 0,
      duration_sec INTEGER NOT NULL DEFAULT 0,
      youtube_url TEXT,
      thumbnail_path TEXT,
      manuscript_path TEXT,
      manuscript_file_name TEXT,
      manuscript_text TEXT,
      transcript_text TEXT,
      segments_json TEXT,
      face_track_json TEXT,
      clips_unseen INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sermon_assets (
      id TEXT PRIMARY KEY,
      sermon_id TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS clips (
      id TEXT PRIMARY KEY,
      sermon_id TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'Teaching',
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      transcript_excerpt TEXT NOT NULL DEFAULT '',
      caption_settings_json TEXT NOT NULL,
      render_status TEXT NOT NULL DEFAULT 'pending',
      rendered_path TEXT,
      render_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'user',
      drawer_tab TEXT NOT NULL DEFAULT 'user',
      body TEXT NOT NULL,
      is_builtin INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      sermon_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS generation_prompts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      asset_type TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      action TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sermons_user ON sermons(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_assets_sermon ON sermon_assets(sermon_id, asset_type);
    CREATE INDEX IF NOT EXISTS idx_clips_sermon ON clips(sermon_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_sermon ON chat_messages(sermon_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_gen_prompts_user_asset ON generation_prompts(user_id, asset_type);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  `);

  for (const colSql of [
    "ALTER TABLE sermons ADD COLUMN youtube_url TEXT;",
    "ALTER TABLE sermons ADD COLUMN series_name TEXT NOT NULL DEFAULT '';",
    "ALTER TABLE sermons ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';",
    "ALTER TABLE ai_settings ADD COLUMN pdf_export_dir TEXT NOT NULL DEFAULT '';",
    "ALTER TABLE ai_settings ADD COLUMN media_export_dir TEXT NOT NULL DEFAULT '';",
    "ALTER TABLE ai_settings ADD COLUMN export_mode TEXT NOT NULL DEFAULT 'browser';",
    "ALTER TABLE ai_settings ADD COLUMN default_pdf_design_json TEXT NOT NULL DEFAULT '{}';",
    "ALTER TABLE ai_settings ADD COLUMN theme_preference TEXT NOT NULL DEFAULT 'light';",
    "ALTER TABLE ai_settings ADD COLUMN default_speaker TEXT NOT NULL DEFAULT '';",
  ]) {
    try {
      sqlite.exec(colSql);
    } catch {
      // Column already exists
    }
  }

  sqlite.exec("CREATE INDEX IF NOT EXISTS idx_sermons_series ON sermons(user_id, series_name);");

  // Seed built-in v2prompts idempotently
  const now = Date.now();
  const existingBuiltins = db
    .select({ id: schema.prompts.id })
    .from(schema.prompts)
    .where(eq(schema.prompts.isBuiltin, 1))
    .all();
  if (existingBuiltins.length < BUILTIN_V2_PROMPTS.length) {
    const existingSet = new Set(existingBuiltins.map((p) => p.id));
    for (const p of BUILTIN_V2_PROMPTS) {
      if (!existingSet.has(p.id)) {
        db.insert(schema.prompts)
          .values({
            id: p.id,
            userId: null,
            title: p.title,
            category: p.category,
            drawerTab: p.drawerTab,
            body: p.body,
            isBuiltin: 1,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoNothing()
          .run();
      }
    }
  }

  globalForDb.__amboInitialized = true;
}

export async function exportSqliteBackupToFile(destPath: string): Promise<void> {
  ensureDbInitialized();
  const sqlite = getSqliteClient();
  await sqlite.backup(destPath);
}

export async function restoreSqliteFromValidatedFile(
  validatedTempPath: string
): Promise<{ preRestoreBackupPath: string }> {
  ensureDbInitialized();
  const currentSqlite = getSqliteClient();
  const preRestoreBackupPath = path.join(DATA_DIR, "amboai.db.pre-restore.bak");
  await currentSqlite.backup(preRestoreBackupPath);

  try {
    currentSqlite.pragma("wal_checkpoint(TRUNCATE)");
  } catch {}
  currentSqlite.close();

  fs.rmSync(`${DB_PATH}-wal`, { force: true });
  fs.rmSync(`${DB_PATH}-shm`, { force: true });
  fs.copyFileSync(validatedTempPath, DB_PATH);

  globalForDb.__amboSqlite = undefined;
  globalForDb.__amboDrizzle = undefined;
  globalForDb.__amboInitialized = false;

  ensureDbInitialized();
  return { preRestoreBackupPath };
}
