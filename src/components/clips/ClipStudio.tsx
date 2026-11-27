"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Download,
  Edit3,
  Film,
  Loader2,
  Pause,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Type,
} from "lucide-react";
import {
  CAPTION_PRESETS,
  DEFAULT_CAPTION_SETTINGS,
  type AspectRatio,
  type CaptionBgStyle,
  type CaptionPosition,
  type CaptionSettings,
  type CaptionSize,
  type FaceTrackData,
  type TranscriptSegment,
} from "@/lib/types";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useToast } from "@/components/ui/ToastProvider";

export interface ClipItem {
  id: string;
  sermonId: string;
  title: string;
  category: string;
  startMs: number;
  endMs: number;
  transcriptExcerpt: string;
  captionSettings: CaptionSettings;
  renderStatus: string;
  renderError?: string | null;
}

interface ClipStudioProps {
  sermonId: string;
  mediaUrl: string;
  isVideo: boolean;
  durationSec: number;
  segments: TranscriptSegment[];
  faceTrack: FaceTrackData | null;
  clips: ClipItem[];
  selectedClipId: string | null;
  onSelectClip: (id: string) => void;
  onClipsChanged: () => void;
  onOpenTranscriptTab: () => void;
  onSegmentsUpdated?: (nextSegments: TranscriptSegment[], fullText: string) => void;
}

const GARDEN_SWATCHES = [
  { hex: "#1D3519", label: "Root Green" },
  { hex: "#BDD630", label: "Vine Accent" },
  { hex: "#121413", label: "Soil Black" },
  { hex: "#F4F2E6", label: "Dew Cream" },
  { hex: "#FFFFFF", label: "White" },
];

function fmtMs(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

export function ClipStudio({
  sermonId,
  mediaUrl,
  isVideo,
  durationSec,
  segments,
  faceTrack,
  clips,
  selectedClipId,
  onSelectClip,
  onClipsChanged,
  onOpenTranscriptTab,
  onSegmentsUpdated,
}: ClipStudioProps) {
  const { success, error: toastError } = useToast();
  const [catFilter, setCatFilter] = useState("All");
  const [findingMore, setFindingMore] = useState(false);
  const [renderingId, setRenderingId] = useState<string | null>(null);
  const [savingStyle, setSavingStyle] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [applyToAllMsg, setApplyToAllMsg] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<ClipItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [showWordEditor, setShowWordEditor] = useState(false);
  const [editingWord, setEditingWord] = useState<{
    segIdx: number;
    wordIdx: number;
    value: string;
  } | null>(null);
  const [savingWord, setSavingWord] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playTimeSec, setPlayTimeSec] = useState(0);

  const activeClip = useMemo(
    () => clips.find((c) => c.id === selectedClipId) || clips[0] || null,
    [clips, selectedClipId]
  );

  const [style, setStyle] = useState<CaptionSettings>(DEFAULT_CAPTION_SETTINGS);

  useEffect(() => {
    if (activeClip) {
      setStyle({ ...DEFAULT_CAPTION_SETTINGS, ...(activeClip.captionSettings || {}) });
      setTitleDraft(activeClip.title);
      setPlayTimeSec(activeClip.startMs / 1000);
      setEditingWord(null);
      if (videoRef.current) {
        videoRef.current.currentTime = activeClip.startMs / 1000;
        videoRef.current.pause();
        setIsPlaying(false);
      }
    }
  }, [activeClip?.id]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = videoRef.current;
      if (el && activeClip) {
        const t = el.currentTime;
        setPlayTimeSec(t);
        if (t >= activeClip.endMs / 1000) {
          el.currentTime = activeClip.startMs / 1000;
        }
      }
      if (isPlaying) {
        raf = requestAnimationFrame(tick);
      }
    };
    if (isPlaying) {
      raf = requestAnimationFrame(tick);
    }
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, activeClip]);

  const indexedWords = useMemo(() => {
    const out: Array<{
      id: string;
      word: string;
      start: number;
      end: number;
      segIdx: number;
      wordIdx: number;
    }> = [];
    segments.forEach((seg) => {
      (seg.words || []).forEach((w, wIdx) => {
        out.push({
          id: w.id,
          word: w.word,
          start: w.start,
          end: w.end,
          segIdx: seg.id,
          wordIdx: wIdx,
        });
      });
    });
    return out;
  }, [segments]);

  const clipWords = useMemo(() => {
    if (!activeClip) return [];
    const s0 = activeClip.startMs / 1000;
    const s1 = activeClip.endMs / 1000;
    return indexedWords.filter((w) => w.end > s0 && w.start < s1);
  }, [indexedWords, activeClip]);

  const activeChunk = useMemo(() => {
    if (clipWords.length === 0) return [];
    let idx = clipWords.findIndex((w) => playTimeSec >= w.start && playTimeSec <= w.end);
    if (idx === -1) {
      idx = clipWords.findIndex((w) => w.start > playTimeSec);
      if (idx === -1) idx = clipWords.length - 1;
      else idx = Math.max(0, idx - 1);
    }
    const chunkStart = Math.floor(idx / 4) * 4;
    return clipWords.slice(chunkStart, chunkStart + 4);
  }, [clipWords, playTimeSec]);

  const currentCenterX = useMemo(() => {
    if (!style.facialTracking || !faceTrack?.points?.length) return 50;
    let closest = faceTrack.points[0];
    let bestDiff = Math.abs(closest.t - playTimeSec);
    for (const pt of faceTrack.points) {
      const diff = Math.abs(pt.t - playTimeSec);
      if (diff < bestDiff) {
        bestDiff = diff;
        closest = pt;
      }
    }
    return Math.round((closest.centerX || 0.5) * 100);
  }, [style.facialTracking, faceTrack, playTimeSec]);

  const persistStyle = async (next: CaptionSettings, applyToAll = false) => {
    setStyle(next);
    if (!activeClip) return;
    setSavingStyle(true);
    try {
      const res = await fetch(`/api/clips/${activeClip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captionSettings: next, applyToAll }),
      });
      if (!res.ok) throw new Error("Failed to save caption style");
      if (applyToAll) {
        setApplyToAllMsg("Applied to all clips.");
        success("Caption style applied to all clips.");
        setTimeout(() => setApplyToAllMsg(null), 2000);
      }
      onClipsChanged();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not save style.");
    } finally {
      setSavingStyle(false);
    }
  };

  const handleRename = async () => {
    if (!activeClip || !titleDraft.trim()) return;
    await fetch(`/api/clips/${activeClip.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: titleDraft.trim() }),
    });
    setRenaming(false);
    success("Clip renamed.");
    onClipsChanged();
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/clips/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete clip");
      success("Clip deleted.");
      setDeleteTarget(null);
      onClipsChanged();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not delete clip.");
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveCaptionWord = async () => {
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
      if (!res.ok) throw new Error(data.error || "Could not update caption word");
      if (data.segments && onSegmentsUpdated) {
        onSegmentsUpdated(data.segments, data.transcriptText || "");
      }
      setEditingWord(null);
      success("Caption word updated — ready to export.");
      onClipsChanged();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not update word.");
    } finally {
      setSavingWord(false);
    }
  };

  const handleFindMore = async () => {
    setFindingMore(true);
    try {
      const res = await fetch(`/api/sermons/${sermonId}/clips`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "find_more" }),
      });
      if (!res.ok) throw new Error("Could not find additional clips");
      success("Added more curated clip moments.");
      onClipsChanged();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not find clips.");
    } finally {
      setFindingMore(false);
    }
  };

  const handleRenderAndDownload = async () => {
    if (!activeClip) return;
    setRenderingId(activeClip.id);
    try {
      const res = await fetch(`/api/clips/${activeClip.id}/render`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Clip rendering failed");
      }
      onClipsChanged();
      const a = document.createElement("a");
      a.href = `/api/clips/${activeClip.id}/download`;
      a.download = `${activeClip.title}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Render failed.");
    } finally {
      setRenderingId(null);
    }
  };

  const filteredClips = clips.filter((c) => {
    if (catFilter === "All") return true;
    if (catFilter === "My Clips") return c.category === "userCreated";
    return c.category === catFilter;
  });

  const activePreset =
    CAPTION_PRESETS.find((p) => p.typography === style.typography) || CAPTION_PRESETS[0];

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el || !activeClip) return;
    if (el.paused) {
      if (el.currentTime < activeClip.startMs / 1000 || el.currentTime >= activeClip.endMs / 1000) {
        el.currentTime = activeClip.startMs / 1000;
      }
      el.play();
      setIsPlaying(true);
    } else {
      el.pause();
      setIsPlaying(false);
    }
  };

  const frameAspectCls =
    style.aspectRatio === "1:1"
      ? "aspect-square w-full max-w-[260px]"
      : style.aspectRatio === "16:9"
        ? "aspect-video w-full max-w-[340px]"
        : "aspect-[9/16] w-full max-w-[235px]";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#E5EAEF] bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-1 rounded-full bg-[#F3F5F7] p-1 text-xs">
          {["All", "Application", "Inspirational", "Pastoral", "Teaching", "My Clips"].map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCatFilter(cat)}
              className={`rounded-full px-3 py-1 font-medium transition ${
                catFilter === cat
                  ? "bg-white text-[#0D1F28] shadow-sm"
                  : "text-[#4E6470] hover:text-[#0D1F28]"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenTranscriptTab}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-3 py-1.5 text-xs font-medium text-[#0D1F28] hover:bg-[#F3F5F7]"
          >
            <Plus className="h-3.5 w-3.5 text-[#4E6470]" aria-hidden="true" />
            Create clip
          </button>
          <button
            type="button"
            disabled={findingMore}
            onClick={handleFindMore}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-[#EBF4F7] px-3 py-1.5 text-xs font-medium text-[#002A3C] hover:bg-[#DDECF1] disabled:opacity-60"
          >
            {findingMore ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Find more clips
          </button>
          {clips.length > 0 && (
            <a
              href={`/api/sermons/${sermonId}/clips/download-all`}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#002A3C] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#0B435B]"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Download all (.zip)
            </a>
          )}
        </div>
      </div>

      {clips.length === 0 ? (
        <div className="rounded-2xl border border-[#E5EAEF] bg-white p-10 text-center">
          <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[#EBF4F7] text-[#002A3C]">
            <Film className="h-5 w-5" aria-hidden="true" />
          </div>
          <h3 className="mt-3 text-base font-semibold text-[#0D1F28]">No clips yet</h3>
          <p className="mt-1 text-xs text-[#4E6470]">
            Highlight text in the Transcript tab to create a clip, or click Find more clips.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-3 overflow-x-auto pb-1">
            {filteredClips.map((c) => {
              const selected = activeClip?.id === c.id;
              return (
                <div
                  key={c.id}
                  onClick={() => onSelectClip(c.id)}
                  className={`w-64 shrink-0 cursor-pointer rounded-xl border p-3.5 transition ${
                    selected
                      ? "border-[#002A3C] bg-[#EBF4F7]"
                      : "border-[#E5EAEF] bg-white hover:bg-[#FAFBFD]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="rounded-full border border-[#E5EAEF] bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#002A3C]">
                      {c.category === "userCreated" ? "My Clip" : c.category}
                    </span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-[#4E6470]">
                        {fmtMs(c.startMs)} – {fmtMs(c.endMs)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(c);
                        }}
                        aria-label={`Delete ${c.title}`}
                        className="rounded p-1 text-[#70848F] hover:text-rose-700"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 truncate text-sm font-semibold text-[#0D1F28]">{c.title}</p>
                  {c.transcriptExcerpt && (
                    <p className="mt-1 line-clamp-2 text-xs text-[#4E6470]">{c.transcriptExcerpt}</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-12">
            {activeClip && (
              <div className="flex min-w-0 flex-col items-center rounded-2xl border border-[#E5EAEF] bg-white p-5 md:col-span-6">
                <div className="mb-3 flex w-full items-center justify-between gap-2">
                  {renaming ? (
                    <div className="flex flex-1 items-center gap-1.5">
                      <input
                        type="text"
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        aria-label="Clip title"
                        className="flex-1 rounded-lg border border-[#D5E1E6] bg-white px-2.5 py-1 text-xs text-[#0D1F28]"
                      />
                      <button
                        type="button"
                        onClick={handleRename}
                        className="rounded-full bg-[#002A3C] px-3 py-1 text-xs font-medium text-white"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <h4 className="truncate text-sm font-semibold text-[#0D1F28]">{activeClip.title}</h4>
                      <button
                        type="button"
                        onClick={() => setRenaming(true)}
                        aria-label="Rename clip"
                        className="text-[#70848F] hover:text-[#0D1F28]"
                      >
                        <Edit3 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  )}
                  <span className="font-mono text-xs text-[#4E6470]">
                    {Math.max(1, Math.round((activeClip.endMs - activeClip.startMs) / 1000))}s
                  </span>
                </div>

                <div
                  className={`relative overflow-hidden rounded-[22px] border border-[#D5E1E6] bg-[#0B1418] ${frameAspectCls}`}
                >
                  {isVideo ? (
                    <video
                      ref={videoRef}
                      src={mediaUrl}
                      playsInline
                      onEnded={() => setIsPlaying(false)}
                      className="h-full w-full object-cover transition-[object-position] duration-300"
                      style={{ objectPosition: `${currentCenterX}% 45%` }}
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center bg-[#1D3519] p-6 text-center">
                      <video ref={videoRef} src={mediaUrl} className="hidden" />
                      <img src="/brand/garden/logo-mark-vine.png" alt="Garden Church" className="h-12 w-12 object-contain" />
                      <p className="mt-3 text-xs font-medium text-white/80">Audio Preview</p>
                    </div>
                  )}

                  <div
                    className={`pointer-events-none absolute inset-x-3 flex justify-center ${
                      style.position === "top"
                        ? "top-10"
                        : style.position === "bottom"
                          ? "bottom-12"
                          : "top-1/2 -translate-y-1/2"
                    }`}
                  >
                    <div
                      className={`max-w-full rounded-xl px-3 py-1.5 text-center font-bold leading-tight ${activePreset.fontClass} ${
                        style.captionSize === "small"
                          ? "text-sm"
                          : style.captionSize === "large"
                            ? "text-xl"
                            : "text-base"
                      }`}
                      style={{
                        backgroundColor:
                          style.backgroundStyle === "background"
                            ? style.backgroundColorHex
                            : "transparent",
                        textShadow:
                          style.backgroundStyle === "border"
                            ? `0 0 8px ${style.backgroundColorHex}, 0 2px 6px rgba(0,0,0,0.9)`
                            : style.backgroundStyle === "none"
                              ? "0 2px 8px rgba(0,0,0,0.95)"
                              : "none",
                        WebkitTextStroke:
                          style.backgroundStyle === "border"
                            ? `1px ${style.backgroundColorHex}`
                            : undefined,
                      }}
                    >
                      {activeChunk.map((w) => {
                        const activeWord =
                          style.highlights && playTimeSec >= w.start && playTimeSec <= w.end;
                        return (
                          <span
                            key={w.id}
                            className="mx-0.5 inline-block transition-colors duration-75"
                            style={{ color: activeWord ? style.highlightColorHex : style.colorHex }}
                          >
                            {w.word}
                          </span>
                        );
                      })}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={togglePlay}
                    aria-label={isPlaying ? "Pause clip" : "Play clip"}
                    className="absolute bottom-3 left-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white hover:bg-[#002A3C]"
                  >
                    {isPlaying ? (
                      <Pause className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Play className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                </div>

                {/* Inline Caption Word Editor */}
                <div className="mt-4 w-full">
                  <button
                    type="button"
                    onClick={() => setShowWordEditor((v) => !v)}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-[#D5E1E6] bg-[#FAFBFD] py-1.5 text-xs font-medium text-[#0D1F28] hover:bg-[#F3F5F7]"
                  >
                    <Type className="h-3.5 w-3.5 text-[#4E6470]" aria-hidden="true" />
                    {showWordEditor ? "Hide caption text editor" : "Edit caption words"}
                  </button>

                  {showWordEditor && (
                    <div className="mt-2.5 rounded-xl border border-[#E5EAEF] bg-[#FAFBFD] p-3">
                      <p className="mb-2 text-[11px] text-[#4E6470]">
                        Click any word to fix spelling before exporting your MP4:
                      </p>
                      <div className="flex max-h-28 flex-wrap gap-1 overflow-y-auto text-xs">
                        {clipWords.map((w) => (
                          <button
                            key={w.id}
                            type="button"
                            onClick={() =>
                              setEditingWord({
                                segIdx: w.segIdx,
                                wordIdx: w.wordIdx,
                                value: w.word,
                              })
                            }
                            className="rounded bg-white px-1.5 py-0.5 text-[#0D1F28] border border-[#E5EAEF] hover:border-[#002A3C]"
                          >
                            {w.word}
                          </button>
                        ))}
                      </div>
                      {editingWord && (
                        <div className="mt-2 flex items-center gap-1.5">
                          <input
                            type="text"
                            value={editingWord.value}
                            onChange={(e) =>
                              setEditingWord({ ...editingWord, value: e.target.value })
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveCaptionWord();
                            }}
                            aria-label="Edit caption word"
                            className="flex-1 rounded-lg border border-[#D5E1E6] bg-white px-2.5 py-1 text-xs text-[#0D1F28]"
                          />
                          <button
                            type="button"
                            disabled={savingWord}
                            onClick={handleSaveCaptionWord}
                            className="rounded-full bg-[#002A3C] px-3 py-1 text-xs font-medium text-white"
                          >
                            {savingWord ? "..." : "Save"}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="mt-4 grid w-full grid-cols-2 gap-2.5 text-xs">
                  <div>
                    <label htmlFor="clip-start-sec" className="block text-[11px] font-medium text-[#4E6470]">
                      Start (sec)
                    </label>
                    <input
                      id="clip-start-sec"
                      type="number"
                      min={0}
                      max={Math.max(0, durationSec - 1)}
                      step={0.5}
                      defaultValue={(activeClip.startMs / 1000).toFixed(1)}
                      onBlur={async (e) => {
                        const nextMs = Math.max(0, Math.round(Number(e.target.value) * 1000));
                        if (nextMs < activeClip.endMs - 1000) {
                          await fetch(`/api/clips/${activeClip.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ startMs: nextMs }),
                          });
                          onClipsChanged();
                        }
                      }}
                      className="mt-1 w-full rounded-xl border border-transparent bg-[#F3F5F7] px-2.5 py-1.5 text-[#0D1F28] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="clip-end-sec" className="block text-[11px] font-medium text-[#4E6470]">
                      End (sec)
                    </label>
                    <input
                      id="clip-end-sec"
                      type="number"
                      min={1}
                      max={Math.max(10, durationSec)}
                      step={0.5}
                      defaultValue={(activeClip.endMs / 1000).toFixed(1)}
                      onBlur={async (e) => {
                        const nextMs = Math.max(
                          activeClip.startMs + 1000,
                          Math.round(Number(e.target.value) * 1000)
                        );
                        await fetch(`/api/clips/${activeClip.id}`, {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ endMs: nextMs }),
                        });
                        onClipsChanged();
                      }}
                      className="mt-1 w-full rounded-xl border border-transparent bg-[#F3F5F7] px-2.5 py-1.5 text-[#0D1F28] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  disabled={renderingId === activeClip.id}
                  onClick={handleRenderAndDownload}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-full bg-[#002A3C] py-2.5 text-xs font-medium text-white transition hover:bg-[#0B435B] disabled:opacity-60"
                >
                  {renderingId === activeClip.id ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      Rendering {style.aspectRatio} MP4...
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" aria-hidden="true" />
                      Export MP4
                    </>
                  )}
                </button>
                {activeClip.renderStatus === "completed" && (
                  <p className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-700">
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    MP4 ready
                  </p>
                )}
              </div>
            )}

            {activeClip && (
              <div className="min-w-0 space-y-4 rounded-2xl border border-[#E5EAEF] bg-white p-5 md:col-span-6">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-[#0D1F28]">Caption style</h4>
                  {savingStyle && <span className="text-xs text-[#4E6470]">Saving...</span>}
                </div>

                <div>
                  <p className="mb-2 text-xs font-medium text-[#4E6470]">
                    Presets (Garden Church fonts first)
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {CAPTION_PRESETS.map((preset) => {
                      const selected = style.typography === preset.typography;
                      return (
                        <button
                          key={preset.typography}
                          type="button"
                          onClick={() =>
                            persistStyle({
                              ...style,
                              typography: preset.typography,
                              colorHex: preset.colorHex,
                              backgroundStyle: preset.backgroundStyle,
                              backgroundColorHex: preset.backgroundColorHex,
                              highlights: preset.highlights,
                              highlightColorHex: preset.highlightColorHex,
                            })
                          }
                          className={`rounded-xl border px-2 py-2 text-center transition ${
                            selected
                              ? "border-[#002A3C] bg-[#EBF4F7] text-[#002A3C]"
                              : "border-[#E5EAEF] bg-[#FAFBFD] text-[#0D1F28] hover:bg-[#F3F5F7]"
                          }`}
                        >
                          <span
                            className={`block truncate text-[11px] font-semibold tracking-normal ${preset.fontClass}`}
                          >
                            {preset.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <label htmlFor="clip-aspect" className="block text-[11px] font-medium text-[#4E6470]">
                      Aspect
                    </label>
                    <select
                      id="clip-aspect"
                      value={style.aspectRatio}
                      onChange={(e) =>
                        persistStyle({ ...style, aspectRatio: e.target.value as AspectRatio })
                      }
                      className="mt-1 w-full rounded-xl border border-transparent bg-[#F3F5F7] px-2.5 py-2 text-[#0D1F28]"
                    >
                      <option value="9:16">9:16 Reel</option>
                      <option value="1:1">1:1 Square</option>
                      <option value="16:9">16:9 Wide</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="clip-position" className="block text-[11px] font-medium text-[#4E6470]">
                      Position
                    </label>
                    <select
                      id="clip-position"
                      value={style.position}
                      onChange={(e) =>
                        persistStyle({ ...style, position: e.target.value as CaptionPosition })
                      }
                      className="mt-1 w-full rounded-xl border border-transparent bg-[#F3F5F7] px-2.5 py-2 text-[#0D1F28]"
                    >
                      <option value="top">Top</option>
                      <option value="mid">Middle</option>
                      <option value="bottom">Bottom</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="clip-size" className="block text-[11px] font-medium text-[#4E6470]">
                      Size
                    </label>
                    <select
                      id="clip-size"
                      value={style.captionSize}
                      onChange={(e) =>
                        persistStyle({ ...style, captionSize: e.target.value as CaptionSize })
                      }
                      className="mt-1 w-full rounded-xl border border-transparent bg-[#F3F5F7] px-2.5 py-2 text-[#0D1F28]"
                    >
                      <option value="small">Small</option>
                      <option value="medium">Medium</option>
                      <option value="large">Large</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <label htmlFor="clip-text-color" className="block text-[11px] font-medium text-[#4E6470]">
                      Text color
                    </label>
                    <input
                      id="clip-text-color"
                      type="color"
                      value={style.colorHex}
                      onChange={(e) => persistStyle({ ...style, colorHex: e.target.value })}
                      className="mt-1 h-8 w-full cursor-pointer rounded-lg border border-[#E5EAEF] bg-white p-0.5"
                    />
                  </div>
                  <div>
                    <label htmlFor="clip-bg-style" className="block truncate text-[11px] font-medium text-[#4E6470]">
                      Bg style
                    </label>
                    <select
                      id="clip-bg-style"
                      value={style.backgroundStyle}
                      onChange={(e) =>
                        persistStyle({ ...style, backgroundStyle: e.target.value as CaptionBgStyle })
                      }
                      className="mt-1 h-8 w-full rounded-lg border border-transparent bg-[#F3F5F7] px-2 text-[#0D1F28]"
                    >
                      <option value="none">None</option>
                      <option value="background">Fill Box</option>
                      <option value="border">Outline</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="clip-bg-color" className="block text-[11px] font-medium text-[#4E6470]">
                      Bg color
                    </label>
                    <input
                      id="clip-bg-color"
                      type="color"
                      value={style.backgroundColorHex}
                      onChange={(e) =>
                        persistStyle({ ...style, backgroundColorHex: e.target.value })
                      }
                      className="mt-1 h-8 w-full cursor-pointer rounded-lg border border-[#E5EAEF] bg-white p-0.5"
                    />
                  </div>
                </div>

                {/* Garden Brand Quick Swatches */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#EDF1F4] bg-[#FAFBFD] px-3 py-2">
                  <span className="text-[11px] font-medium text-[#4E6470]">Garden swatches (highlight)</span>
                  <div className="flex items-center gap-1.5">
                    {GARDEN_SWATCHES.map((sw) => (
                      <button
                        key={sw.hex}
                        type="button"
                        title={sw.label}
                        aria-label={`Set highlight color ${sw.label}`}
                        onClick={() => persistStyle({ ...style, highlightColorHex: sw.hex })}
                        className="h-5 w-5 rounded-full border border-[#D5E1E6]"
                        style={{ backgroundColor: sw.hex }}
                      />
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-[#EDF1F4] bg-[#FAFBFD] p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-[#0D1F28]">Karaoke highlighting</p>
                      <p className="text-[11px] text-[#4E6470]">Words highlight while spoken</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={style.highlights}
                      aria-label="Enable karaoke highlighting"
                      onChange={(e) => persistStyle({ ...style, highlights: e.target.checked })}
                      className="h-4 w-4 accent-[#002A3C]"
                    />
                  </div>
                  {style.highlights && (
                    <div className="mt-2.5 flex items-center justify-between text-xs">
                      <label htmlFor="clip-highlight-color" className="text-[#4E6470]">
                        Highlight color
                      </label>
                      <input
                        id="clip-highlight-color"
                        type="color"
                        value={style.highlightColorHex}
                        onChange={(e) =>
                          persistStyle({ ...style, highlightColorHex: e.target.value })
                        }
                        className="h-7 w-14 cursor-pointer rounded border border-[#E5EAEF] bg-white p-0.5"
                      />
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-between rounded-xl border border-[#EDF1F4] bg-[#FAFBFD] p-3">
                  <div>
                    <p className="text-xs font-medium text-[#0D1F28]">Facial tracking</p>
                    <p className="text-[11px] text-[#4E6470]">Keep speaker centered in 9:16</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={style.facialTracking}
                    aria-label="Enable facial tracking"
                    onChange={(e) => persistStyle({ ...style, facialTracking: e.target.checked })}
                    className="h-4 w-4 accent-[#002A3C]"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => persistStyle(style, true)}
                  className="w-full rounded-full border border-[#D5E1E6] bg-white py-2 text-xs font-medium text-[#0D1F28] hover:bg-[#F3F5F7]"
                >
                  Apply style to all clips
                </button>
                {applyToAllMsg && (
                  <p className="text-center text-xs font-medium text-[#002A3C]">{applyToAllMsg}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete video clip?"
        description={
          deleteTarget
            ? `Delete "${deleteTarget.title}" and any rendered MP4? This cannot be undone.`
            : ""
        }
        confirmLabel="Delete clip"
        variant="danger"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
