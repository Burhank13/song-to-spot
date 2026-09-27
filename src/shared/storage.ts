import type { TrackInfo } from "./track";
import type { Candidate } from "../spotify/match";

export interface SpotifyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface AppSettings {
  playlistId: string | null;
  playlistName: string | null;
}

// A detected song whose best Spotify match wasn't certain enough to add
// without asking.
export interface PendingPick {
  track: TrackInfo;
  candidates: Candidate[];
  at: number;
}

export type HistoryStatus = "added" | "already_in_playlist" | "not_found" | "removed";

export interface HistoryEntry {
  id: string;
  at: number;
  detected: { title: string; artist: string; sourceUrl: string };
  match: Pick<Candidate, "uri" | "name" | "artists" | "imageUrl"> | null;
  playlistId: string | null;
  status: HistoryStatus;
}

// Local copy of the target playlist's track URIs, refreshed when Spotify's
// snapshot_id for the playlist changes.
export interface PlaylistCache {
  playlistId: string;
  snapshotId: string;
  uris: string[];
}

export interface StoredState {
  spotifyTokens: SpotifyTokens | null;
  settings: AppSettings;
  lastSentKey: string | null;
  lastSentAt: number;
  lastTrack: TrackInfo | null;
  lastResult: string | null;
  pending: PendingPick | null;
  history: HistoryEntry[];
  playlistCache: PlaylistCache | null;
}

const HISTORY_LIMIT = 20;

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
    "pending",
    "history",
    "playlistCache",
  ]);

  return {
    spotifyTokens: data.spotifyTokens ?? null,
    settings: { ...DEFAULT_SETTINGS, ...data.settings },
    lastSentKey: data.lastSentKey ?? null,
    lastSentAt: data.lastSentAt ?? 0,
    lastTrack: data.lastTrack ?? null,
    lastResult: data.lastResult ?? null,
    pending: data.pending ?? null,
    history: data.history ?? [],
    playlistCache: data.playlistCache ?? null,
  };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await chrome.storage.local.set({ settings });
}

export async function saveTokens(tokens: SpotifyTokens | null): Promise<void> {
  await chrome.storage.local.set({ spotifyTokens: tokens });
}

export async function savePending(pending: PendingPick | null): Promise<void> {
  await chrome.storage.local.set({ pending });
}

export async function savePlaylistCache(cache: PlaylistCache | null): Promise<void> {
  await chrome.storage.local.set({ playlistCache: cache });
}

export async function clearDuplicateGuard(): Promise<void> {
  await chrome.storage.local.set({ lastSentKey: null, lastSentAt: 0 });
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

export async function addHistory(
  entry: Omit<HistoryEntry, "id" | "at">
): Promise<void> {
  const { history } = await getStoredState();
  const full: HistoryEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
  };
  await chrome.storage.local.set({ history: [full, ...history].slice(0, HISTORY_LIMIT) });
}

export async function updateHistoryStatus(id: string, status: HistoryStatus): Promise<void> {
  const { history } = await getStoredState();
  await chrome.storage.local.set({
    history: history.map((entry) => (entry.id === id ? { ...entry, status } : entry)),
  });
}
