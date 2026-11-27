import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { sermonAssets, sermons } from "@/lib/db/schema";
import { ensureUserAiSettings, getCurrentUser } from "@/lib/auth";
import { renderGardenChurchPdf, type GardenPdfSection } from "@/lib/pdf/garden-pdf";
import { designPdfWithAi } from "@/lib/pdf/ai-pdf-designer";
import {
  GENERATION_PROMPT_SLOTS,
  getEffectiveGenerationPrompts,
} from "@/lib/ai/default-generation-prompts";
import { saveBufferToExportDir } from "@/lib/local-export";
import {
  ASSET_TYPES,
  DEFAULT_PDF_DESIGN,
  type AssetType,
  type LlmProvider,
  type PdfDesignSpec,
} from "@/lib/types";
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
        ? body.assetTypes.filter(
            (t: unknown): t is string =>
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

    const settings = ensureUserAiSettings(user.id);
    let savedDesign: PdfDesignSpec = DEFAULT_PDF_DESIGN;
    try {
      const parsed = JSON.parse(settings.defaultPdfDesignJson || "{}");
      savedDesign = {
        ...DEFAULT_PDF_DESIGN,
        ...parsed,
        palette: { ...DEFAULT_PDF_DESIGN.palette, ...(parsed.palette || {}) },
      };
    } catch {}

    const reqDesign =
      body.design && typeof body.design === "object"
        ? (body.design as Partial<PdfDesignSpec>)
        : {};
    let activeDesign: PdfDesignSpec = {
      ...savedDesign,
      ...reqDesign,
      palette: { ...savedDesign.palette, ...(reqDesign.palette || {}) },
    };

    let documentTitle =
      typeof body.documentTitle === "string" && body.documentTitle.trim()
        ? body.documentTitle.trim().slice(0, 120)
        : sections.length === 1
          ? `${sections[0].title} — The Garden Church`
          : "Sermon Notes & Discussion Guide";

    let activeSections = sections;

    const answerKeyMode = Boolean(body.answerKey);
    const inlinePreview = Boolean(body.inlinePreview);
    const runAiInPreview = Boolean(body.runAiInPreview);

    if (activeDesign.useAiDesigner && settings.llmProvider !== "offline" && (!inlinePreview || runAiInPreview)) {
      const prompts = getEffectiveGenerationPrompts(user.id);
      const pdfPrompt =
        typeof body.pdfPrompt === "string" && body.pdfPrompt.trim()
          ? body.pdfPrompt.trim().slice(0, 4000)
          : prompts.pdf_design?.promptText || "";
      const customInstruction =
        typeof body.customInstruction === "string" && body.customInstruction.trim()
          ? body.customInstruction.trim().slice(0, 1500)
          : undefined;

      const aiRes = await designPdfWithAi({
        sermonTitle: sermon.title,
        documentTitle,
        sections,
        baseDesign: activeDesign,
        pdfPrompt,
        customInstruction,
        config: {
          provider: (settings.llmProvider as LlmProvider) || "offline",
          apiKey: settings.decryptedApiKey || "",
          baseUrl: settings.baseUrl,
          model: settings.model,
        },
      });
      documentTitle = aiRes.documentTitle;
      activeDesign = aiRes.design;
      activeSections = aiRes.sections;
    }

    const dateLabel = new Date(sermon.createdAt).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

    const pdfBuf = await renderGardenChurchPdf({
      sermonTitle: sermon.title,
      speaker: sermon.speaker || settings.defaultSpeaker || user.fullName || "The Garden Church",
      topic: sermon.topic || undefined,
      dateLabel,
      documentTitle,
      sections: activeSections,
      includeNoteLines: Boolean(body.includeNoteLines),
      answerKeyMode,
      design: activeDesign,
    });

    const slug =
      sermon.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "") || "sermon";
    const fileName = answerKeyMode
      ? `${slug}-leader-answer-key.pdf`
      : activeDesign.fillInTheBlanks
        ? `${slug}-sunday-bulletin.pdf`
        : `${slug}-garden-church.pdf`;

    if (!inlinePreview && body.saveToDisk === true && settings.pdfExportDir) {
      const saved = saveBufferToExportDir(settings.pdfExportDir, fileName, pdfBuf);
      return NextResponse.json({
        ok: true,
        ...saved,
      });
    }

    return new NextResponse(new Uint8Array(pdfBuf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": String(pdfBuf.length),
        "Content-Disposition": `${inlinePreview ? "inline" : "attachment"}; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    return safeErrorResponse(err, "Could not generate Garden Church PDF.");
  }
}
