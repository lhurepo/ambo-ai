"use client";

import React, { useMemo, useState } from "react";
import { Check, ChevronDown, Copy, Edit3, Film, Loader2, Search, X } from "lucide-react";
import type { TranscriptSegment } from "@/lib/types";

interface ClipRange {
  id: string;
  title: string;
  category: string;
  startMs: number;
  endMs: number;
}

interface InteractiveTranscriptProps {
  sermonId: string;
  segments: TranscriptSegment[];
  currentTimeSec: number;
  clips: ClipRange[];
  onSeek: (seconds: number) => void;
  onSegmentsUpdated: (next: TranscriptSegment[], fullText: string) => void;
  onCreateClip: (startMs: number, endMs: number, excerpt: string) => Promise<void>;
  onNavigateToClip?: (clipId: string) => void;
}

const CLIP_CATEGORIES = [
  { key: "Application", label: "Application", color: "bg-sky-50 border-sky-400/70" },
  { key: "Inspirational", label: "Inspirational", color: "bg-emerald-50 border-emerald-400/70" },
  { key: "Pastoral", label: "Pastoral", color: "bg-amber-50 border-amber-400/70" },
  { key: "Teaching", label: "Teaching", color: "bg-cyan-50 border-cyan-400/70" },
  { key: "userCreated", label: "My Clips", color: "bg-[#EBF4F7] border-[#002A3C]/50" },
];

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

export function InteractiveTranscript({
  sermonId,
  segments,
  currentTimeSec,
  clips,
  onSeek,
  onSegmentsUpdated,
  onCreateClip,
  onNavigateToClip,
}: InteractiveTranscriptProps) {
  const [search, setSearch] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [editingWord, setEditingWord] = useState<{ segIdx: number; wordIdx: number; value: string } | null>(null);
  const [savingWord, setSavingWord] = useState(false);

  const [dragStart, setDragStart] = useState<{ segIdx: number; wordIdx: number; time: number } | null>(null);
  const [selection, setSelection] = useState<{ startSec: number; endSec: number; text: string } | null>(null);
  const [creatingClip, setCreatingClip] = useState(false);
  const [copiedSel, setCopiedSel] = useState(false);

  const [showClipTimesMenu, setShowClipTimesMenu] = useState(false);
  const [visibleCategories, setVisibleCategories] = useState<Set<string>>(
    () => new Set(["Application", "Inspirational", "Pastoral", "Teaching", "userCreated"])
  );

  const flatWords = useMemo(() => {
    const list: Array<{ segIdx: number; wordIdx: number; word: string; start: number; end: number }> = [];
    segments.forEach((seg, sIdx) => {
      (seg.words || []).forEach((w, wIdx) => {
        list.push({ segIdx: sIdx, wordIdx: wIdx, word: w.word, start: w.start, end: w.end });
      });
    });
    return list;
  }, [segments]);

  const toggleCategory = (cat: string) => {
    setVisibleCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const getWordClipHighlight = (wordStart: number, wordEnd: number) => {
    const msStart = wordStart * 1000;
    const msEnd = wordEnd * 1000;
    for (const c of clips) {
      if (!visibleCategories.has(c.category)) continue;
      if (msEnd > c.startMs && msStart < c.endMs) {
        const meta = CLIP_CATEGORIES.find((x) => x.key === c.category) || CLIP_CATEGORIES[3];
        return { clip: c, cls: meta.color };
      }
    }
    return null;
  };

  const handleSaveWord = async () => {
    if (!editingWord) return;
    setSavingWord(true);
    try {
      const res = await fetch(`/api/sermons/${sermonId}/transcript/edit-word`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segmentIdx: editingWord.segIdx,
          wordIdx: editingWord.wordIdx,
          newWord: editingWord.value,
        }),
      });
      const data = await res.json();
      if (res.ok && data.segments) {
        onSegmentsUpdated(data.segments, data.transcriptText);
        setEditingWord(null);
      }
    } finally {
      setSavingWord(false);
    }
  };

  const handleWordMouseUp = (segIdx: number, wordIdx: number, endSec: number) => {
    if (editMode || !dragStart) return;
    const startIdx = flatWords.findIndex((w) => w.segIdx === dragStart.segIdx && w.wordIdx === dragStart.wordIdx);
    const endIdx = flatWords.findIndex((w) => w.segIdx === segIdx && w.wordIdx === wordIdx);
    setDragStart(null);
    if (startIdx === -1 || endIdx === -1) return;

    const lo = Math.min(startIdx, endIdx);
    const hi = Math.max(startIdx, endIdx);
    if (hi - lo < 2) {
      onSeek(flatWords[lo].start);
      setSelection(null);
      return;
    }
    const slice = flatWords.slice(lo, hi + 1);
    setSelection({
      startSec: slice[0].start,
      endSec: Math.max(endSec, slice[slice.length - 1].end),
      text: slice.map((w) => w.word).join(" "),
    });
  };

  const filteredSegments = useMemo(() => {
    if (!search.trim()) return segments;
    const q = search.toLowerCase();
    return segments.filter((s) => s.text.toLowerCase().includes(q));
  }, [segments, search]);

  return (
    <div className="rounded-2xl border border-[#E5EAEF] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EDF1F4] pb-4">
        <div className="relative min-w-[200px] flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#70848F]"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search transcript..."
            aria-label="Search transcript"
            className="w-full rounded-full border border-transparent bg-[#F3F5F7] py-1.5 pl-8 pr-3.5 text-xs text-[#0D1F28] placeholder-[#70848F] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowClipTimesMenu((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-3 py-1.5 text-xs font-medium text-[#0D1F28] transition hover:bg-[#F3F5F7]"
            >
              Show clip times
              <ChevronDown className="h-3.5 w-3.5 text-[#4E6470]" aria-hidden="true" />
            </button>
            {showClipTimesMenu && (
              <div className="absolute right-0 z-20 mt-2 w-48 rounded-xl border border-[#E5EAEF] bg-white p-2 shadow-sm">
                {CLIP_CATEGORIES.map((cat) => (
                  <label
                    key={cat.key}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-[#0D1F28] hover:bg-[#F7F8FA]"
                  >
                    <input
                      type="checkbox"
                      checked={visibleCategories.has(cat.key)}
                      onChange={() => toggleCategory(cat.key)}
                      className="accent-[#002A3C]"
                    />
                    <span className={`h-2.5 w-2.5 rounded-sm border ${cat.color}`} />
                    <span>{cat.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setEditMode((v) => !v);
              setEditingWord(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              editMode
                ? "border-[#002A3C] bg-[#002A3C] text-white"
                : "border-[#D5E1E6] bg-white text-[#0D1F28] hover:bg-[#F3F5F7]"
            }`}
          >
            <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
            {editMode ? "Done editing" : "Edit words"}
          </button>
        </div>
      </div>

      <p className="mt-3 text-xs text-[#70848F]">
        {editMode
          ? "Click a word to edit spelling."
          : "Click a word to seek, or drag across words to create a clip."}
      </p>

      {selection && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#D5E1E6] bg-[#EBF4F7] px-4 py-2.5">
          <div className="text-xs text-[#0D1F28]">
            <span className="font-semibold text-[#002A3C]">
              {formatTime(selection.startSec)} – {formatTime(selection.endSec)}
            </span>{" "}
            ({Math.max(1, Math.round(selection.endSec - selection.startSec))}s selected)
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={async () => {
                await navigator.clipboard.writeText(selection.text);
                setCopiedSel(true);
                setTimeout(() => setCopiedSel(false), 1500);
              }}
              className="inline-flex items-center gap-1 rounded-full border border-[#D5E1E6] bg-white px-3 py-1 text-xs font-medium text-[#0D1F28] hover:bg-[#F3F5F7]"
            >
              {copiedSel ? (
                <Check className="h-3 w-3 text-emerald-700" aria-hidden="true" />
              ) : (
                <Copy className="h-3 w-3 text-[#4E6470]" aria-hidden="true" />
              )}
              Copy
            </button>
            <button
              type="button"
              disabled={creatingClip}
              onClick={async () => {
                setCreatingClip(true);
                try {
                  await onCreateClip(
                    Math.round(selection.startSec * 1000),
                    Math.round(selection.endSec * 1000),
                    selection.text
                  );
                  setSelection(null);
                } finally {
                  setCreatingClip(false);
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#002A3C] px-3.5 py-1 text-xs font-medium text-white hover:bg-[#0B435B] disabled:opacity-60"
            >
              {creatingClip ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : (
                <Film className="h-3 w-3" aria-hidden="true" />
              )}
              Create clip
            </button>
            <button
              type="button"
              onClick={() => setSelection(null)}
              aria-label="Clear selection"
              className="rounded-full p-1 text-[#4E6470] hover:text-[#0D1F28]"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {editingWord && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[#D5E1E6] bg-[#F7F8FA] p-3">
          <span className="text-xs font-medium text-[#4E6470]">Edit word:</span>
          <input
            type="text"
            value={editingWord.value}
            onChange={(e) => setEditingWord({ ...editingWord, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSaveWord();
              if (e.key === "Escape") setEditingWord(null);
            }}
            autoFocus
            className="flex-1 rounded-lg border border-[#D5E1E6] bg-white px-3 py-1 text-xs text-[#0D1F28] focus:outline-none"
          />
          <button
            type="button"
            disabled={savingWord}
            onClick={handleSaveWord}
            className="rounded-full bg-[#002A3C] px-3.5 py-1 text-xs font-medium text-white"
          >
            {savingWord ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => setEditingWord(null)}
            className="rounded-full border border-[#D5E1E6] bg-white px-3 py-1 text-xs text-[#4E6470]"
          >
            Cancel
          </button>
        </div>
      )}

      <div className="mt-4 max-h-[540px] space-y-4 overflow-y-auto pr-2 select-none">
        {filteredSegments.length === 0 ? (
          <p className="text-sm text-[#70848F]">No transcript segments available.</p>
        ) : (
          filteredSegments.map((seg) => (
            <div key={seg.id} className="flex items-start gap-4">
              <button
                type="button"
                onClick={() => onSeek(seg.start)}
                className="w-12 shrink-0 pt-0.5 text-left font-mono text-xs font-medium text-[#4E6470] hover:text-[#002A3C]"
              >
                {formatTime(seg.start)}
              </button>
              <div className="flex flex-1 flex-wrap gap-x-1 gap-y-1 text-sm leading-relaxed text-[#0D1F28]">
                {(seg.words && seg.words.length > 0
                  ? seg.words
                  : [{ id: `seg-${seg.id}`, word: seg.text, start: seg.start, end: seg.end }]
                ).map((w, wIdx) => {
                  const isSpoken = currentTimeSec >= w.start && currentTimeSec <= w.end;
                  const inSelection =
                    selection && w.start >= selection.startSec - 0.05 && w.end <= selection.endSec + 0.05;
                  const clipMatch = getWordClipHighlight(w.start, w.end);

                  return (
                    <span
                      key={w.id}
                      onMouseDown={() => {
                        if (!editMode) {
                          setDragStart({ segIdx: seg.id, wordIdx: wIdx, time: w.start });
                        }
                      }}
                      onMouseUp={() => handleWordMouseUp(seg.id, wIdx, w.end)}
                      onClick={() => {
                        if (editMode) {
                          setEditingWord({ segIdx: seg.id, wordIdx: wIdx, value: w.word });
                        }
                      }}
                      onDoubleClick={() => {
                        if (clipMatch && onNavigateToClip && !editMode) {
                          onNavigateToClip(clipMatch.clip.id);
                        }
                      }}
                      title={clipMatch ? `Clip: ${clipMatch.clip.title}` : formatTime(w.start)}
                      className={`cursor-pointer rounded px-1 py-0.5 transition ${
                        isSpoken
                          ? "bg-[#002A3C] font-medium text-white"
                          : inSelection
                            ? "bg-[#EBF4F7] text-[#002A3C]"
                            : clipMatch
                              ? `border-b-2 ${clipMatch.cls}`
                              : editMode
                                ? "hover:bg-[#F3F5F7] hover:underline"
                                : "hover:bg-[#F3F5F7]"
                      }`}
                    >
                      {w.word}
                    </span>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
