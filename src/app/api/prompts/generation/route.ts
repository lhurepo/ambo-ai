import { NextResponse } from "next/server";
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { generationPrompts } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  ALLOWED_GENERATION_KEYS,
  GENERATION_PROMPT_SLOTS,
  getEffectiveGenerationPrompts,
} from "@/lib/ai/default-generation-prompts";
import { logAuditEvent, safeErrorResponse } from "@/lib/security";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const effective = getEffectiveGenerationPrompts(user.id);
  const items = GENERATION_PROMPT_SLOTS.map((slot) => ({
    ...slot,
    promptText: effective[slot.key].promptText,
    isCustom: effective[slot.key].isCustom,
    updatedAt: effective[slot.key].updatedAt,
  }));

  return NextResponse.json({ prompts: items });
}

export async function PUT(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    ensureDbInitialized();

    const body = await req.json();
    const assetType = String(body.assetType || "").trim();
    const promptText = String(body.promptText || "").trim();

    if (!ALLOWED_GENERATION_KEYS.has(assetType)) {
      return NextResponse.json({ error: "Unknown generation prompt key." }, { status: 400 });
    }
    if (!promptText || promptText.length > 4000) {
      return NextResponse.json(
        { error: "Prompt text must be between 1 and 4000 characters." },
        { status: 400 }
      );
    }

    const now = Date.now();
    const existing = db
      .select()
      .from(generationPrompts)
      .where(
        and(eq(generationPrompts.userId, user.id), eq(generationPrompts.assetType, assetType))
      )
      .get();

    if (existing) {
      db.update(generationPrompts)
        .set({ promptText, updatedAt: now })
        .where(eq(generationPrompts.id, existing.id))
        .run();
    } else {
      db.insert(generationPrompts)
        .values({
          id: crypto.randomUUID(),
          userId: user.id,
          assetType,
          promptText,
          updatedAt: now,
        })
        .run();
    }

    logAuditEvent(user.id, "generation_prompt_saved", assetType);
    return NextResponse.json({ ok: true, assetType, promptText, isCustom: true, updatedAt: now });
  } catch (err) {
    return safeErrorResponse(err, "Could not save generation prompt.");
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    ensureDbInitialized();

    const { searchParams } = new URL(req.url);
    const assetType = String(searchParams.get("assetType") || "").trim();
    if (!assetType) {
      return NextResponse.json({ error: "Missing assetType" }, { status: 400 });
    }

    if (assetType === "all") {
      db.delete(generationPrompts).where(eq(generationPrompts.userId, user.id)).run();
    } else if (ALLOWED_GENERATION_KEYS.has(assetType)) {
      db.delete(generationPrompts)
        .where(
          and(eq(generationPrompts.userId, user.id), eq(generationPrompts.assetType, assetType))
        )
        .run();
    } else {
      return NextResponse.json({ error: "Invalid assetType" }, { status: 400 });
    }

    logAuditEvent(user.id, "generation_prompt_reset", assetType);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return safeErrorResponse(err, "Could not reset generation prompt.");
  }
}
