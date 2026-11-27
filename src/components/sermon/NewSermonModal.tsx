"use client";

import React, { useRef, useState } from "react";
import { FileText, Film, Link2, Loader2, Upload, X } from "lucide-react";
import { useToast } from "@/components/ui/ToastProvider";

interface NewSermonModalProps {
  open: boolean;
  onClose: () => void;
  attachToSermonId?: string | null;
  onlyKind?: "media" | "manuscript" | null;
  onCreated: (sermonId: string) => void;
}

export function NewSermonModal({
  open,
  onClose,
  attachToSermonId = null,
  onlyKind = null,
  onCreated,
}: NewSermonModalProps) {
  const { success, error: toastError } = useToast();
  const manuscriptInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [uploadingKind, setUploadingKind] = useState<
    "media" | "manuscript" | "youtube" | "sample" | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleUpload = async (file: File, kind: "media" | "manuscript") => {
    setError(null);
    setUploadingKind(kind);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", kind);
      if (attachToSermonId) fd.append("sermonId", attachToSermonId);
      if (title.trim()) fd.append("title", title.trim());

      const res = await fetch("/api/sermons", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");
      success("Sermon uploaded — processing started.");
      onCreated(data.sermonId);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toastError(msg);
    } finally {
      setUploadingKind(null);
    }
  };

  const handleYoutubeImport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!youtubeUrl.trim()) return;
    setError(null);
    setUploadingKind("youtube");
    try {
      const res = await fetch("/api/sermons/youtube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          youtubeUrl: youtubeUrl.trim(),
          title: title.trim() || undefined,
          sermonId: attachToSermonId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "YouTube import failed");
      success("YouTube import started — transcribing audio shortly.");
      setYoutubeUrl("");
      onCreated(data.sermonId);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toastError(msg);
    } finally {
      setUploadingKind(null);
    }
  };

  const handleSample = async () => {
    setError(null);
    setUploadingKind("sample");
    try {
      const res = await fetch("/api/sermons/sample", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create sample sermon");
      success("Sample sermon created.");
      onCreated(data.sermonId);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toastError(msg);
    } finally {
      setUploadingKind(null);
    }
  };

  const modalTitle = attachToSermonId
    ? onlyKind === "media"
      ? "Attach audio, video, or YouTube link"
      : "Attach manuscript"
    : "Add a sermon";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-sermon-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[620px] rounded-2xl border border-[#E5EAEF] bg-white p-6 shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h2 id="new-sermon-modal-title" className="text-lg font-semibold text-[#0D1F28]">
            {modalTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="rounded-lg p-1.5 text-[#4E6470] transition hover:bg-[#F3F5F7] hover:text-[#0D1F28]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {!attachToSermonId && (
          <div className="mb-4">
            <label htmlFor="sermon-title-input" className="mb-1.5 block text-xs font-medium text-[#4E6470]">
              Title (optional)
            </label>
            <input
              id="sermon-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Defaults to YouTube or file title"
              className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2 text-sm text-[#0D1F28] placeholder-[#70848F] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
            />
          </div>
        )}

        {(!onlyKind || onlyKind === "media") && (
          <form
            onSubmit={handleYoutubeImport}
            className="mb-4 rounded-2xl border border-[#E5EAEF] bg-[#FAFBFD] p-4"
          >
            <label htmlFor="youtube-url-input" className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-[#0D1F28]">
              <Link2 className="h-3.5 w-3.5 text-[#1D3519]" aria-hidden="true" />
              Import from YouTube link
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="youtube-url-input"
                type="url"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="flex-1 rounded-xl border border-[#E5EAEF] bg-white px-3.5 py-2 text-xs text-[#0D1F28] placeholder-[#70848F] focus:border-[#002A3C] focus:outline-none"
              />
              <button
                type="submit"
                disabled={uploadingKind !== null || !youtubeUrl.trim()}
                className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#002A3C] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#0B435B] disabled:opacity-55"
              >
                {uploadingKind === "youtube" && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                )}
                Import YouTube
              </button>
            </div>
          </form>
        )}

        <div
          className={`grid gap-4 rounded-2xl border border-dashed border-[#D5E1E6] bg-[#FAFBFD] p-5 ${
            onlyKind ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"
          }`}
        >
          {(!onlyKind || onlyKind === "manuscript") && (
            <div className="flex flex-col items-center rounded-xl border border-[#EDF1F4] bg-white p-5 text-center">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#EBF4F7] text-[#002A3C]">
                <FileText className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="text-sm font-semibold text-[#0D1F28]">Text file</p>
              <p className="mt-1 text-xs text-[#4E6470]">TXT, PDF, DOCX, PPTX</p>
              <input
                ref={manuscriptInputRef}
                type="file"
                accept=".txt,.md,.pdf,.docx,.doc,.pptx"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUpload(file, "manuscript");
                }}
              />
              <button
                type="button"
                disabled={uploadingKind !== null}
                onClick={() => manuscriptInputRef.current?.click()}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-4 py-1.5 text-xs font-medium text-[#0D1F28] transition hover:bg-[#F3F5F7] disabled:opacity-60"
              >
                {uploadingKind === "manuscript" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Upload manuscript
              </button>
            </div>
          )}

          {(!onlyKind || onlyKind === "media") && (
            <div className="flex flex-col items-center rounded-xl border border-[#EDF1F4] bg-white p-5 text-center">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[#EBF4F7] text-[#002A3C]">
                <Film className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="text-sm font-semibold text-[#0D1F28]">Audio or video</p>
              <p className="mt-1 text-xs text-[#4E6470]">MP4, MOV, MP3, WAV, M4A</p>
              <input
                ref={mediaInputRef}
                type="file"
                accept="audio/*,video/*,.mp4,.mov,.mkv,.webm,.mp3,.wav,.m4a"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleUpload(file, "media");
                }}
              />
              <button
                type="button"
                disabled={uploadingKind !== null}
                onClick={() => mediaInputRef.current?.click()}
                className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-4 py-1.5 text-xs font-medium text-[#0D1F28] transition hover:bg-[#F3F5F7] disabled:opacity-60"
              >
                {uploadingKind === "media" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Upload media
              </button>
            </div>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700" role="alert">
            {error}
          </p>
        )}

        {!attachToSermonId && (
          <div className="mt-4 flex items-center justify-end">
            <button
              type="button"
              disabled={uploadingKind !== null}
              onClick={handleSample}
              className="text-xs font-medium text-[#4E6470] transition hover:text-[#002A3C] disabled:opacity-60"
            >
              {uploadingKind === "sample" ? "Creating sample sermon..." : "Try a sample sermon"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
