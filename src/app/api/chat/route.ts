import { NextResponse } from "next/server";
import crypto from "crypto";
import { and, asc, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { chatMessages, sermons } from "@/lib/db/schema";
import { ensureUserAiSettings, getCurrentUser } from "@/lib/auth";
import { answerOfflineChat } from "@/lib/ai/offline-engine";
import { getEffectiveGenerationPrompts } from "@/lib/ai/default-generation-prompts";
import { streamLlmCompletion, type ChatTurn } from "@/lib/ai/provider";
import type { LlmProvider } from "@/lib/types";
import { checkRateLimit } from "@/lib/rate-limit";
import { isValidUuid, safeErrorResponse } from "@/lib/security";

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    ensureDbInitialized();

    const rl = checkRateLimit(`chat:${user.id}`, 45, 5 * 60 * 1000);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `Rate limit reached. Try again in ${rl.retryAfterSec}s.` },
        { status: 429 }
      );
    }

    const { sermonId, message } = await req.json();
    const cleanId = String(sermonId || "");
    const cleanMsg = String(message || "").trim();
    if (!isValidUuid(cleanId) || !cleanMsg || cleanMsg.length > 6000) {
      return NextResponse.json(
        { error: "Valid sermonId and message (up to 6000 chars) are required." },
        { status: 400 }
      );
    }

    const sermon = db
      .select()
      .from(sermons)
      .where(and(eq(sermons.id, cleanId), eq(sermons.userId, user.id)))
      .get();
    if (!sermon) return NextResponse.json({ error: "Sermon not found" }, { status: 404 });

    const now = Date.now();
    db.insert(chatMessages)
      .values({
        id: crypto.randomUUID(),
        sermonId: cleanId,
        role: "user",
        content: cleanMsg,
        createdAt: now,
      })
      .run();

    const history = db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sermonId, cleanId))
      .orderBy(asc(chatMessages.createdAt))
      .all()
      .slice(-14);

    const settings = ensureUserAiSettings(user.id);
    const provider = (settings.llmProvider as LlmProvider) || "offline";
    const sourceText =
      [sermon.transcriptText, sermon.manuscriptText].filter(Boolean).join("\n\n") || sermon.title;
    const prompts = getEffectiveGenerationPrompts(user.id);
    const voiceContext =
      prompts.global_system?.promptText ||
      "You are Ambo AI's Sermon Assistant for The Garden Church in Boston.";

    const systemPrompt = `${voiceContext}
You are helping prepare resources and reflections for the sermon "${sermon.title}".
Always ground your answers in the sermon transcript/manuscript provided below, cite relevant Scriptures, and format clearly with Markdown.

SERMON CONTENT:
"""
${sourceText.slice(0, 22000)}
"""`;

    const turns: ChatTurn[] = [
      { role: "system", content: systemPrompt },
      ...history.map((m) => ({
        role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        content: m.content,
      })),
    ];

    const encoder = new TextEncoder();
    let fullReply = "";

    const stream = new ReadableStream({
      async start(controller) {
        const push = (text: string) => {
          fullReply += text;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta: text })}\n\n`));
        };

        try {
          if (provider === "offline") {
            const offline = answerOfflineChat(cleanMsg, sermon.title, sourceText);
            for (const chunk of offline.match(/.{1,48}/gs) || [offline]) {
              push(chunk);
            }
          } else {
            let yielded = false;
            for await (const delta of streamLlmCompletion(
              {
                provider,
                apiKey: settings.decryptedApiKey || "",
                baseUrl: settings.baseUrl,
                model: settings.model,
              },
              turns
            )) {
              yielded = true;
              push(delta);
            }
            if (!yielded) {
              push(answerOfflineChat(cleanMsg, sermon.title, sourceText));
            }
          }
        } catch (err) {
          const fallback = answerOfflineChat(cleanMsg, sermon.title, sourceText);
          push(
            `*(Provider note: ${err instanceof Error ? err.message : "offline fallback"})*\n\n${fallback}`
          );
        }

        if (fullReply.trim()) {
          db.insert(chatMessages)
            .values({
              id: crypto.randomUUID(),
              sermonId: cleanId,
              role: "assistant",
              content: fullReply.trim(),
              createdAt: Date.now(),
            })
            .run();
        }
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        controller.close();
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (err) {
    return safeErrorResponse(err, "Chat request failed.");
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    ensureDbInitialized();

    const { searchParams } = new URL(req.url);
    const sermonId = String(searchParams.get("sermonId") || "");
    if (!isValidUuid(sermonId)) {
      return NextResponse.json({ error: "Valid sermonId required" }, { status: 400 });
    }

    const sermon = db
      .select()
      .from(sermons)
      .where(and(eq(sermons.id, sermonId), eq(sermons.userId, user.id)))
      .get();
    if (!sermon) return NextResponse.json({ error: "Not found" }, { status: 404 });

    db.delete(chatMessages).where(eq(chatMessages.sermonId, sermonId)).run();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return safeErrorResponse(err, "Could not clear chat history.");
  }
}
