import { NextResponse } from "next/server";
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { sermonAssets, sermons } from "@/lib/db/schema";
import { ensureUserAiSettings, getCurrentUser } from "@/lib/auth";
import { regenerateSingleAsset } from "@/lib/ai/generators";
import { getEffectiveGenerationPrompts } from "@/lib/ai/default-generation-prompts";
import { ASSET_TYPES, type AssetType, type LlmProvider } from "@/lib/types";
import { isValidUuid, safeErrorResponse } from "@/lib/security";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    ensureDbInitialized();

    const { id } = await context.params;
    if (!isValidUuid(id)) {
      return NextResponse.json({ error: "Invalid sermon id" }, { status: 400 });
    }

    const sermon = db
      .select()
      .from(sermons)
      .where(and(eq(sermons.id, id), eq(sermons.userId, user.id)))
      .get();
    if (!sermon) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = await req.json();
    const assetType = String(body.assetType || "") as AssetType;
    if (!ASSET_TYPES.includes(assetType)) {
      return NextResponse.json({ error: "Invalid assetType" }, { status: 400 });
    }

    // Direct manual edit save
    if (typeof body.manualContent === "string") {
      const now = Date.now();
      const existing = db
        .select()
        .from(sermonAssets)
        .where(and(eq(sermonAssets.sermonId, id), eq(sermonAssets.assetType, assetType)))
        .get();
      if (existing) {
        db.update(sermonAssets)
          .set({ content: body.manualContent, updatedAt: now })
          .where(eq(sermonAssets.id, existing.id))
          .run();
      } else {
        db.insert(sermonAssets)
          .values({
            id: crypto.randomUUID(),
            sermonId: id,
            assetType,
            content: body.manualContent,
            updatedAt: now,
          })
          .run();
      }
      return NextResponse.json({ ok: true, content: body.manualContent });
    }

    const rl = checkRateLimit(`regen:${user.id}`, 30, 5 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Too many regenerate requests. Wait ${rl.retryAfterSec}s.` },
        { status: 429 }
      );
    }

    const settings = ensureUserAiSettings(user.id);
    const userPrompts = getEffectiveGenerationPrompts(user.id);
    const sourceText =
      [sermon.transcriptText, sermon.manuscriptText].filter(Boolean).join("\n\n") || sermon.title;

    const regenerated = await regenerateSingleAsset({
      title: sermon.title,
      text: sourceText,
      assetType,
      customInstruction: body.customInstruction ? String(body.customInstruction).slice(0, 1500) : undefined,
      config: {
        provider: (settings.llmProvider as LlmProvider) || "offline",
        apiKey: settings.decryptedApiKey || "",
        baseUrl: settings.baseUrl,
        model: settings.model,
      },
      userPrompts,
    });

    const now = Date.now();
    const existing = db
      .select()
      .from(sermonAssets)
      .where(and(eq(sermonAssets.sermonId, id), eq(sermonAssets.assetType, assetType)))
      .get();

    if (existing) {
      db.update(sermonAssets)
        .set({ content: regenerated, updatedAt: now })
        .where(eq(sermonAssets.id, existing.id))
        .run();
    } else {
      db.insert(sermonAssets)
        .values({
          id: crypto.randomUUID(),
          sermonId: id,
          assetType,
          content: regenerated,
          updatedAt: now,
        })
        .run();
    }

    return NextResponse.json({ ok: true, assetType, content: regenerated });
  } catch (err) {
    return safeErrorResponse(err, "Could not regenerate sermon resource.");
  }
}
