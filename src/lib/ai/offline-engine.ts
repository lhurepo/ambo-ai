import type { TranscriptSegment } from "../types";

const STOPWORDS = new Set([
  "the", "and", "that", "have", "for", "not", "with", "you", "this", "but", "his", "from",
  "they", "say", "her", "she", "will", "one", "all", "would", "there", "their", "what",
  "out", "about", "who", "get", "which", "when", "make", "can", "like", "time", "just",
  "know", "take", "into", "year", "your", "good", "some", "could", "them", "see", "other",
  "than", "then", "now", "look", "only", "come", "its", "over", "think", "also", "back",
  "after", "use", "two", "how", "our", "work", "first", "well", "way", "even", "new",
  "want", "because", "any", "these", "give", "day", "most", "are", "was", "were", "been",
  "being", "has", "had", "did", "does", "doing", "said", "says", "here", "today", "going",
  "really", "very", "much", "more", "right", "let", "need", "every", "thing", "things",
]);

const BIBLE_BOOK_REGEX =
  /\b(?:1|2|3|First|Second|Third)?\s*(?:Genesis|Exodus|Leviticus|Numbers|Deuteronomy|Joshua|Judges|Ruth|Samuel|Kings|Chronicles|Ezra|Nehemiah|Esther|Job|Psalms?|Proverbs|Ecclesiastes|Song of Solomon|Isaiah|Jeremiah|Lamentations|Ezekiel|Daniel|Hosea|Joel|Amos|Obadiah|Jonah|Micah|Nahum|Habakkuk|Zephaniah|Haggai|Zechariah|Malachi|Matthew|Mark|Luke|John|Acts|Romans|Corinthians|Galatians|Ephesians|Philippians|Colossians|Thessalonians|Timothy|Titus|Philemon|Hebrews|James|Peter|Jude|Revelation)\s+(?:chapter\s+)?\d+(?:[:\s]+(?:verse\s+)?\d+(?:\s*[-–]\s*\d+)?)?/gi;

export function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
  }
  return `${mins}:${String(rem).padStart(2, "0")}`;
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 12);
}

export function extractScriptures(text: string): string[] {
  const matches = text.match(BIBLE_BOOK_REGEX) || [];
  const cleaned = matches.map((m) => m.replace(/\s+/g, " ").trim());
  const unique = Array.from(new Set(cleaned));
  if (unique.length > 0) return unique.slice(0, 12);

  // Suggest grounded scriptures by thematic keywords if none explicitly parsed
  const lower = text.toLowerCase();
  const suggestions: string[] = [];
  if (/peace|rest|weary|anxiet|worry|storm|burden/.test(lower)) {
    suggestions.push("Matthew 11:28-30", "Philippians 4:6-7", "John 14:27");
  }
  if (/grace|forgive|mercy|love|cross|sin/.test(lower)) {
    suggestions.push("Ephesians 2:8-9", "Romans 5:8", "2 Corinthians 12:9");
  }
  if (/hope|wait|trust|faith|promise|future/.test(lower)) {
    suggestions.push("Romans 8:28", "Isaiah 40:31", "Hebrews 11:1");
  }
  if (suggestions.length === 0) {
    suggestions.push("Psalm 119:105", "Colossians 3:16", "James 1:22");
  }
  return suggestions;
}

export function extractKeywords(text: string, limit = 10): string[] {
  const counts = new Map<string, number>();
  const tokens = text.toLowerCase().match(/[a-z]{4,}/g) || [];
  for (const tok of tokens) {
    if (STOPWORDS.has(tok)) continue;
    counts.set(tok, (counts.get(tok) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => word.charAt(0).toUpperCase() + word.slice(1));
}

export function inferTopic(text: string): string {
  const lower = text.toLowerCase();
  if (/peace|storm|rest|worry|anxious|calm/.test(lower)) return "Peace & Trust";
  if (/prayer|pray|psalm|worship/.test(lower)) return "Prayer & Worship";
  if (/grace|mercy|forgive|salvation|gospel/.test(lower)) return "Grace & Gospel";
  if (/serve|community|church|neighbor|mission/.test(lower)) return "Community & Mission";
  if (/family|marriage|parent|home/.test(lower)) return "Family & Relationships";
  if (/hope|persever|wait|trial|suffering/.test(lower)) return "Perseverance & Hope";
  return "Christian Living";
}

export interface GeneratedClipCandidate {
  title: string;
  category: "Application" | "Inspirational" | "Pastoral" | "Teaching";
  startMs: number;
  endMs: number;
  transcriptExcerpt: string;
}

export function selectOfflineClips(
  segments: TranscriptSegment[],
  transcriptText: string,
  count = 4,
  excludeRanges: Array<{ startMs: number; endMs: number }> = []
): GeneratedClipCandidate[] {
  if (!segments || segments.length === 0) return [];

  const totalStart = segments[0].start;
  const totalEnd = segments[segments.length - 1].end;
  const totalDur = Math.max(1, totalEnd - totalStart);

  // Build candidate windows of 18-55 seconds aligned on segment boundaries
  const candidates: Array<GeneratedClipCandidate & { score: number }> = [];
  const categories: Array<GeneratedClipCandidate["category"]> = [
    "Inspirational",
    "Teaching",
    "Pastoral",
    "Application",
  ];

  const targetWindow = totalDur < 50 ? Math.max(8, totalDur * 0.45) : 34;

  for (let i = 0; i < segments.length; i++) {
    const startSec = segments[i].start;
    let j = i;
    while (j + 1 < segments.length && segments[j].end - startSec < targetWindow) {
      j++;
    }
    const endSec = segments[j].end;
    const dur = endSec - startSec;
    if (dur < 5 && totalDur > 12) continue;

    const startMs = Math.round(startSec * 1000);
    const endMs = Math.round(endSec * 1000);

    const overlaps = excludeRanges.some(
      (r) => Math.max(r.startMs, startMs) < Math.min(r.endMs, endMs) - 3000
    );
    if (overlaps) continue;

    const excerpt = segments
      .slice(i, j + 1)
      .map((s) => s.text)
      .join(" ")
      .trim();

    let score = excerpt.length * 0.02;
    if (/jesus|god|grace|peace|hope|scripture|matthew|romans|psalm|love|faith/i.test(excerpt)) score += 6;
    if (/practical|this week|today|remember|notice|step/i.test(excerpt)) score += 4;
    if (/!|\?/.test(excerpt)) score += 2;

    let category: GeneratedClipCandidate["category"] = categories[candidates.length % categories.length];
    if (/step|week|minute|practice|action|apply/i.test(excerpt)) category = "Application";
    else if (/matthew|romans|scripture|verse|bible|means/i.test(excerpt)) category = "Teaching";
    else if (/weary|burden|rest|comfort|heart|grace|season/i.test(excerpt)) category = "Pastoral";
    else category = "Inspirational";

    const firstSentence = splitSentences(excerpt)[0] || excerpt;
    const words = firstSentence.replace(/[^\w\s']/g, "").split(/\s+/).filter(Boolean).slice(0, 6);
    const title = words.length >= 3 ? words.join(" ") : `Key Moment (${formatTimestamp(startSec)})`;

    candidates.push({ title, category, startMs, endMs, transcriptExcerpt: excerpt, score });
  }

  if (candidates.length === 0 && segments.length > 0) {
    const first = segments[0];
    const last = segments[segments.length - 1];
    return [
      {
        title: "Opening Message Highlight",
        category: "Inspirational",
        startMs: Math.round(first.start * 1000),
        endMs: Math.round(last.end * 1000),
        transcriptExcerpt: transcriptText.slice(0, 320),
      },
    ];
  }

  // Greedily pick top non-overlapping candidates
  candidates.sort((a, b) => b.score - a.score);
  const chosen: GeneratedClipCandidate[] = [];
  for (const cand of candidates) {
    if (chosen.length >= count) break;
    const overlapsChosen = chosen.some(
      (c) => Math.max(c.startMs, cand.startMs) < Math.min(c.endMs, cand.endMs) - 3000
    );
    if (!overlapsChosen) {
      chosen.push({
        title: cand.title,
        category: cand.category,
        startMs: cand.startMs,
        endMs: cand.endMs,
        transcriptExcerpt: cand.transcriptExcerpt,
      });
    }
  }
  return chosen.sort((a, b) => a.startMs - b.startMs);
}

export function generateOfflineBundle(params: {
  title: string;
  text: string;
  segments: TranscriptSegment[];
  durationSec: number;
}): {
  topic: string;
  assets: Record<string, string>;
  clips: GeneratedClipCandidate[];
} {
  const { title, text, segments, durationSec } = params;
  const cleanText = text.trim() || title;
  const sentences = splitSentences(cleanText);
  const scriptures = extractScriptures(cleanText);
  const keywords = extractKeywords(cleanText, 10);
  const topic = inferTopic(cleanText);

  const leadSentences = sentences.slice(0, 3).join(" ") || cleanText.slice(0, 320);
  const closingSentences = sentences.slice(-2).join(" ") || leadSentences;

  // Chapters
  const chapterLines: string[] = [];
  if (segments.length >= 2) {
    const chunkCount = Math.min(5, Math.max(2, Math.ceil(segments.length / 3)));
    const step = Math.max(1, Math.floor(segments.length / chunkCount));
    for (let idx = 0; idx < segments.length; idx += step) {
      const seg = segments[idx];
      const preview = seg.text.split(/\s+/).slice(0, 7).join(" ");
      chapterLines.push(`- **${formatTimestamp(seg.start)}** — ${preview}...`);
    }
  } else {
    chapterLines.push(`- **0:00** — Opening & Scripture Reading`);
    chapterLines.push(`- **${formatTimestamp(Math.floor(durationSec * 0.45))}** — Core Theological Insight`);
    chapterLines.push(`- **${formatTimestamp(Math.floor(durationSec * 0.8))}** — Weekly Practical Application`);
  }

  const points = (sentences.length >= 3 ? sentences.slice(0, 4) : [cleanText]).map(
    (s, idx) => `${idx + 1}. **Main Takeaway ${idx + 1}:** ${s}`
  );

  const quotes = (sentences.length > 0 ? sentences.slice(0, 5) : [cleanText.slice(0, 180)]).map(
    (s) => `> "${s}"`
  );

  const primaryScripture = scriptures[0] || "Matthew 11:28-30";
  const secondaryScripture = scriptures[1] || "Romans 8:28";

  const assets: Record<string, string> = {
    overview: `## Sermon Overview: ${title}\n\n${leadSentences}\n\n**Central Focus:** Anchored in **${primaryScripture}**, this message calls the congregation to move from overwhelm into anchored trust and daily obedience.\n\n**Key Closing Call:** ${closingSentences}`,
    chapters: chapterLines.join("\n"),
    keywords: keywords.join(", "),
    points: `## Key Sermon Points\n\n${points.join("\n\n")}`,
    scripture: `## Scripture References & Supporting Passages\n\n### Referenced & Related Texts\n${scriptures
      .map((ref) => `- **${ref}** — Connects directly to the message theme of *${topic}*.`)
      .join("\n")}\n\n### Suggested Companion Passages\n- **Psalm 46:1-3** — God as our ever-present refuge in trouble.\n- **Philippians 4:6-7** — Prayerful surrender leading to peace that guards the heart.`,
    quotes: `## Notable Sermon Quotes\n\n${quotes.join("\n\n")}`,
    discussion_questions: `## Small Group Discussion Questions\n\n1. **Icebreaker:** When life feels busiest or most uncertain, what is your natural first reaction?\n2. **Digging Into Scripture:** Read **${primaryScripture}** together. What stands out to you about God's invitation in this passage?\n3. **Heart Check:** Which statement from *"${title}"* challenged or encouraged you the most?\n4. **Connecting the Word:** How does **${secondaryScripture}** reshape the way you view a waiting season you are currently walking through?\n5. **Living It Out:** What is one concrete practice you can commit to this week so this truth moves from notes into daily habit?\n6. **Prayer Focus:** How can the group pray specifically for your peace and endurance this week?`,
    small_group_guide: `## Small Group Leader Guide — ${title}\n\n**Goal:** Help group members internalize **${primaryScripture}** and practice one tangible spiritual habit together this week.\n\n### 1. Welcome & Warm-Up (10 mins)\n- Open in brief prayer thanking God for gathering your group.\n- Ask: *"What was one unexpected grace or challenge you experienced this past week?"*\n\n### 2. Sermon Recap (5 mins)\n${leadSentences}\n\n### 3. Scripture Study (20 mins)\nRead **${primaryScripture}** and **${secondaryScripture}** aloud.\n- Ask the group to underline repeated words or promises.\n- Discuss how the sermon bridged the biblical text to everyday life.\n\n### 4. Practical Next Step (10 mins)\n${closingSentences}\n\n### 5. Closing Prayer (10 mins)\nPair up in twos or threes and pray over each person's specific burden for the week ahead.`,
    devotional: `## 5-Day Devotional Plan: ${title}\n\n### Day 1 — Come as You Are (${primaryScripture})\n**Reflection:** ${sentences[0] || leadSentences}\n**Prayer:** *Lord, I bring my weariness honestly before You today.*\n\n### Day 2 — Grace in the Waiting (${secondaryScripture})\n**Reflection:** ${sentences[1] || leadSentences}\n**Prayer:** *Father, help me trust Your unseen work even when answers feel slow.*\n\n### Day 3 — Practicing Quiet Trust (Psalm 46:10)\n**Reflection:** ${sentences[2] || closingSentences}\n**Action:** Pause for 10 unhurried minutes today before opening social feeds.\n\n### Day 4 — Renewing the Mind (Philippians 4:6-7)\n**Reflection:** Trade anxious rehearsal for honest gratitude and specific petition.\n**Action:** Write down one worry and pray over it aloud.\n\n### Day 5 — Sharing Peace With Others (Colossians 3:15)\n**Reflection:** ${closingSentences}\n**Action:** Encourage one friend or family member with a verse from Sunday's message.`,
    social_instagram: `### Instagram Carousel & Feed Post\n\n**Slide 1 (Hook):** ${title}\n**Slide 2 (Truth):** ${sentences[0] || leadSentences}\n**Slide 3 (Scripture):** ${primaryScripture}\n**Slide 4 (Step):** ${closingSentences}\n\n**Caption:**\nYou don't have to have everything figured out before coming to God. In Sunday's message *"${title}"*, we looked at **${primaryScripture}** and what real rest looks like in a noisy week.\n\nSave this post for Monday morning and tag someone who needs encouragement today. 🙏\n\n#ChurchOnline #SundaySermon #${topic.replace(/[^a-zA-Z0-9]/g, "")} #FaithInAction`,
    social_facebook: `### Facebook Community Post\n\nMissed Sunday or want to revisit Sunday's message, *"${title}"*?\n\n${leadSentences}\n\n📖 Key Scripture: **${primaryScripture}**\n\n💬 **Join the conversation:** What is one way you're practicing stillness and faith this week? Share below so our church family can encourage you!`,
    social_twitter: `### X / Short Posts\n\n1. "${sentences[0] || leadSentences}" — from Sunday's sermon *${title}* (${primaryScripture}).\n\n2. God does not wait until you feel strong to invite you close. Read **${primaryScripture}** today.\n\n3. This week's rhythm: 10 quiet minutes with Scripture before checking your phone. Peace starts with presence.`,
    social_captions: `### Short-Form Video / Reel Captions\n\n**Option 1 (Reflective):**\n${sentences[0] || leadSentences} (${primaryScripture}) #SundayMessage #Faith\n\n**Option 2 (Action-Oriented):**\nIf this week already feels heavy, take 60 seconds to hear this reminder from *"${title}"*. Watch the full sermon on our page!`,
    email_recap: `## Weekly Church Recap Email\n\n**Subject:** This Week's Recap: ${title} (${primaryScripture})\n\nHi Church Family,\n\nThank you for worshiping with us! In case you missed Sunday's message—or want to carry it deeper into your week—here is your quick recap of **"${title}"**.\n\n### What We Learned\n${leadSentences}\n\n### Scriptures to Keep Close\n- **${primaryScripture}**\n- **${secondaryScripture}**\n\n### Your Next Step This Week\n${closingSentences}\n\nWe're praying for you this week. See you Sunday!\n\nGrace and peace,\n*Your Pastoral Team*`,
    blog_post: `## ${title}\n\n${leadSentences}\n\n### Anchored in ${primaryScripture}\nWhen life speeds up, it is tempting to believe peace only arrives after every problem is solved. Yet Scripture paints a different picture. In **${primaryScripture}**, God meets people right in the middle of real exhaustion.\n\n### Trusting God in the Middle (${secondaryScripture})\n${sentences.slice(1, 4).join(" ") || leadSentences}\n\n### Walking It Out Monday Through Saturday\n${closingSentences}\n\nTake time this week to revisit **${primaryScripture}** and share what God is teaching you with your small group.`,
    coach_structure: `## Structure & Flow Review\n\n- **Opening Hook:** Opens directly with relatable human tension and moves promptly into **${primaryScripture}**.\n- **Pacing & Transitions:** ${sentences.length} core sentences detected across ${formatTimestamp(durationSec || 180)} of content. Consider adding a clear 1-sentence signpost between your exposition of **${primaryScripture}** and **${secondaryScripture}**.\n- **Closing Landing:** Closes with a concrete, memorable weekly challenge—strong call to action.`,
    coach_illustrations: `## Illustrations & Story Ideas\n\n- **Modern Contrast:** Pair the pace of morning notifications/phones with the unhurried posture of Psalm 23 ("makes me lie down in green pastures").\n- **Biblical Narrative Link:** Reference Elijah under the broom tree (1 Kings 19) to show how God restores weary servants physically and spiritually.\n- **Visual Object Lesson:** A literal heavy backpack or overflowing calendar on stage makes "weary and burdened" immediately tangible.`,
    coach_application: `## Practical Application Opportunities\n\n- **Keep the 10-Minute Morning Rhythm:** Very specific and achievable for busy families.\n- **Add a Mid-Week Check-In Prompt:** Encourage members to text one accountability partner on Wednesday.\n- **Tailor for Skeptics & Seekers:** Briefly acknowledge that trusting God doesn't deny real pain—it anchors us while walking through it.`,
  };

  return {
    topic,
    assets,
    clips: selectOfflineClips(segments, cleanText, 4),
  };
}

export function answerOfflineChat(question: string, sermonTitle: string, text: string): string {
  const sentences = splitSentences(text);
  const scriptures = extractScriptures(text);
  const qTokens = new Set(
    (question.toLowerCase().match(/[a-z]{3,}/g) || []).filter((t) => !STOPWORDS.has(t))
  );

  const ranked = sentences
    .map((s) => {
      const lower = s.toLowerCase();
      let hits = 0;
      qTokens.forEach((tok) => {
        if (lower.includes(tok)) hits++;
      });
      return { s, hits };
    })
    .sort((a, b) => b.hits - a.hits);

  const relevant = ranked.filter((r) => r.hits > 0).slice(0, 3).map((r) => r.s);
  const excerpts = relevant.length > 0 ? relevant : sentences.slice(0, 3);

  return `Based on **"${sermonTitle}"** (running on the free local offline engine — connect Gemini, Groq, OpenRouter, or Ollama in **AI & API Keys** for full generative dialogue):\n\n### Grounded Excerpts from Your Sermon\n${excerpts
    .map((e) => `- *"${e}"*`)
    .join("\n")}\n\n### Key Scriptures & Themes\n- **Scriptures:** ${scriptures.join(", ")}\n- **Core Keywords:** ${extractKeywords(text, 6).join(", ")}\n\n**Practical Suggestion:** Use the quotes above to anchor your response around **${scriptures[0] || "your core passage"}** and keep the focus on one clear takeaway for your congregation.`;
}
