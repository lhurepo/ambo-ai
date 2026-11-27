import crypto from "crypto";
import fs from "fs";
import path from "path";
import { NextResponse } from "next/server";
import { db, ensureDbInitialized } from "./db";
import { auditLogs } from "./db/schema";

const SECRET_FILE = path.join(process.cwd(), "data", ".secret.key");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_ID_RE = /^[a-zA-Z0-9_-]{3,64}$/;

let cachedKey: Buffer | null = null;

function getEncryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const envSecret = process.env.AMBO_SECRET_KEY;
  if (envSecret && envSecret.trim().length >= 8) {
    cachedKey = crypto.createHash("sha256").update(envSecret.trim()).digest();
    return cachedKey;
  }
  const dataDir = path.dirname(SECRET_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  if (fs.existsSync(SECRET_FILE)) {
    const hex = fs.readFileSync(SECRET_FILE, "utf8").trim();
    if (/^[0-9a-f]{64}$/i.test(hex)) {
      cachedKey = Buffer.from(hex, "hex");
      return cachedKey;
    }
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(SECRET_FILE, key.toString("hex"), { mode: 0o600 });
  cachedKey = key;
  return cachedKey;
}

export function encryptSecret(plain: string): string {
  const clean = plain.trim();
  if (!clean) return "";
  if (clean.startsWith("enc:v1:")) return clean;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(clean, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(stored: string): string {
  if (!stored) return "";
  if (!stored.startsWith("enc:v1:")) return stored;
  const parts = stored.split(":");
  if (parts.length !== 5) return "";
  try {
    const iv = Buffer.from(parts[2], "hex");
    const tag = Buffer.from(parts[3], "hex");
    const cipherBuf = Buffer.from(parts[4], "hex");
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(cipherBuf), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

export function isValidUuid(id: string): boolean {
  return UUID_RE.test(id);
}

export function isValidResourceId(id: string): boolean {
  return UUID_RE.test(id) || SAFE_ID_RE.test(id);
}

export function assertSafeDataPath(targetPath: string): string {
  const resolved = path.resolve(targetPath);
  const dataRoot = path.resolve(process.cwd(), "data") + path.sep;
  if (!resolved.startsWith(dataRoot)) {
    throw new Error("Invalid file path");
  }
  return resolved;
}

export function validateExternalBaseUrl(rawUrl: string, allowLocalhost = true): string {
  const clean = rawUrl.trim();
  if (!clean) return "";
  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    throw new Error("Invalid Base URL format.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Base URL must use http:// or https://.");
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === "169.254.169.254" ||
    host.startsWith("169.254.") ||
    host === "metadata.google.internal" ||
    host === "0.0.0.0"
  ) {
    throw new Error("Blocked metadata or restricted network address.");
  }
  if (!allowLocalhost && (host === "localhost" || host === "127.0.0.1" || host === "::1")) {
    throw new Error("Localhost URLs are not allowed for this field.");
  }
  return clean;
}

export function safeErrorResponse(
  err: unknown,
  fallback = "Request could not be completed.",
  status = 500
) {
  console.error("[Ambo AI Error]", err);
  return NextResponse.json({ error: fallback }, { status });
}

export function logAuditEvent(userId: string | null, action: string, detail = "") {
  try {
    ensureDbInitialized();
    db.insert(auditLogs)
      .values({
        id: crypto.randomUUID(),
        userId,
        action,
        detail: detail.slice(0, 300),
        createdAt: Date.now(),
      })
      .run();
  } catch {
    // Non-blocking audit logging
  }
}
