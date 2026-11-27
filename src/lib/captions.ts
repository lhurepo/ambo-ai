import type { TranscriptSegment } from "./types";

export interface SubtitleCue {
  startSec: number;
  endSec: number;
  text: string;
}

function formatSrtTime(sec: number): string {
  const s = Math.max(0, sec);
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = Math.floor(s % 60);
  const ms = Math.min(999, Math.round((s - Math.floor(s)) * 1000));
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(
    2,
    "0"
  )},${String(ms).padStart(3, "0")}`;
}

function formatVttTime(sec: number): string {
  return formatSrtTime(sec).replace(",", ".");
}

export function buildSubtitleCues(
  segments: TranscriptSegment[],
  fallbackText?: string | null,
  durationSec = 180
): SubtitleCue[] {
  const cues: SubtitleCue[] = [];

  for (const seg of segments) {
    if (Array.isArray(seg.words) && seg.words.length > 0) {
      let chunkWords: string[] = [];
      let chunkStart = seg.words[0].start;
      let chunkEnd = seg.words[0].end;

      for (const w of seg.words) {
        const nextText = [...chunkWords, w.word].join(" ");
        if (chunkWords.length >= 10 || (chunkWords.length > 0 && nextText.length > 52)) {
          cues.push({
            startSec: chunkStart,
            endSec: Math.max(chunkStart + 0.4, chunkEnd),
            text: chunkWords.join(" ").trim(),
          });
          chunkWords = [w.word];
          chunkStart = w.start;
          chunkEnd = w.end;
        } else {
          if (chunkWords.length === 0) chunkStart = w.start;
          chunkWords.push(w.word);
          chunkEnd = w.end;
        }
      }
      if (chunkWords.length > 0) {
        cues.push({
          startSec: chunkStart,
          endSec: Math.max(chunkStart + 0.4, chunkEnd),
          text: chunkWords.join(" ").trim(),
        });
      }
    } else if (seg.text?.trim()) {
      cues.push({
        startSec: Math.max(0, seg.start),
        endSec: Math.max(seg.start + 0.8, seg.end),
        text: seg.text.trim(),
      });
    }
  }

  if (cues.length === 0 && fallbackText?.trim()) {
    const sentences = fallbackText
      .trim()
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean);
    const total = Math.max(10, durationSec || sentences.length * 4);
    const step = total / Math.max(1, sentences.length);
    sentences.forEach((line, idx) => {
      cues.push({
        startSec: idx * step,
        endSec: (idx + 1) * step,
        text: line,
      });
    });
  }

  return cues;
}

export function segmentsToSrt(
  segments: TranscriptSegment[],
  fallbackText?: string | null,
  durationSec = 180
): string {
  const cues = buildSubtitleCues(segments, fallbackText, durationSec);
  return (
    cues
      .map(
        (c, i) =>
          `${i + 1}\n${formatSrtTime(c.startSec)} --> ${formatSrtTime(c.endSec)}\n${c.text}\n`
      )
      .join("\n") + "\n"
  );
}

export function segmentsToVtt(
  segments: TranscriptSegment[],
  fallbackText?: string | null,
  durationSec = 180
): string {
  const cues = buildSubtitleCues(segments, fallbackText, durationSec);
  return (
    "WEBVTT\n\n" +
    cues
      .map((c) => `${formatVttTime(c.startSec)} --> ${formatVttTime(c.endSec)}\n${c.text}\n`)
      .join("\n") +
    "\n"
  );
}
