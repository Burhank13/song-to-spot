import type { Message, BackgroundResponse, StatusResponse } from "../shared/messages";
import {
  getStoredState,
  saveSettings,
  saveTokens,
  DEFAULT_SETTINGS,
} from "../shared/storage";
import { authenticateSpotify, getOAuthRedirectUriForSetup } from "../spotify/auth";
import { fetchUserPlaylists } from "../spotify/client";
import { handleTrackUpdate, processTrack } from "./pipeline";
import { isTrackUpdate } from "../shared/messages";

async function getStatus(): Promise<StatusResponse> {
  const state = await getStoredState();
  return {
    connected: Boolean(state.spotifyTokens),
    enabled: state.settings.enabled,
    playlistId: state.settings.playlistId,
    playlistName: state.settings.playlistName,
    lastTrack: state.lastTrack,
    lastResult: state.lastResult,
  };
}

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  void (async () => {
    try {
      if (isTrackUpdate(message)) {
        await handleTrackUpdate(message.track);
        sendResponse({ ok: true } satisfies BackgroundResponse);
        return;
      }

      switch (message.type) {
        case "GET_STATUS": {
          sendResponse(await getStatus());
          return;
        }
        case "TOGGLE_ENABLED": {
          const state = await getStoredState();
          const settings = { ...state.settings, enabled: message.enabled };
          await saveSettings(settings);
          sendResponse(await getStatus());
          return;
        }
        case "SEND_NOW": {
          const state = await getStoredState();
          if (!state.lastTrack) {
            sendResponse({ ok: false, error: "No track detected yet." });
            return;
          }
          const result = await processTrack(state.lastTrack, true);
          sendResponse({ ok: true, message: result });
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
