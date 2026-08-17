import { shouldSkipDuplicate, buildSearchQuery } from "./dedup";
import type { TrackInfo } from "../shared/track";
import { trackKey, isSpotifySource } from "../shared/track";
import {
  getStoredState,
  saveDetectedTrack,
  saveLastAction,
  saveTokens,
  type SpotifyTokens,
} from "../shared/storage";
import { searchTrack, addTrackToPlaylist } from "../spotify/client";

export async function processTrack(
  track: TrackInfo,
  force = false
): Promise<string> {
  if (!track.isPlaying) {
    return "Skipped: media is not playing.";
  }

  if (isSpotifySource(track.sourceHost)) {
    return "Skipped: source is Spotify.";
  }

  const state = await getStoredState();

  if (!state.settings.enabled && !force) {
    return "Auto-send is disabled.";
  }

  if (!state.spotifyTokens) {
    return "Connect Spotify first.";
  }

  if (!state.settings.playlistId) {
    return "Choose a target playlist first.";
  }

  const key = trackKey(track);
  if (
    !force &&
    shouldSkipDuplicate(key, state.lastSentKey, state.lastSentAt)
  ) {
    return "Already sent recently.";
  }

  let tokens: SpotifyTokens = state.spotifyTokens;
  const query = buildSearchQuery(track.title, track.artist);
  const { track: match, tokens: searchTokens } = await searchTrack(tokens, query);
  tokens = searchTokens;

  if (!match) {
    const message = `Not found on Spotify: ${track.title}`;
    await saveLastAction(track, key, message);
    await saveTokens(tokens);
    return message;
  }

  const { tokens: finalTokens } = await addTrackToPlaylist(
    tokens,
    state.settings.playlistId,
    match.uri
  );
  await saveTokens(finalTokens);

  const message = `Added "${match.name}" by ${match.artists.join(", ")}`;
  await saveLastAction(track, key, message);

  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: "Added to Spotify playlist",
    message,
  });

  return message;
}

export async function handleTrackUpdate(track: TrackInfo): Promise<void> {
  const state = await getStoredState();
  if (!state.settings.enabled) {
    return;
  }

  if (!track.isPlaying || isSpotifySource(track.sourceHost)) {
    return;
  }

  const currentKey = trackKey(track);
  const previousKey = state.lastTrack ? trackKey(state.lastTrack) : null;
  if (previousKey === currentKey) {
    return;
  }

  await saveDetectedTrack(track);

  chrome.notifications.create({
    type: "basic",
    iconUrl: chrome.runtime.getURL("icons/icon128.png"),
    title: "Song detected",
    message: `${track.title}${track.artist ? ` — ${track.artist}` : ""}. Open the extension to add it to your playlist.",
  });
}
