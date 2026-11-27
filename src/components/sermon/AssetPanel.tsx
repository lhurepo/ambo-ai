"use client";

import React, { useState } from "react";
import {
  Check,
  Copy,
  Download,
  Edit3,
  FileDown,
  FolderOpen,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { MarkdownView } from "@/components/ui/MarkdownView";
import { useToast } from "@/components/ui/ToastProvider";
import { copyToClipboard } from "@/lib/clipboard";
import {
  fetchExportPreferences,
  revealPathInFinder,
  saveBlobWithMode,
} from "@/lib/client-download";
import type { AssetType } from "@/lib/types";

interface AssetPanelProps {
  sermonId: string;
  assetType: AssetType;
  title: string;
  content: string;
  onUpdated: (assetType: AssetType, newContent: string) => void;
  extraHeader?: React.ReactNode;
}

export function AssetPanel({
  sermonId,
  assetType,
  title,
  content,
  onUpdated,
  extraHeader,
}: AssetPanelProps) {
  const { success, error: toastError } = useToast();
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [showCustomPrompt, setShowCustomPrompt] = useState(false);
  const [customInstruction, setCustomInstruction] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [savedNotice, setSavedNotice] = useState<{ savedPath: string; displayPath: string } | null>(
    null
  );

  // Saved permanent prompt rule editor
  const [showDefaultRule, setShowDefaultRule] = useState(false);
  const [ruleText, setRuleText] = useState("");
  const [ruleLoadedKey, setRuleLoadedKey] = useState<string | null>(null);
  const [ruleIsCustom, setRuleIsCustom] = useState(false);
  const [savingRule, setSavingRule] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(content || "");
    if (ok) {
      setCopied(true);
      success("Copied to clipboard.");
      setTimeout(() => setCopied(false), 1800);
    } else {
      toastError("Clipboard access was blocked by the browser.");
    }
  };

  const handleDownloadMd = async () => {
    setSavedNotice(null);
    const mdText = `# ${title}\n\n${content}`;
    const prefs = await fetchExportPreferences();
    if (prefs.exportMode === "folder" && prefs.pdfExportDir) {
      const res = await fetch("/api/system/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_markdown",
          fileName: `${assetType}.md`,
          content: mdText,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setSavedNotice({ savedPath: data.savedPath, displayPath: data.displayPath });
      } else {
        toastError(data.error || "Could not save Markdown file.");
      }
      return;
    }

    const blob = new Blob([mdText], { type: "text/markdown;charset=utf-8" });
    await saveBlobWithMode({
      blob,
      fileName: `${assetType}.md`,
      mimeType: "text/markdown",
      exportMode: prefs.exportMode,
    });
  };

  const handleExportGardenPdf = async () => {
    const activeText = editing ? draft : content;
    if (!activeText?.trim()) {
      toastError("Nothing to export yet.");
      return;
    }
    setExportingPdf(true);
    setSavedNotice(null);
    try {
      const prefs = await fetchExportPreferences();
      const saveToDisk = prefs.exportMode === "folder" && Boolean(prefs.pdfExportDir);

      const res = await fetch(`/api/sermons/${sermonId}/pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentTitle: `${title} — The Garden Church`,
          sections: [{ assetType, title, content: activeText }],
          includeNoteLines: false,
          saveToDisk,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "PDF export failed");
      }
      if (saveToDisk) {
        const saved = await res.json();
        setSavedNotice({ savedPath: saved.savedPath, displayPath: saved.displayPath });
        return;
      }
      const blob = await res.blob();
      await saveBlobWithMode({
        blob,
        fileName: `${assetType}-garden-church.pdf`,
        mimeType: "application/pdf",
        exportMode: prefs.exportMode,
      });
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not export PDF.");
    } finally {
      setExportingPdf(false);
    }
  };

  const toggleDefaultRule = async () => {
    const next = !showDefaultRule;
    setShowDefaultRule(next);
    if (next && ruleLoadedKey !== assetType) {
      const res = await fetch("/api/prompts/generation");
      if (res.ok) {
        const d = await res.json();
        const found = (d.prompts || []).find((p: { key: string }) => p.key === assetType);
        if (found) {
          setRuleText(found.promptText);
          setRuleIsCustom(Boolean(found.isCustom));
          setRuleLoadedKey(assetType);
        }
      }
    }
  };

  const handleSaveRule = async () => {
    if (!ruleText.trim()) return;
    setSavingRule(true);
    try {
      const res = await fetch("/api/prompts/generation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetType, promptText: ruleText.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Failed to save prompt rule");
      }
      setRuleIsCustom(true);
      success("Default generation prompt saved for all future runs.");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not save rule.");
    } finally {
      setSavingRule(false);
    }
  };

  const handleResetRule = async () => {
    setSavingRule(true);
    try {
      await fetch(`/api/prompts/generation?assetType=${encodeURIComponent(assetType)}`, {
        method: "DELETE",
      });
      const res = await fetch("/api/prompts/generation");
      if (res.ok) {
        const d = await res.json();
        const found = (d.prompts || []).find((p: { key: string }) => p.key === assetType);
        if (found) {
          setRuleText(found.promptText);
          setRuleIsCustom(false);
        }
      }
      success("Reset to default prompt.");
    } finally {
      setSavingRule(false);
    }
  };

  const handleRegenerate = async (withInstruction?: string) => {
    setRegenerating(true);
    try {
      const res = await fetch(`/api/sermons/${sermonId}/assets/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetType, customInstruction: withInstruction }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Regeneration failed");
      if (typeof data.content === "string") {
        onUpdated(assetType, data.content);
        setDraft(data.content);
        setShowCustomPrompt(false);
        setCustomInstruction("");
        success("Resource regenerated.");
      }
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not regenerate.");
    } finally {
      setRegenerating(false);
    }
  };

  const handleSaveManual = async () => {
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/sermons/${sermonId}/assets/regenerate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetType, manualContent: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save edits");
      onUpdated(assetType, data.content);
      setEditing(false);
      success("Edits saved.");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSavingEdit(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[#E5EAEF] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#EDF1F4] pb-3.5">
        <h3 className="text-base font-semibold text-[#0D1F28]">{title}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-3 py-1.5 text-xs font-medium text-[#0D1F28] transition hover:bg-[#F3F5F7]"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-[#4E6470]" aria-hidden="true" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>

          <button
            type="button"
            onClick={handleDownloadMd}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-3 py-1.5 text-xs font-medium text-[#0D1F28] transition hover:bg-[#F3F5F7]"
          >
            <Download className="h-3.5 w-3.5 text-[#4E6470]" aria-hidden="true" />
            .md
          </button>

          <button
            type="button"
            disabled={exportingPdf}
            onClick={handleExportGardenPdf}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#1D3519] px-3 py-1.5 text-xs font-medium text-white transition hover:bg-[#274622] disabled:opacity-60"
          >
            {exportingPdf ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <FileDown className="h-3.5 w-3.5 text-[#BDD630]" aria-hidden="true" />
            )}
            Garden PDF
          </button>

          <button
            type="button"
            onClick={() => {
              setDraft(content);
              setEditing((v) => !v);
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-3 py-1.5 text-xs font-medium text-[#0D1F28] transition hover:bg-[#F3F5F7]"
          >
            {editing ? (
              <X className="h-3.5 w-3.5 text-[#4E6470]" aria-hidden="true" />
            ) : (
              <Edit3 className="h-3.5 w-3.5 text-[#4E6470]" aria-hidden="true" />
            )}
            {editing ? "Cancel" : "Edit"}
          </button>

          <button
            type="button"
            onClick={toggleDefaultRule}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
              showDefaultRule
                ? "border-[#002A3C] bg-[#F3F5F7] text-[#002A3C]"
                : "border-[#D5E1E6] bg-white text-[#4E6470] hover:bg-[#F3F5F7] hover:text-[#0D1F28]"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            Prompt rule
          </button>

          <button
            type="button"
            disabled={regenerating}
            onClick={() => setShowCustomPrompt((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-[#EBF4F7] px-3 py-1.5 text-xs font-medium text-[#002A3C] transition hover:bg-[#DDECF1] disabled:opacity-60"
          >
            {regenerating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Regenerate
          </button>
        </div>
      </div>

      {showDefaultRule && (
        <div className="mt-3 space-y-2.5 rounded-xl border border-[#D5E1E6] bg-[#FAFBFD] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#0D1F28]">
              Always use this prompt rule for {title}
              {ruleIsCustom && (
                <span className="ml-2 rounded-full bg-[#EBF4F7] px-2 py-0.5 text-[10px] font-medium text-[#002A3C]">
                  Custom
                </span>
              )}
            </span>
            {ruleIsCustom && (
              <button
                type="button"
                disabled={savingRule}
                onClick={handleResetRule}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4E6470] hover:text-[#0D1F28]"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                Reset default
              </button>
            )}
          </div>
          <textarea
            value={ruleText}
            onChange={(e) => setRuleText(e.target.value)}
            rows={3}
            aria-label={`Default generation prompt for ${title}`}
            className="w-full rounded-xl border border-[#D5E1E6] bg-white p-2.5 text-xs text-[#0D1F28] focus:outline-none"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={savingRule}
              onClick={handleSaveRule}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#002A3C] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#0B435B] disabled:opacity-60"
            >
              <Save className="h-3 w-3" aria-hidden="true" />
              Save default rule
            </button>
          </div>
        </div>
      )}

      {showCustomPrompt && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-[#E5EAEF] bg-[#F7F8FA] p-3 sm:flex-row">
          <input
            type="text"
            value={customInstruction}
            onChange={(e) => setCustomInstruction(e.target.value)}
            placeholder="Optional one-off tweak for this regeneration..."
            aria-label="Regeneration instruction"
            className="flex-1 rounded-xl border border-[#D5E1E6] bg-white px-3 py-1.5 text-xs text-[#0D1F28] placeholder-[#70848F] focus:outline-none"
          />
          <button
            type="button"
            disabled={regenerating}
            onClick={() => handleRegenerate(customInstruction.trim() || undefined)}
            className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#002A3C] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#0B435B] disabled:opacity-60"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Run
          </button>
        </div>
      )}

      {savedNotice && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#D5E1E6] bg-[#F4F2E6]/70 px-3.5 py-2 text-xs text-[#1D3519]">
          <span className="inline-flex items-center gap-1.5 font-medium">
            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Saved to <code className="font-mono">{savedNotice.displayPath}</code>
          </span>
          <button
            type="button"
            onClick={() => void revealPathInFinder(savedNotice.savedPath)}
            className="inline-flex items-center gap-1 rounded-full border border-[#D5E1E6] bg-white px-2.5 py-1 text-[11px] font-medium text-[#0D1F28] hover:bg-[#F3F5F7]"
          >
            <FolderOpen className="h-3 w-3" aria-hidden="true" />
            Show in Finder
          </button>
        </div>
      )}

      {extraHeader && <div className="mt-4">{extraHeader}</div>}

      <div className="mt-4">
        {editing ? (
          <div className="space-y-3">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={14}
              aria-label={`Edit ${title}`}
              className="w-full rounded-xl border border-[#D5E1E6] bg-[#FAFBFD] p-3.5 font-mono text-xs text-[#0D1F28] focus:bg-white focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={savingEdit}
                onClick={handleSaveManual}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#002A3C] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#0B435B] disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" aria-hidden="true" />
                Save edits
              </button>
            </div>
          </div>
        ) : content ? (
          <MarkdownView content={content} />
        ) : (
          <p className="text-sm text-[#70848F]">Generating...</p>
        )}
      </div>
    </div>
  );
}
