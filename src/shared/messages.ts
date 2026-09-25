import type { TrackInfo } from "./track";

export type Message =
  | { type: "GET_STATUS" }
  | { type: "GET_NOW_PLAYING" }
  | { type: "SAVE_NOW_PLAYING" }
  | { type: "AUTH_SPOTIFY" }
  | { type: "DISCONNECT_SPOTIFY" }
  | { type: "SET_PLAYLIST"; playlistId: string; playlistName: string }
  | { type: "FETCH_PLAYLISTS" };

// Sent from the service worker to a tab's content script.
export type ContentMessage = { type: "READ_NOW_PLAYING"; audible: boolean };

export interface ContentResponse {
  track: TrackInfo | null;
  // Why nothing was returned, when the tab knows better than "nothing playing".
  reason?: string;
}

export interface PlaylistSummary {
  id: string;
  name: string;
}

export interface StatusResponse {
  connected: boolean;
  playlistId: string | null;
  playlistName: string | null;
  lastTrack: TrackInfo | null;
  lastResult: string | null;
}

export interface PlaylistsResponse {
  playlists: PlaylistSummary[];
}

export interface NowPlayingResponse {
  nowPlaying: TrackInfo | null;
  reason: string | null;
}

export type BackgroundResponse =
  | StatusResponse
  | PlaylistsResponse
  | NowPlayingResponse
  | { ok: true; message?: string }
  | { ok: false; error: string };
