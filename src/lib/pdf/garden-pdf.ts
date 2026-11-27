import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";

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
}

const GARDEN = {
  light: "#FFFFFF",
  vine: "#BDD630",
  soil: "#121413",
  dew: "#F4F2E6",
  root: "#1D3519",
  muted: "#576258",
  rule: "#DFDCD0",
};

const FONTS_DIR = path.join(process.cwd(), "data", "fonts");
const LOGO_PRIMARY_LIGHT = path.join(
  process.cwd(),
  "public",
  "brand",
  "garden",
  "logo-primary-light.png"
);
const LOGO_MARK_DARK = path.join(
  process.cwd(),
  "public",
  "brand",
  "garden",
  "logo-mark-dark.png"
);

type InlineSpan = { text: string; font: string };

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
  fontSize: number
) {
  doc.circle(cx, cy, radius).fill(GARDEN.root);
  doc.fillColor(GARDEN.vine).font(fontName).fontSize(fontSize);

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

export async function renderGardenChurchPdf(input: GardenPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: 56, bottom: 48, left: 56, right: 56 },
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

    // Register official Garden Church Yankee font family (readable across uppercase headings & body)
    const yankeeExtraBold = path.join(FONTS_DIR, "Yankee-ExtraBold.otf");
    const yankeeBold = path.join(FONTS_DIR, "Yankee-Bold.otf");
    const yankeeBoldIt = path.join(FONTS_DIR, "Yankee-BoldIt.otf");
    const yankeeSemi = path.join(FONTS_DIR, "Yankee-SemiBold.otf");
    const yankeeMed = path.join(FONTS_DIR, "Yankee-Medium.otf");
    const yankeeReg = path.join(FONTS_DIR, "Yankee-Regular.otf");
    const yankeeIt = path.join(FONTS_DIR, "Yankee-RegularIt.otf");

    const hasExtraBold = fs.existsSync(yankeeExtraBold);
    const hasBold = fs.existsSync(yankeeBold);
    const hasBoldIt = fs.existsSync(yankeeBoldIt);
    const hasSemi = fs.existsSync(yankeeSemi);
    const hasMed = fs.existsSync(yankeeMed);
    const hasReg = fs.existsSync(yankeeReg);
    const hasIt = fs.existsSync(yankeeIt);

    if (hasExtraBold) doc.registerFont("GardenDisplay", yankeeExtraBold);
    if (hasBold) doc.registerFont("GardenBold", yankeeBold);
    if (hasBoldIt) doc.registerFont("GardenBoldIt", yankeeBoldIt);
    if (hasSemi) doc.registerFont("GardenSemi", yankeeSemi);
    if (hasMed) doc.registerFont("GardenMed", yankeeMed);
    if (hasReg) doc.registerFont("GardenReg", yankeeReg);
    if (hasIt) doc.registerFont("GardenItalic", yankeeIt);

    const FONT_BOLD = hasBold ? "GardenBold" : "Helvetica-Bold";
    const FONT_DISPLAY = hasExtraBold ? "GardenDisplay" : FONT_BOLD;
    const FONT_BOLD_IT = hasBoldIt ? "GardenBoldIt" : "Helvetica-BoldOblique";
    const FONT_SEMI = hasSemi ? "GardenSemi" : FONT_BOLD;
    const FONT_REG = hasReg ? "GardenReg" : "Helvetica";
    const FONT_MED = hasMed ? "GardenMed" : FONT_REG;
    const FONT_ITALIC = hasIt ? "GardenItalic" : "Helvetica-Oblique";

    const pageW = doc.page.width; // 612
    const marginL = 56;
    const marginR = 56;
    const contentW = pageW - marginL - marginR; // 500
    const maxY = doc.page.height - 76; // 716 (safely above page.maxY() = 744)

    const ensureSpace = (needed: number) => {
      const clamped = Math.min(needed, maxY - 90);
      if (doc.y + clamped > maxY) {
        doc.addPage();
        doc.y = 56;
      }
    };

    // === HERO HEADER BANNER (Page 1) ===
    const bannerPadTop = 34;
    const bannerPadBottom = 32;
    const logoW = 96;
    const logoH = logoW * (451 / 854); // ~50.7pt aspect-preserving height
    const logoGap = 28;
    const headerTextW = contentW - logoW - logoGap;

    const cleanSubtitle = (input.documentTitle || "SERMON RESOURCES & DISCUSSION GUIDE")
      .replace(/\s*[—–-]\s*The Garden Church\s*$/i, "")
      .trim()
      .toUpperCase();
    const cleanTitle = (input.sermonTitle || "Sermon Notes").trim().toUpperCase();
    const titleSize = cleanTitle.length > 70 ? 15.5 : cleanTitle.length > 45 ? 18 : 20.5;

    const metaParts = [
      input.speaker?.trim(),
      input.dateLabel?.trim(),
      input.topic?.trim(),
    ].filter(Boolean);
    const metaStr = metaParts.join("   ·   ");

    doc.font(FONT_SEMI).fontSize(8.5);
    const subtitleH = doc.heightOfString(cleanSubtitle, {
      width: headerTextW,
      characterSpacing: 1.2,
    });

    doc.font(FONT_DISPLAY).fontSize(titleSize);
    const titleH = doc.heightOfString(cleanTitle, {
      width: headerTextW,
      characterSpacing: 0.25,
      lineGap: 2.5,
    });

    let metaH = 0;
    if (metaStr) {
      doc.font(FONT_MED).fontSize(9.5);
      metaH = doc.heightOfString(metaStr, {
        width: headerTextW,
        lineGap: 2,
      });
    }

    const textBlockH = subtitleH + 7 + titleH + (metaStr ? 9 + metaH : 0);
    const innerH = Math.max(textBlockH, logoH);
    const bannerH = Math.round(bannerPadTop + innerH + bannerPadBottom);

    doc.rect(0, 0, pageW, bannerH).fill(GARDEN.root);
    doc.rect(0, bannerH, pageW, 4).fill(GARDEN.vine);

    if (fs.existsSync(LOGO_PRIMARY_LIGHT)) {
      const logoY = bannerPadTop + (innerH - logoH) / 2;
      doc.image(LOGO_PRIMARY_LIGHT, pageW - marginR - logoW, logoY, { width: logoW });
    }

    const textStartY = bannerPadTop + (innerH - textBlockH) / 2;
    doc
      .fillColor(GARDEN.vine)
      .font(FONT_SEMI)
      .fontSize(8.5)
      .text(cleanSubtitle, marginL, textStartY, {
        width: headerTextW,
        characterSpacing: 1.2,
      });

    doc
      .fillColor(GARDEN.light)
      .font(FONT_DISPLAY)
      .fontSize(titleSize)
      .text(cleanTitle, marginL, textStartY + subtitleH + 7, {
        width: headerTextW,
        characterSpacing: 0.25,
        lineGap: 2.5,
      });

    if (metaStr) {
      doc
        .fillColor(GARDEN.dew)
        .font(FONT_MED)
        .fontSize(9.5)
        .text(metaStr, marginL, textStartY + subtitleH + 7 + titleH + 9, {
          width: headerTextW,
          lineGap: 2,
        });
    }

    doc.y = bannerH + 4 + 26;

    // === RENDER SECTIONS ===
    input.sections.forEach((sec, sIdx) => {
      if (sIdx > 0) {
        doc.y += 12;
      }
      ensureSpace(120);

      const headingY = doc.y;
      doc.roundedRect(marginL, headingY + 3.2, 4.5, 11, 2).fill(GARDEN.vine);
      doc
        .fillColor(GARDEN.root)
        .font(FONT_DISPLAY)
        .fontSize(12.5)
        .text(sec.title.toUpperCase(), marginL + 13, headingY, {
          width: contentW - 13,
          characterSpacing: 0.5,
        });
      doc
        .moveTo(marginL, doc.y + 4)
        .lineTo(pageW - marginR, doc.y + 4)
        .lineWidth(0.75)
        .strokeColor(GARDEN.rule)
        .stroke();
      doc.y += 11;

      const lines = (sec.content || "").replace(/\r\n/g, "\n").split("\n");
      let i = 0;
      let seenContentLine = false;

      while (i < lines.length) {
        const rawLine = lines[i].trim();
        if (!rawLine) {
          if (seenContentLine) doc.y += 4;
          i += 1;
          continue;
        }

        // Skip horizontal rules `---`
        if (/^[-*_]{3,}$/.test(rawLine)) {
          doc.y += 3;
          i += 1;
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
          ensureSpace(34);
          const level = hMatch[1].length;
          doc.y += 4;
          doc
            .fillColor(GARDEN.root)
            .font(level <= 2 ? FONT_BOLD : FONT_SEMI)
            .fontSize(level === 1 ? 12.5 : level === 2 ? 11.5 : 10.5)
            .text(cleanHeading, marginL, doc.y, { width: contentW });
          doc.y += 3;
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
          doc.font(FONT_ITALIC).fontSize(10.5);
          const measuredH = doc.heightOfString(stripMarkdown(qText), {
            width: contentW - 28,
            lineGap: 3.5,
          });
          const boxH = measuredH + 18;
          ensureSpace(boxH + 8);
          const boxY = doc.y;
          doc.roundedRect(marginL, boxY, contentW, boxH, 6).fill(GARDEN.dew);
          doc.rect(marginL, boxY, 4, boxH).fill(GARDEN.vine);
          doc.y = boxY + 9;
          writeRichLine(doc, qText, marginL + 16, contentW - 28, {
            size: 10.5,
            color: GARDEN.root,
            baseFont: FONT_ITALIC,
            boldFont: FONT_BOLD_IT,
            italicFont: FONT_ITALIC,
            lineGap: 3.5,
          });
          doc.y = Math.max(doc.y + 4, boxY + boxH + 7);
          continue;
        }

        // Numbered item (1. ...)
        const numMatch = rawLine.match(/^(\d+)[.)]\s+(.+)$/);
        if (numMatch) {
          const num = numMatch[1];
          const itemText = numMatch[2];
          doc.font(FONT_MED).fontSize(10.5);
          const estH = doc.heightOfString(stripMarkdown(itemText), {
            width: contentW - 26,
            lineGap: 3.5,
          });
          ensureSpace(estH + 8);
          const rowY = doc.y;

          drawCenteredCircleNumber(
            doc,
            marginL + 9,
            rowY + 7.35,
            9,
            num,
            FONT_BOLD,
            num.length >= 2 ? 7.8 : 8.5
          );

          doc.y = rowY;
          writeRichLine(doc, itemText, marginL + 26, contentW - 26, {
            size: 10.5,
            color: GARDEN.soil,
            baseFont: FONT_MED,
            boldFont: FONT_BOLD,
            italicFont: FONT_ITALIC,
            lineGap: 3.5,
          });
          doc.y = Math.max(doc.y + 5, rowY + 19);
          i += 1;
          continue;
        }

        // Bullet item (- / * / •)
        const bulletMatch = rawLine.match(/^[-*•]\s+(.+)$/);
        if (bulletMatch) {
          const itemText = bulletMatch[1];
          doc.font(FONT_REG).fontSize(10.5);
          const estH = doc.heightOfString(stripMarkdown(itemText), {
            width: contentW - 16,
            lineGap: 3.5,
          });
          ensureSpace(estH + 6);
          const rowY = doc.y;
          doc.circle(marginL + 5, rowY + 7.35, 2.5).fill(GARDEN.vine);
          doc.y = rowY;
          writeRichLine(doc, itemText, marginL + 16, contentW - 16, {
            size: 10.5,
            color: GARDEN.soil,
            baseFont: FONT_REG,
            boldFont: FONT_BOLD,
            italicFont: FONT_ITALIC,
            lineGap: 3.5,
          });
          doc.y += 4;
          i += 1;
          continue;
        }

        // Standard paragraph
        doc.font(FONT_REG).fontSize(10.5);
        const estH = doc.heightOfString(stripMarkdown(rawLine), {
          width: contentW,
          lineGap: 4,
        });
        ensureSpace(estH + 8);
        writeRichLine(doc, rawLine, marginL, contentW, {
          size: 10.5,
          color: GARDEN.soil,
          baseFont: FONT_REG,
          boldFont: FONT_BOLD,
          italicFont: FONT_ITALIC,
          lineGap: 4,
        });
        doc.y += 5;
        i += 1;
      }
    });

    // === OPTIONAL HANDWRITTEN NOTES LINES FOR GROUP SHARING ===
    if (input.includeNoteLines) {
      if (doc.y > maxY - 110) {
        doc.addPage();
        doc.y = 56;
      } else {
        doc.y += 14;
      }
      const notesY = doc.y;
      doc.roundedRect(marginL, notesY + 3.2, 4.5, 11, 2).fill(GARDEN.vine);
      doc
        .fillColor(GARDEN.root)
        .font(FONT_DISPLAY)
        .fontSize(12.5)
        .text("NOTES & REFLECTION", marginL + 13, notesY, {
          width: contentW - 13,
          characterSpacing: 0.5,
        });
      doc.y += 8;
      while (doc.y + 22 <= maxY - 6) {
        doc.y += 22;
        doc
          .moveTo(marginL, doc.y)
          .lineTo(pageW - marginR, doc.y)
          .lineWidth(0.6)
          .strokeColor(GARDEN.rule)
          .stroke();
      }
    }

    // === RUNNING FOOTER ACROSS ALL PAGES ===
    const range = doc.bufferedPageRange();
    for (let idx = 0; idx < range.count; idx++) {
      doc.switchToPage(range.start + idx);
      const prevBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;

      const footerY = doc.page.height - 42; // 750
      doc
        .moveTo(marginL, footerY - 8)
        .lineTo(pageW - marginR, footerY - 8)
        .lineWidth(0.6)
        .strokeColor(GARDEN.rule)
        .stroke();

      let textX = marginL;
      if (fs.existsSync(LOGO_MARK_DARK)) {
        doc.image(LOGO_MARK_DARK, marginL, footerY - 1, { height: 12 });
        textX = marginL + 17;
      }
      doc
        .fillColor(GARDEN.root)
        .font(FONT_SEMI)
        .fontSize(8)
        .text("THE GARDEN CHURCH  ·  BOSTON", textX, footerY + 1, {
          lineBreak: false,
          characterSpacing: 0.6,
        });

      const pageStr = `Page ${idx + 1} of ${range.count}`;
      doc.fillColor(GARDEN.muted).font(FONT_REG).fontSize(8);
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
