import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np

# Ensure Homebrew & ffmpeg-full binaries are visible even when launched from Finder/Node
EXTRA_BIN_PATHS = [
    "/opt/homebrew/opt/ffmpeg-full/bin",
    "/usr/local/opt/ffmpeg-full/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
]
os.environ["PATH"] = os.pathsep.join(EXTRA_BIN_PATHS + [os.environ.get("PATH", "")])

FONT_MAP = {
    "GardenResolve": "Resolve Sans Bold Cm",
    "GardenYankee": "Yankee Bold",
    "PlusJakarta": "Plus Jakarta Sans",
    "Modern": "Poppins",
    "Classic": "Merriweather",
    "Bold": "Montserrat",
    "Elegant": "Raleway",
    "Condensed": "Bebas Neue",
    "Playful": "Fredoka",
    "Sleek": "Work Sans",
    "Refined": "Libre Baskerville",
    "Typewriter": "Courier Prime",
}

FONT_FILE_MAP = {
    "GardenResolve": ["Resolve-BoldCm.otf"],
    "GardenYankee": ["Yankee-Bold.otf", "Yankee-Regular.otf"],
    "PlusJakarta": ["PlusJakartaSans-Bold.ttf", "PlusJakartaSans-Regular.ttf"],
    "Modern": ["Poppins.ttf"],
    "Classic": ["Merriweather.ttf"],
    "Bold": ["Montserrat.ttf"],
    "Elegant": ["Raleway.ttf"],
    "Condensed": ["BebasNeue.ttf"],
    "Playful": ["Fredoka.ttf"],
    "Sleek": ["WorkSans.ttf"],
    "Refined": ["LibreBaskerville.ttf"],
    "Typewriter": ["CourierPrime.ttf"],
}

ASPECT_RES = {
    "9:16": (1080, 1920),
    "1:1": (1080, 1080),
    "16:9": (1920, 1080),
}

BRAND_DIR = Path(__file__).resolve().parent.parent / "public" / "brand" / "garden"


def compute_crop_box(src_w: int, src_h: int, out_w: int, out_h: int, center_x: float) -> tuple[int, int, int, int]:
    target_ratio = out_w / float(out_h)
    src_ratio = src_w / float(src_h)
    if src_ratio > target_ratio:
        crop_h = src_h
        crop_w = max(2, int(round(src_h * target_ratio)) // 2 * 2)
        max_x = max(0, src_w - crop_w)
        crop_x = int(max(0, min(max_x, round(center_x * src_w - crop_w / 2.0))))
        crop_y = 0
    else:
        crop_w = src_w
        crop_h = max(2, int(round(src_w / target_ratio)) // 2 * 2)
        crop_x = 0
        crop_y = max(0, (src_h - crop_h) // 2)
    return crop_w, crop_h, crop_x, crop_y


def make_watermark_png(tmp: Path, out_w: int, out_h: int, style: dict) -> tuple[Path, int, int] | None:
    if not style.get("showWatermark"):
        return None
    mark_path = BRAND_DIR / "logo-mark-light.png"
    if not mark_path.exists():
        mark_path = BRAND_DIR / "logo-mark-vine.png"
    if not mark_path.exists():
        return None

    from PIL import Image

    im = Image.open(mark_path).convert("RGBA")
    wm_w = max(56, int(out_w * 0.082))
    wm_h = max(1, int(round(im.height * (wm_w / float(im.width)))))
    im = im.resize((wm_w, wm_h), Image.Resampling.LANCZOS)
    r, g, b, a = im.split()
    a = a.point(lambda p: int(p * 0.78))
    im = Image.merge("RGBA", (r, g, b, a))

    wm_out = tmp / "watermark.png"
    im.save(wm_out)

    pos = style.get("watermarkPosition", "top-right")
    pad_x = max(28, int(out_w * 0.038))
    pad_top = max(36, int(out_h * 0.036))
    pad_bottom = max(48, int(out_h * 0.045))

    if pos == "top-left":
        return wm_out, pad_x, pad_top
    if pos == "bottom-right":
        return wm_out, out_w - wm_w - pad_x, out_h - wm_h - pad_bottom
    return wm_out, out_w - wm_w - pad_x, pad_top


def make_outro_mp4(tmp: Path, out_w: int, out_h: int, fonts_dir: Path, out_mp4: Path) -> None:
    from PIL import Image, ImageDraw, ImageFont

    card = Image.new("RGB", (out_w, out_h), (29, 53, 25))  # Garden Root Green #1D3519
    draw = ImageDraw.Draw(card)

    logo_path = BRAND_DIR / "logo-primary-light.png"
    cur_y = int(out_h * 0.36)
    if logo_path.exists():
        logo = Image.open(logo_path).convert("RGBA")
        lw = int(out_w * 0.44)
        lh = max(1, int(round(logo.height * (lw / float(logo.width)))))
        logo = logo.resize((lw, lh), Image.Resampling.LANCZOS)
        cur_y = (out_h - lh - 96) // 2
        card.paste(logo, ((out_w - lw) // 2, cur_y), logo)
        cur_y += lh + 28

    bar_w = max(90, int(out_w * 0.12))
    bar_x0 = (out_w - bar_w) // 2
    draw.rounded_rectangle([bar_x0, cur_y, bar_x0 + bar_w, cur_y + 6], radius=3, fill=(189, 214, 48))
    cur_y += 28

    font_size = max(26, int(out_w * 0.028))
    font = None
    for fname in ["Yankee-SemiBold.otf", "Yankee-Bold.otf", "PlusJakartaSans-SemiBold.ttf"]:
        fp = fonts_dir / fname
        if fp.exists():
            try:
                font = ImageFont.truetype(str(fp), font_size)
                break
            except Exception:
                pass
    if font is None:
        font = ImageFont.load_default()

    tagline = "THE GARDEN CHURCH  ·  BOSTON"
    tw = draw.textlength(tagline, font=font)
    draw.text(((out_w - tw) / 2.0, cur_y), tagline, font=font, fill=(244, 242, 230))

    card_png = tmp / "outro_card.png"
    card.save(card_png)

    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-t", "2.0", "-r", "30", "-i", str(card_png),
        "-f", "lavfi", "-t", "2.0", "-i", "anullsrc=r=44100:cl=stereo",
        "-vf", "fade=t=in:st=0:d=0.25,setsar=1,format=yuv420p",
        "-c:v", "libx264", "-preset", "fast", "-crf", "21",
        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k",
        "-shortest",
        str(out_mp4),
    ]
    proc = subprocess.run(cmd, cwd=str(tmp), capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"Outro bumper render failed: {proc.stderr[-600:]}")


def hex_to_ass(hex_color: str, alpha: int = 0) -> str:
    """Convert #RRGGBB to ASS &HAABBGGRR."""
    c = (hex_color or "#FFFFFF").strip().lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    if len(c) != 6:
        c = "FFFFFF"
    r, g, b = c[0:2], c[2:4], c[4:6]
    return f"&H{alpha:02X}{b}{g}{r}"


def format_ass_time(sec: float) -> str:
    sec = max(0.0, sec)
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = int(sec % 60)
    cs = int(round((sec - int(sec)) * 100))
    if cs >= 100:
        s += 1
        cs -= 100
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def track_faces(video_path: str, output_path: str) -> None:
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1280)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720)
    duration = total_frames / fps if fps > 0 else 0.0

    frontal = None
    profile = None
    cascade_cls = getattr(cv2, "CascadeClassifier", None)
    cv2_data = getattr(cv2, "data", None)
    if cascade_cls and cv2_data and hasattr(cv2_data, "haarcascades"):
        frontal_xml = os.path.join(cv2_data.haarcascades, "haarcascade_frontalface_default.xml")
        profile_xml = os.path.join(cv2_data.haarcascades, "haarcascade_profileface.xml")
        if os.path.exists(frontal_xml):
            frontal = cascade_cls(frontal_xml)
        if os.path.exists(profile_xml):
            profile = cascade_cls(profile_xml)

    sample_interval_sec = 0.5
    step = max(1, int(round(fps * sample_interval_sec)))

    raw_points = []
    frame_idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if frame_idx % step == 0:
            t_sec = round(frame_idx / fps, 3)
            faces = ()
            if frontal is not None or profile is not None:
                small_w = 480
                scale = small_w / float(width)
                small_h = max(1, int(round(height * scale)))
                small = cv2.resize(frame, (small_w, small_h))
                gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
                if frontal is not None:
                    faces = frontal.detectMultiScale(gray, scaleFactor=1.15, minNeighbors=4, minSize=(28, 28))
                if len(faces) == 0 and profile is not None:
                    faces = profile.detectMultiScale(gray, scaleFactor=1.15, minNeighbors=4, minSize=(28, 28))
            else:
                small_w, small_h = width, height

            if len(faces) > 0:
                # Pick largest detected speaker face
                x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
                cx = (x + w / 2.0) / float(small_w)
                cy = (y + h / 2.0) / float(small_h)
                detected = True
            else:
                cx = raw_points[-1]["centerX"] if raw_points else 0.5
                cy = raw_points[-1]["centerY"] if raw_points else 0.42
                detected = False

            raw_points.append({"t": t_sec, "centerX": float(cx), "centerY": float(cy), "detected": detected})
        frame_idx += 1

    cap.release()

    if not raw_points:
        raw_points = [{"t": 0.0, "centerX": 0.5, "centerY": 0.45, "detected": False}]

    # Median filter (window=5) + EMA smoothing + deadband hysteresis to prevent camera jitter
    xs = [p["centerX"] for p in raw_points]
    ys = [p["centerY"] for p in raw_points]
    smoothed = []
    ema_x = float(np.median(xs[:5]))
    ema_y = float(np.median(ys[:5]))
    alpha = 0.14
    deadband = 0.035

    for i, p in enumerate(raw_points):
        lo = max(0, i - 2)
        hi = min(len(xs), i + 3)
        med_x = float(np.median(xs[lo:hi]))
        med_y = float(np.median(ys[lo:hi]))
        cand_x = alpha * med_x + (1.0 - alpha) * ema_x
        cand_y = alpha * med_y + (1.0 - alpha) * ema_y
        if abs(cand_x - ema_x) > deadband:
            ema_x = cand_x
        if abs(cand_y - ema_y) > deadband:
            ema_y = cand_y
        smoothed.append({
            "t": p["t"],
            "centerX": round(max(0.15, min(0.85, ema_x)), 4),
            "centerY": round(max(0.15, min(0.85, ema_y)), 4),
            "detected": p["detected"],
        })

    out = {
        "width": width,
        "height": height,
        "fps": round(fps, 3),
        "duration": round(duration, 3),
        "points": smoothed,
    }
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    Path(output_path).write_text(json.dumps(out, indent=2), encoding="utf-8")


def build_ass_file(
    ass_path: Path,
    words: list,
    style: dict,
    start_sec: float,
    end_sec: float,
    out_w: int,
    out_h: int,
) -> None:
    typography = style.get("typography", "Modern")
    font_name = FONT_MAP.get(typography, "Poppins")
    size_map = {"small": 52, "medium": 66, "large": 82}
    font_size = size_map.get(style.get("captionSize", "medium"), 66)
    if out_w == 1920:
        font_size = int(font_size * 0.88)

    pos = style.get("position", "mid")
    if pos == "top":
        alignment = 8
        margin_v = int(out_h * 0.14)
    elif pos == "bottom":
        alignment = 2
        margin_v = int(out_h * 0.14)
    else:
        alignment = 5
        margin_v = 40

    text_color = style.get("colorHex", "#FFFFFF")
    bg_style = style.get("backgroundStyle", "none")
    bg_color = style.get("backgroundColorHex", "#002A3C")
    enable_karaoke = bool(style.get("highlights", True))
    highlight_color = style.get("highlightColorHex", "#6FB3C8")

    # ASS Karaoke: PrimaryColour is the color AFTER sweep, SecondaryColour is color BEFORE sweep!
    primary_ass = hex_to_ass(highlight_color if enable_karaoke else text_color, 0)
    secondary_ass = hex_to_ass(text_color, 0)

    if bg_style == "background":
        border_style = 3
        outline_w = 18
        shadow = 0
        outline_col = hex_to_ass(bg_color, 25)
        back_col = hex_to_ass(bg_color, 25)
    elif bg_style == "border":
        border_style = 1
        outline_w = 6
        shadow = 2
        outline_col = hex_to_ass(bg_color, 0)
        back_col = hex_to_ass("#000000", 140)
    else:
        border_style = 1
        outline_w = 5
        shadow = 3
        outline_col = hex_to_ass("#001018", 40)
        back_col = hex_to_ass("#000000", 130)

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {out_w}
PlayResY: {out_h}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{font_name},{font_size},{primary_ass},{secondary_ass},{outline_col},{back_col},1,0,0,0,100,100,0,0,{border_style},{outline_w},{shadow},{alignment},60,60,{margin_v},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    # Group clip words into readable 4-word chunks
    clip_words = [
        w for w in words
        if float(w.get("end", 0)) > start_sec and float(w.get("start", 0)) < end_sec
    ]
    if not clip_words:
        clip_words = [{"word": "Ambo AI", "start": start_sec, "end": min(end_sec, start_sec + 2.0)}]

    lines = []
    chunk_size = 4
    for i in range(0, len(clip_words), chunk_size):
        chunk = clip_words[i : i + chunk_size]
        c_start = max(0.0, float(chunk[0]["start"]) - start_sec)
        c_end = max(c_start + 0.25, min(end_sec - start_sec, float(chunk[-1]["end"]) - start_sec))
        if i + chunk_size < len(clip_words):
            next_start = max(0.0, float(clip_words[i + chunk_size]["start"]) - start_sec)
            c_end = max(c_end, min(next_start, c_end + 0.25))

        if enable_karaoke:
            parts = []
            cursor = c_start
            force_upper = bool(style.get("uppercase", False)) or typography in ("GardenResolve", "Condensed")
            for w in chunk:
                w_start = max(cursor, float(w["start"]) - start_sec)
                w_end = max(w_start + 0.08, float(w["end"]) - start_sec)
                gap_cs = max(0, int(round((w_start - cursor) * 100)))
                dur_cs = max(8, int(round((w_end - w_start) * 100)))
                clean_tok = str(w["word"]).replace("{", "").replace("}", "").replace("\\", "")
                if force_upper:
                    clean_tok = clean_tok.upper()
                if gap_cs > 0:
                    parts.append(f"{{\\kf{gap_cs}}}{{\\kf{dur_cs}}}{clean_tok}")
                else:
                    parts.append(f"{{\\kf{dur_cs}}}{clean_tok}")
                cursor = w_end
            text_line = " ".join(parts)
        else:
            force_upper = bool(style.get("uppercase", False)) or typography in ("GardenResolve", "Condensed")
            raw_tokens = [str(w["word"]).replace("{", "").replace("}", "") for w in chunk]
            if force_upper:
                raw_tokens = [tok.upper() for tok in raw_tokens]
            text_line = " ".join(raw_tokens)

        lines.append(
            f"Dialogue: 0,{format_ass_time(c_start)},{format_ass_time(c_end)},Default,,0,0,0,,{text_line}"
        )

    ass_path.write_text(header + "\n".join(lines) + "\n", encoding="utf-8")


def probe_has_video(media_path: str) -> tuple[bool, int, int]:
    cmd = [
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=width,height", "-of", "json", media_path
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        return False, 0, 0
    try:
        data = json.loads(res.stdout)
        streams = data.get("streams") or []
        if not streams:
            return False, 0, 0
        return True, int(streams[0].get("width", 1280)), int(streams[0].get("height", 720))
    except Exception:
        return False, 0, 0


def ffmpeg_has_ass_filter() -> bool:
    try:
        res = subprocess.run(
            ["ffmpeg", "-filters", "-hide_banner"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return res.returncode == 0 and (" ass " in res.stdout or "\n T.. ass " in res.stdout or "libass" in res.stdout)
    except Exception:
        return False


def hex_to_rgba(hex_color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    c = (hex_color or "#FFFFFF").strip().lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    if len(c) != 6:
        c = "FFFFFF"
    return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), alpha)


def load_pil_font(fonts_dir: Path, typography: str, font_size: int):
    from PIL import ImageFont

    candidates = FONT_FILE_MAP.get(typography, ["Poppins.ttf"]) + ["Yankee-Bold.otf", "Poppins.ttf"]
    for name in candidates:
        fp = fonts_dir / name
        if fp.exists():
            try:
                return ImageFont.truetype(str(fp), font_size)
            except Exception:
                pass
    return ImageFont.load_default()


def build_pillow_overlay_track(
    tmp: Path,
    words: list,
    style: dict,
    start_sec: float,
    end_sec: float,
    out_w: int,
    out_h: int,
    fonts_dir: Path,
) -> Path:
    """Fallback caption renderer when Homebrew ffmpeg lacks libass/ass filter."""
    from PIL import Image, ImageDraw

    typography = style.get("typography", "Modern")
    size_map = {"small": 44, "medium": 56, "large": 70}
    font_size = size_map.get(style.get("captionSize", "medium"), 56)
    if out_w == 1920:
        font_size = int(font_size * 0.88)
    font = load_pil_font(fonts_dir, typography, font_size)

    pos = style.get("position", "mid")
    text_rgba = hex_to_rgba(style.get("colorHex", "#FFFFFF"), 255)
    bg_style = style.get("backgroundStyle", "none")
    bg_rgba = hex_to_rgba(style.get("backgroundColorHex", "#002A3C"), 225)
    enable_karaoke = bool(style.get("highlights", True))
    hi_rgba = hex_to_rgba(style.get("highlightColorHex", "#6FB3C8"), 255)

    clip_words = [
        w for w in words
        if float(w.get("end", 0)) > start_sec and float(w.get("start", 0)) < end_sec
    ]
    if not clip_words:
        clip_words = [{"word": "Ambo AI", "start": start_sec, "end": min(end_sec, start_sec + 2.0)}]

    duration_sec = max(0.5, end_sec - start_sec)
    frames_dir = tmp / "caption_frames"
    frames_dir.mkdir(exist_ok=True)
    concat_lines = ["ffconcat version 1.0"]

    def make_frame(chunk_words: list, active_idx: int, out_png: Path) -> None:
        img = Image.new("RGBA", (out_w, out_h), (0, 0, 0, 0))
        if not chunk_words:
            img.save(out_png)
            return
        draw = ImageDraw.Draw(img)
        tokens = [str(w["word"]).strip() for w in chunk_words]
        if bool(style.get("uppercase", False)) or typography in ("GardenResolve", "Condensed"):
            tokens = [t.upper() for t in tokens]

        max_line_w = int(out_w * 0.84)
        space_w = draw.textlength(" ", font=font)
        # Wrap into 1 or 2 lines cleanly
        lines_toks: list[list[tuple[int, str]]] = [[]]
        cur_w = 0.0
        for idx_t, tok in enumerate(tokens):
            tw = draw.textlength(tok, font=font)
            add_w = tw + (space_w if lines_toks[-1] else 0.0)
            if lines_toks[-1] and cur_w + add_w > max_line_w:
                lines_toks.append([(idx_t, tok)])
                cur_w = tw
            else:
                lines_toks[-1].append((idx_t, tok))
                cur_w += add_w

        line_h = int(font_size * 1.28)
        block_h = line_h * len(lines_toks)
        line_widths = [
            sum(draw.textlength(t, font=font) for _, t in ln) + space_w * max(0, len(ln) - 1)
            for ln in lines_toks
        ]
        max_w = max(line_widths) if line_widths else 100

        if pos == "top":
            top_y = int(out_h * 0.14)
        elif pos == "bottom":
            top_y = int(out_h * 0.86) - block_h
        else:
            top_y = (out_h - block_h) // 2

        if bg_style == "background":
            pad_x, pad_y = 24, 14
            rx0 = (out_w - max_w) / 2 - pad_x
            ry0 = top_y - pad_y
            rx1 = (out_w + max_w) / 2 + pad_x
            ry1 = top_y + block_h + pad_y
            draw.rounded_rectangle([rx0, ry0, rx1, ry1], radius=18, fill=bg_rgba)

        for row_i, ln in enumerate(lines_toks):
            lw = line_widths[row_i]
            cursor_x = (out_w - lw) / 2.0
            y = top_y + row_i * line_h
            for idx_t, tok in ln:
                col = hi_rgba if (enable_karaoke and idx_t <= active_idx) else text_rgba
                stroke_col = bg_rgba if bg_style == "border" else (0, 16, 24, 210)
                stroke_w = 4 if bg_style != "background" else 0
                draw.text(
                    (cursor_x, y),
                    tok,
                    font=font,
                    fill=col,
                    stroke_width=stroke_w,
                    stroke_fill=stroke_col,
                )
                cursor_x += draw.textlength(tok, font=font) + space_w

        img.save(out_png)

    # Build timeline slices: blank gap + per-word highlight frames
    timeline: list[tuple[float, float, list, int]] = []
    chunk_size = 4
    cursor = 0.0
    for i in range(0, len(clip_words), chunk_size):
        chunk = clip_words[i : i + chunk_size]
        c_start = max(cursor, float(chunk[0]["start"]) - start_sec)
        c_end = max(c_start + 0.25, min(duration_sec, float(chunk[-1]["end"]) - start_sec))
        if c_start > cursor + 0.04:
            timeline.append((cursor, c_start, [], -1))
        if enable_karaoke:
            w_cursor = c_start
            for wi, w in enumerate(chunk):
                w_end = c_end if wi == len(chunk) - 1 else min(c_end, max(w_cursor + 0.08, float(w["end"]) - start_sec))
                if w_end > w_cursor + 0.02:
                    timeline.append((w_cursor, w_end, chunk, wi))
                    w_cursor = w_end
        else:
            timeline.append((c_start, c_end, chunk, -1))
        cursor = c_end

    if cursor < duration_sec:
        timeline.append((cursor, duration_sec, [], -1))

    if not timeline:
        timeline.append((0.0, duration_sec, [], -1))

    blank_png = frames_dir / "blank.png"
    make_frame([], -1, blank_png)

    for idx_f, (t0, t1, ch, act) in enumerate(timeline):
        dur = max(0.04, t1 - t0)
        if not ch:
            png_path = blank_png
        else:
            png_path = frames_dir / f"f_{idx_f:04d}.png"
            make_frame(ch, act, png_path)
        concat_lines.append(f"file '{png_path.as_posix()}'")
        concat_lines.append(f"duration {dur:.4f}")

    # ffconcat requires trailing file entry so last frame holds its duration
    concat_lines.append(f"file '{blank_png.as_posix()}'")
    concat_file = tmp / "captions.ffconcat"
    concat_file.write_text("\n".join(concat_lines) + "\n", encoding="utf-8")
    return concat_file


def render_clip(args: argparse.Namespace) -> None:
    words = json.loads(Path(args.words_json).read_text(encoding="utf-8"))
    style = json.loads(Path(args.style_json).read_text(encoding="utf-8"))
    aspect = style.get("aspectRatio", "9:16")
    out_w, out_h = ASPECT_RES.get(aspect, (1080, 1920))

    start_sec = max(0.0, float(args.start_ms) / 1000.0)
    end_sec = max(start_sec + 1.0, float(args.end_ms) / 1000.0)
    duration_sec = end_sec - start_sec

    has_video, src_w, src_h = probe_has_video(args.input)
    facial_tracking = bool(style.get("facialTracking", True))

    center_x = 0.5
    if facial_tracking and args.face_track_json and Path(args.face_track_json).exists():
        track_data = json.loads(Path(args.face_track_json).read_text(encoding="utf-8"))
        pts = [p for p in track_data.get("points", []) if start_sec <= p["t"] <= end_sec]
        if pts:
            center_x = float(np.median([p["centerX"] for p in pts]))

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    show_captions = bool(style.get("showCaptions", True))
    use_outro = bool(style.get("showOutroBumper", False))
    use_ass = ffmpeg_has_ass_filter()

    with tempfile.TemporaryDirectory(prefix="ambo_render_") as tmpdir:
        tmp = Path(tmpdir)
        fonts_local = tmp / "fonts"
        if args.fonts_dir and Path(args.fonts_dir).exists():
            shutil.copytree(args.fonts_dir, fonts_local)
        else:
            fonts_local.mkdir(exist_ok=True)

        wm_info = make_watermark_png(tmp, out_w, out_h, style)
        render_target = (tmp / "main_body.mp4") if use_outro else out_path.resolve()

        if not show_captions:
            if has_video and src_w > 0 and src_h > 0:
                crop_w, crop_h, crop_x, crop_y = compute_crop_box(src_w, src_h, out_w, out_h, center_x)
                base_chain = f"[0:v]crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale={out_w}:{out_h}:flags=lanczos,setsar=1"
                if wm_info:
                    wm_path, wm_x, wm_y = wm_info
                    fc = f"{base_chain}[b];[b][1:v]overlay={wm_x}:{wm_y}:format=auto[v]"
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", f"{start_sec:.3f}",
                        "-t", f"{duration_sec:.3f}",
                        "-i", str(Path(args.input).resolve()),
                        "-i", str(wm_path),
                        "-filter_complex", fc,
                        "-map", "[v]", "-map", "0:a",
                        "-r", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k", "-movflags", "+faststart",
                        str(render_target),
                    ]
                else:
                    vf = f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale={out_w}:{out_h}:flags=lanczos,setsar=1"
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", f"{start_sec:.3f}",
                        "-t", f"{duration_sec:.3f}",
                        "-i", str(Path(args.input).resolve()),
                        "-vf", vf,
                        "-r", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k", "-movflags", "+faststart",
                        str(render_target),
                    ]
            else:
                wave_h = max(180, int(out_h * 0.16))
                wave_y = int(out_h * 0.42)
                if wm_info:
                    wm_path, wm_x, wm_y = wm_info
                    fc = (
                        f"color=c=#1D3519:s={out_w}x{out_h}:r=30:d={duration_sec:.3f}[bg];"
                        f"[0:a]showwaves=s={out_w}x{wave_h}:mode=cline:colors=#BDD630|#F4F2E6:rate=30[waves];"
                        f"[bg][waves]overlay=0:{wave_y}:shortest=1[b];"
                        f"[b][1:v]overlay={wm_x}:{wm_y}:format=auto[v]"
                    )
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", f"{start_sec:.3f}",
                        "-t", f"{duration_sec:.3f}",
                        "-i", str(Path(args.input).resolve()),
                        "-i", str(wm_path),
                        "-filter_complex", fc,
                        "-map", "[v]", "-map", "0:a",
                        "-r", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k", "-shortest", "-movflags", "+faststart",
                        str(render_target),
                    ]
                else:
                    fc = (
                        f"color=c=#1D3519:s={out_w}x{out_h}:r=30:d={duration_sec:.3f}[bg];"
                        f"[0:a]showwaves=s={out_w}x{wave_h}:mode=cline:colors=#BDD630|#F4F2E6:rate=30[waves];"
                        f"[bg][waves]overlay=0:{wave_y}:shortest=1[v]"
                    )
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", f"{start_sec:.3f}",
                        "-t", f"{duration_sec:.3f}",
                        "-i", str(Path(args.input).resolve()),
                        "-filter_complex", fc,
                        "-map", "[v]", "-map", "0:a",
                        "-r", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k", "-shortest", "-movflags", "+faststart",
                        str(render_target),
                    ]
        elif use_ass:
            ass_file = tmp / "captions.ass"
            build_ass_file(ass_file, words, style, start_sec, end_sec, out_w, out_h)

            if has_video and src_w > 0 and src_h > 0:
                crop_w, crop_h, crop_x, crop_y = compute_crop_box(src_w, src_h, out_w, out_h, center_x)
                if wm_info:
                    wm_path, wm_x, wm_y = wm_info
                    fc = (
                        f"[0:v]crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale={out_w}:{out_h}:flags=lanczos,setsar=1,"
                        f"ass=captions.ass:fontsdir=fonts[b];[b][1:v]overlay={wm_x}:{wm_y}:format=auto[v]"
                    )
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", f"{start_sec:.3f}",
                        "-t", f"{duration_sec:.3f}",
                        "-i", str(Path(args.input).resolve()),
                        "-i", str(wm_path),
                        "-filter_complex", fc,
                        "-map", "[v]", "-map", "0:a",
                        "-r", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k", "-movflags", "+faststart",
                        str(render_target),
                    ]
                else:
                    vf = f"crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale={out_w}:{out_h}:flags=lanczos,setsar=1,ass=captions.ass:fontsdir=fonts"
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", f"{start_sec:.3f}",
                        "-t", f"{duration_sec:.3f}",
                        "-i", str(Path(args.input).resolve()),
                        "-vf", vf,
                        "-r", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k", "-movflags", "+faststart",
                        str(render_target),
                    ]
            else:
                wave_h = max(180, int(out_h * 0.16))
                wave_y = int(out_h * 0.20)
                if wm_info:
                    wm_path, wm_x, wm_y = wm_info
                    fc = (
                        f"color=c=#1D3519:s={out_w}x{out_h}:r=30:d={duration_sec:.3f}[bg];"
                        f"[0:a]showwaves=s={out_w}x{wave_h}:mode=cline:colors=#BDD630|#F4F2E6:rate=30[waves];"
                        f"[bg][waves]overlay=0:{wave_y}:shortest=1,ass=captions.ass:fontsdir=fonts[b];"
                        f"[b][1:v]overlay={wm_x}:{wm_y}:format=auto[v]"
                    )
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", f"{start_sec:.3f}",
                        "-t", f"{duration_sec:.3f}",
                        "-i", str(Path(args.input).resolve()),
                        "-i", str(wm_path),
                        "-filter_complex", fc,
                        "-map", "[v]", "-map", "0:a",
                        "-r", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k", "-shortest", "-movflags", "+faststart",
                        str(render_target),
                    ]
                else:
                    fc = (
                        f"color=c=#1D3519:s={out_w}x{out_h}:r=30:d={duration_sec:.3f}[bg];"
                        f"[0:a]showwaves=s={out_w}x{wave_h}:mode=cline:colors=#BDD630|#F4F2E6:rate=30[waves];"
                        f"[bg][waves]overlay=0:{wave_y}:shortest=1,ass=captions.ass:fontsdir=fonts[v]"
                    )
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", f"{start_sec:.3f}",
                        "-t", f"{duration_sec:.3f}",
                        "-i", str(Path(args.input).resolve()),
                        "-filter_complex", fc,
                        "-map", "[v]", "-map", "0:a",
                        "-r", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k", "-shortest", "-movflags", "+faststart",
                        str(render_target),
                    ]
        else:
            concat_file = build_pillow_overlay_track(
                tmp, words, style, start_sec, end_sec, out_w, out_h, fonts_local
            )
            if has_video and src_w > 0 and src_h > 0:
                crop_w, crop_h, crop_x, crop_y = compute_crop_box(src_w, src_h, out_w, out_h, center_x)
                if wm_info:
                    wm_path, wm_x, wm_y = wm_info
                    fc = (
                        f"[0:v]crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale={out_w}:{out_h}:flags=lanczos,setsar=1[base];"
                        f"[base][1:v]overlay=0:0:shortest=1[c];"
                        f"[c][2:v]overlay={wm_x}:{wm_y}:format=auto[v]"
                    )
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", f"{start_sec:.3f}",
                        "-t", f"{duration_sec:.3f}",
                        "-i", str(Path(args.input).resolve()),
                        "-f", "concat", "-safe", "0", "-i", str(concat_file),
                        "-i", str(wm_path),
                        "-filter_complex", fc,
                        "-map", "[v]", "-map", "0:a",
                        "-r", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k", "-shortest", "-movflags", "+faststart",
                        str(render_target),
                    ]
                else:
                    fc = (
                        f"[0:v]crop={crop_w}:{crop_h}:{crop_x}:{crop_y},scale={out_w}:{out_h}:flags=lanczos,setsar=1[base];"
                        f"[base][1:v]overlay=0:0:shortest=1[v]"
                    )
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", f"{start_sec:.3f}",
                        "-t", f"{duration_sec:.3f}",
                        "-i", str(Path(args.input).resolve()),
                        "-f", "concat", "-safe", "0", "-i", str(concat_file),
                        "-filter_complex", fc,
                        "-map", "[v]", "-map", "0:a",
                        "-r", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k", "-shortest", "-movflags", "+faststart",
                        str(render_target),
                    ]
            else:
                wave_h = max(180, int(out_h * 0.16))
                wave_y = int(out_h * 0.20)
                if wm_info:
                    wm_path, wm_x, wm_y = wm_info
                    fc = (
                        f"color=c=#1D3519:s={out_w}x{out_h}:r=30:d={duration_sec:.3f}[bg];"
                        f"[0:a]showwaves=s={out_w}x{wave_h}:mode=cline:colors=#BDD630|#F4F2E6:rate=30[waves];"
                        f"[bg][waves]overlay=0:{wave_y}:shortest=1[base];"
                        f"[base][1:v]overlay=0:0:shortest=1[c];"
                        f"[c][2:v]overlay={wm_x}:{wm_y}:format=auto[v]"
                    )
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", f"{start_sec:.3f}",
                        "-t", f"{duration_sec:.3f}",
                        "-i", str(Path(args.input).resolve()),
                        "-f", "concat", "-safe", "0", "-i", str(concat_file),
                        "-i", str(wm_path),
                        "-filter_complex", fc,
                        "-map", "[v]", "-map", "0:a",
                        "-r", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k", "-shortest", "-movflags", "+faststart",
                        str(render_target),
                    ]
                else:
                    fc = (
                        f"color=c=#1D3519:s={out_w}x{out_h}:r=30:d={duration_sec:.3f}[bg];"
                        f"[0:a]showwaves=s={out_w}x{wave_h}:mode=cline:colors=#BDD630|#F4F2E6:rate=30[waves];"
                        f"[bg][waves]overlay=0:{wave_y}:shortest=1[base];"
                        f"[base][1:v]overlay=0:0:shortest=1[v]"
                    )
                    cmd = [
                        "ffmpeg", "-y",
                        "-ss", f"{start_sec:.3f}",
                        "-t", f"{duration_sec:.3f}",
                        "-i", str(Path(args.input).resolve()),
                        "-f", "concat", "-safe", "0", "-i", str(concat_file),
                        "-filter_complex", fc,
                        "-map", "[v]", "-map", "0:a",
                        "-r", "30", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k", "-shortest", "-movflags", "+faststart",
                        str(render_target),
                    ]

        proc = subprocess.run(cmd, cwd=str(tmp), capture_output=True, text=True)
        if proc.returncode != 0:
            raise RuntimeError(f"FFmpeg render failed: {proc.stderr[-1000:]}")

        if use_outro:
            outro_mp4 = tmp / "outro_bumper.mp4"
            make_outro_mp4(tmp, out_w, out_h, fonts_local, outro_mp4)
            concat_cmd = [
                "ffmpeg", "-y",
                "-i", str(render_target),
                "-i", str(outro_mp4),
                "-filter_complex", "[0:v]setsar=1,fps=30[v0];[1:v]setsar=1,fps=30[v1];[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[v][a]",
                "-map", "[v]", "-map", "[a]",
                "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-ar", "44100", "-ac", "2", "-b:a", "128k", "-movflags", "+faststart",
                str(out_path.resolve()),
            ]
            cproc = subprocess.run(concat_cmd, cwd=str(tmp), capture_output=True, text=True)
            if cproc.returncode != 0:
                raise RuntimeError(f"FFmpeg outro concat failed: {cproc.stderr[-800:]}")


def render_thumbnail(args: argparse.Namespace) -> None:
    from PIL import Image, ImageDraw, ImageFont

    style = json.loads(Path(args.style_json).read_text(encoding="utf-8")) if args.style_json and Path(args.style_json).exists() else {}
    aspect = style.get("aspectRatio", "9:16")
    out_w, out_h = ASPECT_RES.get(aspect, (1080, 1920))

    start_sec = max(0.0, float(args.start_ms) / 1000.0)
    end_sec = max(start_sec + 1.0, float(args.end_ms) / 1000.0)
    dur_sec = end_sec - start_sec

    has_video, src_w, src_h = probe_has_video(args.input)
    facial_tracking = bool(style.get("facialTracking", True))

    center_x = 0.5
    if facial_tracking and args.face_track_json and Path(args.face_track_json).exists():
        track_data = json.loads(Path(args.face_track_json).read_text(encoding="utf-8"))
        pts = [p for p in track_data.get("points", []) if start_sec <= p["t"] <= end_sec]
        if pts:
            center_x = float(np.median([p["centerX"] for p in pts]))

    fonts_dir = Path(args.fonts_dir) if args.fonts_dir else Path(os.getcwd()) / "data" / "fonts"

    base_img: Image.Image | None = None
    if has_video and src_w > 0 and src_h > 0:
        cap = cv2.VideoCapture(args.input)
        if cap.isOpened():
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            frontal = None
            cascade_cls = getattr(cv2, "CascadeClassifier", None)
            cv2_data = getattr(cv2, "data", None)
            if cascade_cls and cv2_data and hasattr(cv2_data, "haarcascades"):
                frontal_xml = os.path.join(cv2_data.haarcascades, "haarcascade_frontalface_default.xml")
                if os.path.exists(frontal_xml):
                    frontal = cascade_cls(frontal_xml)
            best_score = -1.0
            best_frame = None

            samples = 7
            for k in range(samples):
                t = start_sec + dur_sec * (0.14 + 0.72 * (k / max(1, samples - 1)))
                cap.set(cv2.CAP_PROP_POS_FRAMES, int(t * fps))
                ok, frame = cap.read()
                if not ok or frame is None:
                    continue
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                sharp = float(cv2.Laplacian(gray, cv2.CV_64F).var())
                faces = ()
                if frontal is not None:
                    faces = frontal.detectMultiScale(
                        cv2.resize(gray, (320, max(1, int(320 * src_h / src_w)))), 1.15, 4
                    )
                score = sharp + (180.0 if len(faces) > 0 else 0.0)
                if score > best_score:
                    best_score = score
                    best_frame = frame
            cap.release()

            if best_frame is not None:
                crop_w, crop_h, crop_x, crop_y = compute_crop_box(src_w, src_h, out_w, out_h, center_x)
                cropped = best_frame[crop_y : crop_y + crop_h, crop_x : crop_x + crop_w]
                resized = cv2.resize(cropped, (out_w, out_h), interpolation=cv2.INTER_LANCZOS4)
                rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
                base_img = Image.fromarray(rgb)

    if base_img is None:
        base_img = Image.new("RGB", (out_w, out_h), (29, 53, 25))

    canvas = base_img.convert("RGBA")

    # Apply smooth bottom vignette gradient covering bottom 50%
    grad = Image.new("RGBA", (out_w, out_h), (0, 0, 0, 0))
    grad_draw = ImageDraw.Draw(grad)
    start_grad_y = int(out_h * 0.48)
    span = max(1, out_h - start_grad_y)
    for y in range(start_grad_y, out_h):
        alpha = int(232 * ((y - start_grad_y) / float(span)) ** 1.35)
        grad_draw.line([(0, y), (out_w, y)], fill=(18, 20, 19, alpha))
    canvas = Image.alpha_composite(canvas, grad)
    draw = ImageDraw.Draw(canvas)

    # Top-right subtle brand wordmark
    logo_path = BRAND_DIR / "logo-primary-light.png"
    if logo_path.exists():
        logo = Image.open(logo_path).convert("RGBA")
        lw = max(160, int(out_w * 0.22))
        lh = max(1, int(round(logo.height * (lw / float(logo.width)))))
        logo = logo.resize((lw, lh), Image.Resampling.LANCZOS)
        canvas.paste(logo, (out_w - lw - int(out_w * 0.055), int(out_h * 0.045)), logo)

    # Load headline font (prefer Yankee-ExtraBold or user's chosen clip typography)
    typography = style.get("typography", "GardenYankee")
    candidates = ["Yankee-ExtraBold.otf", "Yankee-Bold.otf"] + FONT_FILE_MAP.get(typography, []) + ["Poppins.ttf"]
    font_size = max(54, int(out_w * 0.072))
    font = None
    for name in candidates:
        fp = fonts_dir / name
        if fp.exists():
            try:
                font = ImageFont.truetype(str(fp), font_size)
                break
            except Exception:
                pass
    if font is None:
        font = ImageFont.load_default()

    raw_title = (args.title or "Sunday Message").strip()
    margin_x = int(out_w * 0.075)
    max_text_w = out_w - margin_x * 2
    words_list = raw_title.split()
    lines: list[str] = []
    cur = ""
    for w in words_list:
        cand = f"{cur} {w}".strip()
        if cur and draw.textlength(cand, font=font) > max_text_w:
            lines.append(cur)
            cur = w
        else:
            cur = cand
    if cur:
        lines.append(cur)
    lines = lines[:4]

    line_h = int(font_size * 1.16)
    total_h = line_h * len(lines)
    bottom_pad = int(out_h * 0.085)
    text_top_y = out_h - bottom_pad - total_h

    # Vine accent bar above title
    draw.rounded_rectangle(
        [margin_x, text_top_y - 24, margin_x + 96, text_top_y - 16],
        radius=4,
        fill=(189, 214, 48, 255),
    )

    for idx_l, ln in enumerate(lines):
        draw.text(
            (margin_x, text_top_y + idx_l * line_h),
            ln,
            font=font,
            fill=(255, 255, 255, 255),
            stroke_width=3,
            stroke_fill=(18, 20, 19, 220),
        )

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    canvas.convert("RGB").save(out_path, format="JPEG", quality=92)


def main() -> None:
    parser = argparse.ArgumentParser(description="Ambo AI face tracking, MP4 & cover thumbnail renderer")
    parser.add_argument("--mode", required=True, choices=["track", "render", "thumbnail"])
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--start-ms", type=int, default=0)
    parser.add_argument("--end-ms", type=int, default=30000)
    parser.add_argument("--words-json")
    parser.add_argument("--style-json")
    parser.add_argument("--face-track-json")
    parser.add_argument("--fonts-dir")
    parser.add_argument("--title")
    args = parser.parse_args()

    if args.mode == "track":
        track_faces(args.input, args.output)
    elif args.mode == "thumbnail":
        render_thumbnail(args)
    else:
        render_clip(args)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        sys.exit(1)
