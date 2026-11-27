import argparse
import json
import socket
import sys
import wave
from pathlib import Path
import numpy as np
from faster_whisper import WhisperModel

# Prefer IPv4 when HuggingFace DNS returns unreachable IPv6 addresses
_orig_getaddrinfo = socket.getaddrinfo
def _ipv4_first_getaddrinfo(*args, **kwargs):
    res = _orig_getaddrinfo(*args, **kwargs)
    v4 = [r for r in res if r[0] == socket.AF_INET]
    return v4 if v4 else res
socket.getaddrinfo = _ipv4_first_getaddrinfo


def load_audio_or_path(input_path: str):
    if input_path.lower().endswith(".wav"):
        try:
            with wave.open(input_path, "rb") as wf:
                if wf.getnchannels() == 1 and wf.getframerate() == 16000 and wf.getsampwidth() == 2:
                    raw = wf.readframes(wf.getnframes())
                    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        except Exception:
            pass
    return input_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Transcribe audio/video with faster-whisper word timestamps")
    parser.add_argument("--input", required=True, help="Input media or audio path")
    parser.add_argument("--model", default="base", help="Whisper model size: tiny, base, small, medium")
    parser.add_argument("--language", default="auto", help="ISO language code or auto")
    parser.add_argument("--output", required=True, help="Output JSON file path")
    args = parser.parse_args()

    lang = None if not args.language or args.language == "auto" else args.language
    print(json.dumps({"type": "status", "message": f"Loading faster-whisper ({args.model}, cpu int8)..."}), flush=True)
    model = WhisperModel(args.model, device="cpu", compute_type="int8", cpu_threads=4)

    print(json.dumps({"type": "progress", "percent": 5, "message": "Starting transcription..."}), flush=True)
    audio_input = load_audio_or_path(args.input)
    segments_iter, info = model.transcribe(
        audio_input,
        language=lang,
        beam_size=5,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 400},
    )

    total_dur = max(float(getattr(info, "duration", 0.0) or 0.0), 0.1)
    segments = []
    full_text_parts = []
    last_pct = 5

    for idx, seg in enumerate(segments_iter):
        words = []
        for w_idx, w in enumerate(seg.words or []):
            token = w.word.strip()
            if not token:
                continue
            words.append({
                "id": f"s{idx}_w{w_idx}",
                "word": token,
                "start": round(float(w.start), 3),
                "end": round(float(w.end), 3),
                "probability": round(float(getattr(w, "probability", 1.0) or 1.0), 3),
            })

        seg_text = seg.text.strip()
        if seg_text:
            full_text_parts.append(seg_text)
        segments.append({
            "id": idx,
            "start": round(float(seg.start), 3),
            "end": round(float(seg.end), 3),
            "text": seg_text,
            "words": words,
        })

        pct = min(98, max(5, int((float(seg.end) / total_dur) * 95) + 3))
        if pct >= last_pct + 5:
            last_pct = pct
            print(json.dumps({"type": "progress", "percent": pct, "message": f"Transcribing ({pct}%)..."}), flush=True)

    payload = {
        "language": getattr(info, "language", "en"),
        "language_probability": round(float(getattr(info, "language_probability", 1.0) or 1.0), 3),
        "duration": round(total_dur, 3),
        "text": " ".join(full_text_parts).strip(),
        "segments": segments,
    }

    out_path = Path(args.output)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"type": "progress", "percent": 100, "message": "Transcription complete"}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"type": "error", "message": str(exc)}), file=sys.stderr, flush=True)
        sys.exit(1)
