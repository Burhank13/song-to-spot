import type { TrackInfo } from "./track";

export type Message =
  | { type: "TRACK_UPDATE"; track: TrackInfo }
  | { type: "GET_STATUS" }
  | { type: "TOGGLE_ENABLED"; enabled: boolean }
  | { type: "SEND_NOW" }
  | { type: "AUTH_SPOTIFY" }
  | { type: "DISCONNECT_SPOTIFY" }
  | { type: "SET_PLAYLIST"; playlistId: string; playlistName: string }
  | { type: "FETCH_PLAYLISTS" };

export interface PlaylistSummary {
  id: string;
  name: string;
}

export interface StatusResponse {
  connected: boolean;
  enabled: boolean;
  playlistId: string | null;
  playlistName: string | null;
  lastTrack: TrackInfo | null;
  lastResult: string | null;
}

export interface PlaylistsResponse {
  playlists: PlaylistSummary[];
}

export type BackgroundResponse =
  | StatusResponse
  | PlaylistsResponse
  | { ok: true; message?: string }
  | { ok: false; error: string };

export function isTrackUpdate(
  message: Message
): message is Extract<Message, { type: "TRACK_UPDATE" }> {
  return message.type === "TRACK_UPDATE";
}
