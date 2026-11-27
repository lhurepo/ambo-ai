import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  fullName: text("full_name").notNull().default("Pastor"),
  ministryName: text("ministry_name").notNull().default("Local Church"),
  ministryWebsite: text("ministry_website").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const aiSettings = sqliteTable("ai_settings", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  llmProvider: text("llm_provider").notNull().default("offline"), // offline | ollama | gemini | groq | openrouter | openai | anthropic | custom
  apiKey: text("api_key").notNull().default(""),
  baseUrl: text("base_url").notNull().default(""),
  model: text("model").notNull().default(""),
  whisperModel: text("whisper_model").notNull().default("base"), // tiny | base | small | medium
  whisperLanguage: text("whisper_language").notNull().default("auto"),
  defaultCaptionSettingsJson: text("default_caption_settings_json").notNull().default("{}"),
  pdfExportDir: text("pdf_export_dir").notNull().default(""),
  mediaExportDir: text("media_export_dir").notNull().default(""),
  exportMode: text("export_mode").notNull().default("browser"), // browser | folder | ask
  defaultPdfDesignJson: text("default_pdf_design_json").notNull().default("{}"),
  themePreference: text("theme_preference").notNull().default("light"), // light | dark | system
  defaultSpeaker: text("default_speaker").notNull().default(""),
  updatedAt: integer("updated_at").notNull(),
});

export const sermons = sqliteTable("sermons", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  speaker: text("speaker").notNull().default(""),
  topic: text("topic").notNull().default("Faith & Discipleship"),
  seriesName: text("series_name").notNull().default(""),
  tagsJson: text("tags_json").notNull().default("[]"),
  sourceType: text("source_type").notNull(), // media | manuscript | both
  status: text("status").notNull().default("queued"), // queued | uploading | transcribing | generating | processing_clips | completed | error
  progress: integer("progress").notNull().default(0),
  progressMessage: text("progress_message").notNull().default("Queued"),
  errorMessage: text("error_message"),
  mediaPath: text("media_path"),
  mediaMime: text("media_mime"),
  mediaFileName: text("media_file_name"),
  isVideo: integer("is_video").notNull().default(0),
  durationSec: integer("duration_sec").notNull().default(0),
  youtubeUrl: text("youtube_url"),
  thumbnailPath: text("thumbnail_path"),
  manuscriptPath: text("manuscript_path"),
  manuscriptFileName: text("manuscript_file_name"),
  manuscriptText: text("manuscript_text"),
  transcriptText: text("transcript_text"),
  segmentsJson: text("segments_json"), // JSON array of TranscriptSegment
  faceTrackJson: text("face_track_json"), // JSON { width, height, points: [{t, centerX, centerY, detected}] }
  clipsUnseen: integer("clips_unseen").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const sermonAssets = sqliteTable("sermon_assets", {
  id: text("id").primaryKey(),
  sermonId: text("sermon_id").notNull(),
  assetType: text("asset_type").notNull(),
  content: text("content").notNull(), // markdown or JSON string
  updatedAt: integer("updated_at").notNull(),
});

export const clips = sqliteTable("clips", {
  id: text("id").primaryKey(),
  sermonId: text("sermon_id").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull().default("Teaching"), // Application | Inspirational | Pastoral | Teaching | userCreated
  startMs: integer("start_ms").notNull(),
  endMs: integer("end_ms").notNull(),
  transcriptExcerpt: text("transcript_excerpt").notNull().default(""),
  captionSettingsJson: text("caption_settings_json").notNull(),
  renderStatus: text("render_status").notNull().default("pending"), // pending | rendering | completed | error
  renderedPath: text("rendered_path"),
  renderError: text("render_error"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const prompts = sqliteTable("prompts", {
  id: text("id").primaryKey(),
  userId: text("user_id"), // null for built-in v2prompts
  title: text("title").notNull(),
  category: text("category").notNull().default("user"),
  drawerTab: text("drawer_tab").notNull().default("user"), // content | coach | iterate | user
  body: text("body").notNull(),
  isBuiltin: integer("is_builtin").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  sermonId: text("sermon_id").notNull(),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const generationPrompts = sqliteTable("generation_prompts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  assetType: text("asset_type").notNull(), // global_system | AssetType | clips
  promptText: text("prompt_text").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  userId: text("user_id"),
  action: text("action").notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: integer("created_at").notNull(),
});
