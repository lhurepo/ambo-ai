import { NextResponse } from "next/server";
import crypto from "crypto";
import { and, asc, eq, or } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { prompts } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isValidResourceId, safeErrorResponse } from "@/lib/security";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  ensureDbInitialized();

  const all = db
    .select()
    .from(prompts)
    .where(or(eq(prompts.isBuiltin, 1), eq(prompts.userId, user.id)))
    .orderBy(asc(prompts.isBuiltin), asc(prompts.createdAt))
    .all();

  const userPrompts = all.filter((p) => p.isBuiltin === 0);
  const builtinPrompts = all.filter((p) => p.isBuiltin === 1);

  return NextResponse.json({ userPrompts, builtinPrompts });
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    ensureDbInitialized();

    const body = await req.json();
    const title = String(body.title || "").trim();
    const promptBody = String(body.body || "").trim();
    const category = String(body.category || "user").trim();

    if (!title || !promptBody) {
      return NextResponse.json({ error: "Title and prompt body are required." }, { status: 400 });
    }

    const now = Date.now();
    const row = {
      id: crypto.randomUUID(),
      userId: user.id,
      title,
      category,
      drawerTab: "user",
      body: promptBody,
      isBuiltin: 0,
      createdAt: now,
      updatedAt: now,
    };
    db.insert(prompts).values(row).run();
    return NextResponse.json({ ok: true, prompt: row });
  } catch (err) {
    return safeErrorResponse(err, "Could not create prompt.");
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    ensureDbInitialized();

    const body = await req.json();
    const id = String(body.id || "");
    if (!id || !isValidResourceId(id)) return NextResponse.json({ error: "Valid prompt id required" }, { status: 400 });

    const existing = db
      .select()
      .from(prompts)
      .where(and(eq(prompts.id, id), eq(prompts.userId, user.id)))
      .get();
    if (!existing) return NextResponse.json({ error: "Prompt not found" }, { status: 404 });

    db.update(prompts)
      .set({
        title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : existing.title,
        body: typeof body.body === "string" && body.body.trim() ? body.body.trim() : existing.body,
        category: typeof body.category === "string" ? body.category.trim() : existing.category,
        updatedAt: Date.now(),
      })
      .where(eq(prompts.id, id))
      .run();

    const updated = db.select().from(prompts).where(eq(prompts.id, id)).get();
    return NextResponse.json({ ok: true, prompt: updated });
  } catch (err) {
    return safeErrorResponse(err, "Could not update prompt.");
  }
}

export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  ensureDbInitialized();

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  db.delete(prompts).where(and(eq(prompts.id, id), eq(prompts.userId, user.id))).run();
  return NextResponse.json({ ok: true });
}
