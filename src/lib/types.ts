export type CaptionTypography =
  | "GardenResolve"
  | "GardenYankee"
  | "Modern"
  | "Classic"
  | "Bold"
  | "Elegant"
  | "Condensed"
  | "Playful"
  | "Sleek"
  | "Refined"
  | "Typewriter";

export type CaptionSize = "small" | "medium" | "large";
export type CaptionPosition = "top" | "mid" | "bottom";
export type CaptionBgStyle = "none" | "background" | "border";
export type AspectRatio = "9:16" | "1:1" | "16:9";

export interface CaptionSettings {
  typography: CaptionTypography;
  aspectRatio: AspectRatio;
  position: CaptionPosition;
  captionSize: CaptionSize;
  colorHex: string;
  backgroundStyle: CaptionBgStyle;
  backgroundColorHex: string;
  highlights: boolean; // Karaoke highlighting
  highlightColorHex: string;
  facialTracking: boolean;
}

export interface CaptionPreset extends CaptionSettings {
  label: string;
  fontClass: string;
  description: string;
}

export const CAPTION_PRESETS: CaptionPreset[] = [
  {
    typography: "GardenYankee",
    label: "Garden Sans",
    fontClass: "font-yankee",
    description: "Garden Church brand sans",
    aspectRatio: "9:16",
    position: "mid",
    captionSize: "medium",
    colorHex: "#FFFFFF",
    backgroundStyle: "background",
    backgroundColorHex: "#121413",
    highlights: true,
    highlightColorHex: "#BDD630",
    facialTracking: true,
  },
  {
    typography: "GardenResolve",
    label: "Garden Display",
    fontClass: "font-resolve tracking-wide uppercase",
    description: "Garden Church compressed headline",
    aspectRatio: "9:16",
    position: "mid",
    captionSize: "large",
    colorHex: "#FFFFFF",
    backgroundStyle: "background",
    backgroundColorHex: "#1D3519",
    highlights: true,
    highlightColorHex: "#BDD630",
    facialTracking: true,
  },
  {
    typography: "Modern",
    label: "Modern",
    fontClass: "font-poppins",
    description: "Clean geometric pill",
    aspectRatio: "9:16",
    position: "mid",
    captionSize: "medium",
    colorHex: "#FFFFFF",
    backgroundStyle: "background",
    backgroundColorHex: "#002A3C",
    highlights: true,
    highlightColorHex: "#6FB3C8",
    facialTracking: true,
  },
  {
    typography: "Classic",
    label: "Classic",
    fontClass: "font-merriweather",
    description: "Editorial serif warmth",
    aspectRatio: "9:16",
    position: "mid",
    captionSize: "medium",
    colorHex: "#FFFFFF",
    backgroundStyle: "none",
    backgroundColorHex: "#001B27",
    highlights: true,
    highlightColorHex: "#F3B92D",
    facialTracking: true,
  },
  {
    typography: "Bold",
    label: "Bold",
    fontClass: "font-montserrat",
    description: "High-impact social reel",
    aspectRatio: "9:16",
    position: "mid",
    captionSize: "medium",
    colorHex: "#FFFFFF",
    backgroundStyle: "none",
    backgroundColorHex: "#000000",
    highlights: true,
    highlightColorHex: "#F3B92D",
    facialTracking: true,
  },
  {
    typography: "Elegant",
    label: "Elegant",
    fontClass: "font-raleway",
    description: "Refined light card",
    aspectRatio: "9:16",
    position: "mid",
    captionSize: "medium",
    colorHex: "#002A3C",
    backgroundStyle: "background",
    backgroundColorHex: "#FFFFFF",
    highlights: true,
    highlightColorHex: "#2A7B96",
    facialTracking: true,
  },
  {
    typography: "Condensed",
    label: "Condensed",
    fontClass: "font-bebas",
    description: "Punchy vertical headline",
    aspectRatio: "9:16",
    position: "mid",
    captionSize: "large",
    colorHex: "#FFFFFF",
    backgroundStyle: "background",
    backgroundColorHex: "#2A7B96",
    highlights: true,
    highlightColorHex: "#F3B92D",
    facialTracking: true,
  },
  {
    typography: "Playful",
    label: "Playful",
    fontClass: "font-fredoka",
    description: "Friendly youth ministry",
    aspectRatio: "9:16",
    position: "mid",
    captionSize: "medium",
    colorHex: "#FFFFFF",
    backgroundStyle: "none",
    backgroundColorHex: "#002A3C",
    highlights: true,
    highlightColorHex: "#81DAF2",
    facialTracking: true,
  },
  {
    typography: "Sleek",
    label: "Sleek",
    fontClass: "font-workSans",
    description: "Outlined studio subtitle",
    aspectRatio: "9:16",
    position: "bottom",
    captionSize: "medium",
    colorHex: "#FFFFFF",
    backgroundStyle: "border",
    backgroundColorHex: "#002A3C",
    highlights: true,
    highlightColorHex: "#6FB3C8",
    facialTracking: true,
  },
  {
    typography: "Refined",
    label: "Refined",
    fontClass: "font-libreBaskerville",
    description: "Timeless sermon quote",
    aspectRatio: "9:16",
    position: "mid",
    captionSize: "medium",
    colorHex: "#F7F5F0",
    backgroundStyle: "none",
    backgroundColorHex: "#002A3C",
    highlights: false,
    highlightColorHex: "#6FB3C8",
    facialTracking: true,
  },
  {
    typography: "Typewriter",
    label: "Typewriter",
    fontClass: "font-courierPrime",
    description: "Notes & study journal",
    aspectRatio: "9:16",
    position: "bottom",
    captionSize: "small",
    colorHex: "#001B27",
    backgroundStyle: "background",
    backgroundColorHex: "#F7F5F0",
    highlights: true,
    highlightColorHex: "#2A7B96",
    facialTracking: true,
  },
];

export const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
  typography: "Bold",
  aspectRatio: "9:16",
  position: "mid",
  captionSize: "medium",
  colorHex: "#FFFFFF",
  backgroundStyle: "none",
  backgroundColorHex: "#002A3C",
  highlights: true,
  highlightColorHex: "#6FB3C8",
  facialTracking: true,
};

export interface TranscriptWord {
  id: string;
  word: string;
  start: number; // seconds
  end: number;   // seconds
  probability?: number;
}

export interface TranscriptSegment {
  id: number;
  start: number;
  end: number;
  text: string;
  words: TranscriptWord[];
}

export interface FaceTrackData {
  width: number;
  height: number;
  fps: number;
  duration: number;
  points: { t: number; centerX: number; centerY: number; detected: boolean }[];
}

export const ASSET_TYPES = [
  "overview",
  "chapters",
  "keywords",
  "points",
  "scripture",
  "quotes",
  "discussion_questions",
  "small_group_guide",
  "devotional",
  "social_instagram",
  "social_facebook",
  "social_twitter",
  "social_captions",
  "email_recap",
  "blog_post",
  "coach_structure",
  "coach_illustrations",
  "coach_application",
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

export type LlmProvider =
  | "claude_cli"
  | "offline"
  | "ollama"
  | "gemini"
  | "groq"
  | "openrouter"
  | "openai"
  | "anthropic"
  | "custom";

export interface AiSettingsPublic {
  llmProvider: LlmProvider;
  hasApiKey: boolean;
  apiKeyMasked: string;
  baseUrl: string;
  model: string;
  whisperModel: "tiny" | "base" | "small" | "medium";
  whisperLanguage: string;
  defaultCaptionSettings: CaptionSettings;
}
