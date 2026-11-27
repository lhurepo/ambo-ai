import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { sermonAssets, sermons } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { renderGardenChurchPdf, type GardenPdfSection } from "@/lib/pdf/garden-pdf";
import { GENERATION_PROMPT_SLOTS } from "@/lib/ai/default-generation-prompts";
import { ASSET_TYPES, type AssetType } from "@/lib/types";
import { isValidUuid, safeErrorResponse } from "@/lib/security";

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
    if (!sermon) {
      return NextResponse.json({ error: "Sermon not found" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const savedRows = db
      .select()
      .from(sermonAssets)
      .where(eq(sermonAssets.sermonId, id))
      .all();
    const savedMap = new Map(savedRows.map((r) => [r.assetType, r.content]));

    const sections: GardenPdfSection[] = [];

    if (Array.isArray(body.sections) && body.sections.length > 0) {
      for (const item of body.sections) {
        if (!item || typeof item !== "object") continue;
        const rawAssetType = typeof item.assetType === "string" ? item.assetType : "";
        const fallbackLabel =
          GENERATION_PROMPT_SLOTS.find((s) => s.key === rawAssetType)?.label ||
          "Sermon Resource";
        const title = String(item.title || fallbackLabel).trim().slice(0, 120);
        const content =
          typeof item.content === "string" && item.content.trim()
            ? item.content
            : rawAssetType
              ? savedMap.get(rawAssetType) || ""
              : "";
        if (content.trim()) {
          sections.push({ title, content });
        }
      }
    } else {
      const requestedTypes: string[] = Array.isArray(body.assetTypes)
        ? body.assetTypes.filter((t: unknown): t is string =>
            typeof t === "string" && ASSET_TYPES.includes(t as AssetType)
          )
        : ["overview", "points", "scripture", "discussion_questions"];

      for (const t of requestedTypes) {
        const content = savedMap.get(t);
        if (content && content.trim()) {
          const label = GENERATION_PROMPT_SLOTS.find((s) => s.key === t)?.label || t;
          sections.push({ title: label, content });
        }
      }
    }

    if (sections.length === 0) {
      return NextResponse.json(
        { error: "No generated or edited content selected for PDF export." },
        { status: 400 }
      );
    }

    const dateLabel = new Date(sermon.createdAt).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    const pdfBuf = await renderGardenChurchPdf({
      sermonTitle: sermon.title,
      speaker: sermon.speaker || user.fullName || "The Garden Church",
      topic: sermon.topic || undefined,
      dateLabel,
      documentTitle:
        typeof body.documentTitle === "string" && body.documentTitle.trim()
          ? body.documentTitle.trim().slice(0, 120)
          : sections.length === 1
            ? `${sections[0].title} — The Garden Church`
            : "Sermon Notes & Discussion Guide",
      sections,
      includeNoteLines: Boolean(body.includeNoteLines),
    });

    const slug =
      sermon.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "sermon";

    return new NextResponse(new Uint8Array(pdfBuf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdfBuf.length),
        "Content-Disposition": `attachment; filename="${slug}-garden-church.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return safeErrorResponse(err, "Could not generate Garden Church PDF.");
  }
}
