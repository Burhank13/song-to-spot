import { shouldSkipDuplicate, buildSearchQuery } from "./dedup";
import { findNowPlaying } from "./now-playing";
import type { TrackInfo } from "../shared/track";
import { trackKey } from "../shared/track";
import { getStoredState, saveLastAction, saveTokens } from "../shared/storage";
import { searchTrack, addTrackToPlaylist } from "../spotify/client";

export interface SaveResult {
  ok: boolean;
  message: string;
}

async function addTrack(track: TrackInfo): Promise<SaveResult> {
  const state = await getStoredState();

  if (!state.spotifyTokens) {
    return { ok: false, message: "Connect Spotify first." };
  }

  if (!state.settings.playlistId) {
    return { ok: false, message: "Choose a target playlist first." };
  }

  const key = trackKey(track);
  if (shouldSkipDuplicate(key, state.lastSentKey, state.lastSentAt)) {
    return { ok: false, message: `Already added: ${track.title}` };
  }

  const query = buildSearchQuery(track.title, track.artist);
  const { track: match, tokens } = await searchTrack(state.spotifyTokens, query);
  await saveTokens(tokens);

  if (!match) {
    const message = `Not found on Spotify: ${track.title}`;
    await saveLastAction(track, message);
    return { ok: false, message };
  }

  const { tokens: finalTokens } = await addTrackToPlaylist(
    tokens,
    state.settings.playlistId,
    match.uri
  );
  await saveTokens(finalTokens);

  const message = `Added "${match.name}" by ${match.artists.join(", ")}`;
  await saveLastAction(track, message, key);
  return { ok: true, message };
}

function notify(title: string, message: string): void {
  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title,
    message,
  });
}

// Finds what's playing and adds it to the target playlist. The keyboard
// shortcut passes `notify` because there is no popup open to show the result.
export async function saveNowPlaying(
  options: { notify: boolean }
): Promise<SaveResult> {
  let result: SaveResult;
  try {
    const found = await findNowPlaying();
    result = found.track
      ? await addTrack(found.track)
      : { ok: false, message: found.reason };
  } catch (error) {
    result = {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  if (options.notify) {
    notify(result.ok ? "Added to Spotify" : "Song not added", result.message);
  }
  return result;
}
