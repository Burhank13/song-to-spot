import { shouldSkipDuplicate, buildSearchQuery } from "./dedup";
import { findNowPlaying } from "./now-playing";
import type { TrackInfo } from "../shared/track";
import { trackKey } from "../shared/track";
import {
  addHistory,
  clearDuplicateGuard,
  getStoredState,
  saveLastAction,
  savePending,
  savePlaylistCache,
  saveTokens,
  updateHistoryStatus,
  type PlaylistCache,
  type SpotifyTokens,
} from "../shared/storage";
import { SpotifyApi } from "../spotify/client";
import { isConfident, rankCandidates, type Candidate } from "../spotify/match";

const PICKER_SIZE = 3;

export type SaveOutcome =
  | "added"
  | "already_in_playlist"
  | "needs_pick"
  | "removed"
  | "failed";

export interface SaveResult {
  outcome: SaveOutcome;
  message: string;
}

const NOTIFICATION_TITLES: Record<SaveOutcome, string> = {
  added: "Added to Spotify",
  already_in_playlist: "Already in your playlist",
  needs_pick: "Which song is this?",
  removed: "Removed from playlist",
  failed: "Song not added",
};

function failed(message: string): SaveResult {
  return { outcome: "failed", message };
}

function describe(match: Pick<Candidate, "name" | "artists">): string {
  return `"${match.name}" by ${match.artists.join(", ")}`;
}

// Runs Spotify calls and persists tokens if they were refreshed on the way.
async function withSpotify<T>(
  tokens: SpotifyTokens,
  run: (api: SpotifyApi) => Promise<T>
): Promise<T> {
  const api = new SpotifyApi(tokens);
  try {
    return await run(api);
  } finally {
    if (api.tokens !== tokens) {
      await saveTokens(api.tokens);
    }
  }
}

async function setPendingBadge(pending: boolean): Promise<void> {
  await chrome.action.setBadgeText({ text: pending ? "?" : "" });
  if (pending) {
    await chrome.action.setBadgeBackgroundColor({ color: "#1db954" });
  }
}

async function currentPlaylist(api: SpotifyApi, playlistId: string): Promise<PlaylistCache> {
  const snapshotId = await api.playlistSnapshot(playlistId);
  const { playlistCache } = await getStoredState();
  if (playlistCache?.playlistId === playlistId && playlistCache.snapshotId === snapshotId) {
    return playlistCache;
  }
  const cache = { playlistId, snapshotId, uris: await api.playlistUris(playlistId) };
  await savePlaylistCache(cache);
  return cache;
}

// Filtered search first; if that isn't conclusive, merge in a free-text
// search, which tolerates small differences in the title.
async function findCandidates(api: SpotifyApi, track: TrackInfo) {
  const filtered = await api.search(buildSearchQuery(track.title, track.artist));
  let ranked = rankCandidates(track, filtered);
  if (!isConfident(track, ranked[0])) {
    const loose = await api.search(`${track.title} ${track.artist}`.trim());
    ranked = rankCandidates(track, [...filtered, ...loose]);
  }
  return ranked;
}

async function addMatch(
  api: SpotifyApi,
  playlistId: string,
  track: TrackInfo,
  match: Candidate
): Promise<SaveResult> {
  const detected = { title: track.title, artist: track.artist, sourceUrl: track.sourceUrl };
  const summary = {
    uri: match.uri,
    name: match.name,
    artists: match.artists,
    imageUrl: match.imageUrl,
  };
  const playlist = await currentPlaylist(api, playlistId);

  if (playlist.uris.includes(match.uri)) {
    const message = `${describe(match)} is already in your playlist.`;
    await addHistory({ detected, match: summary, playlistId, status: "already_in_playlist" });
    await saveLastAction(track, message, trackKey(track));
    return { outcome: "already_in_playlist", message };
  }

  const snapshotId = await api.addToPlaylist(playlistId, match.uri);
  await savePlaylistCache({ playlistId, snapshotId, uris: [...playlist.uris, match.uri] });

  const message = `Added ${describe(match)}`;
  await addHistory({ detected, match: summary, playlistId, status: "added" });
  await saveLastAction(track, message, trackKey(track));
  return { outcome: "added", message };
}

async function saveTrack(track: TrackInfo): Promise<SaveResult> {
  const state = await getStoredState();
  const { spotifyTokens, settings } = state;

  if (!spotifyTokens) {
    return failed("Connect Spotify first.");
  }
  if (!settings.playlistId) {
    return failed("Choose a target playlist first.");
  }
  if (shouldSkipDuplicate(trackKey(track), state.lastSentKey, state.lastSentAt)) {
    return failed(`Already saved: ${track.title}`);
  }

  // A new save replaces any unanswered pick.
  await savePending(null);
  await setPendingBadge(false);

  return withSpotify(spotifyTokens, async (api) => {
    const ranked = await findCandidates(api, track);

    if (ranked.length === 0) {
      const message = `Not found on Spotify: ${track.title}`;
      await addHistory({
        detected: { title: track.title, artist: track.artist, sourceUrl: track.sourceUrl },
        match: null,
        playlistId: settings.playlistId,
        status: "not_found",
      });
      await saveLastAction(track, message);
      return failed(message);
    }

    if (isConfident(track, ranked[0])) {
      return addMatch(api, settings.playlistId!, track, ranked[0]);
    }

    const candidates: Candidate[] = ranked
      .slice(0, PICKER_SIZE)
      .map(({ uri, name, artists, album, imageUrl }) => ({ uri, name, artists, album, imageUrl }));
    await savePending({ track, candidates, at: Date.now() });
    await setPendingBadge(true);
    const message = `Not sure which song "${track.title}" is. Open the extension to pick it.`;
    await saveLastAction(track, message);
    return { outcome: "needs_pick", message };
  });
}

function notify(result: SaveResult): void {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: NOTIFICATION_TITLES[result.outcome],
    message: result.message,
  });
}

async function guarded(run: () => Promise<SaveResult>): Promise<SaveResult> {
  try {
    return await run();
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}

// Finds what's playing and saves it. The keyboard shortcut passes `notify`
// because there is no popup open to show the result.
export async function saveNowPlaying(options: { notify: boolean }): Promise<SaveResult> {
  const result = await guarded(async () => {
    const found = await findNowPlaying();
    return found.track ? saveTrack(found.track) : failed(found.reason);
  });

  if (options.notify) {
    notify(result);
  }
  return result;
}

// The user chose one of the pending candidates in the popup.
export async function pickMatch(uri: string): Promise<SaveResult> {
  return guarded(async () => {
    const { pending, spotifyTokens, settings } = await getStoredState();
    const match = pending?.candidates.find((c) => c.uri === uri);
    if (!pending || !match) {
      return failed("That choice is no longer available.");
    }
    if (!spotifyTokens || !settings.playlistId) {
      return failed("Connect Spotify and choose a playlist first.");
    }

    const result = await withSpotify(spotifyTokens, (api) =>
      addMatch(api, settings.playlistId!, pending.track, match)
    );
    await savePending(null);
    await setPendingBadge(false);
    return result;
  });
}

export async function dismissPending(): Promise<void> {
  const { pending } = await getStoredState();
  await savePending(null);
  await setPendingBadge(false);
  if (pending) {
    await saveLastAction(pending.track, `Skipped: ${pending.track.title}`);
  }
}

export async function undoHistoryEntry(id: string): Promise<SaveResult> {
  return guarded(async () => {
    const { history, spotifyTokens, playlistCache } = await getStoredState();
    const entry = history.find((e) => e.id === id);
    if (!entry || entry.status !== "added" || !entry.match || !entry.playlistId) {
      return failed("Nothing to undo.");
    }
    if (!spotifyTokens) {
      return failed("Connect Spotify first.");
    }

    const { match, playlistId } = entry;
    const snapshotId = await withSpotify(spotifyTokens, (api) =>
      api.removeFromPlaylist(playlistId, match.uri)
    );
    if (playlistCache?.playlistId === playlistId) {
      await savePlaylistCache({
        playlistId,
        snapshotId,
        uris: playlistCache.uris.filter((uri) => uri !== match.uri),
      });
    }
    await updateHistoryStatus(id, "removed");
    await clearDuplicateGuard();

    const message = `Removed ${describe(match)}`;
    await chrome.storage.local.set({ lastResult: message });
    return { outcome: "removed", message };
  });
}
