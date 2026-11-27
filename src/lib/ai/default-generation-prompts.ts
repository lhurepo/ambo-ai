import { eq } from "drizzle-orm";
import { db, ensureDbInitialized } from "../db";
import { generationPrompts } from "../db/schema";

export interface GenerationPromptSlot {
  key: string;
  label: string;
  group:
    | "Global"
    | "Sermon Notes"
    | "Discipleship"
    | "Social & Comms"
    | "Preaching Coach"
    | "Video Clips"
    | "PDF & Design";
  defaultPrompt: string;
}

export const GENERATION_PROMPT_SLOTS: GenerationPromptSlot[] = [
  {
    key: "global_system",
    label: "Global Voice & Ministry Context",
    group: "Global",
    defaultPrompt:
      "You are the ministry communications assistant for The Garden Church in Boston—grounded in Scripture, warm, urban, reflective, and practical. Write clear, biblically faithful Markdown that helps everyday people follow Jesus in the city. Stay strictly rooted in what was actually taught in the sermon.",
  },
  {
    key: "overview",
    label: "Sermon Summary",
    group: "Sermon Notes",
    defaultPrompt: "Write a 2–3 paragraph sermon summary in Markdown highlighting the central passage, big idea, and pastoral invitation.",
  },
  {
    key: "chapters",
    label: "Chapters & Timestamps",
    group: "Sermon Notes",
    defaultPrompt: "Markdown bullet list of 3–6 timestamped chapters formatted like '- **0:00** — Chapter title'.",
  },
  {
    key: "keywords",
    label: "Keywords",
    group: "Sermon Notes",
    defaultPrompt: "Comma-separated list of 8–10 key biblical and theological themes from the sermon.",
  },
  {
    key: "points",
    label: "Key Sermon Points",
    group: "Sermon Notes",
    defaultPrompt: "Markdown numbered list of 3–5 core sermon movements or teaching points with concise explanations and text anchors.",
  },
  {
    key: "scripture",
    label: "Scripture References",
    group: "Sermon Notes",
    defaultPrompt: "Markdown list of cited Scripture references from the sermon plus 2–3 supporting cross-references with brief study notes.",
  },
  {
    key: "quotes",
    label: "Notable Quotes",
    group: "Sermon Notes",
    defaultPrompt: "Markdown blockquotes of 4–6 memorable verbatim or near-verbatim quotes from the sermon.",
  },
  {
    key: "discussion_questions",
    label: "Discussion Questions",
    group: "Discipleship",
    defaultPrompt:
      "Markdown numbered list of 6 thoughtful small group discussion questions moving from icebreaker and Scripture observation to personal reflection and concrete midweek practice.",
  },
  {
    key: "small_group_guide",
    label: "Small Group Leader Guide",
    group: "Discipleship",
    defaultPrompt: "Complete Small Group Leader Guide with sections: Welcome, Sermon Recap, Scripture Study, Group Discussion, Action Step, and Closing Prayer.",
  },
  {
    key: "devotional",
    label: "5-Day Devotional Plan",
    group: "Discipleship",
    defaultPrompt: "Complete 5-Day Devotional Plan rooted in the sermon with a daily title, Scripture reading, short reflection, and prayer prompt.",
  },
  {
    key: "social_instagram",
    label: "Instagram Post & Carousel",
    group: "Social & Comms",
    defaultPrompt: "Instagram carousel slide-by-slide outline plus a warm, non-cliché feed caption tailored for Boston neighbors and church community.",
  },
  {
    key: "social_facebook",
    label: "Facebook Community Post",
    group: "Social & Comms",
    defaultPrompt: "Warm Facebook church community recap post with key takeaway and an inviting comment question.",
  },
  {
    key: "social_twitter",
    label: "X / Short Quotes",
    group: "Social & Comms",
    defaultPrompt: "3 concise, shareable short-form text posts rooted in the sermon's core truth.",
  },
  {
    key: "social_captions",
    label: "Reel & Clip Captions",
    group: "Social & Comms",
    defaultPrompt: "2 punchy vertical video / Reel captions with a hook line and clear next step.",
  },
  {
    key: "podcast_show_notes",
    label: "Spotify & Apple Podcast Show Notes",
    group: "Social & Comms",
    defaultPrompt:
      "Write ready-to-paste Spotify & Apple Podcasts show notes in Markdown with: 1) 2 compelling episode title options, 2) a warm 2–3 sentence episode description hook, 3) key Scriptures referenced, 4) clickable 00:00 chapter timestamps, and 5) a brief invitation to connect with The Garden Church in Boston.",
  },
  {
    key: "email_recap",
    label: "Weekly Email Recap",
    group: "Social & Comms",
    defaultPrompt: "Complete weekly Garden Church email recap with Subject line, warm greeting, 3 takeaways, Scripture links, and Sunday/midweek invitation.",
  },
  {
    key: "blog_post",
    label: "Sermon Blog Article",
    group: "Social & Comms",
    defaultPrompt: "Conversational 400–600 word church blog article based on the sermon for seekers and church members alike.",
  },
  {
    key: "coach_structure",
    label: "Coach: Structure & Flow",
    group: "Preaching Coach",
    defaultPrompt: "Constructive preaching coaching feedback on sermon structure, pacing, transitions, and gospel clarity.",
  },
  {
    key: "coach_illustrations",
    label: "Coach: Illustration Ideas",
    group: "Preaching Coach",
    defaultPrompt: "3 concrete illustration, metaphor, or city-life story ideas that could strengthen or complement this message.",
  },
  {
    key: "coach_application",
    label: "Coach: Practical Application",
    group: "Preaching Coach",
    defaultPrompt: "3 ways to sharpen practical weekly application for both longtime believers and spiritual explorers in Boston.",
  },
  {
    key: "clips",
    label: "Auto Video Clip Selection",
    group: "Video Clips",
    defaultPrompt:
      "Select 4 self-contained, high-impact sermon moments (15–65 seconds each when duration allows) that work well on vertical social reels without needing prior context.",
  },
  {
    key: "pdf_design",
    label: "PDF Handout & Design Prompt",
    group: "PDF & Design",
    defaultPrompt:
      "Design a warm, scannable Sunday handout for The Garden Church. Keep bullet points concise, highlight key Scriptures in bold or callout boxes, and choose a clean layout and density that prints cleanly without awkward page splits.",
  },
];

export const ALLOWED_GENERATION_KEYS = new Set(GENERATION_PROMPT_SLOTS.map((s) => s.key));

export function getDefaultPromptText(key: string): string {
  return GENERATION_PROMPT_SLOTS.find((s) => s.key === key)?.defaultPrompt || "";
}

export function getEffectiveGenerationPrompts(
  userId: string
): Record<string, { promptText: string; isCustom: boolean; updatedAt: number | null }> {
  ensureDbInitialized();
  const rows = db
    .select()
    .from(generationPrompts)
    .where(eq(generationPrompts.userId, userId))
    .all();

  const customMap = new Map(rows.map((r) => [r.assetType, r]));
  const result: Record<string, { promptText: string; isCustom: boolean; updatedAt: number | null }> = {};

  for (const slot of GENERATION_PROMPT_SLOTS) {
    const custom = customMap.get(slot.key);
    if (custom && custom.promptText.trim()) {
      result[slot.key] = {
        promptText: custom.promptText.trim(),
        isCustom: true,
        updatedAt: custom.updatedAt,
      };
    } else {
      result[slot.key] = {
        promptText: slot.defaultPrompt,
        isCustom: false,
        updatedAt: null,
      };
    }
  }
  return result;
}
