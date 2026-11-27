import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import {
  DEFAULT_PDF_DESIGN,
  type PdfDensity,
  type PdfDesignSpec,
  type PdfFontPairing,
  type PdfHeaderStyle,
} from "@/lib/types";

export interface GardenPdfSection {
  title: string;
  content: string;
}

export interface GardenPdfInput {
  sermonTitle: string;
  speaker?: string;
  topic?: string;
  dateLabel?: string;
  documentTitle?: string;
  sections: GardenPdfSection[];
  includeNoteLines?: boolean;
  design?: Partial<PdfDesignSpec>;
}

const FONTS_DIR = path.join(process.cwd(), "data", "fonts");
const LOGO_PRIMARY_LIGHT = path.join(
  process.cwd(),
  "public",
  "brand",
  "garden",
  "logo-primary-light.png"
);
const LOGO_PRIMARY_DARK = path.join(
  process.cwd(),
  "public",
  "brand",
  "garden",
  "logo-primary-dark.png"
);
const LOGO_MARK_DARK = path.join(
  process.cwd(),
  "public",
  "brand",
  "garden",
  "logo-mark-dark.png"
);

type InlineSpan = { text: string; font: string };

function isHexLight(hex: string): boolean {
  const c = (hex || "#FFFFFF").replace("#", "");
  if (c.length !== 6) return false;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 155;
}

function stripMarkdown(line: string): string {
  return line
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
}

function parseInlineMarkdown(
  line: string,
  boldFont: string,
  italicFont: string,
  baseFont: string
): InlineSpan[] {
  const spans: InlineSpan[] = [];
  const normalized = line.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  const tokenRe = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(normalized)) !== null) {
    if (match.index > last) {
      spans.push({ text: normalized.slice(last, match.index), font: baseFont });
    }
    const tok = match[0];
    if (tok.startsWith("**") && tok.endsWith("**")) {
      spans.push({ text: tok.slice(2, -2), font: boldFont });
    } else if (tok.startsWith("*") && tok.endsWith("*")) {
      spans.push({ text: tok.slice(1, -1), font: italicFont });
    } else {
      spans.push({ text: tok.slice(1, -1), font: boldFont });
    }
    last = match.index + tok.length;
  }
  if (last < normalized.length) {
    spans.push({ text: normalized.slice(last), font: baseFont });
  }
  return spans.length > 0 ? spans : [{ text: normalized, font: baseFont }];
}

function writeRichLine(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  width: number,
  options: {
    size: number;
    color: string;
    baseFont: string;
    boldFont: string;
    italicFont: string;
    lineGap?: number;
  }
) {
  const spans = parseInlineMarkdown(text, options.boldFont, options.italicFont, options.baseFont);
  doc.fillColor(options.color).fontSize(options.size);
  const lineGap = options.lineGap ?? 3.5;
  spans.forEach((span, idx) => {
    const isLast = idx === spans.length - 1;
    doc.font(span.font);
    if (idx === 0) {
      doc.text(span.text, x, doc.y, {
        width,
        lineGap,
        continued: !isLast,
      });
    } else {
      doc.text(span.text, {
        width,
        lineGap,
        continued: !isLast,
      });
    }
  });
}

function drawCenteredCircleNumber(
  doc: PDFKit.PDFDocument,
  cx: number,
  cy: number,
  radius: number,
  num: string,
  fontName: string,
  fontSize: number,
  circleColor: string,
  textColor: string
) {
  doc.circle(cx, cy, radius).fill(circleColor);
  doc.fillColor(textColor).font(fontName).fontSize(fontSize);

  const fontObj = (
    doc as unknown as {
      _font?: { ascender?: number; font?: { capHeight?: number } };
    }
  )._font;
  const ascender = fontObj?.ascender ?? 1050;
  const capHeight = fontObj?.font?.capHeight ?? 700;
  const ascPt = (ascender / 1000) * fontSize;
  const capPt = (capHeight / 1000) * fontSize;
  const textY = cy - (ascPt - capPt / 2);
  const textW = doc.widthOfString(num, { characterSpacing: 0 });
  const textX = cx - textW / 2;

  doc.text(num, textX, textY, {
    lineBreak: false,
    characterSpacing: 0,
  });
}

function isRedundantSectionHeading(headingText: string, sectionTitle: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const h = norm(headingText);
  const t = norm(sectionTitle);
  if (!h || !t) return false;
  if (h === t || h.startsWith(t) || t.startsWith(h)) return true;

  const genericPrefixes = [
    "sermon overview",
    "sermon summary",
    "key sermon points",
    "scripture references",
    "notable sermon quotes",
    "notable quotes",
    "small group discussion questions",
    "discussion questions",
    "small group leader guide",
    "5 day devotional plan",
  ];
  return genericPrefixes.some((p) => h.startsWith(p));
}

function mergeDesign(override?: Partial<PdfDesignSpec>): PdfDesignSpec {
  return {
    ...DEFAULT_PDF_DESIGN,
    ...(override || {}),
    palette: {
      ...DEFAULT_PDF_DESIGN.palette,
      ...(override?.palette || {}),
    },
  };
}

function registerPairingFonts(doc: PDFKit.PDFDocument, pairing: PdfFontPairing) {
  const regIfExists = (name: string, file: string): boolean => {
    const full = path.join(FONTS_DIR, file);
    if (fs.existsSync(full)) {
      doc.registerFont(name, full);
      return true;
    }
    return false;
  };

  // Always keep Yankee semi/med/italic available as clean fallbacks
  const hasYankeeExtraBold = regIfExists("YankeeExtraBold", "Yankee-ExtraBold.otf");
  const hasYankeeBold = regIfExists("YankeeBold", "Yankee-Bold.otf");
  const hasYankeeBoldIt = regIfExists("YankeeBoldIt", "Yankee-BoldIt.otf");
  const hasYankeeSemi = regIfExists("YankeeSemi", "Yankee-SemiBold.otf");
  const hasYankeeMed = regIfExists("YankeeMed", "Yankee-Medium.otf");
  const hasYankeeReg = regIfExists("YankeeReg", "Yankee-Regular.otf");
  const hasYankeeIt = regIfExists("YankeeIt", "Yankee-RegularIt.otf");

  const hasJakartaReg = regIfExists("JakartaReg", "PlusJakartaSans-Regular.ttf");
  const hasJakartaMed = regIfExists("JakartaMed", "PlusJakartaSans-Medium.ttf");
  const hasJakartaSemi = regIfExists("JakartaSemi", "PlusJakartaSans-SemiBold.ttf");
  const hasJakartaBold = regIfExists("JakartaBold", "PlusJakartaSans-Bold.ttf");

  const hasMerriweather = regIfExists("MerriweatherBold", "Merriweather.ttf");
  const hasBaskerville = regIfExists("BaskervilleBold", "LibreBaskerville.ttf");

  const yBold = hasYankeeBold ? "YankeeBold" : "Helvetica-Bold";
  const yDisp = hasYankeeExtraBold ? "YankeeExtraBold" : yBold;
  const ySemi = hasYankeeSemi ? "YankeeSemi" : yBold;
  const yReg = hasYankeeReg ? "YankeeReg" : "Helvetica";
  const yMed = hasYankeeMed ? "YankeeMed" : yReg;
  const yIt = hasYankeeIt ? "YankeeIt" : "Helvetica-Oblique";
  const yBoldIt = hasYankeeBoldIt ? "YankeeBoldIt" : "Helvetica-BoldOblique";

  if (pairing === "editorial" && hasMerriweather) {
    return {
      FONT_DISPLAY: "MerriweatherBold",
      FONT_BOLD: yBold,
      FONT_BOLD_IT: yBoldIt,
      FONT_SEMI: ySemi,
      FONT_MED: yMed,
      FONT_REG: yReg,
      FONT_ITALIC: yIt,
    };
  }

  if (pairing === "classic" && hasBaskerville) {
    return {
      FONT_DISPLAY: "BaskervilleBold",
      FONT_BOLD: "BaskervilleBold",
      FONT_BOLD_IT: yBoldIt,
      FONT_SEMI: ySemi,
      FONT_MED: yReg,
      FONT_REG: yReg,
      FONT_ITALIC: yIt,
    };
  }

  if (pairing === "modern" && hasJakartaReg && hasJakartaBold) {
    return {
      FONT_DISPLAY: "JakartaBold",
      FONT_BOLD: "JakartaBold",
      FONT_BOLD_IT: yBoldIt,
      FONT_SEMI: hasJakartaSemi ? "JakartaSemi" : "JakartaBold",
      FONT_MED: hasJakartaMed ? "JakartaMed" : "JakartaReg",
      FONT_REG: "JakartaReg",
      FONT_ITALIC: yIt,
    };
  }

  // Default: "garden" (Official Garden Church Yankee family)
  return {
    FONT_DISPLAY: yDisp,
    FONT_BOLD: yBold,
    FONT_BOLD_IT: yBoldIt,
    FONT_SEMI: ySemi,
    FONT_MED: yMed,
    FONT_REG: yReg,
    FONT_ITALIC: yIt,
  };
}

export async function renderGardenChurchPdf(input: GardenPdfInput): Promise<Buffer> {
  const design = mergeDesign(input.design);
  const { palette } = design;
  const COLORS = {
    light: "#FFFFFF",
    primary: palette.primaryHex || "#1D3519",
    accent: palette.accentHex || "#BDD630",
    surface: palette.surfaceHex || "#F4F2E6",
    headerBg: palette.headerBgHex || palette.primaryHex || "#1D3519",
    headerText: palette.headerTextHex || "#FFFFFF",
    soil: "#121413",
    muted: "#576258",
    rule: "#DFDCD0",
  };

  const densityMap: Record<
    PdfDensity,
    { marginX: number; bodySize: number; lineGap: number; secGap: number; itemGap: number }
  > = {
    compact: { marginX: 46, bodySize: 9.5, lineGap: 2.6, secGap: 9, itemGap: 3.5 },
    comfortable: { marginX: 56, bodySize: 10.5, lineGap: 3.5, secGap: 12, itemGap: 5 },
    spacious: { marginX: 56, bodySize: 11.5, lineGap: 4.5, secGap: 15, itemGap: 6.5 },
  };
  const dSpec = densityMap[design.density] || densityMap.comfortable;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: 52, bottom: 48, left: dSpec.marginX, right: dSpec.marginX },
      bufferPages: true,
      info: {
        Title: `${input.sermonTitle} — The Garden Church`,
        Author: input.speaker || "The Garden Church Boston",
        Subject: input.documentTitle || "Sermon Resources",
        Creator: "Ambo AI Studio — The Garden Church Edition",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const fonts = registerPairingFonts(doc, design.fontPairing);
    const { FONT_DISPLAY, FONT_BOLD, FONT_BOLD_IT, FONT_SEMI, FONT_MED, FONT_REG, FONT_ITALIC } =
      fonts;

    const pageW = doc.page.width; // 612
    const marginL = dSpec.marginX;
    const marginR = dSpec.marginX;
    const contentW = pageW - marginL - marginR;
    const maxY = doc.page.height - 76; // 716 (safely above page.maxY())

    const ensureSpace = (needed: number) => {
      const clamped = Math.min(needed, maxY - 90);
      if (doc.y + clamped > maxY) {
        doc.addPage();
        doc.y = 52;
      }
    };

    // === HEADER RENDERING (4 Styles) ===
    const cleanSubtitle = (input.documentTitle || "SERMON RESOURCES & DISCUSSION GUIDE")
      .replace(/\s*[—–-]\s*The Garden Church\s*$/i, "")
      .trim()
      .toUpperCase();
    const rawTitle = (input.sermonTitle || "Sermon Notes").trim();
    const displayTitle = design.uppercaseHeadings ? rawTitle.toUpperCase() : rawTitle;
    const titleSize =
      displayTitle.length > 70 ? 15.5 : displayTitle.length > 45 ? 18 : 20.5;

    const metaParts = design.showMetadata
      ? [input.speaker?.trim(), input.dateLabel?.trim(), input.topic?.trim()].filter(Boolean)
      : [];
    const metaStr = metaParts.join("   ·   ");

    const headerStyle: PdfHeaderStyle = design.headerStyle || "banner";
    const lightHeaderBg = isHexLight(COLORS.headerBg);
    const logoForDark = fs.existsSync(LOGO_PRIMARY_LIGHT) ? LOGO_PRIMARY_LIGHT : null;
    const logoForLight = fs.existsSync(LOGO_PRIMARY_DARK)
      ? LOGO_PRIMARY_DARK
      : fs.existsSync(LOGO_MARK_DARK)
        ? LOGO_MARK_DARK
        : null;

    if (headerStyle === "minimal") {
      const topY = 40;
      const logoW = design.showLogo && logoForLight ? 78 : 0;
      const textW = logoW ? contentW - logoW - 20 : contentW;

      doc.font(FONT_SEMI).fontSize(8.5);
      const subH = doc.heightOfString(cleanSubtitle, { width: textW, characterSpacing: 1.2 });
      doc.font(FONT_DISPLAY).fontSize(titleSize);
      const tH = doc.heightOfString(displayTitle, { width: textW, lineGap: 2.5 });

      doc
        .fillColor(COLORS.primary)
        .font(FONT_SEMI)
        .fontSize(8.5)
        .text(cleanSubtitle, marginL, topY, { width: textW, characterSpacing: 1.2 });

      doc
        .fillColor(COLORS.soil)
        .font(FONT_DISPLAY)
        .fontSize(titleSize)
        .text(displayTitle, marginL, topY + subH + 5, { width: textW, lineGap: 2.5 });

      let bottomY = topY + subH + 5 + tH;
      if (metaStr) {
        doc.font(FONT_MED).fontSize(9.5);
        const mH = doc.heightOfString(metaStr, { width: textW });
        doc
          .fillColor(COLORS.muted)
          .font(FONT_MED)
          .fontSize(9.5)
          .text(metaStr, marginL, bottomY + 6, { width: textW });
        bottomY += 6 + mH;
      }

      if (design.showLogo && logoForLight) {
        doc.image(logoForLight, pageW - marginR - logoW, topY + 2, { width: logoW });
      }

      const ruleY = Math.max(bottomY + 14, topY + (logoW ? 48 : 0));
      doc
        .moveTo(marginL, ruleY)
        .lineTo(pageW - marginR, ruleY)
        .lineWidth(2.2)
        .strokeColor(COLORS.accent)
        .stroke();
      doc.y = ruleY + 18;
    } else if (headerStyle === "centered") {
      let curY = 40;
      if (design.showLogo && logoForLight) {
        const lw = 76;
        doc.image(logoForLight, (pageW - lw) / 2, curY, { width: lw });
        curY += 44;
      }
      doc.font(FONT_SEMI).fontSize(8.5);
      const subH = doc.heightOfString(cleanSubtitle, {
        width: contentW,
        align: "center",
        characterSpacing: 1.4,
      });
      doc
        .fillColor(COLORS.primary)
        .font(FONT_SEMI)
        .fontSize(8.5)
        .text(cleanSubtitle, marginL, curY, {
          width: contentW,
          align: "center",
          characterSpacing: 1.4,
        });
      curY += subH + 5;

      doc.font(FONT_DISPLAY).fontSize(titleSize);
      const tH = doc.heightOfString(displayTitle, {
        width: contentW,
        align: "center",
        lineGap: 2.5,
      });
      doc
        .fillColor(COLORS.soil)
        .font(FONT_DISPLAY)
        .fontSize(titleSize)
        .text(displayTitle, marginL, curY, {
          width: contentW,
          align: "center",
          lineGap: 2.5,
        });
      curY += tH;

      if (metaStr) {
        doc.font(FONT_MED).fontSize(9.5);
        const mH = doc.heightOfString(metaStr, { width: contentW, align: "center" });
        doc
          .fillColor(COLORS.muted)
          .font(FONT_MED)
          .fontSize(9.5)
          .text(metaStr, marginL, curY + 6, { width: contentW, align: "center" });
        curY += 6 + mH;
      }

      curY += 14;
      doc
        .moveTo(marginL + 40, curY)
        .lineTo(pageW - marginR - 40, curY)
        .lineWidth(1.5)
        .strokeColor(COLORS.accent)
        .stroke();
      doc.y = curY + 18;
    } else {
      // "banner" (full bleed) or "boxed" (inset rounded card)
      const isBoxed = headerStyle === "boxed";
      const boxX = isBoxed ? marginL : 0;
      const boxY = isBoxed ? 36 : 0;
      const boxW = isBoxed ? contentW : pageW;
      const textX = isBoxed ? marginL + 24 : marginL;
      const padTop = isBoxed ? 22 : 34;
      const padBottom = isBoxed ? 22 : 32;
      const logoW = design.showLogo ? 92 : 0;
      const logoH = logoW ? logoW * (451 / 854) : 0;
      const logoGap = logoW ? 24 : 0;
      const headerTextW = (isBoxed ? contentW - 48 : contentW) - logoW - logoGap;

      doc.font(FONT_SEMI).fontSize(8.5);
      const subtitleH = doc.heightOfString(cleanSubtitle, {
        width: headerTextW,
        characterSpacing: 1.2,
      });

      doc.font(FONT_DISPLAY).fontSize(titleSize);
      const titleH = doc.heightOfString(displayTitle, {
        width: headerTextW,
        characterSpacing: 0.25,
        lineGap: 2.5,
      });

      let metaH = 0;
      if (metaStr) {
        doc.font(FONT_MED).fontSize(9.5);
        metaH = doc.heightOfString(metaStr, { width: headerTextW, lineGap: 2 });
      }

      const textBlockH = subtitleH + 7 + titleH + (metaStr ? 9 + metaH : 0);
      const innerH = Math.max(textBlockH, logoH);
      const bannerH = Math.round(padTop + innerH + padBottom);

      if (isBoxed) {
        doc.roundedRect(boxX, boxY, boxW, bannerH, 10).fill(COLORS.headerBg);
        doc.rect(boxX, boxY + bannerH - 4, boxW, 4).fill(COLORS.accent);
      } else {
        doc.rect(0, 0, pageW, bannerH).fill(COLORS.headerBg);
        doc.rect(0, bannerH, pageW, 4).fill(COLORS.accent);
      }

      const chosenLogo = lightHeaderBg ? logoForLight : logoForDark;
      if (design.showLogo && chosenLogo) {
        const logoY = boxY + padTop + (innerH - logoH) / 2;
        const logoX = isBoxed ? boxX + boxW - 24 - logoW : pageW - marginR - logoW;
        doc.image(chosenLogo, logoX, logoY, { width: logoW });
      }

      const textStartY = boxY + padTop + (innerH - textBlockH) / 2;
      doc
        .fillColor(lightHeaderBg ? COLORS.primary : COLORS.accent)
        .font(FONT_SEMI)
        .fontSize(8.5)
        .text(cleanSubtitle, textX, textStartY, {
          width: headerTextW,
          characterSpacing: 1.2,
        });

      doc
        .fillColor(COLORS.headerText)
        .font(FONT_DISPLAY)
        .fontSize(titleSize)
        .text(displayTitle, textX, textStartY + subtitleH + 7, {
          width: headerTextW,
          characterSpacing: 0.25,
          lineGap: 2.5,
        });

      if (metaStr) {
        doc
          .fillColor(lightHeaderBg ? COLORS.muted : COLORS.surface)
          .font(FONT_MED)
          .fontSize(9.5)
          .text(metaStr, textX, textStartY + subtitleH + 7 + titleH + 9, {
            width: headerTextW,
            lineGap: 2,
          });
      }

      doc.y = boxY + bannerH + (isBoxed ? 22 : 28);
    }

    // === RENDER SECTIONS ===
    input.sections.forEach((sec, sIdx) => {
      if (sIdx > 0) {
        doc.y += dSpec.secGap;
      }
      ensureSpace(115);

      const headingY = doc.y;
      const secHeading = design.uppercaseHeadings ? sec.title.toUpperCase() : sec.title;
      doc.roundedRect(marginL, headingY + 3.2, 4.5, 11, 2).fill(COLORS.accent);
      doc
        .fillColor(COLORS.primary)
        .font(FONT_DISPLAY)
        .fontSize(12.5)
        .text(secHeading, marginL + 13, headingY, {
          width: contentW - 13,
          characterSpacing: design.uppercaseHeadings ? 0.5 : 0.1,
        });
      doc
        .moveTo(marginL, doc.y + 4)
        .lineTo(pageW - marginR, doc.y + 4)
        .lineWidth(0.75)
        .strokeColor(COLORS.rule)
        .stroke();
      doc.y += 10;

      const lines = (sec.content || "").replace(/\r\n/g, "\n").split("\n");
      let i = 0;
      let seenContentLine = false;

      while (i < lines.length) {
        const rawLine = lines[i].trim();
        if (!rawLine) {
          if (seenContentLine) doc.y += 3.5;
          i += 1;
          continue;
        }

        if (/^[-*_]{3,}$/.test(rawLine)) {
          doc.y += 3;
          i += 1;
          continue;
        }

        // Callout card: :::callout Optional Title ... :::
        if (rawLine.startsWith(":::callout")) {
          seenContentLine = true;
          const calloutTitle = rawLine.replace(/^:::callout\s*/i, "").trim();
          const bodyLines: string[] = [];
          i += 1;
          while (i < lines.length && !lines[i].trim().startsWith(":::")) {
            const cl = lines[i].trim();
            if (cl) bodyLines.push(cl);
            i += 1;
          }
          if (i < lines.length && lines[i].trim().startsWith(":::")) i += 1;

          const bodyText = bodyLines.join(" ");
          doc.font(FONT_MED).fontSize(dSpec.bodySize);
          const bodyH = doc.heightOfString(stripMarkdown(bodyText), {
            width: contentW - 28,
            lineGap: dSpec.lineGap,
          });
          const titleH = calloutTitle ? 15 : 0;
          const boxH = titleH + bodyH + 18;
          ensureSpace(boxH + 8);
          const boxY = doc.y;
          doc.roundedRect(marginL, boxY, contentW, boxH, 6).fill(COLORS.surface);
          doc.rect(marginL, boxY, 4, boxH).fill(COLORS.accent);
          let innerY = boxY + 9;
          if (calloutTitle) {
            doc
              .fillColor(COLORS.primary)
              .font(FONT_BOLD)
              .fontSize(dSpec.bodySize)
              .text(calloutTitle, marginL + 16, innerY, { width: contentW - 28 });
            innerY = doc.y + 3;
          }
          doc.y = innerY;
          writeRichLine(doc, bodyText, marginL + 16, contentW - 28, {
            size: dSpec.bodySize,
            color: COLORS.soil,
            baseFont: FONT_MED,
            boldFont: FONT_BOLD,
            italicFont: FONT_ITALIC,
            lineGap: dSpec.lineGap,
          });
          doc.y = Math.max(doc.y + 4, boxY + boxH + 7);
          continue;
        }

        // Heading (#, ##, ###)
        const hMatch = rawLine.match(/^(#{1,4})\s+(.+)$/);
        if (hMatch) {
          const cleanHeading = stripMarkdown(hMatch[2]).trim();
          if (!seenContentLine && isRedundantSectionHeading(cleanHeading, sec.title)) {
            i += 1;
            continue;
          }
          seenContentLine = true;
          ensureSpace(32);
          const level = hMatch[1].length;
          doc.y += 4;
          doc
            .fillColor(COLORS.primary)
            .font(level <= 2 ? FONT_BOLD : FONT_SEMI)
            .fontSize(level === 1 ? 12.5 : level === 2 ? 11.2 : 10.2)
            .text(cleanHeading, marginL, doc.y, { width: contentW });
          doc.y += 2.5;
          i += 1;
          continue;
        }

        seenContentLine = true;

        // Blockquote group (> ...)
        if (rawLine.startsWith(">")) {
          const quoteLines: string[] = [];
          while (i < lines.length && lines[i].trim().startsWith(">")) {
            quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
            i += 1;
          }
          const qText = quoteLines.join(" ");
          doc.font(FONT_ITALIC).fontSize(dSpec.bodySize);
          const measuredH = doc.heightOfString(stripMarkdown(qText), {
            width: contentW - 28,
            lineGap: dSpec.lineGap,
          });
          const boxH = measuredH + 18;
          ensureSpace(boxH + 8);
          const boxY = doc.y;
          doc.roundedRect(marginL, boxY, contentW, boxH, 6).fill(COLORS.surface);
          doc.rect(marginL, boxY, 4, boxH).fill(COLORS.accent);
          doc.y = boxY + 9;
          writeRichLine(doc, qText, marginL + 16, contentW - 28, {
            size: dSpec.bodySize,
            color: COLORS.primary,
            baseFont: FONT_ITALIC,
            boldFont: FONT_BOLD_IT,
            italicFont: FONT_ITALIC,
            lineGap: dSpec.lineGap,
          });
          doc.y = Math.max(doc.y + 4, boxY + boxH + 7);
          continue;
        }

        // Numbered item (1. ...)
        const numMatch = rawLine.match(/^(\d+)[.)]\s+(.+)$/);
        if (numMatch) {
          const num = numMatch[1];
          const itemText = numMatch[2];
          doc.font(FONT_MED).fontSize(dSpec.bodySize);
          const textIndent = design.showBadgeNumbers ? 26 : 16;
          const estH = doc.heightOfString(stripMarkdown(itemText), {
            width: contentW - textIndent,
            lineGap: dSpec.lineGap,
          });
          ensureSpace(estH + 8);
          const rowY = doc.y;

          if (design.showBadgeNumbers) {
            drawCenteredCircleNumber(
              doc,
              marginL + 9,
              rowY + dSpec.bodySize * 0.7,
              9,
              num,
              FONT_BOLD,
              num.length >= 2 ? 7.8 : 8.5,
              COLORS.primary,
              COLORS.accent
            );
          } else {
            doc
              .fillColor(COLORS.primary)
              .font(FONT_BOLD)
              .fontSize(dSpec.bodySize)
              .text(`${num}.`, marginL, rowY, { lineBreak: false });
          }

          doc.y = rowY;
          writeRichLine(doc, itemText, marginL + textIndent, contentW - textIndent, {
            size: dSpec.bodySize,
            color: COLORS.soil,
            baseFont: FONT_MED,
            boldFont: FONT_BOLD,
            italicFont: FONT_ITALIC,
            lineGap: dSpec.lineGap,
          });
          doc.y = Math.max(doc.y + dSpec.itemGap, rowY + 19);
          i += 1;
          continue;
        }

        // Bullet item (- / * / •)
        const bulletMatch = rawLine.match(/^[-*•]\s+(.+)$/);
        if (bulletMatch) {
          const itemText = bulletMatch[1];
          doc.font(FONT_REG).fontSize(dSpec.bodySize);
          const estH = doc.heightOfString(stripMarkdown(itemText), {
            width: contentW - 16,
            lineGap: dSpec.lineGap,
          });
          ensureSpace(estH + 6);
          const rowY = doc.y;
          doc.circle(marginL + 5, rowY + dSpec.bodySize * 0.7, 2.5).fill(COLORS.accent);
          doc.y = rowY;
          writeRichLine(doc, itemText, marginL + 16, contentW - 16, {
            size: dSpec.bodySize,
            color: COLORS.soil,
            baseFont: FONT_REG,
            boldFont: FONT_BOLD,
            italicFont: FONT_ITALIC,
            lineGap: dSpec.lineGap,
          });
          doc.y += dSpec.itemGap - 1;
          i += 1;
          continue;
        }

        // Standard paragraph
        doc.font(FONT_REG).fontSize(dSpec.bodySize);
        const estH = doc.heightOfString(stripMarkdown(rawLine), {
          width: contentW,
          lineGap: dSpec.lineGap + 0.5,
        });
        ensureSpace(estH + 8);
        writeRichLine(doc, rawLine, marginL, contentW, {
          size: dSpec.bodySize,
          color: COLORS.soil,
          baseFont: FONT_REG,
          boldFont: FONT_BOLD,
          italicFont: FONT_ITALIC,
          lineGap: dSpec.lineGap + 0.5,
        });
        doc.y += dSpec.itemGap;
        i += 1;
      }
    });

    // === OPTIONAL HANDWRITTEN NOTES LINES ===
    if (input.includeNoteLines) {
      if (doc.y > maxY - 110) {
        doc.addPage();
        doc.y = 52;
      } else {
        doc.y += 14;
      }
      const notesY = doc.y;
      doc.roundedRect(marginL, notesY + 3.2, 4.5, 11, 2).fill(COLORS.accent);
      doc
        .fillColor(COLORS.primary)
        .font(FONT_DISPLAY)
        .fontSize(12.5)
        .text(
          design.uppercaseHeadings ? "NOTES & REFLECTION" : "Notes & Reflection",
          marginL + 13,
          notesY,
          {
            width: contentW - 13,
            characterSpacing: design.uppercaseHeadings ? 0.5 : 0.1,
          }
        );
      doc.y += 8;
      while (doc.y + 22 <= maxY - 6) {
        doc.y += 22;
        doc
          .moveTo(marginL, doc.y)
          .lineTo(pageW - marginR, doc.y)
          .lineWidth(0.6)
          .strokeColor(COLORS.rule)
          .stroke();
      }
    }

    // === RUNNING FOOTER ACROSS ALL PAGES ===
    const range = doc.bufferedPageRange();
    for (let idx = 0; idx < range.count; idx++) {
      doc.switchToPage(range.start + idx);
      const prevBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;

      const footerY = doc.page.height - 42;
      doc
        .moveTo(marginL, footerY - 8)
        .lineTo(pageW - marginR, footerY - 8)
        .lineWidth(0.6)
        .strokeColor(COLORS.rule)
        .stroke();

      let textX = marginL;
      if (fs.existsSync(LOGO_MARK_DARK)) {
        doc.image(LOGO_MARK_DARK, marginL, footerY - 1, { height: 12 });
        textX = marginL + 17;
      }
      doc
        .fillColor(COLORS.primary)
        .font(FONT_SEMI)
        .fontSize(8)
        .text("THE GARDEN CHURCH  ·  BOSTON", textX, footerY + 1, {
          lineBreak: false,
          characterSpacing: 0.6,
        });

      const pageStr = `Page ${idx + 1} of ${range.count}`;
      doc.fillColor(COLORS.muted).font(FONT_REG).fontSize(8);
      const pageStrW = doc.widthOfString(pageStr, { characterSpacing: 0 });
      doc.text(pageStr, pageW - marginR - pageStrW, footerY + 1, {
        lineBreak: false,
        characterSpacing: 0,
      });

      doc.page.margins.bottom = prevBottom;
    }

    doc.end();
  });
}
