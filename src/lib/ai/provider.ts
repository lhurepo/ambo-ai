import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import type { LlmProvider } from "../types";
import { withLocalBinPath } from "../env-path";

export interface LlmConfig {
  provider: LlmProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export const PROVIDER_DEFAULTS: Record<
  LlmProvider,
  { label: string; baseUrl: string; defaultModel: string; freeTierNote: string }
> = {
  claude_cli: {
    label: "Claude Team (Automatic CLI)",
    baseUrl: "",
    defaultModel: "sonnet",
    freeTierNote:
      "Runs directly through your Claude Team subscription via `claude auth login` — no separate API billing needed.",
  },
  offline: {
    label: "Built-in Offline Engine (Zero Keys)",
    baseUrl: "",
    defaultModel: "local-nlp",
    freeTierNote: "100% free & offline fallback — no API key needed.",
  },
  ollama: {
    label: "Ollama (100% Local Free Models)",
    baseUrl: "http://127.0.0.1:11434/v1",
    defaultModel: "llama3.2",
    freeTierNote: "Runs completely free on your own computer via Ollama.",
  },
  gemini: {
    label: "Google Gemini (Free Tier)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
    freeTierNote: "Free API key at aistudio.google.com — fast & generous free quota.",
  },
  groq: {
    label: "Groq (Free Tier)",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    freeTierNote: "Free ultra-fast Llama 3.3 inference at console.groq.com.",
  },
  openrouter: {
    label: "OpenRouter (:free Models)",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    freeTierNote: "Access free-tier open models (:free suffix) at openrouter.ai.",
  },
  openai: {
    label: "OpenAI (BYOK)",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    freeTierNote: "Bring your own OpenAI API key.",
  },
  anthropic: {
    label: "Anthropic Console API (BYOK)",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-haiku-latest",
    freeTierNote: "Uses an Anthropic Console API key (separate from Claude Team web plan).",
  },
  custom: {
    label: "Custom OpenAI-Compatible",
    baseUrl: "http://127.0.0.1:8000/v1",
    defaultModel: "default",
    freeTierNote: "Any LM Studio, vLLM, llama.cpp, or OpenAI-compatible endpoint.",
  },
};

export function resolveClaudeBinary(): string | null {
  const env = withLocalBinPath(process.env);
  const home = env.HOME || "";
  const pathDirs = (env.PATH || "").split(path.delimiter).filter(Boolean);
  const candidates = [
    path.join(home, ".local", "bin", "claude"),
    path.join(home, ".claude", "local", "claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
    path.join(home, ".volta", "bin", "claude"),
    path.join(home, ".npm-global", "bin", "claude"),
    "/usr/bin/claude",
    ...pathDirs.map((d) => path.join(d, "claude")),
  ];
  for (const p of candidates) {
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {}
  }
  return null;
}

export function hasClaudeBinaryInstalled(): boolean {
  return resolveClaudeBinary() !== null;
}

function cleanClaudeOutput(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => !line.startsWith("Warning: this sign-in can end at any time"))
    .join("\n")
    .trim();
}

export async function checkClaudeCliStatus(oauthToken?: string): Promise<{
  installed: boolean;
  loggedIn: boolean;
  email?: string;
  planTier?: string;
  subscriptionType?: string;
  orgName?: string;
  message: string;
}> {
  const bin = resolveClaudeBinary();
  if (!bin) {
    return {
      installed: false,
      loggedIn: false,
      message: "Claude CLI was not found on this machine. Install Claude Code and run `claude auth login`.",
    };
  }

  return new Promise((resolve) => {
    const env = withLocalBinPath(process.env);
    delete env.ANTHROPIC_API_KEY;
    if (oauthToken && oauthToken.trim()) {
      env.CLAUDE_CODE_OAUTH_TOKEN = oauthToken.trim();
    }

    const child = spawn(bin, ["auth", "status"], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ installed: false, loggedIn: false, message: "Claude CLI status check timed out." });
    }, 8000);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", () => {
      clearTimeout(timer);
      resolve({
        installed: false,
        loggedIn: false,
        message: "Claude CLI is not installed on PATH. Install Claude Code and run `claude auth login`.",
      });
    });
    child.on("close", () => {
      clearTimeout(timer);
      const txt = `${stdout}\n${stderr}`;
      const jsonMatch = txt.match(/\{[\s\S]*"loggedIn"[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const hasOauth = Boolean(oauthToken && oauthToken.trim());
          const loggedIn = Boolean(parsed.loggedIn) || hasOauth;
          resolve({
            installed: true,
            loggedIn,
            email: parsed.email || undefined,
            planTier: parsed.planTier || undefined,
            subscriptionType: parsed.subscriptionType || undefined,
            orgName: parsed.orgName || undefined,
            message: loggedIn
              ? `Signed in via Claude (${parsed.email || parsed.subscriptionType || "Team subscription"}).`
              : "Claude CLI installed, not signed in yet. Run `claude auth login` in Terminal.",
          });
          return;
        } catch {}
      }
      resolve({
        installed: true,
        loggedIn: Boolean(oauthToken && oauthToken.trim()),
        message: oauthToken?.trim()
          ? "Using saved Claude setup-token."
          : "Claude CLI installed. Run `claude auth login` to link your Claude account.",
      });
    });
  });
}

async function callClaudeCli(
  config: LlmConfig,
  messages: ChatTurn[],
  options: { timeoutMs?: number } = {}
): Promise<string> {
  const bin = resolveClaudeBinary();
  if (!bin) {
    throw new Error("Claude CLI binary not found. Install Claude Code and run `claude auth login`.");
  }

  const systemMsg = messages.find((m) => m.role === "system")?.content || "";
  const transcriptTurns = messages
    .filter((m) => m.role !== "system")
    .map((m) => (messages.length <= 2 ? m.content : `${m.role === "assistant" ? "Assistant" : "User"}:\n${m.content}`))
    .join("\n\n");

  const model = ["sonnet", "opus", "haiku"].includes(config.model) || config.model.startsWith("claude-")
    ? config.model
    : "sonnet";

  const args = ["-p", "--tools", "", "--no-session-persistence", "--output-format", "text", "--model", model];
  if (systemMsg) {
    args.push("--system-prompt", systemMsg);
  }

  return new Promise((resolve, reject) => {
    const env = withLocalBinPath(process.env);
    delete env.ANTHROPIC_API_KEY;
    if (config.apiKey && config.apiKey.trim()) {
      env.CLAUDE_CODE_OAUTH_TOKEN = config.apiKey.trim();
    }

    const child = spawn(bin, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Claude CLI timed out while generating response."));
    }, options.timeoutMs ?? 120000);

    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not run Claude CLI: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const out = cleanClaudeOutput(stdout);
      const errClean = cleanClaudeOutput(stderr);
      const combined = `${out}\n${errClean}`.toLowerCase();

      if (
        combined.includes("can't use your claude subscription") ||
        combined.includes("not logged in") ||
        combined.includes("please run /login") ||
        combined.includes("past due")
      ) {
        reject(
          new Error(
            cleanClaudeOutput(out || errClean) ||
              "Claude CLI is not authorized yet. Run `claude auth login` in Terminal."
          )
        );
        return;
      }

      if (code !== 0 || !out) {
        reject(new Error(errClean || out || `Claude CLI exited with code ${code}`));
        return;
      }
      resolve(out);
    });

    child.stdin.write(transcriptTurns);
    child.stdin.end();
  });
}

export function resolveEndpoint(config: LlmConfig): { url: string; model: string; isAnthropic: boolean } {
  const defaults = PROVIDER_DEFAULTS[config.provider] || PROVIDER_DEFAULTS.offline;
  const base = (config.baseUrl || defaults.baseUrl).replace(/\/+$/, "");
  const model = config.model || defaults.defaultModel;
  if (config.provider === "anthropic") {
    return { url: `${base}/messages`, model, isAnthropic: true };
  }
  return { url: `${base}/chat/completions`, model, isAnthropic: false };
}

export async function callLlmCompletion(
  config: LlmConfig,
  messages: ChatTurn[],
  options: { temperature?: number; maxTokens?: number; jsonMode?: boolean; timeoutMs?: number } = {}
): Promise<string> {
  if (config.provider === "offline") {
    throw new Error(`${config.provider} mode active`);
  }

  if (config.provider === "claude_cli") {
    return callClaudeCli(config, messages, { timeoutMs: options.timeoutMs ?? 120000 });
  }

  const { url, model, isAnthropic } = resolveEndpoint(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 60000);

  try {
    if (isAnthropic) {
      const systemMsg = messages.find((m) => m.role === "system")?.content || "";
      const nonSystem = messages.filter((m) => m.role !== "system");
      const res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: options.maxTokens ?? 4096,
          temperature: options.temperature ?? 0.5,
          system: systemMsg,
          messages: nonSystem,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Anthropic HTTP ${res.status}: ${errText.slice(0, 300)}`);
      }
      const data = await res.json();
      return data?.content?.[0]?.text || "";
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }
    if (config.provider === "openrouter") {
      headers["HTTP-Referer"] = "http://localhost:3000";
      headers["X-Title"] = "Ambo AI";
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: options.temperature ?? 0.5,
      max_tokens: options.maxTokens ?? 4096,
    };
    if (options.jsonMode && config.provider !== "ollama") {
      body.response_format = { type: "json_object" };
    }

    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`LLM HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }

    const data = await res.json();
    return data?.choices?.[0]?.message?.content || "";
  } finally {
    clearTimeout(timer);
  }
}

export async function* streamLlmCompletion(
  config: LlmConfig,
  messages: ChatTurn[]
): AsyncGenerator<string, void, unknown> {
  if (config.provider === "offline") {
    return;
  }

  if (config.provider === "claude_cli") {
    const full = await callClaudeCli(config, messages, { timeoutMs: 90000 });
    for (const chunk of full.match(/.{1,48}/gs) || [full]) {
      yield chunk;
    }
    return;
  }

  const { url, model, isAnthropic } = resolveEndpoint(config);

  if (isAnthropic) {
    const full = await callLlmCompletion(config, messages, { temperature: 0.6, maxTokens: 2048 });
    yield full;
    return;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  if (config.provider === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost:3000";
    headers["X-Title"] = "Ambo AI";
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.6,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Stream HTTP ${res.status}: ${errText.slice(0, 250)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
        const delta = parsed?.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // Ignore partial chunk JSON
      }
    }
  }
}
