"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  FileText,
  FolderOpen,
  HardDriveDownload,
  Loader2,
  Monitor,
  Moon,
  Palette,
  RefreshCw,
  Save,
  Sliders,
  Sparkles,
  Sun,
  Terminal,
} from "lucide-react";
import { AuthenticatedShell } from "@/components/layout/AuthenticatedShell";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useTheme, type ThemeMode } from "@/components/ui/ThemeProvider";
import { useToast } from "@/components/ui/ToastProvider";
import {
  DEFAULT_CAPTION_SETTINGS,
  DEFAULT_PDF_DESIGN,
  FONT_OPTIONS,
  OVERLAY_COLOR_THEMES,
  PDF_COLOR_THEMES,
  type CaptionSettings,
  type ExportMode,
  type LlmProvider,
  type PdfDensity,
  type PdfDesignSpec,
  type PdfFontPairing,
  type PdfHeaderStyle,
} from "@/lib/types";

interface ProviderMeta {
  label: string;
  baseUrl: string;
  defaultModel: string;
  freeTierNote: string;
}

interface HealthInfo {
  platform?: string;
  health?: {
    claudeCli: { installed: boolean; loggedIn: boolean; email: string | null; message: string };
    ffmpeg: { installed: boolean; libass: boolean };
    whisper: { ready: boolean };
    database: { ready: boolean };
  };
}

const PROVIDER_ORDER: LlmProvider[] = [
  "claude_cli",
  "gemini",
  "ollama",
  "groq",
  "openrouter",
  "offline",
  "openai",
  "anthropic",
  "custom",
];

type SettingsTab = "general" | "downloads" | "design" | "ai";

export default function SettingsPage() {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const { mode: themeMode, setThemeMode } = useTheme();

  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  // General
  const [defaultSpeaker, setDefaultSpeaker] = useState("");
  const [healthInfo, setHealthInfo] = useState<HealthInfo | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  // Downloads & Folders
  const [exportMode, setExportMode] = useState<ExportMode>("browser");
  const [pdfExportDir, setPdfExportDir] = useState("");
  const [mediaExportDir, setMediaExportDir] = useState("");
  const [pickingFor, setPickingFor] = useState<"pdf" | "media" | null>(null);

  // PDF & Video Defaults
  const [pdfDesign, setPdfDesign] = useState<PdfDesignSpec>(DEFAULT_PDF_DESIGN);
  const [pdfPrompt, setPdfPrompt] = useState("");
  const [captionDefaults, setCaptionDefaults] = useState<CaptionSettings>(
    DEFAULT_CAPTION_SETTINGS
  );

  // AI & Transcription
  const [llmProvider, setLlmProvider] = useState<LlmProvider>("offline");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [apiKeyMasked, setApiKeyMasked] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [whisperModel, setWhisperModel] = useState<"tiny" | "base" | "small" | "medium">("base");
  const [whisperLanguage, setWhisperLanguage] = useState("auto");
  const [providers, setProviders] = useState<Record<string, ProviderMeta>>({});

  const [claudeStatus, setClaudeStatus] = useState<{
    installed: boolean;
    loggedIn: boolean;
    email?: string;
    message: string;
  } | null>(null);
  const [checkingClaude, setCheckingClaude] = useState(false);

  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaRunning, setOllamaRunning] = useState<boolean | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearingKey, setClearingKey] = useState(false);

  const loadHealth = async () => {
    setCheckingHealth(true);
    try {
      const res = await fetch("/api/system/folders", { cache: "no-store" });
      if (res.ok) {
        setHealthInfo(await res.json());
      }
    } finally {
      setCheckingHealth(false);
    }
  };

  useEffect(() => {
    Promise.all([
      fetch("/api/settings/ai").then((r) => {
        if (r.status === 401) {
          router.push("/signin");
          return null;
        }
        return r.json();
      }),
      fetch("/api/prompts/generation").then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([d, pData]) => {
        if (d?.settings) {
          setLlmProvider(d.settings.llmProvider);
          setHasSavedKey(Boolean(d.settings.hasApiKey));
          setApiKeyMasked(d.settings.apiKeyMasked || "");
          setBaseUrl(d.settings.baseUrl || "");
          setModel(d.settings.model || "");
          setWhisperModel(d.settings.whisperModel || "base");
          setWhisperLanguage(d.settings.whisperLanguage || "auto");
          setProviders(d.providers || {});
          setExportMode(d.settings.exportMode || "browser");
          setPdfExportDir(d.settings.pdfExportDir || "");
          setMediaExportDir(d.settings.mediaExportDir || "");
          setDefaultSpeaker(d.settings.defaultSpeaker || "");
          if (d.settings.defaultPdfDesign) {
            setPdfDesign({
              ...DEFAULT_PDF_DESIGN,
              ...d.settings.defaultPdfDesign,
              palette: {
                ...DEFAULT_PDF_DESIGN.palette,
                ...(d.settings.defaultPdfDesign.palette || {}),
              },
            });
          }
          if (d.settings.defaultCaptionSettings) {
            setCaptionDefaults({
              ...DEFAULT_CAPTION_SETTINGS,
              ...d.settings.defaultCaptionSettings,
            });
          }
          if (d.settings.themePreference) {
            setThemeMode(d.settings.themePreference as ThemeMode, false);
          }
        }
        const pdfSlot = (pData?.prompts || []).find(
          (p: { key: string; promptText?: string }) => p.key === "pdf_design"
        );
        if (pdfSlot?.promptText) {
          setPdfPrompt(pdfSlot.promptText);
        }
      })
      .finally(() => setLoading(false));

    void loadHealth();
  }, [router, setThemeMode]);

  const checkClaudeCli = async () => {
    setCheckingClaude(true);
    try {
      const res = await fetch("/api/settings/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "check_claude_cli",
          apiKey: apiKeyInput.trim() || undefined,
        }),
      });
      if (res.ok) {
        setClaudeStatus(await res.json());
      }
    } finally {
      setCheckingClaude(false);
    }
  };

  useEffect(() => {
    if (llmProvider === "claude_cli" && !claudeStatus) {
      void checkClaudeCli();
    }
  }, [llmProvider]);

  const handleSelectProvider = (p: LlmProvider) => {
    setLlmProvider(p);
    const meta = providers[p];
    if (meta) {
      setBaseUrl(meta.baseUrl);
      setModel(meta.defaultModel);
    }
    setTestResult(null);
  };

  const detectOllama = async () => {
    const res = await fetch("/api/settings/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "detect_ollama", baseUrl }),
    });
    const data = await res.json();
    setOllamaRunning(Boolean(data.running));
    setOllamaModels(data.models || []);
    if (data.models?.length > 0 && !model) {
      setModel(data.models[0]);
    }
  };

  const pickFolder = async (target: "pdf" | "media") => {
    setPickingFor(target);
    try {
      const res = await fetch("/api/system/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "pick" }),
      });
      const data = await res.json();
      if (data.cancelled) return;
      if (data.ok && data.path) {
        if (target === "pdf") setPdfExportDir(data.path);
        else setMediaExportDir(data.path);
        setExportMode("folder");
      } else {
        toastError(data.message || data.error || "Could not open folder picker.");
      }
    } finally {
      setPickingFor(null);
    }
  };

  const openFolderInFinder = async (dirPath: string) => {
    if (!dirPath.trim()) return;
    await fetch("/api/system/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reveal", path: dirPath.trim() }),
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const requests: Promise<Response>[] = [
        fetch("/api/settings/ai", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            llmProvider,
            apiKey: apiKeyInput.trim() || undefined,
            baseUrl,
            model,
            whisperModel,
            whisperLanguage,
            exportMode,
            pdfExportDir: pdfExportDir.trim(),
            mediaExportDir: mediaExportDir.trim(),
            defaultPdfDesign: pdfDesign,
            defaultCaptionSettings: captionDefaults,
            themePreference: themeMode,
            defaultSpeaker: defaultSpeaker.trim(),
          }),
        }),
      ];

      if (pdfPrompt.trim()) {
        requests.push(
          fetch("/api/prompts/generation", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assetType: "pdf_design", promptText: pdfPrompt.trim() }),
          })
        );
      }

      const [res] = await Promise.all(requests);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save settings");

      setHasSavedKey(Boolean(data.settings.hasApiKey));
      setApiKeyMasked(data.settings.apiKeyMasked || "");
      setPdfExportDir(data.settings.pdfExportDir || "");
      setMediaExportDir(data.settings.mediaExportDir || "");
      setApiKeyInput("");
      success("All settings saved.");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmClearKey = async () => {
    setClearingKey(true);
    try {
      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clearApiKey: true }),
      });
      if (!res.ok) throw new Error("Could not remove saved token/key");
      setHasSavedKey(false);
      setApiKeyMasked("");
      setApiKeyInput("");
      setConfirmClearOpen(false);
      success("Saved key / token cleared.");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Could not clear key.");
    } finally {
      setClearingKey(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/settings/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llmProvider,
          apiKey: apiKeyInput.trim() || undefined,
          baseUrl,
          model,
        }),
      });
      const data = await res.json();
      const ok = Boolean(data.ok);
      const message = data.message || (ok ? "Connected." : "Connection failed.");
      setTestResult({ ok, message });
      if (ok) success("Connection test succeeded.");
      else toastError(message);
    } finally {
      setTesting(false);
    }
  };

  const showsSecretField = !["offline", "ollama"].includes(llmProvider);
  const currentMeta = providers[llmProvider];

  return (
    <AuthenticatedShell>
      <div className="mx-auto max-w-4xl px-5 py-7 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#0D1F28]">Settings</h1>
            <p className="mt-1 text-xs text-[#4E6470]">
              Customize dark mode, Mac download folders, PDF &amp; video styling defaults, and Claude AI.
            </p>
          </div>
        </div>

        {/* 4 Category Tabs */}
        <div className="mt-5 flex flex-wrap gap-1.5 rounded-2xl border border-[#E5EAEF] bg-white p-1.5">
          {(
            [
              { id: "general", label: "Appearance & General", icon: Sliders },
              { id: "downloads", label: "Downloads & Folders", icon: HardDriveDownload },
              { id: "design", label: "PDF & Video Defaults", icon: Palette },
              { id: "ai", label: "AI & Transcription", icon: Cpu },
            ] as Array<{
              id: SettingsTab;
              label: string;
              icon: React.ComponentType<{ className?: string }>;
            }>
          ).map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition ${
                  active
                    ? "bg-[#002A3C] text-white shadow-sm"
                    : "text-[#4E6470] hover:bg-[#F3F5F7] hover:text-[#0D1F28]"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{t.label}</span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="mt-10 flex justify-center py-12 text-[#4E6470]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          </div>
        ) : (
          <form onSubmit={handleSave} className="mt-6 space-y-5">
            {activeTab === "general" && (
              <>
                <section className="rounded-2xl border border-[#E5EAEF] bg-white p-6">
                  <h2 className="text-base font-semibold text-[#0D1F28]">Appearance</h2>
                  <p className="mt-1 text-xs text-[#4E6470]">
                    Switch between Light mode, Dark mode, or automatically match your Mac.
                  </p>
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {(
                      [
                        { id: "light", label: "Light mode", desc: "Crisp daytime studio", icon: Sun },
                        { id: "dark", label: "Dark mode", desc: "Easy on the eyes", icon: Moon },
                        { id: "system", label: "Match Mac", desc: "Follows macOS setting", icon: Monitor },
                      ] as Array<{
                        id: ThemeMode;
                        label: string;
                        desc: string;
                        icon: React.ComponentType<{ className?: string }>;
                      }>
                    ).map((opt) => {
                      const Icon = opt.icon;
                      const active = themeMode === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setThemeMode(opt.id, true)}
                          className={`flex items-start gap-3 rounded-xl border p-3.5 text-left transition ${
                            active
                              ? "border-[#002A3C] bg-[#EBF4F7] text-[#002A3C]"
                              : "border-[#E5EAEF] bg-white text-[#0D1F28] hover:bg-[#FAFBFD]"
                          }`}
                        >
                          <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                          <div>
                            <p className="text-xs font-semibold">{opt.label}</p>
                            <p className="mt-0.5 text-[11px] text-[#4E6470]">{opt.desc}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="rounded-2xl border border-[#E5EAEF] bg-white p-6">
                  <h2 className="text-base font-semibold text-[#0D1F28]">Default Sermon Details</h2>
                  <div className="mt-4">
                    <label
                      htmlFor="default-speaker-input"
                      className="mb-1.5 block text-xs font-medium text-[#4E6470]"
                    >
                      Default Speaker Name (used on new sermons &amp; PDF headers)
                    </label>
                    <input
                      id="default-speaker-input"
                      type="text"
                      value={defaultSpeaker}
                      onChange={(e) => setDefaultSpeaker(e.target.value)}
                      placeholder="e.g. Pastor Josh Wilson"
                      className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2.5 text-sm text-[#0D1F28] placeholder-[#70848F] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                    />
                  </div>
                </section>

                <section className="rounded-2xl border border-[#E5EAEF] bg-white p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-[#0D1F28]">Mac System Check</h2>
                      <p className="mt-0.5 text-xs text-[#4E6470]">
                        Verify local tools installed on this computer.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={loadHealth}
                      disabled={checkingHealth}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-3 py-1.5 text-xs font-medium text-[#0D1F28] hover:bg-[#F3F5F7]"
                    >
                      <RefreshCw
                        className={`h-3 w-3 ${checkingHealth ? "animate-spin" : ""}`}
                        aria-hidden="true"
                      />
                      Refresh
                    </button>
                  </div>

                  {healthInfo?.health && (
                    <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                      {[
                        {
                          label: "Claude CLI (claude auth login)",
                          ok: healthInfo.health.claudeCli.loggedIn,
                          detail: healthInfo.health.claudeCli.message,
                        },
                        {
                          label: "FFmpeg Video & Audio",
                          ok: healthInfo.health.ffmpeg.installed,
                          detail: healthInfo.health.ffmpeg.installed
                            ? healthInfo.health.ffmpeg.libass
                              ? "Installed with native libass subtitles"
                              : "Installed (using built-in Pillow captions)"
                            : "Not found — run `brew install ffmpeg`",
                        },
                        {
                          label: "Local Transcription (faster-whisper)",
                          ok: healthInfo.health.whisper.ready,
                          detail: healthInfo.health.whisper.ready
                            ? "Ready to transcribe privately on CPU"
                            : "Python worker not set up yet",
                        },
                        {
                          label: "Local Database (SQLite)",
                          ok: healthInfo.health.database.ready,
                          detail: "Sermons, clips & prompts stored locally",
                        },
                      ].map((row) => (
                        <div
                          key={row.label}
                          className="rounded-xl border border-[#EDF1F4] bg-[#FAFBFD] p-3 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-[#0D1F28]">{row.label}</span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                row.ok
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-amber-50 text-amber-800"
                              }`}
                            >
                              {row.ok ? "Ready" : "Check"}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-[#4E6470]">{row.detail}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}

            {activeTab === "downloads" && (
              <section className="space-y-5 rounded-2xl border border-[#E5EAEF] bg-white p-6">
                <div>
                  <h2 className="text-base font-semibold text-[#0D1F28]">
                    Where Downloaded Files Go
                  </h2>
                  <p className="mt-1 text-xs text-[#4E6470]">
                    Choose whether PDFs, videos, MP3s, and notes go to your browser Downloads, save straight into your own Mac folders, or ask where to save every time.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {(
                    [
                      {
                        id: "browser",
                        title: "Browser Default",
                        desc: "Downloads normally through Safari or Chrome.",
                      },
                      {
                        id: "folder",
                        title: "Custom Mac Folders",
                        desc: "Saves directly into the folders you pick below.",
                      },
                      {
                        id: "ask",
                        title: "Ask Every Time",
                        desc: "Opens a Save As dialog when supported by your browser.",
                      },
                    ] as Array<{ id: ExportMode; title: string; desc: string }>
                  ).map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setExportMode(m.id)}
                      className={`rounded-xl border p-3.5 text-left transition ${
                        exportMode === m.id
                          ? "border-[#1D3519] bg-[#F4F2E6]/70 text-[#1D3519]"
                          : "border-[#E5EAEF] bg-white text-[#0D1F28] hover:bg-[#FAFBFD]"
                      }`}
                    >
                      <p className="text-xs font-semibold">{m.title}</p>
                      <p className="mt-1 text-[11px] text-[#4E6470]">{m.desc}</p>
                    </button>
                  ))}
                </div>

                <div className="space-y-4 border-t border-[#EDF1F4] pt-4">
                  {/* PDF & Notes Folder */}
                  <div>
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <label htmlFor="pdf-export-dir" className="text-xs font-medium text-[#0D1F28]">
                        PDF &amp; Notes Save Folder
                      </label>
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => {
                            setPdfExportDir("~/Downloads");
                            setExportMode("folder");
                          }}
                          className="text-[#002A3C] hover:underline"
                        >
                          Use ~/Downloads
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPdfExportDir("~/Desktop/Garden Church PDFs");
                            setExportMode("folder");
                          }}
                          className="text-[#002A3C] hover:underline"
                        >
                          Use Desktop Folder
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <input
                        id="pdf-export-dir"
                        type="text"
                        value={pdfExportDir}
                        onChange={(e) => setPdfExportDir(e.target.value)}
                        placeholder="~/Desktop/Garden Church PDFs"
                        className="min-w-[200px] flex-1 rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2 text-xs text-[#0D1F28] placeholder-[#70848F] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={pickingFor === "pdf"}
                        onClick={() => void pickFolder("pdf")}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-3.5 py-2 text-xs font-medium text-[#0D1F28] hover:bg-[#F3F5F7]"
                      >
                        <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                        {pickingFor === "pdf" ? "Opening..." : "Choose Folder..."}
                      </button>
                      {pdfExportDir.trim() && (
                        <button
                          type="button"
                          onClick={() => void openFolderInFinder(pdfExportDir)}
                          className="rounded-full border border-[#D5E1E6] bg-white px-3 py-2 text-xs font-medium text-[#4E6470] hover:bg-[#F3F5F7]"
                        >
                          Open
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Videos & MP3 Folder */}
                  <div>
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <label htmlFor="media-export-dir" className="text-xs font-medium text-[#0D1F28]">
                        Downloaded Videos, Clips &amp; MP3 Folder
                      </label>
                      <div className="flex flex-wrap items-center gap-2 text-[11px]">
                        <button
                          type="button"
                          onClick={() => {
                            setMediaExportDir("~/Movies/Ambo AI Clips");
                            setExportMode("folder");
                          }}
                          className="text-[#002A3C] hover:underline"
                        >
                          Use ~/Movies
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setMediaExportDir("~/Desktop/Ambo AI Media");
                            setExportMode("folder");
                          }}
                          className="text-[#002A3C] hover:underline"
                        >
                          Use Desktop Folder
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <input
                        id="media-export-dir"
                        type="text"
                        value={mediaExportDir}
                        onChange={(e) => setMediaExportDir(e.target.value)}
                        placeholder="~/Movies/Ambo AI Clips"
                        className="min-w-[200px] flex-1 rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2 text-xs text-[#0D1F28] placeholder-[#70848F] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                      />
                      <button
                        type="button"
                        disabled={pickingFor === "media"}
                        onClick={() => void pickFolder("media")}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-3.5 py-2 text-xs font-medium text-[#0D1F28] hover:bg-[#F3F5F7]"
                      >
                        <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
                        {pickingFor === "media" ? "Opening..." : "Choose Folder..."}
                      </button>
                      {mediaExportDir.trim() && (
                        <button
                          type="button"
                          onClick={() => void openFolderInFinder(mediaExportDir)}
                          className="rounded-full border border-[#D5E1E6] bg-white px-3 py-2 text-xs font-medium text-[#4E6470] hover:bg-[#F3F5F7]"
                        >
                          Open
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {activeTab === "design" && (
              <>
                <section className="space-y-4 rounded-2xl border border-[#E5EAEF] bg-white p-6">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="inline-flex items-center gap-2 text-base font-semibold text-[#0D1F28]">
                        <FileText className="h-4 w-4 text-[#1D3519]" aria-hidden="true" />
                        Default PDF Design &amp; AI Prompt
                      </h2>
                      <p className="mt-1 text-xs text-[#4E6470]">
                        Adjust the default PDF layout and the prompt sent to Claude (or your active AI provider) when designing PDFs.
                      </p>
                    </div>
                  </div>

                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[#D5E1E6] bg-[#FAFBFD] px-4 py-3 text-xs">
                    <div>
                      <p className="font-semibold text-[#0D1F28]">
                        Enable AI PDF Designer by default
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#4E6470]">
                        When on, your logged-in Claude / AI account customizes PDF formatting &amp; callouts using your prompt below.
                      </p>
                    </div>
                    <input
                      type="checkbox"
                      checked={pdfDesign.useAiDesigner}
                      onChange={(e) =>
                        setPdfDesign((d) => ({ ...d, useAiDesigner: e.target.checked }))
                      }
                      className="h-4 w-4 shrink-0 accent-[#1D3519]"
                    />
                  </label>

                  <div>
                    <label
                      htmlFor="settings-pdf-prompt"
                      className="mb-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-[#4E6470]"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-[#1D3519]" aria-hidden="true" />
                      Default AI PDF Design Prompt
                    </label>
                    <textarea
                      id="settings-pdf-prompt"
                      rows={4}
                      value={pdfPrompt}
                      onChange={(e) => setPdfPrompt(e.target.value)}
                      className="w-full rounded-xl border border-transparent bg-[#F3F5F7] p-3 text-xs leading-relaxed text-[#0D1F28] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label htmlFor="def-pdf-header" className="mb-1 block text-xs font-medium text-[#4E6470]">
                        Header style
                      </label>
                      <select
                        id="def-pdf-header"
                        value={pdfDesign.headerStyle}
                        onChange={(e) =>
                          setPdfDesign((d) => ({
                            ...d,
                            headerStyle: e.target.value as PdfHeaderStyle,
                          }))
                        }
                        className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3 py-2 text-xs text-[#0D1F28]"
                      >
                        <option value="banner">Full Banner</option>
                        <option value="minimal">Minimal Print</option>
                        <option value="boxed">Inset Card</option>
                        <option value="centered">Centered Bulletin</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="def-pdf-font" className="mb-1 block text-xs font-medium text-[#4E6470]">
                        PDF font pairing
                      </label>
                      <select
                        id="def-pdf-font"
                        value={pdfDesign.fontPairing}
                        onChange={(e) =>
                          setPdfDesign((d) => ({
                            ...d,
                            fontPairing: e.target.value as PdfFontPairing,
                          }))
                        }
                        className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3 py-2 text-xs text-[#0D1F28]"
                      >
                        <option value="garden">Garden Sans (Yankee)</option>
                        <option value="editorial">Editorial (Merriweather + Yankee)</option>
                        <option value="classic">Classic Serif (Baskerville)</option>
                        <option value="modern">Modern (Plus Jakarta Sans)</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="def-pdf-density" className="mb-1 block text-xs font-medium text-[#4E6470]">
                        PDF spacing
                      </label>
                      <select
                        id="def-pdf-density"
                        value={pdfDesign.density}
                        onChange={(e) =>
                          setPdfDesign((d) => ({
                            ...d,
                            density: e.target.value as PdfDensity,
                          }))
                        }
                        className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3 py-2 text-xs text-[#0D1F28]"
                      >
                        <option value="compact">Compact</option>
                        <option value="comfortable">Balanced</option>
                        <option value="spacious">Large Print</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <p className="mb-1.5 text-xs font-medium text-[#4E6470]">Default PDF color theme</p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {PDF_COLOR_THEMES.map((theme) => {
                        const active =
                          pdfDesign.palette.primaryHex === theme.palette.primaryHex &&
                          pdfDesign.palette.headerBgHex === theme.palette.headerBgHex;
                        return (
                          <button
                            key={theme.id}
                            type="button"
                            onClick={() =>
                              setPdfDesign((d) => ({ ...d, palette: { ...theme.palette } }))
                            }
                            className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition ${
                              active
                                ? "border-[#1D3519] bg-[#F4F2E6]/70 font-medium text-[#1D3519]"
                                : "border-[#E5EAEF] bg-white text-[#0D1F28] hover:bg-[#FAFBFD]"
                            }`}
                          >
                            <span
                              className="h-3.5 w-3.5 shrink-0 rounded-full border border-black/10"
                              style={{ backgroundColor: theme.palette.headerBgHex }}
                            />
                            <span className="truncate">{theme.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>

                <section className="space-y-4 rounded-2xl border border-[#E5EAEF] bg-white p-6">
                  <div>
                    <h2 className="text-base font-semibold text-[#0D1F28]">
                      Default Video Clip Overlay Theme &amp; Font
                    </h2>
                    <p className="mt-1 text-xs text-[#4E6470]">
                      New clips start with The Garden Church colors and your selected font.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {OVERLAY_COLOR_THEMES.map((theme) => {
                      const active =
                        captionDefaults.backgroundColorHex.toLowerCase() ===
                          theme.backgroundColorHex.toLowerCase() &&
                        captionDefaults.highlightColorHex.toLowerCase() ===
                          theme.highlightColorHex.toLowerCase();
                      return (
                        <button
                          key={theme.id}
                          type="button"
                          onClick={() =>
                            setCaptionDefaults((c) => ({
                              ...c,
                              colorHex: theme.colorHex,
                              backgroundStyle: theme.backgroundStyle,
                              backgroundColorHex: theme.backgroundColorHex,
                              highlights: theme.highlights,
                              highlightColorHex: theme.highlightColorHex,
                            }))
                          }
                          className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                            active
                              ? "border-[#1D3519] bg-[#F4F2E6] text-[#1D3519]"
                              : "border-[#E5EAEF] bg-[#FAFBFD] text-[#0D1F28] hover:bg-[#F3F5F7]"
                          }`}
                        >
                          <span
                            className="h-3 w-3 rounded-full border border-black/15"
                            style={{ backgroundColor: theme.backgroundColorHex }}
                          />
                          <span
                            className="h-3 w-3 rounded-full border border-black/15"
                            style={{ backgroundColor: theme.highlightColorHex }}
                          />
                          {theme.label}
                        </button>
                      );
                    })}
                  </div>

                  <div>
                    <label htmlFor="def-clip-font" className="mb-1.5 block text-xs font-medium text-[#4E6470]">
                      Default caption font
                    </label>
                    <select
                      id="def-clip-font"
                      value={captionDefaults.typography}
                      onChange={(e) =>
                        setCaptionDefaults((c) => ({
                          ...c,
                          typography: e.target.value as CaptionSettings["typography"],
                        }))
                      }
                      className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2.5 text-sm text-[#0D1F28]"
                    >
                      {FONT_OPTIONS.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label} ({f.category})
                        </option>
                      ))}
                    </select>
                  </div>
                </section>
              </>
            )}

            {activeTab === "ai" && (
              <>
                <section className="rounded-2xl border border-[#E5EAEF] bg-white p-6">
                  <h2 className="text-base font-semibold text-[#0D1F28]">AI provider</h2>

                  <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                    {PROVIDER_ORDER.map((p) => {
                      const active = llmProvider === p;
                      const meta = providers[p];
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => handleSelectProvider(p)}
                          className={`rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition ${
                            active
                              ? "border-[#002A3C] bg-[#EBF4F7] text-[#002A3C]"
                              : "border-[#E5EAEF] bg-white text-[#4E6470] hover:bg-[#F7F8FA] hover:text-[#0D1F28]"
                          }`}
                        >
                          {meta?.label || p}
                        </button>
                      );
                    })}
                  </div>

                  {currentMeta?.freeTierNote && (
                    <p className="mt-3 text-xs text-[#4E6470]">{currentMeta.freeTierNote}</p>
                  )}

                  {llmProvider === "claude_cli" && (
                    <div className="mt-4 space-y-3 rounded-xl border border-[#D5E1E6] bg-[#FAFBFD] p-4 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-[#0D1F28]">
                          <Terminal className="h-3.5 w-3.5 text-[#002A3C]" aria-hidden="true" />
                          Claude Team Subscription Bridge
                        </span>
                        <button
                          type="button"
                          onClick={checkClaudeCli}
                          disabled={checkingClaude}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#002A3C] hover:underline"
                        >
                          <RefreshCw
                            className={`h-3 w-3 ${checkingClaude ? "animate-spin" : ""}`}
                            aria-hidden="true"
                          />
                          Check CLI status
                        </button>
                      </div>
                      {claudeStatus && (
                        <p
                          className={`rounded-lg px-3 py-2 font-medium ${
                            claudeStatus.loggedIn
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-800"
                          }`}
                        >
                          {claudeStatus.message}
                        </p>
                      )}
                      <ol className="list-decimal space-y-1 pl-4 text-[#4E6470]">
                        <li>
                          Run{" "}
                          <code className="rounded border border-[#E5EAEF] bg-white px-1.5 py-0.5 text-[#0D1F28]">
                            claude auth login
                          </code>{" "}
                          with your Claude account (no separate API plan required).
                        </li>
                        <li>Select Sonnet or Opus and click Save all settings.</li>
                      </ol>
                    </div>
                  )}

                  {llmProvider !== "offline" && (
                    <div className="mt-5 space-y-4 border-t border-[#EDF1F4] pt-5">
                      {showsSecretField && (
                        <div>
                          <div className="mb-1.5 flex items-center justify-between">
                            <label htmlFor="api-key-input" className="text-xs font-medium text-[#4E6470]">
                              {llmProvider === "claude_cli"
                                ? "Optional setup-token (CLAUDE_CODE_OAUTH_TOKEN)"
                                : "API key"}
                            </label>
                            {hasSavedKey && (
                              <button
                                type="button"
                                onClick={() => setConfirmClearOpen(true)}
                                className="text-xs text-rose-700 hover:underline"
                              >
                                Clear saved key ({apiKeyMasked})
                              </button>
                            )}
                          </div>
                          <div className="relative">
                            <input
                              id="api-key-input"
                              type={showKey ? "text" : "password"}
                              value={apiKeyInput}
                              onChange={(e) => setApiKeyInput(e.target.value)}
                              placeholder={
                                hasSavedKey
                                  ? `Saved (${apiKeyMasked})`
                                  : llmProvider === "claude_cli"
                                    ? "Optional if already signed in with `claude auth login`"
                                    : "Paste your API key"
                              }
                              className="w-full rounded-xl border border-transparent bg-[#F3F5F7] py-2.5 pl-3.5 pr-10 text-sm text-[#0D1F28] placeholder-[#70848F] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => setShowKey((v) => !v)}
                              aria-label={showKey ? "Hide secret" : "Show secret"}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-[#70848F] hover:text-[#0D1F28]"
                            >
                              {showKey ? (
                                <EyeOff className="h-4 w-4" aria-hidden="true" />
                              ) : (
                                <Eye className="h-4 w-4" aria-hidden="true" />
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {llmProvider !== "claude_cli" && (
                          <div>
                            <label
                              htmlFor="provider-base-url"
                              className="mb-1.5 block text-xs font-medium text-[#4E6470]"
                            >
                              Base URL
                            </label>
                            <input
                              id="provider-base-url"
                              type="text"
                              value={baseUrl}
                              onChange={(e) => setBaseUrl(e.target.value)}
                              className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2.5 text-sm text-[#0D1F28] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                            />
                          </div>
                        )}
                        <div>
                          <div className="mb-1.5 flex items-center justify-between">
                            <label htmlFor="provider-model" className="text-xs font-medium text-[#4E6470]">
                              Model
                            </label>
                            {llmProvider === "ollama" && (
                              <button
                                type="button"
                                onClick={detectOllama}
                                className="inline-flex items-center gap-1 text-xs font-medium text-[#002A3C] hover:underline"
                              >
                                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                                Detect local
                              </button>
                            )}
                          </div>
                          {llmProvider === "claude_cli" ? (
                            <select
                              id="provider-model"
                              value={model || "sonnet"}
                              onChange={(e) => setModel(e.target.value)}
                              className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2.5 text-sm text-[#0D1F28] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                            >
                              <option value="sonnet">Claude Sonnet (recommended)</option>
                              <option value="opus">Claude Opus (deepest reasoning)</option>
                              <option value="haiku">Claude Haiku (fastest)</option>
                            </select>
                          ) : llmProvider === "ollama" && ollamaModels.length > 0 ? (
                            <select
                              id="provider-model"
                              value={model}
                              onChange={(e) => setModel(e.target.value)}
                              className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2.5 text-sm text-[#0D1F28] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                            >
                              {ollamaModels.map((m) => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              id="provider-model"
                              type="text"
                              value={model}
                              onChange={(e) => setModel(e.target.value)}
                              className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2.5 text-sm text-[#0D1F28] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                            />
                          )}
                          {llmProvider === "ollama" && ollamaRunning === false && (
                            <p className="mt-1 text-xs text-rose-700">
                              Ollama was not reachable at {baseUrl || "http://127.0.0.1:11434"}.
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {testResult && (
                    <div
                      className={`mt-4 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-medium ${
                        testResult.ok
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-rose-50 text-rose-700"
                      }`}
                      role="status"
                    >
                      {testResult.ok && (
                        <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                      )}
                      {testResult.message}
                    </div>
                  )}

                  <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={handleTest}
                      disabled={testing}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-4 py-2 text-xs font-medium text-[#0D1F28] transition hover:bg-[#F3F5F7] disabled:opacity-60"
                    >
                      {testing && (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      )}
                      Test connection
                    </button>
                  </div>
                </section>

                <section className="rounded-2xl border border-[#E5EAEF] bg-white p-6">
                  <h2 className="text-base font-semibold text-[#0D1F28]">
                    Transcription (faster-whisper)
                  </h2>
                  <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="whisper-model"
                        className="mb-1.5 block text-xs font-medium text-[#4E6470]"
                      >
                        Whisper model
                      </label>
                      <select
                        id="whisper-model"
                        value={whisperModel}
                        onChange={(e) =>
                          setWhisperModel(e.target.value as "tiny" | "base" | "small" | "medium")
                        }
                        className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2.5 text-sm text-[#0D1F28] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                      >
                        <option value="tiny">tiny (fastest)</option>
                        <option value="base">base (balanced)</option>
                        <option value="small">small (accurate)</option>
                        <option value="medium">medium (highest accuracy)</option>
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="whisper-language"
                        className="mb-1.5 block text-xs font-medium text-[#4E6470]"
                      >
                        Language
                      </label>
                      <select
                        id="whisper-language"
                        value={whisperLanguage}
                        onChange={(e) => setWhisperLanguage(e.target.value)}
                        className="w-full rounded-xl border border-transparent bg-[#F3F5F7] px-3.5 py-2.5 text-sm text-[#0D1F28] focus:border-[#D5E1E6] focus:bg-white focus:outline-none"
                      >
                        <option value="auto">Auto-detect</option>
                        <option value="en">English</option>
                        <option value="es">Spanish</option>
                        <option value="pt">Portuguese</option>
                        <option value="fr">French</option>
                        <option value="ko">Korean</option>
                      </select>
                    </div>
                  </div>
                </section>
              </>
            )}

            <div className="flex items-center justify-end gap-4">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#002A3C] px-5 py-2.5 text-xs font-medium text-white transition hover:bg-[#0B435B] disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Save all settings
              </button>
            </div>
          </form>
        )}
      </div>

      <ConfirmModal
        open={confirmClearOpen}
        title="Remove saved API key or token?"
        description="This clears the encrypted key stored for your account. You can paste a new one anytime."
        confirmLabel="Remove key"
        variant="danger"
        loading={clearingKey}
        onConfirm={handleConfirmClearKey}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </AuthenticatedShell>
  );
}
