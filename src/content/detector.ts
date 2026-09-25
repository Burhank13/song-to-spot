import type { TrackInfo } from "../shared/track";
import { isSpotifySource } from "../shared/track";
import type { ContentMessage, ContentResponse } from "../shared/messages";

function hasPlayingMediaElement(): boolean {
  const mediaElements = document.querySelectorAll("video, audio");
  for (const element of Array.from(mediaElements)) {
    if (element instanceof HTMLMediaElement && !element.paused && !element.ended) {
      return true;
    }
  }
  return false;
}

// `audible` comes from Chrome's tab state. Some players never set
// playbackState or play through detached <audio> elements, so the tab
// making sound is the most reliable "is playing" signal we have.
function isPlaying(audible: boolean): boolean {
  if (!("mediaSession" in navigator) || !navigator.mediaSession) {
    return audible || hasPlayingMediaElement();
  }
  const state = navigator.mediaSession.playbackState;
  if (state === "playing") {
    return true;
  }
  if (state === "paused") {
    return false;
  }
  return audible || hasPlayingMediaElement();
}

function readFromMediaSession(): TrackInfo | null {
  const metadata = navigator.mediaSession?.metadata;
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

function readFromPageTitle(): TrackInfo | null {
  const title = document.title
    .replace(/^\(\d+\)\s*/, "")
    .replace(/\s*[-|–—]\s*YouTube$/i, "")
    .replace(/\s*[-|–—]\s*SoundCloud$/i, "")
    .replace(/\s*on\s+SoundCloud$/i, "")
    .trim();

  if (!title) {
    return null;
  }

  return {
    title,
    artist: "",
    album: "",
    isPlaying: true,
    sourceUrl: location.href,
    sourceHost: location.hostname,
  };
}

// During YouTube ads the Media Session metadata describes the ad, not the
// video, so reading it would search Spotify for the advertiser.
function isAdPlaying(): boolean {
  return document.querySelector(".html5-video-player.ad-showing") !== null;
}

function detectCurrentTrack(audible: boolean): ContentResponse {
  if (isSpotifySource(location.hostname) || !isPlaying(audible)) {
    return { track: null };
  }
  if (isAdPlaying()) {
    return { track: null, reason: "An ad is playing. Try again when the song starts." };
  }

  return { track: readFromMediaSession() ?? readFromPageTitle() };
}

chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
  if (message?.type === "READ_NOW_PLAYING") {
    sendResponse(detectCurrentTrack(message.audible));
  }
});
