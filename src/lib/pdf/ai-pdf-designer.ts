import { callLlmCompletion, type LlmConfig } from "@/lib/ai/provider";
import { extractJsonBlock } from "@/lib/ai/generators";
import type { GardenPdfSection } from "@/lib/pdf/garden-pdf";
import {
  DEFAULT_PDF_DESIGN,
  type PdfDensity,
  type PdfDesignSpec,
  type PdfFontPairing,
  type PdfHeaderStyle,
} from "@/lib/types";

const HEX_RE = /^#[0-9a-f]{6}$/i;
const VALID_HEADERS = new Set<PdfHeaderStyle>(["banner", "minimal", "boxed", "centered"]);
const VALID_PAIRINGS = new Set<PdfFontPairing>(["garden", "editorial", "classic", "modern"]);
const VALID_DENSITIES = new Set<PdfDensity>(["compact", "comfortable", "spacious"]);

function pickHex(cand: unknown, fallback: string): string {
  return typeof cand === "string" && HEX_RE.test(cand.trim()) ? cand.trim() : fallback;
}

export async function designPdfWithAi(params: {
  sermonTitle: string;
  documentTitle: string;
  sections: GardenPdfSection[];
  baseDesign: PdfDesignSpec;
  pdfPrompt: string;
  customInstruction?: string;
  config: LlmConfig;
}): Promise<{
  documentTitle: string;
  design: PdfDesignSpec;
  sections: GardenPdfSection[];
  usedAi: boolean;
}> {
  const { sermonTitle, documentTitle, sections, baseDesign, pdfPrompt, customInstruction, config } =
    params;

  if (config.provider === "offline") {
    return { documentTitle, design: baseDesign, sections, usedAi: false };
  }

  try {
    const sysPrompt = `You are a print layout & typography designer for The Garden Church in Boston.
Your job is to apply the user's PDF Design Prompt to organize and style a sermon handout cleanly as JSON for our PDF renderer.
Available layout parameters:
- headerStyle: "banner" | "minimal" | "boxed" | "centered"
- fontPairing: "garden" (Yankee sans) | "editorial" (Merriweather headings + Yankee body) | "classic" (Libre Baskerville) | "modern" (Plus Jakarta Sans)
- density: "compact" | "comfortable" | "spacious"
- palette: { primaryHex, accentHex, surfaceHex, headerBgHex, headerTextHex } (6-digit hex codes)
- showLogo, showMetadata, showBadgeNumbers, uppercaseHeadings: booleans
In section content, you may use standard Markdown (headings ##, **bold**, *italic*, numbered lists 1., bullets -, > blockquotes) plus :::callout Title ... ::: blocks for Scripture/prayer callouts. Preserve biblical fidelity and keep all requested sermon content intact.
Return ONLY valid JSON:
{
  "documentTitle": "...",
  "design": { ... },
  "sections": [{ "title": "...", "content": "..." }]
}`;

    const userMsg = `Sermon Title: "${sermonTitle}"
Current Document Subtitle: "${documentTitle}"
Current Base Style: ${JSON.stringify(baseDesign)}

USER'S PDF DESIGN PROMPT (follow carefully):
${pdfPrompt}
${customInstruction ? `\nONE-OFF ADJUSTMENT FOR THIS EXPORT:\n${customInstruction}` : ""}

SECTIONS TO FORMAT (${sections.length}):
${JSON.stringify(sections).slice(0, 22000)}`;

    const raw = await callLlmCompletion(
      config,
      [
        { role: "system", content: sysPrompt },
        { role: "user", content: userMsg },
      ],
      { jsonMode: true, maxTokens: 4096, temperature: 0.4, timeoutMs: 90_000 }
    );

    const parsed = extractJsonBlock(raw);
    if (!parsed) {
      return { documentTitle, design: baseDesign, sections, usedAi: false };
    }

    const dRaw =
      parsed.design && typeof parsed.design === "object"
        ? (parsed.design as Record<string, unknown>)
        : {};
    const pRaw =
      dRaw.palette && typeof dRaw.palette === "object"
        ? (dRaw.palette as Record<string, unknown>)
        : {};

    const nextDesign: PdfDesignSpec = {
      headerStyle: VALID_HEADERS.has(dRaw.headerStyle as PdfHeaderStyle)
        ? (dRaw.headerStyle as PdfHeaderStyle)
        : baseDesign.headerStyle,
      fontPairing: VALID_PAIRINGS.has(dRaw.fontPairing as PdfFontPairing)
        ? (dRaw.fontPairing as PdfFontPairing)
        : baseDesign.fontPairing,
      density: VALID_DENSITIES.has(dRaw.density as PdfDensity)
        ? (dRaw.density as PdfDensity)
        : baseDesign.density,
      palette: {
        primaryHex: pickHex(pRaw.primaryHex, baseDesign.palette.primaryHex),
        accentHex: pickHex(pRaw.accentHex, baseDesign.palette.accentHex),
        surfaceHex: pickHex(pRaw.surfaceHex, baseDesign.palette.surfaceHex),
        headerBgHex: pickHex(pRaw.headerBgHex, baseDesign.palette.headerBgHex),
        headerTextHex: pickHex(pRaw.headerTextHex, baseDesign.palette.headerTextHex),
      },
      showLogo: typeof dRaw.showLogo === "boolean" ? dRaw.showLogo : baseDesign.showLogo,
      showMetadata:
        typeof dRaw.showMetadata === "boolean" ? dRaw.showMetadata : baseDesign.showMetadata,
      showBadgeNumbers:
        typeof dRaw.showBadgeNumbers === "boolean"
          ? dRaw.showBadgeNumbers
          : baseDesign.showBadgeNumbers,
      uppercaseHeadings:
        typeof dRaw.uppercaseHeadings === "boolean"
          ? dRaw.uppercaseHeadings
          : baseDesign.uppercaseHeadings,
      useAiDesigner: baseDesign.useAiDesigner,
    };

    const nextSections: GardenPdfSection[] = [];
    if (Array.isArray(parsed.sections)) {
      for (const item of parsed.sections) {
        if (
          item &&
          typeof item === "object" &&
          typeof (item as { title?: unknown }).title === "string" &&
          typeof (item as { content?: unknown }).content === "string" &&
          (item as { content: string }).content.trim()
        ) {
          nextSections.push({
            title: (item as { title: string }).title.trim().slice(0, 120),
            content: (item as { content: string }).content.trim(),
          });
        }
      }
    }

    const nextTitle =
      typeof parsed.documentTitle === "string" && parsed.documentTitle.trim()
        ? parsed.documentTitle.trim().slice(0, 120)
        : documentTitle;

    return {
      documentTitle: nextTitle,
      design: { ...DEFAULT_PDF_DESIGN, ...nextDesign },
      sections: nextSections.length > 0 ? nextSections : sections,
      usedAi: true,
    };
  } catch (err) {
    console.warn("[Ambo AI] AI PDF designer fell back to base layout:", err);
    return { documentTitle, design: baseDesign, sections, usedAi: false };
  }
}
