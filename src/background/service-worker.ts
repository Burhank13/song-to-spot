import type { Message, StatusResponse } from "../shared/messages";
import { getStoredState, saveSettings, saveTokens } from "../shared/storage";
import { authenticateSpotify, getOAuthRedirectUriForSetup } from "../spotify/auth";
import { fetchUserPlaylists } from "../spotify/client";
import { findNowPlaying } from "./now-playing";
import { saveNowPlaying } from "./pipeline";

const SAVE_COMMAND = "save-now-playing";

async function getStatus(): Promise<StatusResponse> {
  const state = await getStoredState();
  return {
    connected: Boolean(state.spotifyTokens),
    playlistId: state.settings.playlistId,
    playlistName: state.settings.playlistName,
    lastTrack: state.lastTrack,
    lastResult: state.lastResult,
  };
}

chrome.commands.onCommand.addListener((command) => {
  if (command === SAVE_COMMAND) {
    void saveNowPlaying({ notify: true });
  }
});

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  void (async () => {
    try {
      switch (message.type) {
        case "GET_STATUS": {
          sendResponse(await getStatus());
          return;
        }
        case "GET_NOW_PLAYING": {
          const found = await findNowPlaying();
          sendResponse({
            nowPlaying: found.track,
            reason: found.track ? null : found.reason,
          });
          return;
        }
        case "SAVE_NOW_PLAYING": {
          const result = await saveNowPlaying({ notify: false });
          sendResponse(
            result.ok
              ? { ok: true, message: result.message }
              : { ok: false, error: result.message }
          );
          return;
        }
        case "AUTH_SPOTIFY": {
          const tokens = await authenticateSpotify();
          await saveTokens(tokens);
          sendResponse(await getStatus());
          return;
        }
        case "DISCONNECT_SPOTIFY": {
          await saveTokens(null);
          sendResponse(await getStatus());
          return;
        }
        case "SET_PLAYLIST": {
          const state = await getStoredState();
          await saveSettings({
            ...state.settings,
            playlistId: message.playlistId,
            playlistName: message.playlistName,
          });
          sendResponse(await getStatus());
          return;
        }
        case "FETCH_PLAYLISTS": {
          const state = await getStoredState();
          if (!state.spotifyTokens) {
            sendResponse({ ok: false, error: "Connect Spotify first." });
            return;
          }
          const { playlists, tokens } = await fetchUserPlaylists(state.spotifyTokens);
          await saveTokens(tokens);
          sendResponse({ playlists });
          return;
        }
        default:
          sendResponse({ ok: false, error: "Unknown message type." });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      sendResponse({ ok: false, error: msg });
    }
  })();

  return true;
});

console.info("Songs to Spotify redirect URI:", getOAuthRedirectUriForSetup());
