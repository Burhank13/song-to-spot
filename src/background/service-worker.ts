import type { BackgroundResponse, Message, StatusResponse } from "../shared/messages";
import { getStoredState, saveSettings, saveTokens } from "../shared/storage";
import { authenticateSpotify, getOAuthRedirectUriForSetup } from "../spotify/auth";
import { findNowPlaying } from "./now-playing";
import { withSpotify } from "./spotify-session";
import {
  dismissPending,
  pickMatch,
  saveNowPlaying,
  undoHistoryEntry,
  type SaveResult,
} from "./pipeline";

const SAVE_COMMAND = "save-now-playing";

async function getStatus(): Promise<StatusResponse> {
  const state = await getStoredState();
  return {
    connected: Boolean(state.spotifyTokens),
    playlistId: state.settings.playlistId,
    playlistName: state.settings.playlistName,
    lastTrack: state.lastTrack,
    lastResult: state.lastResult,
    pending: state.pending,
    history: state.history,
  };
}

function toResponse(result: SaveResult): BackgroundResponse {
  return result.outcome === "failed"
    ? { ok: false, error: result.message }
    : { ok: true, message: result.message };
}

chrome.commands.onCommand.addListener((command) => {
  if (command === SAVE_COMMAND) {
    void saveNowPlaying({ notify: true });
  }
});

// Clicking a notification (e.g. "Which song is this?") opens the popup.
chrome.notifications.onClicked.addListener((notificationId) => {
  chrome.notifications.clear(notificationId);
  chrome.action.openPopup().catch(() => {
    // Not allowed when no browser window is focused; the badge still shows.
  });
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
          sendResponse(toResponse(await saveNowPlaying({ notify: false })));
          return;
        }
        case "PICK_MATCH": {
          sendResponse(toResponse(await pickMatch(message.uri)));
          return;
        }
        case "DISMISS_PENDING": {
          await dismissPending();
          sendResponse({ ok: true });
          return;
        }
        case "UNDO": {
          sendResponse(toResponse(await undoHistoryEntry(message.entryId)));
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
          const playlists = await withSpotify(state.spotifyTokens, (api) => api.playlists());
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
