import type { TrackInfo } from "./track";

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface AppSettings {
  playlistId: string | null;
  playlistName: string | null;
}

export interface StoredState {
  spotifyTokens: SpotifyTokens | null;
  settings: AppSettings;
  lastSentKey: string | null;
  lastSentAt: number;
  lastTrack: TrackInfo | null;
  lastResult: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
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

// `sentKey` is only passed when the track was actually added, so a failed
// attempt can be retried immediately without hitting the duplicate check.
export async function saveLastAction(
  track: TrackInfo | null,
  result: string,
  sentKey: string | null = null
): Promise<void> {
  const update: Record<string, unknown> = { lastTrack: track, lastResult: result };
  if (sentKey) {
    update.lastSentKey = sentKey;
    update.lastSentAt = Date.now();
  }
  await chrome.storage.local.set(update);
}
