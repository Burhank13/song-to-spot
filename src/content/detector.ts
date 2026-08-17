import type { TrackInfo } from "../shared/track";
import { isSpotifySource } from "../shared/track";

const POLL_INTERVAL_MS = 2000;

function readFromMediaSession(): TrackInfo | null {
  if (!("mediaSession" in navigator) || !navigator.mediaSession) {
    return null;
  }

  const session = navigator.mediaSession;
  if (session.playbackState !== "playing") {
    return null;
  }

  const metadata = session.metadata;
  if (!metadata?.title?.trim()) {
    return null;
  }

  return {
    title: metadata.title.trim(),
    artist: metadata.artist?.trim() ?? "",
    album: metadata.album?.trim() ?? "",
    isPlaying: true,
    sourceUrl: location.href,
    sourceHost: location.hostname,
  };
}

function hasPlayingMediaElement(): boolean {
  const mediaElements = document.querySelectorAll("video, audio");
  for (const element of Array.from(mediaElements)) {
    if (element instanceof HTMLMediaElement && !element.paused && !element.ended) {
      return true;
    }
  }
  return false;
}

function readFromPageFallback(): TrackInfo | null {
  if (!hasPlayingMediaElement()) {
    return null;
  }

  const titleFromPage = document.title.trim();
  if (!titleFromPage) {
    return null;
  }

  const cleanedTitle = titleFromPage
    .replace(/\s*[-|–—]\s*YouTube$/i, "")
    .replace(/\s*[-|–—]\s*SoundCloud$/i, "")
    .replace(/\s*on\s+SoundCloud$/i, "")
    .trim();

  if (!cleanedTitle) {
    return null;
  }

  let artist = "";
  let title = cleanedTitle;

  const separators = [" - ", " – ", " — ", " | "];
  for (const sep of separators) {
    if (cleanedTitle.includes(sep)) {
      const [left, right] = cleanedTitle.split(sep, 2);
      if (left && right) {
        artist = left.trim();
        title = right.trim();
        break;
      }
    }
  }

  return {
    title,
    artist,
    album: "",
    isPlaying: true,
    sourceUrl: location.href,
    sourceHost: location.hostname,
  };
}

function detectCurrentTrack(): TrackInfo | null {
  if (isSpotifySource(location.hostname)) {
    return null;
  }

  return readFromMediaSession() ?? readFromPageFallback();
}

let lastSentKey = "";

function publishTrack(track: TrackInfo | null): void {
  if (!track) {
    return;
  }

  const key = `${track.title}::${track.artist}::${track.sourceUrl}`;
  if (key === lastSentKey) {
    return;
  }
  lastSentKey = key;

  chrome.runtime.sendMessage({ type: "TRACK_UPDATE", track }).catch(() => {
    // Extension context may be unavailable during reload.
  });
}

function tick(): void {
  publishTrack(detectCurrentTrack());
}

function attachMediaListeners(): void {
  document.addEventListener(
    "play",
    (event) => {
      if (event.target instanceof HTMLMediaElement) {
        setTimeout(tick, 300);
      }
    },
    true
  );

  document.addEventListener(
    "pause",
    () => {
      lastSentKey = "";
    },
    true
  );

  document.addEventListener("visibilitychange", tick);
}

attachMediaListeners();
setInterval(tick, POLL_INTERVAL_MS);
tick();
