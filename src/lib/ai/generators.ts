import { ASSET_TYPES, type AssetType, type TranscriptSegment } from "../types";
import { callLlmCompletion, type LlmConfig } from "./provider";
import {
  generateOfflineBundle,
  selectOfflineClips,
  type GeneratedClipCandidate,
} from "./offline-engine";

export type EffectivePromptMap = Record<string, { promptText: string; isCustom: boolean }>;

export function extractJsonBlock(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```\s*$/i, "");
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function getPromptText(
  userPrompts: EffectivePromptMap | undefined,
  key: string,
  fallback: string
): string {
  return userPrompts?.[key]?.promptText?.trim() || fallback;
}

export async function generateAllSermonResources(params: {
  title: string;
  text: string;
  segments: TranscriptSegment[];
  durationSec: number;
  config: LlmConfig;
  userPrompts?: EffectivePromptMap;
}): Promise<{
  topic: string;
  assets: Record<string, string>;
  clips: GeneratedClipCandidate[];
}> {
  const { title, text, segments, durationSec, config, userPrompts } = params;

  // Always compute offline fallback first so every asset is guaranteed populated
  const fallback = generateOfflineBundle({ title, text, segments, durationSec });

  if (config.provider === "offline") {
    return fallback;
  }

  try {
    const truncated = text.slice(0, 26000);
    const segmentGuide =
      segments.length > 0
        ? segments
            .slice(0, 80)
            .map((s) => `[${Math.round(s.start * 1000)}-${Math.round(s.end * 1000)}] ${s.text}`)
            .join("\n")
        : "";

    const globalVoice = getPromptText(
      userPrompts,
      "global_system",
      "You are a seasoned ministry communications director helping a local church turn a sermon into faithful, practical resources."
    );

    const schemaLines = ASSET_TYPES.map((k) => {
      const instruction = getPromptText(userPrompts, k, k.replace(/_/g, " "));
      return `  ${JSON.stringify(k)}: ${JSON.stringify(instruction)}`;
    }).join(",\n");

    const promptCore = `Sermon Title: "${title}"
Transcript / Manuscript:
"""
${truncated}
"""

Follow each custom prompt instruction below when writing its Markdown string value. Return ONLY a valid JSON object:
{
  "topic": "2-4 word topic tag (e.g. Peace & Trust)",
${schemaLines}
}`;

    const rawAssets = await callLlmCompletion(
      config,
      [
        {
          role: "system",
          content: `${globalVoice}\nReturn strictly valid JSON matching the requested schema keys. Format values cleanly with Markdown.`,
        },
        { role: "user", content: promptCore },
      ],
      { jsonMode: true, maxTokens: 4096, temperature: 0.45, timeoutMs: 120000 }
    );

    const parsed = extractJsonBlock(rawAssets);
    if (parsed) {
      const mergedAssets = { ...fallback.assets };
      for (const k of Object.keys(fallback.assets)) {
        if (typeof parsed[k] === "string" && (parsed[k] as string).trim().length > 10) {
          mergedAssets[k] = parsed[k] as string;
        }
      }
      const topic =
        typeof parsed.topic === "string" && parsed.topic.trim() ? parsed.topic.trim() : fallback.topic;

      let chosenClips = fallback.clips;
      if (segmentGuide) {
        try {
          const clipInstruction = getPromptText(
            userPrompts,
            "clips",
            "Select 4 high-impact vertical video clips (each 15-65 seconds long if duration allows)."
          );
          const clipRaw = await callLlmCompletion(
            config,
            [
              { role: "system", content: `${globalVoice}\nReturn strictly valid JSON.` },
              {
                role: "user",
                content: `${clipInstruction}
From these timestamped sermon segments ([startMs-endMs] text), return JSON:
{"clips":[{"title":"4-6 word hook","category":"Application|Inspirational|Pastoral|Teaching","startMs":number,"endMs":number,"transcriptExcerpt":"exact words"}]}

Segments:
${segmentGuide.slice(0, 14000)}`,
              },
            ],
            { jsonMode: true, maxTokens: 1500, temperature: 0.3, timeoutMs: 45000 }
          );
          const parsedClips = extractJsonBlock(clipRaw);
          if (parsedClips && Array.isArray(parsedClips.clips) && parsedClips.clips.length > 0) {
            const valid = parsedClips.clips
              .filter(
                (c: unknown): c is GeneratedClipCandidate =>
                  typeof c === "object" &&
                  c !== null &&
                  typeof (c as GeneratedClipCandidate).startMs === "number" &&
                  typeof (c as GeneratedClipCandidate).endMs === "number" &&
                  (c as GeneratedClipCandidate).endMs > (c as GeneratedClipCandidate).startMs + 2000
              )
              .slice(0, 5);
            if (valid.length > 0) {
              chosenClips = valid;
            }
          }
        } catch {
          // Keep offline timed clips
        }
      }

      return { topic, assets: mergedAssets, clips: chosenClips };
    }
  } catch (err) {
    console.warn("[Ambo AI] LLM generation failed, using offline fallback:", err);
  }

  return fallback;
}

export async function regenerateSingleAsset(params: {
  title: string;
  text: string;
  assetType: AssetType;
  customInstruction?: string;
  config: LlmConfig;
  userPrompts?: EffectivePromptMap;
}): Promise<string> {
  const { title, text, assetType, customInstruction, config, userPrompts } = params;
  const fallback = generateOfflineBundle({
    title,
    text,
    segments: [],
    durationSec: 180,
  });

  const savedRule = getPromptText(userPrompts, assetType, "");
  const globalVoice = getPromptText(
    userPrompts,
    "global_system",
    "You are Ambo AI, a pastoral & church communications assistant for The Garden Church in Boston."
  );

  if (config.provider === "offline") {
    const base = fallback.assets[assetType] || fallback.assets.overview;
    const note = customInstruction || (userPrompts?.[assetType]?.isCustom ? savedRule : "");
    return note
      ? `${base}\n\n---\n*Offline preview (custom prompt saved: "${note.slice(0, 140)}"). Sign in via \`claude auth login\` or configure Gemini in API keys for full AI generation.*`
      : base;
  }

  const label = assetType.replace(/_/g, " ");
  const result = await callLlmCompletion(
    config,
    [
      {
        role: "system",
        content: `${globalVoice}\nWrite clear, biblically faithful, well-formatted Markdown matching the user's saved prompt.`,
      },
      {
        role: "user",
        content: `Generate the "${label}" resource for the sermon "${title}".
Saved generation prompt (follow carefully):
${savedRule || `Create a helpful ${label} resource.`}
${customInstruction ? `\nAdditional instruction for this run: ${customInstruction}` : ""}

Sermon text:
"""
${text.slice(0, 22000)}
"""`,
      },
    ],
    { temperature: 0.6, maxTokens: 2500, timeoutMs: 90000 }
  );

  return result.trim() || fallback.assets[assetType] || "";
}

export async function findMoreClipCandidates(params: {
  segments: TranscriptSegment[];
  transcriptText: string;
  existingRanges: Array<{ startMs: number; endMs: number }>;
  config: LlmConfig;
}): Promise<GeneratedClipCandidate[]> {
  return selectOfflineClips(params.segments, params.transcriptText, 3, params.existingRanges);
}
