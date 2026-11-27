import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import {
  aiSettings,
  chatMessages,
  clips,
  generationPrompts,
  prompts,
  sermonAssets,
  sermons,
  sessions,
  users,
} from "@/lib/db/schema";
import { clearSessionCookie, getCurrentUser, hashPassword, verifyPassword } from "@/lib/auth";
import { assertSafeDataPath, logAuditEvent, safeErrorResponse, validateExternalBaseUrl } from "@/lib/security";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ user });
}

export async function PATCH(req: Request) {
  try {
    ensureDbInitialized();
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const updates: Partial<{
      email: string;
      fullName: string;
      ministryName: string;
      ministryWebsite: string;
      passwordHash: string;
    }> = {};

    if (typeof body.fullName === "string") updates.fullName = body.fullName.trim().slice(0, 120);
    if (typeof body.ministryName === "string") updates.ministryName = body.ministryName.trim().slice(0, 120);
    if (typeof body.ministryWebsite === "string") {
      try {
        updates.ministryWebsite = validateExternalBaseUrl(body.ministryWebsite, false);
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Invalid website URL." },
          { status: 400 }
        );
      }
    }

    if (typeof body.email === "string" && body.email.trim()) {
      const nextEmail = body.email.trim().toLowerCase();
      if (nextEmail !== user.email) {
        const clash = db.select().from(users).where(eq(users.email, nextEmail)).get();
        if (clash) {
          return NextResponse.json({ error: "Email already in use." }, { status: 409 });
        }
        updates.email = nextEmail;
      }
    }

    if (typeof body.newPassword === "string" && body.newPassword.length > 0) {
      if (body.newPassword.length < 6) {
        return NextResponse.json(
          { error: "New password must be at least 6 characters." },
          { status: 400 }
        );
      }
      if (body.currentPassword) {
        const row = db.select().from(users).where(eq(users.id, user.id)).get();
        if (row && !verifyPassword(String(body.currentPassword), row.passwordHash)) {
          return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
        }
      }
      updates.passwordHash = hashPassword(body.newPassword);
    }

    if (Object.keys(updates).length > 0) {
      db.update(users).set(updates).where(eq(users.id, user.id)).run();
      logAuditEvent(user.id, "account_updated", Object.keys(updates).join(","));
    }

    const updated = db.select().from(users).where(eq(users.id, user.id)).get();
    return NextResponse.json({
      user: updated
        ? {
            id: updated.id,
            email: updated.email,
            fullName: updated.fullName,
            ministryName: updated.ministryName,
            ministryWebsite: updated.ministryWebsite,
            createdAt: updated.createdAt,
          }
        : user,
    });
  } catch (err) {
    return safeErrorResponse(err, "Could not update account details.");
  }
}

export async function DELETE() {
  try {
    ensureDbInitialized();
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const userSermons = db.select({ id: sermons.id }).from(sermons).where(eq(sermons.userId, user.id)).all();
    for (const s of userSermons) {
      db.delete(clips).where(eq(clips.sermonId, s.id)).run();
      db.delete(sermonAssets).where(eq(sermonAssets.sermonId, s.id)).run();
      db.delete(chatMessages).where(eq(chatMessages.sermonId, s.id)).run();
      try {
        fs.rmSync(assertSafeDataPath(path.join(process.cwd(), "data", "uploads", s.id)), {
          recursive: true,
          force: true,
        });
        fs.rmSync(assertSafeDataPath(path.join(process.cwd(), "data", "renders", s.id)), {
          recursive: true,
          force: true,
        });
      } catch {}
    }

    db.delete(sermons).where(eq(sermons.userId, user.id)).run();
    db.delete(prompts).where(eq(prompts.userId, user.id)).run();
    db.delete(generationPrompts).where(eq(generationPrompts.userId, user.id)).run();
    db.delete(aiSettings).where(eq(aiSettings.userId, user.id)).run();
    db.delete(sessions).where(eq(sessions.userId, user.id)).run();
    db.delete(users).where(eq(users.id, user.id)).run();

    await clearSessionCookie();
    logAuditEvent(user.id, "account_deleted", user.email);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return safeErrorResponse(err, "Could not delete account.");
  }
}
