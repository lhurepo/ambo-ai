"use client";

import React, { useEffect, useState } from "react";
import {
  Check,
  FileDown,
  FolderOpen,
  Loader2,
  Palette,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import { useToast } from "@/components/ui/ToastProvider";
import {
  fetchExportPreferences,
  revealPathInFinder,
  saveBlobWithMode,
} from "@/lib/client-download";
import {
  DEFAULT_PDF_DESIGN,
  PDF_COLOR_THEMES,
  type PdfDensity,
  type PdfDesignSpec,
  type PdfFontPairing,
  type PdfHeaderStyle,
} from "@/lib/types";

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

const PROVIDER_LABELS: Record<string, string> = {
  claude_cli: "Claude (Logged In)",
  gemini: "Google Gemini",
  ollama: "Local Ollama",
  groq: "Groq",
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic API",
  custom: "Custom AI",
  offline: "Offline Engine",
};

export function GardenPdfModal({
  open,
  sermonId,
  sermonTitle,
  assets,
  onClose,
}: GardenPdfModalProps) {
  const { success, error: toastError } = useToast();
  const [tab, setTab] = useState<"sections" | "style" | "prompt">("sections");
  const [selected, setSelected] = useState<string[]>([
    "overview",
    "points",
    "scripture",
    "discussion_questions",
  ]);
  const [docTitle, setDocTitle] = useState("Sermon Notes & Discussion Guide");
  const [includeNoteLines, setIncludeNoteLines] = useState(true);
  const [design, setDesign] = useState<PdfDesignSpec>(DEFAULT_PDF_DESIGN);
  const [pdfPrompt, setPdfPrompt] = useState("");
  const [customInstruction, setCustomInstruction] = useState("");
  const [activeProvider, setActiveProvider] = useState("offline");
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [savedNotice, setSavedNotice] = useState<{ savedPath: string; displayPath: string } | null>(
    null
  );

  useEffect(() => {
    if (!open) return;
    setSavedNotice(null);
    Promise.all([
      fetch("/api/settings/ai").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/prompts/generation").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([sData, pData]) => {
        if (sData?.settings) {
          setActiveProvider(sData.settings.llmProvider || "offline");
          if (sData.settings.defaultPdfDesign) {
            setDesign({
              ...DEFAULT_PDF_DESIGN,
              ...sData.settings.defaultPdfDesign,
              palette: {
                ...DEFAULT_PDF_DESIGN.palette,
                ...(sData.settings.defaultPdfDesign.palette || {}),
              },
            });
          }
        }
        const found = (pData?.prompts || []).find(
          (p: { key: string; promptText?: string }) => p.key === "pdf_design"
        );
        if (found?.promptText) {
          setPdfPrompt(found.promptText);
        }
      })
      .catch(() => {});
  }, [open]);

  if (!open) return null;

  const toggleKey = (key: string) => {
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleSaveDefaultPrompt = async () => {
    if (!pdfPrompt.trim()) return;
    setSavingPrompt(true);
    try {
      const res = await fetch("/api/prompts/generation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetType: "pdf_design", promptText: pdfPrompt.trim() }),
      });
      if (!res.ok) throw new Error("Could not save PDF prompt.");
      success("Default PDF design prompt saved.");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSavingPrompt(false);
    }
  };

  const handleDownload = async () => {
    const sections = PDF_OPTIONS.filter(
      (opt) => selected.includes(opt.key) && assets[opt.key]?.trim()
    ).map((opt) => ({
      assetType: opt.key,
      title: opt.label,
      content: assets[opt.key],
    }));

    if (sections.length === 0) {
      toastError("Select at least one non-empty resource to export.");
      return;
    }

    setExporting(true);
    setSavedNotice(null);
    try {
      const prefs = await fetchExportPreferences();
      const saveToDisk = prefs.exportMode === "folder" && Boolean(prefs.pdfExportDir);

      const res = await fetch(`/api/sermons/${sermonId}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentTitle: docTitle.trim() || "Sermon Notes & Discussion Guide",
          sections,
          includeNoteLines,
          design,
          pdfPrompt: pdfPrompt.trim(),
          customInstruction: customInstruction.trim() || undefined,
          saveToDisk,
        }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "PDF generation failed");
      }

      if (saveToDisk) {
        const saved = await res.json();
        setSavedNotice({ savedPath: saved.savedPath, displayPath: saved.displayPath });
        return;
      }

      const blob = await res.blob();
      const slug =
        sermonTitle
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "") || "sermon";

      await saveBlobWithMode({
        blob,
        fileName: `${slug}-garden-church.pdf`,
        mimeType: "application/pdf",
        exportMode: prefs.exportMode,
      });
      onClose();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not export PDF.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="garden-pdf-modal-title"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-[600px] flex-col rounded-2xl border border-[#E5EAEF] bg-white p-6 shadow-md"
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
                Customize sections, layout, fonts, or let {PROVIDER_LABELS[activeProvider] || activeProvider} format the design.
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

        {/* 3 Intuitive Tabs */}
        <div className="mt-4 grid grid-cols-3 gap-1 rounded-full bg-[#F3F5F7] p-1 text-xs font-medium">
          <button
            type="button"
            onClick={() => setTab("sections")}
            className={`rounded-full py-1.5 transition ${
              tab === "sections"
                ? "bg-white text-[#0D1F28] shadow-sm"
                : "text-[#4E6470] hover:text-[#0D1F28]"
            }`}
          >
            1. Content
          </button>
          <button
            type="button"
            onClick={() => setTab("style")}
            className={`inline-flex items-center justify-center gap-1.5 rounded-full py-1.5 transition ${
              tab === "style"
                ? "bg-white text-[#0D1F28] shadow-sm"
                : "text-[#4E6470] hover:text-[#0D1F28]"
            }`}
          >
            <Palette className="h-3.5 w-3.5" aria-hidden="true" />
            2. Style &amp; Layout
          </button>
          <button
            type="button"
            onClick={() => setTab("prompt")}
            className={`inline-flex items-center justify-center gap-1.5 rounded-full py-1.5 transition ${
              tab === "prompt"
                ? "bg-white text-[#0D1F28] shadow-sm"
                : "text-[#4E6470] hover:text-[#0D1F28]"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            3. AI Prompt
          </button>
        </div>

        <div className="mt-4 flex-1 space-y-4 overflow-y-auto pr-1">
          {tab === "sections" && (
            <>
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
                <p className="mb-2 text-xs font-medium text-[#4E6470]">
                  Include sections (uses your latest edits)
                </p>
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
            </>
          )}

          {tab === "style" && (
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs font-medium text-[#4E6470]">Header layout</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(
                    [
                      { id: "banner", label: "Full Banner" },
                      { id: "minimal", label: "Ink-Saver" },
                      { id: "boxed", label: "Inset Card" },
                      { id: "centered", label: "Centered" },
                    ] as Array<{ id: PdfHeaderStyle; label: string }>
                  ).map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => setDesign((d) => ({ ...d, headerStyle: h.id }))}
                      className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${
                        design.headerStyle === h.id
                          ? "border-[#1D3519] bg-[#F4F2E6]/70 text-[#1D3519]"
                          : "border-[#E5EAEF] bg-white text-[#4E6470] hover:bg-[#FAFBFD]"
                      }`}
                    >
                      {h.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="pdf-font-pairing" className="mb-1.5 block text-xs font-medium text-[#4E6470]">
                    Font pairing
                  </label>
                  <select
                    id="pdf-font-pairing"
                    value={design.fontPairing}
                    onChange={(e) =>
                      setDesign((d) => ({ ...d, fontPairing: e.target.value as PdfFontPairing }))
                    }
                    className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3 py-2 text-xs text-[#0D1F28]"
                  >
                    <option value="garden">Garden Sans (Yankee)</option>
                    <option value="editorial">Editorial (Merriweather + Yankee)</option>
                    <option value="classic">Classic Serif (Baskerville)</option>
                    <option value="modern">Modern Clean (Plus Jakarta Sans)</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="pdf-density" className="mb-1.5 block text-xs font-medium text-[#4E6470]">
                    Spacing &amp; size
                  </label>
                  <select
                    id="pdf-density"
                    value={design.density}
                    onChange={(e) =>
                      setDesign((d) => ({ ...d, density: e.target.value as PdfDensity }))
                    }
                    className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3 py-2 text-xs text-[#0D1F28]"
                  >
                    <option value="compact">Compact (Fits more per page)</option>
                    <option value="comfortable">Balanced (Default)</option>
                    <option value="spacious">Large Print (Easier reading)</option>
                  </select>
                </div>
              </div>

              <div>
                <p className="mb-1.5 text-xs font-medium text-[#4E6470]">Color palette</p>
                <div className="grid grid-cols-2 gap-2">
                  {PDF_COLOR_THEMES.map((theme) => {
                    const active =
                      design.palette.primaryHex === theme.palette.primaryHex &&
                      design.palette.headerBgHex === theme.palette.headerBgHex;
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() =>
                          setDesign((d) => ({ ...d, palette: { ...theme.palette } }))
                        }
                        className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-xs transition ${
                          active
                            ? "border-[#1D3519] bg-[#F4F2E6]/70 font-medium text-[#1D3519]"
                            : "border-[#E5EAEF] bg-white text-[#0D1F28] hover:bg-[#FAFBFD]"
                        }`}
                      >
                        <span className="flex shrink-0 items-center gap-1">
                          <span
                            className="h-3.5 w-3.5 rounded-full border border-black/10"
                            style={{ backgroundColor: theme.palette.headerBgHex }}
                          />
                          <span
                            className="h-3.5 w-3.5 rounded-full border border-black/10"
                            style={{ backgroundColor: theme.palette.accentHex }}
                          />
                        </span>
                        <span className="truncate">{theme.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                {(
                  [
                    { key: "showLogo", label: "Show church logo" },
                    { key: "showMetadata", label: "Show speaker & date" },
                    { key: "showBadgeNumbers", label: "Numbered circles" },
                    { key: "uppercaseHeadings", label: "Uppercase headings" },
                  ] as const
                ).map((tog) => (
                  <label
                    key={tog.key}
                    className="flex cursor-pointer items-center justify-between rounded-xl border border-[#EDF1F4] bg-[#FAFBFD] px-3 py-2 text-[#0D1F28]"
                  >
                    <span>{tog.label}</span>
                    <input
                      type="checkbox"
                      checked={design[tog.key]}
                      onChange={(e) =>
                        setDesign((d) => ({ ...d, [tog.key]: e.target.checked }))
                      }
                      className="h-4 w-4 accent-[#1D3519]"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}

          {tab === "prompt" && (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-[#D5E1E6] bg-[#FAFBFD] px-4 py-3">
                <div>
                  <p className="text-xs font-semibold text-[#0D1F28]">
                    Let {PROVIDER_LABELS[activeProvider] || activeProvider} customize this PDF&apos;s layout
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#4E6470]">
                    {activeProvider === "offline"
                      ? "Sign in with `claude auth login` or pick an AI provider in Settings to enable AI layout editing."
                      : "Uses your connected AI account to adjust formatting, callouts, and visual hierarchy."}
                  </p>
                </div>
                <input
                  type="checkbox"
                  disabled={activeProvider === "offline"}
                  checked={design.useAiDesigner && activeProvider !== "offline"}
                  aria-label="Enable AI PDF designer"
                  onChange={(e) =>
                    setDesign((d) => ({ ...d, useAiDesigner: e.target.checked }))
                  }
                  className="h-4 w-4 shrink-0 accent-[#1D3519]"
                />
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="pdf-ai-prompt" className="text-xs font-medium text-[#4E6470]">
                    PDF Design Prompt (links directly to your AI provider)
                  </label>
                  <button
                    type="button"
                    disabled={savingPrompt || !pdfPrompt.trim()}
                    onClick={handleSaveDefaultPrompt}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#002A3C] hover:underline disabled:opacity-50"
                  >
                    <Save className="h-3 w-3" aria-hidden="true" />
                    {savingPrompt ? "Saving..." : "Save as default"}
                  </button>
                </div>
                <textarea
                  id="pdf-ai-prompt"
                  rows={5}
                  value={pdfPrompt}
                  onChange={(e) => setPdfPrompt(e.target.value)}
                  placeholder="Describe how you want Claude / your AI to format and design the PDF..."
                  className="w-full rounded-xl border border-transparent bg-[#F3F5F7] p-3 text-xs leading-relaxed text-[#0D1F28] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                />
              </div>

              <div>
                <label
                  htmlFor="pdf-one-off-tweak"
                  className="mb-1.5 block text-xs font-medium text-[#4E6470]"
                >
                  Quick one-time tweak for this PDF (optional)
                </label>
                <input
                  id="pdf-one-off-tweak"
                  type="text"
                  value={customInstruction}
                  onChange={(e) => setCustomInstruction(e.target.value)}
                  placeholder="e.g. Use minimal ink-saver header and add a closing prayer callout box"
                  className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2 text-xs text-[#0D1F28] placeholder-[#70848F] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                />
              </div>
            </div>
          )}

          {savedNotice && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#D5E1E6] bg-[#F4F2E6]/70 px-3.5 py-2.5 text-xs text-[#1D3519]">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Saved to <code className="font-mono">{savedNotice.displayPath}</code>
              </span>
              <button
                type="button"
                onClick={() => void revealPathInFinder(savedNotice.savedPath)}
                className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-medium text-[#0D1F28] border border-[#D5E1E6] hover:bg-[#F3F5F7]"
              >
                <FolderOpen className="h-3 w-3" aria-hidden="true" />
                Show in Finder
              </button>
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2 border-t border-[#EDF1F4] pt-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-[#D5E1E6] bg-white px-4 py-2 text-xs font-medium text-[#0D1F28] hover:bg-[#F3F5F7]"
          >
            Close
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
            {design.useAiDesigner && activeProvider !== "offline"
              ? "Design & Export PDF"
              : "Export Garden PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
