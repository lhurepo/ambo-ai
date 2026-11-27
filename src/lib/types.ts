export type CaptionTypography =
  | "GardenYankee"
  | "GardenResolve"
  | "PlusJakarta"
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

export type WatermarkPosition = "top-right" | "top-left" | "bottom-right";

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
  showCaptions?: boolean;
  uppercase?: boolean;
  showWatermark?: boolean;
  watermarkPosition?: WatermarkPosition;
  showOutroBumper?: boolean;
}

export interface FontOption {
  id: CaptionTypography;
  label: string;
  category: string;
  fontClass: string;
  fontFamilyCss: string;
  sample: string;
}

export const FONT_OPTIONS: FontOption[] = [
  {
    id: "GardenYankee",
    label: "Garden Sans",
    category: "Church Brand",
    fontClass: "font-yankee",
    fontFamilyCss: "'Yankee', sans-serif",
    sample: "Grace & Peace",
  },
  {
    id: "GardenResolve",
    label: "Garden Display",
    category: "Church Brand",
    fontClass: "font-resolve",
    fontFamilyCss: "'Resolve Compressed', sans-serif",
    sample: "GRACE & PEACE",
  },
  {
    id: "PlusJakarta",
    label: "Plus Jakarta",
    category: "Modern",
    fontClass: "font-jakarta",
    fontFamilyCss: "'Plus Jakarta Sans', sans-serif",
    sample: "Grace & Peace",
  },
  {
    id: "Modern",
    label: "Poppins",
    category: "Clean",
    fontClass: "font-poppins",
    fontFamilyCss: "'Poppins', sans-serif",
    sample: "Grace & Peace",
  },
  {
    id: "Bold",
    label: "Montserrat",
    category: "Bold",
    fontClass: "font-montserrat",
    fontFamilyCss: "'Montserrat', sans-serif",
    sample: "Grace & Peace",
  },
  {
    id: "Condensed",
    label: "Bebas Neue",
    category: "Tall",
    fontClass: "font-bebas",
    fontFamilyCss: "'Bebas Neue', sans-serif",
    sample: "GRACE & PEACE",
  },
  {
    id: "Classic",
    label: "Merriweather",
    category: "Serif",
    fontClass: "font-merriweather",
    fontFamilyCss: "'Merriweather', serif",
    sample: "Grace & Peace",
  },
  {
    id: "Refined",
    label: "Baskerville",
    category: "Serif",
    fontClass: "font-libreBaskerville",
    fontFamilyCss: "'Libre Baskerville', serif",
    sample: "Grace & Peace",
  },
  {
    id: "Elegant",
    label: "Raleway",
    category: "Light",
    fontClass: "font-raleway",
    fontFamilyCss: "'Raleway', sans-serif",
    sample: "Grace & Peace",
  },
  {
    id: "Playful",
    label: "Fredoka",
    category: "Friendly",
    fontClass: "font-fredoka",
    fontFamilyCss: "'Fredoka', sans-serif",
    sample: "Grace & Peace",
  },
  {
    id: "Sleek",
    label: "Work Sans",
    category: "Studio",
    fontClass: "font-workSans",
    fontFamilyCss: "'Work Sans', sans-serif",
    sample: "Grace & Peace",
  },
  {
    id: "Typewriter",
    label: "Courier Prime",
    category: "Mono",
    fontClass: "font-courierPrime",
    fontFamilyCss: "'Courier Prime', monospace",
    sample: "Grace & Peace",
  },
];

export interface OverlayColorTheme {
  id: string;
  label: string;
  colorHex: string;
  backgroundStyle: CaptionBgStyle;
  backgroundColorHex: string;
  highlights: boolean;
  highlightColorHex: string;
}

export const OVERLAY_COLOR_THEMES: OverlayColorTheme[] = [
  {
    id: "garden-root",
    label: "Garden Root",
    colorHex: "#FFFFFF",
    backgroundStyle: "background",
    backgroundColorHex: "#1D3519",
    highlights: true,
    highlightColorHex: "#BDD630",
  },
  {
    id: "garden-soil",
    label: "Garden Soil",
    colorHex: "#F4F2E6",
    backgroundStyle: "background",
    backgroundColorHex: "#121413",
    highlights: true,
    highlightColorHex: "#BDD630",
  },
  {
    id: "garden-dew",
    label: "Garden Dew",
    colorHex: "#1D3519",
    backgroundStyle: "background",
    backgroundColorHex: "#F4F2E6",
    highlights: true,
    highlightColorHex: "#121413",
  },
  {
    id: "garden-clean",
    label: "Clean Shadow",
    colorHex: "#FFFFFF",
    backgroundStyle: "border",
    backgroundColorHex: "#1D3519",
    highlights: true,
    highlightColorHex: "#BDD630",
  },
  {
    id: "ambo-navy",
    label: "Ambo Navy",
    colorHex: "#FFFFFF",
    backgroundStyle: "background",
    backgroundColorHex: "#002A3C",
    highlights: true,
    highlightColorHex: "#6FB3C8",
  },
];

export interface CaptionPreset extends CaptionSettings {
  label: string;
  fontClass: string;
  fontFamilyCss: string;
  description: string;
}

export const CAPTION_PRESETS: CaptionPreset[] = FONT_OPTIONS.map((opt) => {
  const isGarden = opt.id === "GardenYankee" || opt.id === "GardenResolve";
  return {
    typography: opt.id,
    label: opt.label,
    fontClass: opt.fontClass,
    fontFamilyCss: opt.fontFamilyCss,
    description: `${opt.category} typeface`,
    aspectRatio: "9:16",
    position: "mid",
    captionSize: opt.id === "GardenResolve" || opt.id === "Condensed" ? "large" : "medium",
    colorHex: "#FFFFFF",
    backgroundStyle: "background",
    backgroundColorHex: isGarden || opt.id === "PlusJakarta" ? "#1D3519" : "#1D3519",
    highlights: true,
    highlightColorHex: "#BDD630",
    facialTracking: true,
    showCaptions: true,
    uppercase: opt.id === "GardenResolve" || opt.id === "Condensed",
  };
});

export const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
  typography: "GardenYankee",
  aspectRatio: "9:16",
  position: "mid",
  captionSize: "medium",
  colorHex: "#FFFFFF",
  backgroundStyle: "background",
  backgroundColorHex: "#1D3519",
  highlights: true,
  highlightColorHex: "#BDD630",
  facialTracking: true,
  showCaptions: true,
  uppercase: false,
  showWatermark: false,
  watermarkPosition: "top-right",
  showOutroBumper: false,
};

export type PdfHeaderStyle = "banner" | "minimal" | "boxed" | "centered";
export type PdfFontPairing = "garden" | "editorial" | "classic" | "modern";
export type PdfDensity = "compact" | "comfortable" | "spacious";

export interface PdfPalette {
  primaryHex: string;
  accentHex: string;
  surfaceHex: string;
  headerBgHex: string;
  headerTextHex: string;
}

export interface PdfDesignSpec {
  headerStyle: PdfHeaderStyle;
  fontPairing: PdfFontPairing;
  density: PdfDensity;
  palette: PdfPalette;
  showLogo: boolean;
  showMetadata: boolean;
  showBadgeNumbers: boolean;
  uppercaseHeadings: boolean;
  useAiDesigner: boolean;
  fillInTheBlanks?: boolean;
  showQrCode?: boolean;
  qrUrl?: string;
  qrLabel?: string;
}

export const PDF_COLOR_THEMES: Array<{ id: string; label: string; palette: PdfPalette }> = [
  {
    id: "garden-classic",
    label: "Garden Classic",
    palette: {
      primaryHex: "#1D3519",
      accentHex: "#BDD630",
      surfaceHex: "#F4F2E6",
      headerBgHex: "#1D3519",
      headerTextHex: "#FFFFFF",
    },
  },
  {
    id: "garden-ink-saver",
    label: "Garden Print (Light)",
    palette: {
      primaryHex: "#1D3519",
      accentHex: "#BDD630",
      surfaceHex: "#F4F2E6",
      headerBgHex: "#F4F2E6",
      headerTextHex: "#1D3519",
    },
  },
  {
    id: "ambo-navy",
    label: "Ambo Navy",
    palette: {
      primaryHex: "#002A3C",
      accentHex: "#2A7B96",
      surfaceHex: "#EBF4F7",
      headerBgHex: "#002A3C",
      headerTextHex: "#FFFFFF",
    },
  },
  {
    id: "mono-print",
    label: "Clean Monochrome",
    palette: {
      primaryHex: "#121413",
      accentHex: "#576258",
      surfaceHex: "#F3F4F6",
      headerBgHex: "#FFFFFF",
      headerTextHex: "#121413",
    },
  },
];

export const DEFAULT_PDF_DESIGN: PdfDesignSpec = {
  headerStyle: "banner",
  fontPairing: "garden",
  density: "comfortable",
  palette: { ...PDF_COLOR_THEMES[0].palette },
  showLogo: true,
  showMetadata: true,
  showBadgeNumbers: true,
  uppercaseHeadings: true,
  useAiDesigner: false,
  fillInTheBlanks: false,
  showQrCode: false,
  qrUrl: "",
  qrLabel: "Watch & Connect",
};

export type ExportMode = "browser" | "folder" | "ask";

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
  "podcast_show_notes",
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
  defaultPdfDesign: PdfDesignSpec;
  pdfExportDir: string;
  mediaExportDir: string;
  exportMode: ExportMode;
  themePreference: "light" | "dark" | "system";
  defaultSpeaker: string;
}
