import argparse
import html
import json
import re
import sys
from pathlib import Path


def extract_txt(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def extract_html(path: Path) -> str:
    raw = path.read_text(encoding="utf-8", errors="replace")
    raw = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", raw, flags=re.S | re.I)
    text = html.unescape(re.sub(r"<[^>]+>", "\n", raw))
    return "\n".join(line.strip() for line in text.splitlines() if line.strip())


def extract_pdf(path: Path) -> str:
    from pypdf import PdfReader
    reader = PdfReader(str(path))
    pages = []
    for page in reader.pages:
        txt = (page.extract_text() or "").strip()
        if txt:
            pages.append(txt)
    return "\n\n".join(pages)


def extract_docx(path: Path) -> str:
    from docx import Document
    doc = Document(str(path))
    parts = [p.text.strip() for p in doc.paragraphs if p.text and p.text.strip()]
    for table in doc.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells if c.text and c.text.strip()]
            if cells:
                parts.append(" | ".join(cells))
    return "\n\n".join(parts)


def extract_pptx(path: Path) -> str:
    from pptx import Presentation
    prs = Presentation(str(path))
    slides = []
    for idx, slide in enumerate(prs.slides, start=1):
        lines = []
        for shape in slide.shapes:
            if getattr(shape, "has_text_frame", False):
                for p in shape.text_frame.paragraphs:
                    t = p.text.strip()
                    if t:
                        lines.append(t)
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame:
            notes = slide.notes_slide.notes_text_frame.text.strip()
            if notes:
                lines.append(f"[Speaker Notes] {notes}")
        if lines:
            slides.append(f"## Slide {idx}\n" + "\n".join(lines))
    return "\n\n".join(slides)


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract text locally from TXT, MD, PDF, DOCX, PPTX, HTML")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    in_path = Path(args.input)
    ext = in_path.suffix.lower()

    if ext in {".txt", ".md", ".csv", ".tsv", ".rtf", ".xml", ".json"}:
        text = extract_txt(in_path)
    elif ext in {".html", ".htm"}:
        text = extract_html(in_path)
    elif ext == ".pdf":
        text = extract_pdf(in_path)
    elif ext in {".docx", ".doc"}:
        text = extract_docx(in_path)
    elif ext in {".pptx", ".ppt"}:
        text = extract_pptx(in_path)
    else:
        text = extract_txt(in_path)

    cleaned = re.sub(r"\n{3,}", "\n\n", text).strip()
    out = {
        "file_name": in_path.name,
        "extension": ext,
        "word_count": len(cleaned.split()),
        "text": cleaned,
    }
    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
