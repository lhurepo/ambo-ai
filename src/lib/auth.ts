import crypto from "crypto";
import { cookies } from "next/headers";
import { eq, gt, lt, and } from "drizzle-orm";
import { db, ensureDbInitialized } from "./db";
import { users, sessions, aiSettings } from "./db/schema";
import { DEFAULT_CAPTION_SETTINGS, DEFAULT_PDF_DESIGN } from "./types";
import { decryptSecret, encryptSecret } from "./security";
import { hasClaudeBinaryInstalled } from "./ai/provider";

const SESSION_COOKIE = "ambo_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, "hex");
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export async function createSessionForUser(userId: string): Promise<string> {
  ensureDbInitialized();
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  try {
    db.delete(sessions).where(lt(sessions.expiresAt, now)).run();
  } catch {}
  db.insert(sessions)
    .values({
      id: token,
      userId,
      expiresAt: now + SESSION_TTL_MS,
      createdAt: now,
    })
    .run();

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.AMBO_COOKIE_SECURE === "true",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
  return token;
}

export function ensureUserAiSettings(userId: string) {
  ensureDbInitialized();
  const existing = db.select().from(aiSettings).where(eq(aiSettings.userId, userId)).get();
  if (existing) {
    if ((existing.llmProvider as string) === "claude_web") {
      db.update(aiSettings)
        .set({
          llmProvider: "claude_cli",
          baseUrl: "",
          model: "sonnet",
          updatedAt: Date.now(),
        })
        .where(eq(aiSettings.userId, userId))
        .run();
      return {
        ...existing,
        llmProvider: "claude_cli",
        baseUrl: "",
        model: "sonnet",
        decryptedApiKey: decryptSecret(existing.apiKey),
      };
    }
    return {
      ...existing,
      decryptedApiKey: decryptSecret(existing.apiKey),
    };
  }

  const now = Date.now();
  // Auto-detect environment keys or local Claude CLI, otherwise start in 100% free Offline Built-in mode
  let llmProvider = "offline";
  let apiKey = "";
  let baseUrl = "";
  let model = "";

  if (process.env.GEMINI_API_KEY) {
    llmProvider = "gemini";
    apiKey = process.env.GEMINI_API_KEY;
    model = "gemini-2.5-flash";
  } else if (process.env.GROQ_API_KEY) {
    llmProvider = "groq";
    apiKey = process.env.GROQ_API_KEY;
    model = "llama-3.3-70b-versatile";
  } else if (process.env.OPENROUTER_API_KEY) {
    llmProvider = "openrouter";
    apiKey = process.env.OPENROUTER_API_KEY;
    model = "meta-llama/llama-3.3-70b-instruct:free";
  } else if (process.env.OPENAI_API_KEY) {
    llmProvider = "openai";
    apiKey = process.env.OPENAI_API_KEY;
    model = "gpt-4o-mini";
  } else if (process.env.ANTHROPIC_API_KEY) {
    llmProvider = "anthropic";
    apiKey = process.env.ANTHROPIC_API_KEY;
    model = "claude-3-5-haiku-latest";
  } else if (hasClaudeBinaryInstalled()) {
    llmProvider = "claude_cli";
    model = "sonnet";
  }

  const encryptedKey = apiKey ? encryptSecret(apiKey) : "";
  const row = {
    id: crypto.randomUUID(),
    userId,
    llmProvider,
    apiKey: encryptedKey,
    baseUrl,
    model,
    whisperModel: "base",
    whisperLanguage: "auto",
    defaultCaptionSettingsJson: JSON.stringify(DEFAULT_CAPTION_SETTINGS),
    pdfExportDir: "",
    mediaExportDir: "",
    exportMode: "browser",
    defaultPdfDesignJson: JSON.stringify(DEFAULT_PDF_DESIGN),
    themePreference: "light",
    defaultSpeaker: "",
    updatedAt: now,
  };
  db.insert(aiSettings).values(row).run();
  return {
    ...row,
    decryptedApiKey: apiKey,
  };
}

export async function getCurrentUser() {
  ensureDbInitialized();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const now = Date.now();
  const session = db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, token), gt(sessions.expiresAt, now)))
    .get();

  if (!session) return null;

  const user = db.select().from(users).where(eq(users.id, session.userId)).get();
  if (!user) return null;

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    ministryName: user.ministryName,
    ministryWebsite: user.ministryWebsite,
    createdAt: user.createdAt,
  };
}

export async function clearSessionCookie() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    ensureDbInitialized();
    db.delete(sessions).where(eq(sessions.id, token)).run();
  }
  cookieStore.delete(SESSION_COOKIE);
}

export function getOrCreateLocalDefaultUser() {
  ensureDbInitialized();
  const email = "pastor@ambo.local";
  let user = db.select().from(users).where(eq(users.email, email)).get();
  if (!user) {
    const id = crypto.randomUUID();
    const now = Date.now();
    user = {
      id,
      email,
      passwordHash: hashPassword("ambo-local-free"),
      fullName: "Garden Church Team",
      ministryName: "The Garden Church",
      ministryWebsite: "",
      createdAt: now,
    };
    db.insert(users).values(user).run();
  } else if (user.ministryName === "Grace Community Church") {
    db.update(users)
      .set({ ministryName: "The Garden Church", fullName: "Garden Church Team" })
      .where(eq(users.id, user.id))
      .run();
    user = { ...user, ministryName: "The Garden Church", fullName: "Garden Church Team" };
  }
  ensureUserAiSettings(user.id);
  return user;
}
