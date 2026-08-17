import type { TrackInfo } from "./track";

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface AppSettings {
  enabled: boolean;
  playlistId: string | null;
  playlistName: string | null;
}

export interface StoredState {
  spotifyTokens: SpotifyTokens | null;
  settings: AppSettings;
  lastSentKey: string | null;
  lastSentAt: number;
  lastTrack: import("./track").TrackInfo | null;
  lastResult: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  enabled: true,
  playlistId: null,
  playlistName: null,
};

export async function getStoredState(): Promise<StoredState> {
  const data = await chrome.storage.local.get([
    "spotifyTokens",
    "settings",
    "lastSentKey",
    "lastSentAt",
    "lastTrack",
    "lastResult",
  ]);

  return {
    spotifyTokens: data.spotifyTokens ?? null,
    settings: { ...DEFAULT_SETTINGS, ...data.settings },
    lastSentKey: data.lastSentKey ?? null,
    lastSentAt: data.lastSentAt ?? 0,
    lastTrack: data.lastTrack ?? null,
    lastResult: data.lastResult ?? null,
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await chrome.storage.local.set({ settings });
}

export async function saveTokens(tokens: SpotifyTokens | null): Promise<void> {
  await chrome.storage.local.set({ spotifyTokens: tokens });
}

export async function saveDetectedTrack(track: TrackInfo): Promise<void> {
  await chrome.storage.local.set({
    lastTrack: track,
    lastResult: "Detected track. Confirm add to playlist.",
  });
}

export async function saveLastAction(
  track: import("./track").TrackInfo,
  key: string,
  result: string
): Promise<void> {
  await chrome.storage.local.set({
    lastTrack: track,
    lastSentKey: key,
    lastSentAt: Date.now(),
    lastResult: result,
  });
}
