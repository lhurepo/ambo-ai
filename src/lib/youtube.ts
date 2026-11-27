const ALLOWED_YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function parseYoutubeVideoId(input: string): {
  videoId: string;
  canonicalUrl: string;
} | null {
  const raw = (input || "").trim();
  if (!raw || raw.length > 500) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (!ALLOWED_YOUTUBE_HOSTS.has(host)) {
    return null;
  }

  let videoId = "";
  if (host === "youtu.be") {
    videoId = url.pathname.replace(/^\/+/, "").split("/")[0] || "";
  } else {
    const vParam = url.searchParams.get("v");
    if (vParam) {
      videoId = vParam;
    } else {
      const m = url.pathname.match(/^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})(?:\/|$)/);
      if (m) videoId = m[1];
    }
  }

  if (!VIDEO_ID_RE.test(videoId)) {
    return null;
  }

  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
