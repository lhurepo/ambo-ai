import { NextResponse } from "next/server";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { users } from "@/lib/db/schema";
import {
  clearSessionCookie,
  createSessionForUser,
  ensureUserAiSettings,
  getOrCreateLocalDefaultUser,
  hashPassword,
} from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logAuditEvent, safeErrorResponse } from "@/lib/security";

export async function POST(req: Request) {
  try {
    ensureDbInitialized();
    const ip = getClientIp(req);
    const body = await req.json().catch(() => ({}));
    if (body.mode === "guest") {
      const rl = checkRateLimit(`guest:${ip}`, 30, 15 * 60 * 1000);
      if (!rl.allowed) {
        return NextResponse.json({ error: "Too many requests." }, { status: 429 });
      }
      const user = getOrCreateLocalDefaultUser();
      await createSessionForUser(user.id);
      logAuditEvent(user.id, "auth_quickstart", user.email);
      return NextResponse.json({ ok: true, user: { id: user.id, email: user.email, fullName: user.fullName } });
    }

    if (body.mode === "signout") {
      await clearSessionCookie();
      return NextResponse.json({ ok: true });
    }

    const rl = checkRateLimit(`signup:${ip}`, 15, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many sign-up attempts. Wait ${rl.retryAfterSec}s.` },
        { status: 429 }
      );
    }

    const cleanEmail = String(body.email || "").trim().toLowerCase();
    const cleanPass = String(body.password || "");
    if (!cleanEmail || cleanPass.length < 6) {
      return NextResponse.json({ error: "Valid email and password (6+ chars) required." }, { status: 400 });
    }

    const existing = db.select().from(users).where(eq(users.email, cleanEmail)).get();
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }

    const id = crypto.randomUUID();
    db.insert(users)
      .values({
        id,
        email: cleanEmail,
        passwordHash: hashPassword(cleanPass),
        fullName: String(body.fullName || "Pastor").trim() || "Pastor",
        ministryName: String(body.ministryName || "Local Church").trim() || "Local Church",
        ministryWebsite: String(body.ministryWebsite || "").trim(),
        createdAt: Date.now(),
      })
      .run();

    ensureUserAiSettings(id);
    await createSessionForUser(id);
    logAuditEvent(id, "auth_signup", cleanEmail);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return safeErrorResponse(err, "Sign up failed.");
  }
}
