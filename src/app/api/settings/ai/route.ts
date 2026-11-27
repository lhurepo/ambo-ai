import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "@/lib/db";
import { aiSettings } from "@/lib/db/schema";
import { ensureUserAiSettings, getCurrentUser } from "@/lib/auth";
import { callLlmCompletion, checkClaudeCliStatus, PROVIDER_DEFAULTS } from "@/lib/ai/provider";
import { validateAndResolveExportDir } from "@/lib/local-export";
import {
  DEFAULT_CAPTION_SETTINGS,
  DEFAULT_PDF_DESIGN,
  type ExportMode,
  type LlmProvider,
  type PdfDesignSpec,
} from "@/lib/types";
import { encryptSecret, logAuditEvent, safeErrorResponse, validateExternalBaseUrl } from "@/lib/security";

function maskKey(k: string): string {
  if (!k) return "";
  if (k.length <= 8) return "••••••••";
  return `${k.slice(0, 4)}••••••••${k.slice(-4)}`;
}

function parsePdfDesign(rawJson: string | null | undefined): PdfDesignSpec {
  try {
    const parsed = JSON.parse(rawJson || "{}");
    return {
      ...DEFAULT_PDF_DESIGN,
      ...parsed,
      palette: { ...DEFAULT_PDF_DESIGN.palette, ...(parsed.palette || {}) },
    };
  } catch {
    return DEFAULT_PDF_DESIGN;
  }
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = ensureUserAiSettings(user.id);
  const plainKey = row.decryptedApiKey || "";
  let captionDefaults = DEFAULT_CAPTION_SETTINGS;
  try {
    captionDefaults = {
      ...DEFAULT_CAPTION_SETTINGS,
      ...JSON.parse(row.defaultCaptionSettingsJson || "{}"),
    };
  } catch {}

  const defaultPdfDesign = parsePdfDesign(row.defaultPdfDesignJson);

  return NextResponse.json({
    settings: {
      llmProvider: row.llmProvider,
      hasApiKey: Boolean(plainKey),
      apiKeyMasked: maskKey(plainKey),
      baseUrl: row.baseUrl,
      model: row.model,
      whisperModel: row.whisperModel,
      whisperLanguage: row.whisperLanguage,
      defaultCaptionSettings: captionDefaults,
      defaultPdfDesign,
      pdfExportDir: row.pdfExportDir || "",
      mediaExportDir: row.mediaExportDir || "",
      exportMode: (row.exportMode as ExportMode) || "browser",
      themePreference:
        (row.themePreference as "light" | "dark" | "system") || "light",
      defaultSpeaker: row.defaultSpeaker || "",
    },
    providers: PROVIDER_DEFAULTS,
  });
}

export async function PUT(req: Request) {
  try {
    ensureDbInitialized();
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const existing = ensureUserAiSettings(user.id);
    const body = await req.json();

    const nextProvider = (body.llmProvider || existing.llmProvider) as LlmProvider;
    if (!(nextProvider in PROVIDER_DEFAULTS)) {
      return NextResponse.json({ error: "Unsupported AI provider" }, { status: 400 });
    }

    const nextPlainKey =
      body.clearApiKey === true
        ? ""
        : typeof body.apiKey === "string" && body.apiKey.trim().length > 0
          ? body.apiKey.trim()
          : existing.decryptedApiKey;

    const storedEncryptedKey = nextPlainKey ? encryptSecret(nextPlainKey) : "";

    let nextBaseUrl = existing.baseUrl;
    if (typeof body.baseUrl === "string") {
      try {
        nextBaseUrl = validateExternalBaseUrl(body.baseUrl, true);
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Invalid Base URL" },
          { status: 400 }
        );
      }
    }

    const nextModel = typeof body.model === "string" ? body.model.trim().slice(0, 120) : existing.model;
    const nextWhisperModel =
      typeof body.whisperModel === "string" &&
      ["tiny", "base", "small", "medium"].includes(body.whisperModel)
        ? body.whisperModel
        : existing.whisperModel;
    const nextWhisperLang =
      typeof body.whisperLanguage === "string"
        ? body.whisperLanguage.trim().slice(0, 12) || "auto"
        : existing.whisperLanguage;

    const nextCaptionJson = body.defaultCaptionSettings
      ? JSON.stringify({ ...DEFAULT_CAPTION_SETTINGS, ...body.defaultCaptionSettings })
      : existing.defaultCaptionSettingsJson;

    const currentPdfDesign = parsePdfDesign(existing.defaultPdfDesignJson);
    const nextPdfDesignJson =
      body.defaultPdfDesign && typeof body.defaultPdfDesign === "object"
        ? JSON.stringify({
            ...currentPdfDesign,
            ...body.defaultPdfDesign,
            palette: {
              ...currentPdfDesign.palette,
              ...(body.defaultPdfDesign.palette || {}),
            },
          })
        : existing.defaultPdfDesignJson;

    let nextPdfExportDir = existing.pdfExportDir || "";
    if (typeof body.pdfExportDir === "string") {
      try {
        nextPdfExportDir = validateAndResolveExportDir(body.pdfExportDir).displayDir;
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Invalid PDF export folder." },
          { status: 400 }
        );
      }
    }

    let nextMediaExportDir = existing.mediaExportDir || "";
    if (typeof body.mediaExportDir === "string") {
      try {
        nextMediaExportDir = validateAndResolveExportDir(body.mediaExportDir).displayDir;
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : "Invalid video/audio export folder." },
          { status: 400 }
        );
      }
    }

    const nextExportMode: ExportMode =
      typeof body.exportMode === "string" &&
      ["browser", "folder", "ask"].includes(body.exportMode)
        ? (body.exportMode as ExportMode)
        : (existing.exportMode as ExportMode) || "browser";

    const nextThemePref =
      typeof body.themePreference === "string" &&
      ["light", "dark", "system"].includes(body.themePreference)
        ? body.themePreference
        : existing.themePreference || "light";

    const nextDefaultSpeaker =
      typeof body.defaultSpeaker === "string"
        ? body.defaultSpeaker.trim().slice(0, 120)
        : existing.defaultSpeaker || "";

    db.update(aiSettings)
      .set({
        llmProvider: nextProvider,
        apiKey: storedEncryptedKey,
        baseUrl: nextBaseUrl,
        model: nextModel,
        whisperModel: nextWhisperModel,
        whisperLanguage: nextWhisperLang,
        defaultCaptionSettingsJson: nextCaptionJson,
        defaultPdfDesignJson: nextPdfDesignJson,
        pdfExportDir: nextPdfExportDir,
        mediaExportDir: nextMediaExportDir,
        exportMode: nextExportMode,
        themePreference: nextThemePref,
        defaultSpeaker: nextDefaultSpeaker,
        updatedAt: Date.now(),
      })
      .where(eq(aiSettings.userId, user.id))
      .run();

    logAuditEvent(user.id, "ai_settings_updated", nextProvider);
    const updated = ensureUserAiSettings(user.id);
    const plainAfter = updated.decryptedApiKey || "";
    return NextResponse.json({
      ok: true,
      settings: {
        llmProvider: updated.llmProvider,
        hasApiKey: Boolean(plainAfter),
        apiKeyMasked: maskKey(plainAfter),
        baseUrl: updated.baseUrl,
        model: updated.model,
        whisperModel: updated.whisperModel,
        whisperLanguage: updated.whisperLanguage,
        defaultCaptionSettings: (() => {
          try {
            return { ...DEFAULT_CAPTION_SETTINGS, ...JSON.parse(updated.defaultCaptionSettingsJson || "{}") };
          } catch {
            return DEFAULT_CAPTION_SETTINGS;
          }
        })(),
        defaultPdfDesign: parsePdfDesign(updated.defaultPdfDesignJson),
        pdfExportDir: updated.pdfExportDir || "",
        mediaExportDir: updated.mediaExportDir || "",
        exportMode: (updated.exportMode as ExportMode) || "browser",
        themePreference:
          (updated.themePreference as "light" | "dark" | "system") || "light",
        defaultSpeaker: updated.defaultSpeaker || "",
      },
    });
  } catch (err) {
    return safeErrorResponse(err, "Could not update settings.");
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const existing = ensureUserAiSettings(user.id);

    const body = await req.json();

    if (body.action === "check_claude_cli") {
      const tokenToUse =
        typeof body.apiKey === "string" && body.apiKey.trim()
          ? body.apiKey.trim()
          : existing.decryptedApiKey;
      const status = await checkClaudeCliStatus(tokenToUse);
      return NextResponse.json(status);
    }

    if (body.action === "detect_ollama") {
      const base = validateExternalBaseUrl(
        (typeof body.baseUrl === "string" && body.baseUrl.trim()) || "http://127.0.0.1:11434",
        true
      )
        .replace(/\/v1\/?$/, "")
        .replace(/\/+$/, "");
      try {
        const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const models: string[] = (data.models || []).map((m: { name: string }) => m.name);
        return NextResponse.json({ ok: true, running: true, models });
      } catch {
        return NextResponse.json({
          ok: false,
          running: false,
          models: [],
          message: "Ollama is not running on this URL.",
        });
      }
    }

    const provider = (body.llmProvider || existing.llmProvider) as LlmProvider;
    const apiKey =
      typeof body.apiKey === "string" && body.apiKey.trim()
        ? body.apiKey.trim()
        : existing.decryptedApiKey;
    const baseUrl =
      typeof body.baseUrl === "string"
        ? validateExternalBaseUrl(body.baseUrl, true)
        : existing.baseUrl;
    const model = typeof body.model === "string" ? body.model : existing.model;

    if (provider === "offline") {
      return NextResponse.json({ ok: true, message: "Built-in Offline NLP Engine active — ready." });
    }

    const reply = await callLlmCompletion(
      { provider, apiKey, baseUrl, model },
      [
        { role: "system", content: "Reply with exactly: Ready for The Garden Church!" },
        { role: "user", content: "Connection check" },
      ],
      { maxTokens: 30, timeoutMs: 25000 }
    );

    return NextResponse.json({ ok: true, message: reply.trim().slice(0, 120) || "Connected!" });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      message: err instanceof Error ? err.message : "Connection test failed.",
    });
  }
}
