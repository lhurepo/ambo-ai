"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { TranscriptSegment } from "@/lib/types";

interface WaveformScrubberProps {
  sermonId: string;
  durationSec: number;
  startMs: number;
  endMs: number;
  playTimeSec: number;
  segments: TranscriptSegment[];
  onSeek: (sec: number) => void;
  onChangeRange: (nextStartMs: number, nextEndMs: number) => void;
}

function fmtSec(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

export function WaveformScrubber({
  sermonId,
  durationSec,
  startMs,
  endMs,
  playTimeSec,
  segments,
  onSeek,
  onChangeRange,
}: WaveformScrubberProps) {
  const [peaks, setPeaks] = useState<number[]>([]);
  const [zoomed, setZoomed] = useState(true);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);
  const [draftStartMs, setDraftStartMs] = useState(startMs);
  const [draftEndMs, setDraftEndMs] = useState(endMs);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDraftStartMs(startMs);
    setDraftEndMs(endMs);
  }, [startMs, endMs]);

  useEffect(() => {
    let active = true;
    fetch(`/api/sermons/${sermonId}/waveform`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && Array.isArray(data?.peaks) && data.peaks.length > 0) {
          setPeaks(data.peaks);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [sermonId]);

  const totalSec = Math.max(10, durationSec || Math.ceil(endMs / 1000) + 5);

  // Deterministic segment-energy fallback peaks until audio waveform loads (zero Math.random for SSR safety)
  const fallbackPeaks = useMemo(() => {
    const n = 160;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = (i / n) * totalSec;
      const inSpeech = segments.some((s) => t >= s.start && t <= s.end);
      const wave = 0.32 + 0.25 * Math.sin(i * 0.7) + 0.16 * Math.cos(i * 1.3);
      out.push(Math.max(0.1, Math.min(0.95, inSpeech ? wave + 0.25 : 0.14)));
    }
    return out;
  }, [segments, totalSec]);

  const activePeaks = peaks.length > 0 ? peaks : fallbackPeaks;

  const viewWindow = useMemo(() => {
    if (!zoomed) {
      return { minSec: 0, maxSec: totalSec };
    }
    const pad = 12;
    const lo = Math.max(0, Math.floor(startMs / 1000 - pad));
    const hi = Math.min(totalSec, Math.ceil(endMs / 1000 + pad));
    if (hi - lo < 12) {
      return { minSec: Math.max(0, lo - 4), maxSec: Math.min(totalSec, lo + 16) };
    }
    return { minSec: lo, maxSec: hi };
  }, [zoomed, totalSec, startMs, endMs]);

  const viewSpan = Math.max(2, viewWindow.maxSec - viewWindow.minSec);

  const visiblePeaks = useMemo(() => {
    const startIdx = Math.max(
      0,
      Math.floor((viewWindow.minSec / totalSec) * activePeaks.length)
    );
    const endIdx = Math.min(
      activePeaks.length,
      Math.max(startIdx + 8, Math.ceil((viewWindow.maxSec / totalSec) * activePeaks.length))
    );
    return activePeaks.slice(startIdx, endIdx);
  }, [activePeaks, viewWindow, totalSec]);

  const toPct = (sec: number) =>
    Math.max(0, Math.min(100, ((sec - viewWindow.minSec) / viewSpan) * 100));

  const clientXToMs = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return draftStartMs;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const sec = viewWindow.minSec + ratio * viewSpan;
    return Math.round(Math.max(0, Math.min(totalSec * 1000, sec * 1000)));
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (ev: PointerEvent) => {
      const ms = clientXToMs(ev.clientX);
      if (dragging === "start") {
        setDraftStartMs(Math.min(ms, draftEndMs - 1000));
      } else {
        setDraftEndMs(Math.max(ms, draftStartMs + 1000));
      }
    };
    const onUp = () => {
      const finalStart = draftStartMs;
      const finalEnd = draftEndMs;
      setDragging(null);
      if (finalStart !== startMs || finalEnd !== endMs) {
        onChangeRange(finalStart, finalEnd);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  });

  const leftPct = toPct(draftStartMs / 1000);
  const rightPct = toPct(draftEndMs / 1000);
  const playPct = toPct(playTimeSec);

  return (
    <div className="mt-4 w-full rounded-xl border border-[#EDF1F4] bg-[#FAFBFD] p-3">
      <div className="mb-2 flex items-center justify-between text-[11px]">
        <span className="font-medium text-[#4E6470]">
          Waveform Trim ({fmtSec(draftStartMs / 1000)} – {fmtSec(draftEndMs / 1000)})
        </span>
        <button
          type="button"
          onClick={() => setZoomed((z) => !z)}
          className="rounded-full border border-[#D5E1E6] bg-white px-2.5 py-0.5 text-[10px] font-medium text-[#002A3C] hover:bg-[#F3F5F7]"
        >
          {zoomed ? "Show Full Sermon" : "Zoom to Clip"}
        </button>
      </div>

      <div
        ref={trackRef}
        onClick={(e) => {
          if (dragging) return;
          const ms = clientXToMs(e.clientX);
          onSeek(ms / 1000);
        }}
        className="relative h-14 w-full cursor-pointer select-none overflow-hidden rounded-lg border border-[#E5EAEF] bg-white px-1"
      >
        <div className="flex h-full w-full items-center justify-between gap-[1px]">
          {visiblePeaks.map((amp, i) => {
            const barSec = viewWindow.minSec + (i / Math.max(1, visiblePeaks.length)) * viewSpan;
            const barMs = barSec * 1000;
            const inClip = barMs >= draftStartMs && barMs <= draftEndMs;
            return (
              <div
                key={i}
                className="flex-1 rounded-full transition-colors"
                style={{
                  height: `${Math.round(14 + amp * 78)}%`,
                  backgroundColor: inClip ? "#1D3519" : "#CBD5DF",
                }}
              />
            );
          })}
        </div>

        {/* Selected Clip Region Highlight */}
        <div
          className="pointer-events-none absolute inset-y-0 border-y-2 border-[#BDD630] bg-[#BDD630]/15"
          style={{
            left: `${leftPct}%`,
            width: `${Math.max(1, rightPct - leftPct)}%`,
          }}
        />

        {/* Playhead Marker */}
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-[#002A3C]"
          style={{ left: `${playPct}%` }}
        />

        {/* Draggable Start Handle */}
        <button
          type="button"
          aria-label="Drag start trim handle"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => {
            e.stopPropagation();
            setDragging("start");
          }}
          className="absolute inset-y-0 z-10 flex w-3 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded-sm bg-[#1D3519] text-white shadow"
          style={{ left: `${leftPct}%` }}
        >
          <span className="h-5 w-0.5 rounded bg-[#BDD630]" />
        </button>

        {/* Draggable End Handle */}
        <button
          type="button"
          aria-label="Drag end trim handle"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => {
            e.stopPropagation();
            setDragging("end");
          }}
          className="absolute inset-y-0 z-10 flex w-3 -translate-x-1/2 cursor-ew-resize items-center justify-center rounded-sm bg-[#1D3519] text-white shadow"
          style={{ left: `${rightPct}%` }}
        >
          <span className="h-5 w-0.5 rounded bg-[#BDD630]" />
        </button>
      </div>

      <div className="mt-1 flex justify-between font-mono text-[10px] text-[#70848F]">
        <span>{fmtSec(viewWindow.minSec)}</span>
        <span>Click waveform to preview · Drag green handles to trim</span>
        <span>{fmtSec(viewWindow.maxSec)}</span>
      </div>
    </div>
  );
}
