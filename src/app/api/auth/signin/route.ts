import { NextResponse } from "next/server";
import crypto from "crypto";
import { eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { createSessionForUser, ensureUserAiSettings, hashPassword, verifyPassword } from "@/lib/auth";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { logAuditEvent, safeErrorResponse } from "@/lib/security";

export async function POST(req: Request) {
  try {
    ensureDbInitialized();
    const ip = getClientIp(req);
    const rl = checkRateLimit(`signin:${ip}`, 20, 15 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many sign-in attempts. Wait ${rl.retryAfterSec}s.` },
        { status: 429 }
      );
    }

    const { email, password } = await req.json();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPass = String(password || "");

    if (!cleanEmail || !cleanPass) {
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }

    const user = db.select().from(users).where(eq(users.email, cleanEmail)).get();
    if (!user || !verifyPassword(cleanPass, user.passwordHash)) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    ensureUserAiSettings(user.id);
    await createSessionForUser(user.id);
    logAuditEvent(user.id, "auth_signin", cleanEmail);
    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        ministryName: user.ministryName,
      },
    });
  } catch (err) {
    return safeErrorResponse(err, "Sign in failed.");
  }
}

export async function PUT(req: Request) {
  // Also support signup via PUT or separate route
  try {
    ensureDbInitialized();
    const { email, password, fullName, ministryName } = await req.json();
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanPass = String(password || "");
    if (!cleanEmail || cleanPass.length < 6) {
      return NextResponse.json({ error: "Valid email and password (6+ chars) required." }, { status: 400 });
    }
    const existing = db.select().from(users).where(eq(users.email, cleanEmail)).get();
    if (existing) {
      return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    db.insert(users)
      .values({
        id,
        email: cleanEmail,
        passwordHash: hashPassword(cleanPass),
        fullName: String(fullName || "Pastor").trim() || "Pastor",
        ministryName: String(ministryName || "Local Church").trim() || "Local Church",
        ministryWebsite: "",
        createdAt: now,
      })
      .run();

    ensureUserAiSettings(id);
    await createSessionForUser(id);
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    return safeErrorResponse(err, "Registration failed.");
  }
}
