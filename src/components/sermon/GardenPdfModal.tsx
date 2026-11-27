"use client";

import React, { useState } from "react";
import { FileDown, Loader2, X } from "lucide-react";
import { useToast } from "@/components/ui/ToastProvider";

interface GardenPdfModalProps {
  open: boolean;
  sermonId: string;
  sermonTitle: string;
  assets: Record<string, string>;
  onClose: () => void;
}

const PDF_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "overview", label: "Sermon Summary" },
  { key: "points", label: "Key Sermon Points" },
  { key: "scripture", label: "Scripture References" },
  { key: "quotes", label: "Notable Quotes" },
  { key: "discussion_questions", label: "Discussion Questions" },
  { key: "small_group_guide", label: "Small Group Leader Guide" },
  { key: "devotional", label: "5-Day Devotional Plan" },
];

export function GardenPdfModal({
  open,
  sermonId,
  sermonTitle,
  assets,
  onClose,
}: GardenPdfModalProps) {
  const { error: toastError } = useToast();
  const [selected, setSelected] = useState<string[]>([
    "overview",
    "points",
    "scripture",
    "discussion_questions",
  ]);
  const [docTitle, setDocTitle] = useState("Sermon Notes & Discussion Guide");
  const [includeNoteLines, setIncludeNoteLines] = useState(true);
  const [exporting, setExporting] = useState(false);

  if (!open) return null;

  const toggleKey = (key: string) => {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleDownload = async () => {
    const sections = PDF_OPTIONS.filter((opt) => selected.includes(opt.key) && assets[opt.key]?.trim()).map(
      (opt) => ({
        assetType: opt.key,
        title: opt.label,
        content: assets[opt.key],
      })
    );
    if (sections.length === 0) {
      toastError("Select at least one non-empty resource to export.");
      return;
    }

    setExporting(true);
    try {
      const res = await fetch(`/api/sermons/${sermonId}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentTitle: docTitle.trim() || "Sermon Notes & Discussion Guide",
          sections,
          includeNoteLines,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "PDF generation failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const slug =
        sermonTitle
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "") || "sermon";
      a.href = url;
      a.download = `${slug}-garden-church.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      onClose();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not export PDF.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/35 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="garden-pdf-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[520px] rounded-2xl border border-[#E5EAEF] bg-white p-6 shadow-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[#EDF1F4] pb-4">
          <div className="flex items-center gap-3">
            <img
              src="/brand/garden/logo-mark-dark.png"
              alt="The Garden Church"
              className="h-7 w-7 object-contain"
            />
            <div>
              <h2 id="garden-pdf-modal-title" className="text-base font-semibold text-[#0D1F28]">
                Garden Church PDF Packet
              </h2>
              <p className="text-xs text-[#4E6470]">
                Formatted with official Garden Church Yankee fonts and branding.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close PDF modal"
            className="rounded-lg p-1 text-[#70848F] hover:bg-[#F3F5F7] hover:text-[#0D1F28]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="pdf-doc-title" className="mb-1.5 block text-xs font-medium text-[#4E6470]">
              PDF Header Subtitle
            </label>
            <input
              id="pdf-doc-title"
              type="text"
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2 text-sm text-[#0D1F28] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
            />
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-[#4E6470]">Include sections (uses your latest edits)</p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {PDF_OPTIONS.map((opt) => {
                const available = Boolean(assets[opt.key]?.trim());
                const checked = selected.includes(opt.key);
                return (
                  <label
                    key={opt.key}
                    className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-xs transition ${
                      available
                        ? checked
                          ? "cursor-pointer border-[#1D3519] bg-[#F4F2E6]/70 font-medium text-[#1D3519]"
                          : "cursor-pointer border-[#E5EAEF] bg-white text-[#0D1F28] hover:bg-[#FAFBFD]"
                        : "cursor-not-allowed border-[#EDF1F4] bg-[#F7F8FA] text-[#9EB0BA]"
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={!available}
                      checked={checked && available}
                      onChange={() => toggleKey(opt.key)}
                      className="accent-[#1D3519]"
                    />
                    <span className="truncate">{opt.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-[#EDF1F4] bg-[#FAFBFD] px-3.5 py-2.5 text-xs text-[#0D1F28]">
            <span>Add lined space at the bottom for handwritten notes</span>
            <input
              type="checkbox"
              checked={includeNoteLines}
              onChange={(e) => setIncludeNoteLines(e.target.checked)}
              className="h-4 w-4 accent-[#1D3519]"
            />
          </label>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#D5E1E6] bg-white px-4 py-2 text-xs font-medium text-[#0D1F28] hover:bg-[#F3F5F7]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={exporting}
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#1D3519] px-5 py-2 text-xs font-medium text-white hover:bg-[#274622] disabled:opacity-60"
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <FileDown className="h-3.5 w-3.5 text-[#BDD630]" aria-hidden="true" />
            )}
            Download Garden PDF
          </button>
        </div>
      </div>
    </div>
  );
}
