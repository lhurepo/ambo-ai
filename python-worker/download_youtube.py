import argparse
import json
import re
import sys
from pathlib import Path
import yt_dlp

CANONICAL_RE = re.compile(r"^https://www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}$")
MAX_BYTES = 2 * 1024 * 1024 * 1024  # 2 GB


def emit(pct: int, message: str) -> None:
    print(json.dumps({"type": "progress", "percent": pct, "message": message}), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Download single YouTube sermon video cleanly.")
    parser.add_argument("--url", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--meta-out", required=True)
    args = parser.parse_args()

    if not CANONICAL_RE.match(args.url.strip()):
        print("Rejected non-canonical YouTube URL", file=sys.stderr)
        sys.exit(2)

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_tmpl = str(out_dir / "youtube_%(id)s.%(ext)s")

    last_pct = -1

    def progress_hook(d: dict) -> None:
        nonlocal last_pct
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes") or 0
            if total > 0:
                pct = min(98, int((downloaded / total) * 100))
                if pct >= last_pct + 5:
                    last_pct = pct
                    emit(pct, f"Downloading sermon from YouTube ({pct}%)...")
        elif d.get("status") == "finished":
            emit(99, "Finalizing YouTube video...")

    ydl_opts = {
        "noplaylist": True,
        "max_filesize": MAX_BYTES,
        "format": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best[height<=1080]/best",
        "merge_output_format": "mp4",
        "outtmpl": out_tmpl,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "progress_hooks": [progress_hook],
    }

    emit(2, "Connecting to YouTube...")
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(args.url, download=True)
        if not info:
            raise RuntimeError("Could not download video metadata from YouTube")
        filename = Path(ydl.prepare_filename(info))
        mp4_candidate = filename.with_suffix(".mp4")
        final_file = mp4_candidate if mp4_candidate.exists() else filename
        if not final_file.exists():
            # Fallback glob in case container extension differs
            matches = sorted(out_dir.glob("youtube_*.*"))
            if not matches:
                raise RuntimeError("Downloaded YouTube media file not found")
            final_file = matches[0]

        meta = {
            "title": str(info.get("title") or "YouTube Sermon").strip(),
            "uploader": str(info.get("uploader") or info.get("channel") or "").strip(),
            "duration": int(info.get("duration") or 0),
            "output_path": str(final_file.resolve()),
            "file_name": final_file.name,
        }
        Path(args.meta_out).write_text(json.dumps(meta, indent=2), encoding="utf-8")
        emit(100, "YouTube download complete")


if __name__ == "__main__":
    main()
