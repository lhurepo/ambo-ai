"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Save,
  Terminal,
} from "lucide-react";
import { AuthenticatedShell } from "@/components/layout/AuthenticatedShell";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { useToast } from "@/components/ui/ToastProvider";
import type { LlmProvider } from "@/lib/types";

interface ProviderMeta {
  label: string;
  baseUrl: string;
  defaultModel: string;
  freeTierNote: string;
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

export default function SettingsPage() {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

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

  useEffect(() => {
    fetch("/api/settings/ai")
      .then((r) => {
        if (r.status === 401) {
          router.push("/signin");
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (!d?.settings) return;
        setLlmProvider(d.settings.llmProvider);
        setHasSavedKey(Boolean(d.settings.hasApiKey));
        setApiKeyMasked(d.settings.apiKeyMasked || "");
        setBaseUrl(d.settings.baseUrl || "");
        setModel(d.settings.model || "");
        setWhisperModel(d.settings.whisperModel || "base");
        setWhisperLanguage(d.settings.whisperLanguage || "auto");
        setProviders(d.providers || {});
      })
      .finally(() => setLoading(false));
  }, [router]);

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

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/settings/ai", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llmProvider,
          apiKey: apiKeyInput.trim() || undefined,
          baseUrl,
          model,
          whisperModel,
          whisperLanguage,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save settings");
      setHasSavedKey(Boolean(data.settings.hasApiKey));
      setApiKeyMasked(data.settings.apiKeyMasked || "");
      setApiKeyInput("");
      success("AI & transcription settings saved.");
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
      <div className="mx-auto max-w-3xl px-5 py-7 md:px-8">
        <h1 className="text-2xl font-semibold tracking-tight text-[#0D1F28]">
          AI &amp; Claude Team
        </h1>

        {loading ? (
          <div className="mt-10 flex justify-center py-12 text-[#4E6470]">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          </div>
        ) : (
          <form onSubmit={handleSave} className="mt-6 space-y-5">
            <section className="rounded-2xl border border-[#E5EAEF] bg-white p-6">
              <h2 className="text-base font-semibold text-[#0D1F28]">AI provider</h2>

              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
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

              {/* Claude Team CLI helper box */}
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
                      Run <code className="rounded bg-white px-1.5 py-0.5 text-[#0D1F28] border border-[#E5EAEF]">claude auth login</code> with your Garden Church Claude Team account (or <code className="rounded bg-white px-1.5 py-0.5 text-[#0D1F28] border border-[#E5EAEF]">claude setup-token</code> and paste it below).
                    </li>
                    <li>Select Sonnet or Opus and click Save settings. No Anthropic Console API plan is required.</li>
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
                          Ollama was not reachable at {baseUrl || "http://localhost:11434"}.
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
                  {testResult.ok && <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />}
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
                  {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
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
                  <label htmlFor="whisper-model" className="mb-1.5 block text-xs font-medium text-[#4E6470]">
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
                  <label htmlFor="whisper-language" className="mb-1.5 block text-xs font-medium text-[#4E6470]">
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
                Save settings
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
