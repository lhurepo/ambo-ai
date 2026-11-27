"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  FileText,
  Film,
  FolderOpen,
  Headphones,
  Link2,
  Loader2,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { AuthenticatedShell } from "@/components/layout/AuthenticatedShell";
import { NewSermonModal } from "@/components/sermon/NewSermonModal";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useToast } from "@/components/ui/ToastProvider";
import { downloadMediaEndpoint, revealPathInFinder } from "@/lib/client-download";

interface SearchMatchItem {
  kind: "transcript" | "scripture" | "quotes" | "notes";
  snippet: string;
  startSec: number | null;
}

interface SermonListItem {
  id: string;
  title: string;
  speaker: string;
  topic: string;
  seriesName?: string;
  tags?: string[];
  sourceType: string;
  status: string;
  progress: number;
  progressMessage: string;
  errorMessage: string | null;
  mediaFileName: string | null;
  manuscriptFileName: string | null;
  isVideo: number;
  durationSec: number;
  clipCount: number;
  searchMatches?: SearchMatchItem[];
  createdAt: number;
}

function formatSeekTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

function formatDuration(sec: number): string {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function StatusBadge({ status, progress }: { status: string; progress: number }) {
  if (status === "completed") {
    return (
      <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
        Ready
      </span>
    );
  }
  if (status === "error" || status === "failed") {
    return (
      <span className="inline-flex items-center rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700">
        Error
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EBF4F7] px-2.5 py-0.5 text-xs font-medium text-[#002A3C]">
      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
      {progress}%
    </span>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [user, setUser] = useState<{ email: string; fullName: string; ministryName: string } | null>(null);
  const [sermons, setSermons] = useState<SermonListItem[]>([]);
  const [allSeries, setAllSeries] = useState<string[]>([]);
  const [seriesFilter, setSeriesFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "media" | "manuscript">("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalKind, setModalKind] = useState<"media" | "manuscript" | null>(null);
  const [attachId, setAttachId] = useState<string | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<SermonListItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [savedNotice, setSavedNotice] = useState<{ savedPath: string; displayPath: string } | null>(
    null
  );

  const handleDownloadMp3 = async (sermonId: string, title: string) => {
    setSavedNotice(null);
    try {
      await downloadMediaEndpoint({
        endpointUrl: `/api/sermons/${sermonId}/audio-mp3`,
        fileName: `${title}-audio.mp3`,
        mimeType: "audio/mpeg",
        onSavedToFolder: (saved) => setSavedNotice(saved),
      });
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not export MP3.");
    }
  };

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 180);
    return () => clearTimeout(t);
  }, [query]);

  const loadData = useCallback(async () => {
    try {
      const qs = new URLSearchParams({
        q: debouncedQuery,
        filter,
        ...(seriesFilter ? { series: seriesFilter } : {}),
      });
      const [acctRes, sermRes] = await Promise.all([
        fetch("/api/account"),
        fetch(`/api/sermons?${qs.toString()}`),
      ]);
      if (acctRes.status === 401) {
        router.push("/signin");
        return;
      }
      if (acctRes.ok) {
        const a = await acctRes.json();
        setUser(a.user);
      }
      if (sermRes.ok) {
        const s = await sermRes.json();
        setSermons(s.sermons || []);
        setAllSeries(Array.isArray(s.allSeries) ? s.allSeries : []);
      }
    } finally {
      setLoading(false);
    }
  }, [filter, debouncedQuery, seriesFilter, router]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const hasActive = sermons.some((s) =>
      ["queued", "transcribing", "generating", "processing_clips"].includes(s.status)
    );
    if (!hasActive) return;
    const t = setInterval(loadData, 2000);
    return () => clearInterval(t);
  }, [sermons, loadData]);

  const openUploadModal = (kind: "media" | "manuscript" | null, targetId: string | null = null) => {
    setModalKind(kind);
    setAttachId(targetId);
    setModalOpen(true);
  };

  const handleSample = async () => {
    setSampleLoading(true);
    try {
      const res = await fetch("/api/sermons/sample", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.sermonId) {
        success("Sample sermon loaded.");
        router.push(`/sermon/${data.sermonId}`);
      } else {
        throw new Error(data.error || "Could not create sample sermon");
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Sample failed.");
    } finally {
      setSampleLoading(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/sermons?id=${encodeURIComponent(deleteTarget.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete sermon");
      success(`Deleted "${deleteTarget.title}".`);
      setDeleteTarget(null);
      loadData();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  };

  const latest = sermons[0];
  const isPureEmpty =
    !loading && sermons.length === 0 && query === "" && filter === "all" && seriesFilter === "";

  return (
    <AuthenticatedShell
      userEmail={user?.email}
      ministryName={user?.ministryName}
      onSermonCreated={(id) => router.push(`/sermon/${id}`)}
    >
      <div className="mx-auto max-w-6xl px-5 py-7 md:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-[#0D1F28]">Dashboard</h1>

        {savedNotice && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#D5E1E6] bg-[#F4F2E6]/70 px-4 py-2.5 text-xs text-[#1D3519]">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Saved to <code className="font-mono">{savedNotice.displayPath}</code>
            </span>
            <button
              type="button"
              onClick={() => void revealPathInFinder(savedNotice.savedPath)}
              className="inline-flex items-center gap-1 rounded-full border border-[#D5E1E6] bg-white px-3 py-1 text-[11px] font-medium text-[#0D1F28] hover:bg-[#F3F5F7]"
            >
              <FolderOpen className="h-3 w-3" aria-hidden="true" />
              Show in Finder
            </button>
          </div>
        )}

        {loading ? (
          <div className="mt-12 flex items-center justify-center py-16 text-[#4E6470]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          </div>
        ) : isPureEmpty ? (
          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-[#E5EAEF] bg-white p-8">
            <h2 className="text-center text-lg font-semibold text-[#0D1F28]">
              Start by uploading a sermon
            </h2>
            <p className="mt-1.5 text-center text-sm text-[#4E6470]">
              Import a YouTube link or upload an audio, video, or text file to begin.
            </p>

            <div className="mt-6 grid grid-cols-1 gap-4 rounded-2xl border border-dashed border-[#D5E1E6] bg-[#FAFBFD] p-5 sm:grid-cols-3">
              <div className="flex flex-col items-center rounded-xl border border-[#EDF1F4] bg-white p-5 text-center">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#EBF4F7] text-[#002A3C]">
                  <Link2 className="h-5 w-5" aria-hidden="true" />
                </div>
                <p className="text-sm font-semibold text-[#0D1F28]">YouTube</p>
                <p className="mt-1 text-xs text-[#4E6470]">Paste URL link</p>
                <button
                  type="button"
                  onClick={() => openUploadModal("media")}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-4 py-1.5 text-xs font-medium text-[#0D1F28] transition hover:bg-[#F3F5F7]"
                >
                  Import URL
                </button>
              </div>

              <div className="flex flex-col items-center rounded-xl border border-[#EDF1F4] bg-white p-5 text-center">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#EBF4F7] text-[#002A3C]">
                  <FileText className="h-5 w-5" aria-hidden="true" />
                </div>
                <p className="text-sm font-semibold text-[#0D1F28]">Text file</p>
                <p className="mt-1 text-xs text-[#4E6470]">TXT, PDF, DOCX</p>
                <button
                  type="button"
                  onClick={() => openUploadModal("manuscript")}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-4 py-1.5 text-xs font-medium text-[#0D1F28] transition hover:bg-[#F3F5F7]"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  Manuscript
                </button>
              </div>

              <div className="flex flex-col items-center rounded-xl border border-[#EDF1F4] bg-white p-5 text-center">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#EBF4F7] text-[#002A3C]">
                  <Film className="h-5 w-5" aria-hidden="true" />
                </div>
                <p className="text-sm font-semibold text-[#0D1F28]">Audio or video</p>
                <p className="mt-1 text-xs text-[#4E6470]">MP4, MOV, MP3</p>
                <button
                  type="button"
                  onClick={() => openUploadModal("media")}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-4 py-1.5 text-xs font-medium text-[#0D1F28] transition hover:bg-[#F3F5F7]"
                >
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                  Media file
                </button>
              </div>
            </div>

            <div className="mt-5 flex justify-center">
              <button
                type="button"
                onClick={handleSample}
                disabled={sampleLoading}
                className="text-xs font-medium text-[#4E6470] transition hover:text-[#002A3C] disabled:opacity-60"
              >
                {sampleLoading ? "Creating sample sermon..." : "Try a sample sermon"}
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            {latest && (
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                <div className="flex flex-col justify-between rounded-2xl border border-[#E5EAEF] bg-white p-5 lg:col-span-7">
                  <div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs font-medium text-[#70848F]">Latest upload</span>
                      <StatusBadge status={latest.status} progress={latest.progress} />
                    </div>
                    <h2 className="mt-2 truncate text-lg font-semibold text-[#0D1F28]">
                      {latest.title}
                    </h2>
                    <p className="mt-1 text-xs text-[#4E6470]">
                      {latest.speaker || "The Garden Church"}
                      {latest.durationSec > 0 ? ` · ${formatDuration(latest.durationSec)}` : ""}
                      {` · ${formatDate(latest.createdAt)}`}
                    </p>
                    {latest.topic && (
                      <span className="mt-3 inline-block rounded-full bg-[#EBF4F7] px-2.5 py-0.5 text-xs font-medium text-[#002A3C]">
                        {latest.topic}
                      </span>
                    )}
                  </div>

                  <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#EDF1F4] pt-4">
                    <div className="text-xs text-[#4E6470]">
                      {latest.clipCount > 0
                        ? `${latest.clipCount} clips ready`
                        : latest.manuscriptFileName || latest.mediaFileName || ""}
                    </div>
                    <div className="flex items-center gap-2">
                      {latest.mediaFileName && (
                        <button
                          type="button"
                          onClick={() => void handleDownloadMp3(latest.id, latest.title)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-3.5 py-2 text-xs font-medium text-[#0D1F28] hover:bg-[#F3F5F7]"
                        >
                          <Headphones className="h-3.5 w-3.5 text-[#4E6470]" aria-hidden="true" />
                          MP3
                        </button>
                      )}
                      <Link
                        href={`/sermon/${latest.id}`}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#002A3C] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#0B435B]"
                      >
                        Open sermon
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2.5 rounded-2xl border border-[#E5EAEF] bg-white p-5 lg:col-span-5">
                  <button
                    type="button"
                    onClick={() => openUploadModal("media")}
                    className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#D5E1E6] bg-[#FAFBFD] p-3 text-center transition hover:bg-[#F3F5F7]"
                  >
                    <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-[#EBF4F7] text-[#002A3C]">
                      <Link2 className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <span className="text-xs font-semibold text-[#0D1F28]">YouTube</span>
                    <span className="mt-0.5 text-[11px] text-[#4E6470]">Paste URL</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => openUploadModal("manuscript")}
                    className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#D5E1E6] bg-[#FAFBFD] p-3 text-center transition hover:bg-[#F3F5F7]"
                  >
                    <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-[#EBF4F7] text-[#002A3C]">
                      <FileText className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <span className="text-xs font-semibold text-[#0D1F28]">Text</span>
                    <span className="mt-0.5 text-[11px] text-[#4E6470]">Manuscript</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => openUploadModal("media")}
                    className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#D5E1E6] bg-[#FAFBFD] p-3 text-center transition hover:bg-[#F3F5F7]"
                  >
                    <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-[#EBF4F7] text-[#002A3C]">
                      <Film className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <span className="text-xs font-semibold text-[#0D1F28]">Media</span>
                    <span className="mt-0.5 text-[11px] text-[#4E6470]">MP4 / MP3</span>
                  </button>
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-[#E5EAEF] bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EDF1F4] px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1 rounded-full bg-[#F3F5F7] p-1 text-xs font-medium">
                    {(["all", "media", "manuscript"] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setFilter(tab)}
                        className={`rounded-full px-3 py-1 capitalize transition ${
                          filter === tab
                            ? "bg-white text-[#0D1F28] shadow-sm"
                            : "text-[#4E6470] hover:text-[#0D1F28]"
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>

                  {allSeries.length > 0 && (
                    <select
                      aria-label="Filter by sermon series"
                      value={seriesFilter}
                      onChange={(e) => setSeriesFilter(e.target.value)}
                      className="rounded-full border border-[#E5EAEF] bg-[#FAFBFD] px-3 py-1.5 text-xs font-medium text-[#0D1F28] focus:outline-none"
                    >
                      <option value="">All Series ({allSeries.length})</option>
                      {allSeries.map((sr) => (
                        <option key={sr} value={sr}>
                          Series: {sr}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="relative w-full sm:w-80">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#70848F]"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search sermons, Scripture, quotes, transcript..."
                    aria-label="Search sermons"
                    className="w-full rounded-full border border-transparent bg-[#F3F5F7] py-1.5 pl-8 pr-3 text-xs text-[#0D1F28] placeholder-[#70848F] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              {sermons.length === 0 ? (
                <div className="px-5 py-12 text-center text-sm text-[#4E6470]">
                  No sermons match this filter.
                </div>
              ) : (
                <div className="divide-y divide-[#EDF1F4]">
                  {sermons.map((s) => (
                    <div key={s.id} className="px-5 py-3.5 transition hover:bg-[#FAFBFD]">
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <Link
                          href={`/sermon/${s.id}`}
                          className="flex min-w-0 flex-1 items-center gap-3.5"
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#F3F5F7] text-[#002A3C]">
                            {s.sourceType === "manuscript" ? (
                              <FileText className="h-4 w-4" aria-hidden="true" />
                            ) : (
                              <Film className="h-4 w-4" aria-hidden="true" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-[#0D1F28]">{s.title}</p>
                            <p className="mt-0.5 truncate text-xs text-[#4E6470]">
                              {s.speaker || "The Garden Church"}
                              {s.seriesName ? ` · Series: ${s.seriesName}` : ""}
                              {s.durationSec > 0 ? ` · ${formatDuration(s.durationSec)}` : ""}
                              {` · ${formatDate(s.createdAt)}`}
                            </p>
                          </div>
                        </Link>

                        <div className="flex flex-wrap items-center gap-2">
                          {s.seriesName && (
                            <span className="hidden rounded-full bg-[#F4F2E6] px-2.5 py-0.5 text-[11px] font-medium text-[#1D3519] sm:inline-block">
                              {s.seriesName}
                            </span>
                          )}
                          {s.topic && (
                            <span className="hidden rounded-full bg-[#F3F5F7] px-2.5 py-0.5 text-xs text-[#4E6470] sm:inline-block">
                              {s.topic}
                            </span>
                          )}
                          {s.tags?.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="hidden rounded-full border border-[#E5EAEF] bg-white px-2 py-0.5 text-[10px] text-[#4E6470] md:inline-block"
                            >
                              #{tag}
                            </span>
                          ))}
                          <StatusBadge status={s.status} progress={s.progress} />
                          {s.mediaFileName && (
                            <button
                              type="button"
                              onClick={() => void handleDownloadMp3(s.id, s.title)}
                              aria-label={`Download MP3 audio for ${s.title}`}
                              title="Download Spotify MP3"
                              className="rounded-lg p-1.5 text-[#70848F] transition hover:bg-[#EBF4F7] hover:text-[#002A3C]"
                            >
                              <Headphones className="h-4 w-4" aria-hidden="true" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(s)}
                            aria-label={`Delete ${s.title}`}
                            className="rounded-lg p-1.5 text-[#70848F] transition hover:bg-rose-50 hover:text-rose-700"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>

                      {s.searchMatches && s.searchMatches.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-2 pl-12">
                          {s.searchMatches.map((m, idx) => (
                            <Link
                              key={idx}
                              href={
                                m.startSec !== null
                                  ? `/sermon/${s.id}?t=${m.startSec}`
                                  : `/sermon/${s.id}?tab=${m.kind}`
                              }
                              className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-[#D5E1E6] bg-[#FAFBFD] px-2.5 py-1 text-[11px] text-[#4E6470] transition hover:border-[#002A3C] hover:text-[#0D1F28]"
                            >
                              <span className="shrink-0 rounded bg-[#EBF4F7] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#002A3C]">
                                {m.startSec !== null ? `▶ ${formatSeekTime(m.startSec)}` : m.kind}
                              </span>
                              <span className="truncate">{m.snippet}</span>
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <NewSermonModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onlyKind={modalKind}
        attachToSermonId={attachId}
        onCreated={(id) => router.push(`/sermon/${id}`)}
      />

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Delete sermon?"
        description={
          deleteTarget
            ? `Permanently delete "${deleteTarget.title}", its audio/video files, generated notes, and clips?`
            : ""
        }
        confirmLabel="Delete sermon"
        variant="danger"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </AuthenticatedShell>
  );
}
