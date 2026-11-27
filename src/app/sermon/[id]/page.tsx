"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  Download,
  Edit3,
  FileDown,
  FileText,
  Film,
  Headphones,
  Loader2,
  Mail,
  MessageSquareText,
  Mic,
  Plus,
  Share2,
} from "lucide-react";
import { AuthenticatedShell } from "@/components/layout/AuthenticatedShell";
import { AssetPanel } from "@/components/sermon/AssetPanel";
import { InteractiveTranscript } from "@/components/sermon/InteractiveTranscript";
import { SermonChatPanel } from "@/components/sermon/SermonChatPanel";
import { ClipStudio, type ClipItem } from "@/components/clips/ClipStudio";
import { NewSermonModal } from "@/components/sermon/NewSermonModal";
import { GardenPdfModal } from "@/components/sermon/GardenPdfModal";
import { useToast } from "@/components/ui/ToastProvider";
import type { AssetType, FaceTrackData, TranscriptSegment } from "@/lib/types";

interface SermonDetail {
  id: string;
  title: string;
  speaker: string;
  topic: string;
  sourceType: "media" | "manuscript" | "both";
  status: string;
  progress: number;
  progressMessage: string;
  errorMessage: string | null;
  hasMedia: boolean;
  hasManuscript: boolean;
  mediaFileName: string | null;
  manuscriptFileName: string | null;
  manuscriptText: string | null;
  transcriptText: string | null;
  isVideo: boolean;
  durationSec: number;
  clipsUnseen: boolean;
  segments: TranscriptSegment[];
  faceTrack: FaceTrackData | null;
  createdAt: number;
}

type TopTab = "sermon" | "feedback" | "discipleship" | "socials" | "clips" | "comms";

export default function SermonWorkspacePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { success, info } = useToast();
  const sermonId = params.id;

  const [sermon, setSermon] = useState<SermonDetail | null>(null);
  const [assets, setAssets] = useState<Record<string, string>>({});
  const [clips, setClips] = useState<ClipItem[]>([]);
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; role: string; content: string }>>([]);
  const [loading, setLoading] = useState(true);

  const [topTab, setTopTab] = useState<TopTab>("sermon");
  const [sermonSubTab, setSermonSubTab] = useState<
    "summary" | "points" | "scripture" | "quotes" | "transcript"
  >("summary");
  const [feedbackSubTab, setFeedbackSubTab] = useState<
    "coach_structure" | "coach_illustrations" | "coach_application"
  >("coach_structure");
  const [discSubTab, setDiscSubTab] = useState<
    "discussion_questions" | "small_group_guide" | "devotional"
  >("discussion_questions");
  const [socialSubTab, setSocialSubTab] = useState<
    "social_instagram" | "social_facebook" | "social_twitter" | "social_captions"
  >("social_instagram");
  const [commSubTab, setCommSubTab] = useState<"email_recap" | "blog_post">("email_recap");

  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [attachModal, setAttachModal] = useState<"media" | "manuscript" | null>(null);
  const [pdfModalOpen, setPdfModalOpen] = useState(false);

  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [currentTimeSec, setCurrentTimeSec] = useState(0);

  const loadSermon = useCallback(async () => {
    const res = await fetch(`/api/sermons/${sermonId}`);
    if (res.status === 401) {
      router.push("/signin");
      return;
    }
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const data = await res.json();
    setSermon(data.sermon);
    setTitleDraft(data.sermon.title);
    setAssets(data.assets || {});
    setClips(data.clips || []);
    setChatMessages(data.chatMessages || []);
    setLoading(false);
    if (data.sermon.sourceType === "manuscript" && !data.sermon.hasMedia) {
      setTopTab((prev) => (prev === "sermon" ? "feedback" : prev));
    }
  }, [router, sermonId]);

  useEffect(() => {
    loadSermon();
  }, [loadSermon]);

  useEffect(() => {
    if (!sermon || sermon.status === "completed" || sermon.status === "error") return;
    const es = new EventSource(`/api/sermons/${sermonId}/events`);
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === "status") {
          setSermon((prev) =>
            prev
              ? {
                  ...prev,
                  status: msg.status || prev.status,
                  progress: typeof msg.progress === "number" ? msg.progress : prev.progress,
                  progressMessage: msg.progressMessage || prev.progressMessage,
                  errorMessage: msg.errorMessage ?? prev.errorMessage,
                }
              : prev
          );
          if (msg.status === "completed" || msg.status === "error") {
            loadSermon();
          }
        } else if (msg.type === "clip") {
          loadSermon();
        }
      } catch {}
    };
    const fallbackPoll = setInterval(loadSermon, 4000);
    return () => {
      es.close();
      clearInterval(fallbackPoll);
    };
  }, [sermon?.status, sermonId, loadSermon]);

  const seekTo = (seconds: number) => {
    const el = mediaRef.current;
    if (el) {
      el.currentTime = seconds;
      el.play().catch(() => {});
    }
  };

  const handleSaveTitle = async () => {
    if (!titleDraft.trim()) return;
    await fetch(`/api/sermons/${sermonId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: titleDraft.trim() }),
    });
    setSermon((prev) => (prev ? { ...prev, title: titleDraft.trim() } : prev));
    setEditingTitle(false);
    success("Sermon title updated.");
  };

  const handleCreateCustomClip = async (startMs: number, endMs: number, excerpt: string) => {
    const res = await fetch(`/api/sermons/${sermonId}/clips`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startMs, endMs, transcriptExcerpt: excerpt }),
    });
    const data = await res.json();
    if (data.duplicate && data.existingClip) {
      info(data.message || "This clip already exists.");
      setSelectedClipId(data.existingClip.id);
      setTopTab("clips");
    } else if (data.clip) {
      await loadSermon();
      setSelectedClipId(data.clip.id);
      setTopTab("clips");
      success("Custom clip created.");
    }
  };

  const handleAssetUpdated = (assetType: AssetType, content: string) => {
    setAssets((prev) => ({ ...prev, [assetType]: content }));
  };

  if (loading) {
    return (
      <AuthenticatedShell>
        <div className="mx-auto max-w-6xl p-8">
          <div className="h-10 w-64 animate-pulse rounded-xl border border-[#E5EAEF] bg-white" />
          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="h-[460px] animate-pulse rounded-2xl border border-[#E5EAEF] bg-white lg:col-span-5" />
            <div className="h-[460px] animate-pulse rounded-2xl border border-[#E5EAEF] bg-white lg:col-span-7" />
          </div>
        </div>
      </AuthenticatedShell>
    );
  }

  if (!sermon) {
    return (
      <AuthenticatedShell>
        <div className="p-10 text-center">
          <p className="text-lg font-semibold text-[#0D1F28]">Sermon not found</p>
          <Link href="/dashboard" className="mt-4 inline-block text-sm text-[#002A3C] underline">
            Back to Dashboard
          </Link>
        </div>
      </AuthenticatedShell>
    );
  }

  const mediaUrl = `/api/sermons/${sermonId}/media`;

  return (
    <AuthenticatedShell>
      <div className="mx-auto flex min-h-full max-w-7xl flex-col px-5 py-6 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#E5EAEF] pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/dashboard"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#E5EAEF] bg-white text-[#4E6470] hover:bg-[#F3F5F7] hover:text-[#0D1F28]"
              aria-label="Back to dashboard"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
            <div className="min-w-0">
              {editingTitle ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSaveTitle()}
                    aria-label="Sermon title"
                    className="rounded-lg border border-[#D5E1E6] bg-white px-3 py-1 text-base font-semibold text-[#0D1F28] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleSaveTitle}
                    className="rounded-full bg-[#002A3C] px-3 py-1 text-xs font-medium text-white"
                  >
                    Save
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="truncate text-lg font-semibold text-[#0D1F28] md:text-xl">
                    {sermon.title}
                  </h1>
                  <button
                    type="button"
                    onClick={() => setEditingTitle(true)}
                    aria-label="Edit sermon title"
                    className="text-[#70848F] hover:text-[#0D1F28]"
                  >
                    <Edit3 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#4E6470]">
                {sermon.topic && (
                  <span className="rounded-full bg-[#EBF4F7] px-2.5 py-0.5 text-[11px] font-medium text-[#002A3C]">
                    {sermon.topic}
                  </span>
                )}
                <span>
                  {new Date(sermon.createdAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
                {sermon.mediaFileName && <span>· {sermon.mediaFileName}</span>}
                {sermon.manuscriptFileName && <span>· {sermon.manuscriptFileName}</span>}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {!sermon.hasManuscript && (
              <button
                type="button"
                onClick={() => setAttachModal("manuscript")}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-3.5 py-1.5 text-xs font-medium text-[#0D1F28] hover:bg-[#F3F5F7]"
              >
                <Plus className="h-3.5 w-3.5 text-[#4E6470]" aria-hidden="true" />
                Add manuscript
              </button>
            )}
            {!sermon.hasMedia && (
              <button
                type="button"
                onClick={() => setAttachModal("media")}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-3.5 py-1.5 text-xs font-medium text-[#0D1F28] hover:bg-[#F3F5F7]"
              >
                <Plus className="h-3.5 w-3.5 text-[#4E6470]" aria-hidden="true" />
                Add media / YouTube
              </button>
            )}
            {sermon.hasMedia && (
              <a
                href={`/api/sermons/${sermonId}/audio-mp3`}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#D5E1E6] bg-white px-3.5 py-1.5 text-xs font-medium text-[#0D1F28] hover:bg-[#F3F5F7]"
              >
                <Headphones className="h-3.5 w-3.5 text-[#4E6470]" aria-hidden="true" />
                Download MP3
              </a>
            )}
            <button
              type="button"
              onClick={() => setPdfModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#1D3519] px-3.5 py-1.5 text-xs font-medium text-white hover:bg-[#274622]"
            >
              <FileDown className="h-3.5 w-3.5 text-[#BDD630]" aria-hidden="true" />
              Garden PDF Packet
            </button>
            <a
              href={`/api/sermons/${sermonId}/clips/download-all`}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#002A3C] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#0B435B]"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Export all (.zip)
            </a>
          </div>
        </div>

        {sermon.status !== "completed" && (
          <div
            className={`mt-4 rounded-xl border px-4 py-3 ${
              sermon.status === "error"
                ? "border-rose-200 bg-rose-50 text-rose-700"
                : "border-[#E5EAEF] bg-white text-[#0D1F28]"
            }`}
          >
            <div className="flex items-center justify-between text-xs font-medium">
              <span className="inline-flex items-center gap-2">
                {sermon.status !== "error" && (
                  <Loader2 className="h-4 w-4 animate-spin text-[#002A3C]" aria-hidden="true" />
                )}
                {sermon.status === "error" ? `Error: ${sermon.errorMessage}` : sermon.progressMessage}
              </span>
              {sermon.status !== "error" && (
                <span className="font-mono text-[#4E6470]">{sermon.progress}%</span>
              )}
            </div>
            {sermon.status !== "error" && (
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#F3F5F7]">
                <div
                  className="h-full rounded-full bg-[#002A3C] transition-all duration-500"
                  style={{ width: `${Math.max(5, sermon.progress)}%` }}
                />
              </div>
            )}
          </div>
        )}

        <div className="mt-5 grid flex-1 grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="flex flex-col gap-4 lg:col-span-5 xl:col-span-4">
            {sermon.hasMedia ? (
              <div className="overflow-hidden rounded-2xl border border-[#E5EAEF] bg-white">
                {sermon.isVideo ? (
                  <video
                    ref={mediaRef}
                    src={mediaUrl}
                    controls
                    onTimeUpdate={(e) => setCurrentTimeSec(e.currentTarget.currentTime)}
                    className="aspect-video w-full bg-black"
                  />
                ) : (
                  <div className="p-5">
                    <div className="mb-3 flex items-center gap-2 text-xs font-medium text-[#4E6470]">
                      <Mic className="h-4 w-4 text-[#002A3C]" aria-hidden="true" />
                      Audio player
                    </div>
                    <audio
                      ref={mediaRef}
                      src={mediaUrl}
                      controls
                      onTimeUpdate={(e) => setCurrentTimeSec(e.currentTarget.currentTime)}
                      className="w-full"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto rounded-2xl border border-[#E5EAEF] bg-white p-4">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#0D1F28]">
                  <FileText className="h-4 w-4 text-[#002A3C]" aria-hidden="true" />
                  Manuscript
                </div>
                <p className="whitespace-pre-wrap text-xs leading-relaxed text-[#4E6470]">
                  {sermon.manuscriptText || "Extracting manuscript text..."}
                </p>
              </div>
            )}

            <SermonChatPanel sermonId={sermonId} initialMessages={chatMessages} />
          </div>

          <div className="flex flex-col gap-4 lg:col-span-7 xl:col-span-8">
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-hide">
              {(
                [
                  ...(sermon.hasMedia ? [{ id: "sermon", label: "Sermon", icon: Mic }] : []),
                  {
                    id: "feedback",
                    label: sermon.hasMedia ? "Coach" : "Get feedback",
                    icon: CheckCircle2,
                  },
                  { id: "discipleship", label: "Discipleship", icon: BookOpen },
                  { id: "socials", label: "Social media", icon: Share2 },
                  ...(sermon.hasMedia
                    ? [
                        {
                          id: "clips",
                          label: `Video clips${clips.length ? ` (${clips.length})` : ""}`,
                          icon: Film,
                        },
                      ]
                    : []),
                  { id: "comms", label: "Comms", icon: Mail },
                  ...(!sermon.hasMedia
                    ? [{ id: "sermon", label: "Summary & Notes", icon: MessageSquareText }]
                    : []),
                ] as Array<{
                  id: TopTab;
                  label: string;
                  icon: React.ComponentType<{ className?: string }>;
                }>
              ).map((tab) => {
                const Icon = tab.icon;
                const active = topTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setTopTab(tab.id)}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-xs font-medium transition ${
                      active
                        ? "border-[#002A3C] bg-[#002A3C] text-white"
                        : "border-[#E5EAEF] bg-white text-[#4E6470] hover:bg-[#FAFBFD] hover:text-[#0D1F28]"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {topTab === "sermon" && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { id: "summary", label: "Summary" },
                      { id: "points", label: "Points" },
                      { id: "scripture", label: "Scripture" },
                      { id: "quotes", label: "Quotes" },
                      ...(sermon.hasMedia ? [{ id: "transcript", label: "Transcript" }] : []),
                    ] as Array<{
                      id: "summary" | "points" | "scripture" | "quotes" | "transcript";
                      label: string;
                    }>
                  ).map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => setSermonSubTab(sub.id)}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                        sermonSubTab === sub.id
                          ? "bg-[#EBF4F7] text-[#002A3C]"
                          : "border border-[#E5EAEF] bg-white text-[#4E6470] hover:text-[#0D1F28]"
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>

                {sermonSubTab === "summary" && (
                  <div className="space-y-4">
                    <AssetPanel
                      sermonId={sermonId}
                      assetType="overview"
                      title="Sermon Summary"
                      content={assets.overview || ""}
                      onUpdated={handleAssetUpdated}
                      extraHeader={
                        assets.keywords ? (
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs font-medium text-[#4E6470]">Keywords:</span>
                            {assets.keywords.split(",").map((kw) => (
                              <span
                                key={kw.trim()}
                                className="rounded-full bg-[#F3F5F7] px-2.5 py-0.5 text-[11px] text-[#0D1F28]"
                              >
                                {kw.trim()}
                              </span>
                            ))}
                          </div>
                        ) : null
                      }
                    />
                    {assets.chapters && (
                      <AssetPanel
                        sermonId={sermonId}
                        assetType="chapters"
                        title="Chapters"
                        content={assets.chapters}
                        onUpdated={handleAssetUpdated}
                      />
                    )}
                  </div>
                )}

                {sermonSubTab === "points" && (
                  <AssetPanel
                    sermonId={sermonId}
                    assetType="points"
                    title="Key Sermon Points"
                    content={assets.points || ""}
                    onUpdated={handleAssetUpdated}
                  />
                )}

                {sermonSubTab === "scripture" && (
                  <AssetPanel
                    sermonId={sermonId}
                    assetType="scripture"
                    title="Scripture References"
                    content={assets.scripture || ""}
                    onUpdated={handleAssetUpdated}
                  />
                )}

                {sermonSubTab === "quotes" && (
                  <AssetPanel
                    sermonId={sermonId}
                    assetType="quotes"
                    title="Notable Quotes"
                    content={assets.quotes || ""}
                    onUpdated={handleAssetUpdated}
                  />
                )}

                {sermonSubTab === "transcript" && (
                  <InteractiveTranscript
                    sermonId={sermonId}
                    segments={sermon.segments || []}
                    currentTimeSec={currentTimeSec}
                    clips={clips}
                    onSeek={seekTo}
                    onSegmentsUpdated={(nextSegments, fullText) =>
                      setSermon((prev) =>
                        prev ? { ...prev, segments: nextSegments, transcriptText: fullText } : prev
                      )
                    }
                    onCreateClip={handleCreateCustomClip}
                    onNavigateToClip={(cid) => {
                      setSelectedClipId(cid);
                      setTopTab("clips");
                    }}
                  />
                )}
              </div>
            )}

            {topTab === "feedback" && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { id: "coach_structure", label: "Structure and flow" },
                      { id: "coach_illustrations", label: "Illustrations" },
                      { id: "coach_application", label: "Application" },
                    ] as Array<{
                      id: "coach_structure" | "coach_illustrations" | "coach_application";
                      label: string;
                    }>
                  ).map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => setFeedbackSubTab(sub.id)}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                        feedbackSubTab === sub.id
                          ? "bg-[#EBF4F7] text-[#002A3C]"
                          : "border border-[#E5EAEF] bg-white text-[#4E6470] hover:text-[#0D1F28]"
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
                <AssetPanel
                  sermonId={sermonId}
                  assetType={feedbackSubTab}
                  title={
                    feedbackSubTab === "coach_structure"
                      ? "Structure and Flow Feedback"
                      : feedbackSubTab === "coach_illustrations"
                        ? "Illustration & Story Ideas"
                        : "Practical Application Coaching"
                  }
                  content={assets[feedbackSubTab] || ""}
                  onUpdated={handleAssetUpdated}
                />
              </div>
            )}

            {topTab === "discipleship" && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { id: "discussion_questions", label: "Discussion questions" },
                      { id: "small_group_guide", label: "Small group guide" },
                      { id: "devotional", label: "Devotional" },
                    ] as Array<{
                      id: "discussion_questions" | "small_group_guide" | "devotional";
                      label: string;
                    }>
                  ).map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => setDiscSubTab(sub.id)}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                        discSubTab === sub.id
                          ? "bg-[#EBF4F7] text-[#002A3C]"
                          : "border border-[#E5EAEF] bg-white text-[#4E6470] hover:text-[#0D1F28]"
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
                <AssetPanel
                  sermonId={sermonId}
                  assetType={discSubTab}
                  title={
                    discSubTab === "discussion_questions"
                      ? "Discussion Questions"
                      : discSubTab === "small_group_guide"
                        ? "Small Group Leader Guide"
                        : "5-Day Devotional"
                  }
                  content={assets[discSubTab] || ""}
                  onUpdated={handleAssetUpdated}
                />
              </div>
            )}

            {topTab === "socials" && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { id: "social_instagram", label: "Instagram" },
                      { id: "social_facebook", label: "Facebook" },
                      { id: "social_twitter", label: "X / Short Posts" },
                      { id: "social_captions", label: "Reel Captions" },
                    ] as Array<{
                      id:
                        | "social_instagram"
                        | "social_facebook"
                        | "social_twitter"
                        | "social_captions";
                      label: string;
                    }>
                  ).map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => setSocialSubTab(sub.id)}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                        socialSubTab === sub.id
                          ? "bg-[#EBF4F7] text-[#002A3C]"
                          : "border border-[#E5EAEF] bg-white text-[#4E6470] hover:text-[#0D1F28]"
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
                <AssetPanel
                  sermonId={sermonId}
                  assetType={socialSubTab}
                  title="Social Media Post"
                  content={assets[socialSubTab] || ""}
                  onUpdated={handleAssetUpdated}
                />
              </div>
            )}

            {topTab === "clips" && (
              <ClipStudio
                sermonId={sermonId}
                mediaUrl={mediaUrl}
                isVideo={sermon.isVideo}
                durationSec={sermon.durationSec}
                segments={sermon.segments || []}
                faceTrack={sermon.faceTrack}
                clips={clips}
                selectedClipId={selectedClipId}
                onSelectClip={setSelectedClipId}
                onClipsChanged={loadSermon}
                onOpenTranscriptTab={() => {
                  setTopTab("sermon");
                  setSermonSubTab("transcript");
                }}
                onSegmentsUpdated={(nextSegments, fullText) =>
                  setSermon((prev) =>
                    prev ? { ...prev, segments: nextSegments, transcriptText: fullText } : prev
                  )
                }
              />
            )}

            {topTab === "comms" && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      { id: "email_recap", label: "Email recap" },
                      { id: "blog_post", label: "Blog post" },
                    ] as Array<{ id: "email_recap" | "blog_post"; label: string }>
                  ).map((sub) => (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => setCommSubTab(sub.id)}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                        commSubTab === sub.id
                          ? "bg-[#EBF4F7] text-[#002A3C]"
                          : "border border-[#E5EAEF] bg-white text-[#4E6470] hover:text-[#0D1F28]"
                      }`}
                    >
                      {sub.label}
                    </button>
                  ))}
                </div>
                <AssetPanel
                  sermonId={sermonId}
                  assetType={commSubTab}
                  title={commSubTab === "email_recap" ? "Weekly Email Recap" : "Sermon Blog Post"}
                  content={assets[commSubTab] || ""}
                  onUpdated={handleAssetUpdated}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <NewSermonModal
        open={Boolean(attachModal)}
        onClose={() => setAttachModal(null)}
        attachToSermonId={sermonId}
        onlyKind={attachModal}
        onCreated={() => loadSermon()}
      />

      <GardenPdfModal
        open={pdfModalOpen}
        sermonId={sermonId}
        sermonTitle={sermon.title}
        assets={assets}
        onClose={() => setPdfModalOpen(false)}
      />
    </AuthenticatedShell>
  );
}
