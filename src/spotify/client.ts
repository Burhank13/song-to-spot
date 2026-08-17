import type { SpotifyTokens } from "../shared/storage";
import { getValidAccessToken } from "./auth";

export interface SpotifyPlaylist {
  id: string;
  name: string;
}

export interface SpotifyTrackMatch {
  id: string;
  uri: string;
  name: string;
  artists: string[];
}

async function spotifyFetch(
  tokens: SpotifyTokens,
  path: string,
  init: RequestInit = {}
): Promise<{ data: unknown; tokens: SpotifyTokens }> {
  let { accessToken, tokens: currentTokens } = await getValidAccessToken(tokens);

  let response = await fetch(`https://api.spotify.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (response.status === 401) {
    const refreshed = await getValidAccessToken({
      ...currentTokens,
      expiresAt: 0,
    });
    currentTokens = refreshed.tokens;
    accessToken = refreshed.accessToken;

    response = await fetch(`https://api.spotify.com/v1${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Spotify API error (${response.status}): ${text}`);
  }

  const data =
    response.status === 204 ? null : await response.json();
  return { data, tokens: currentTokens };
}

export async function fetchUserPlaylists(
  tokens: SpotifyTokens
): Promise<{ playlists: SpotifyPlaylist[]; tokens: SpotifyTokens }> {
  const playlists: SpotifyPlaylist[] = [];
  let nextUrl: string | null = "/me/playlists?limit=50";
  let currentTokens = tokens;

  while (nextUrl) {
    const path = nextUrl.startsWith("http")
      ? nextUrl.replace("https://api.spotify.com/v1", "")
      : nextUrl;

    const { data, tokens: updatedTokens } = await spotifyFetch(currentTokens, path);
    currentTokens = updatedTokens;

    const page = data as {
      items: Array<{ id: string; name: string }>;
      next: string | null;
    };

    for (const item of page.items) {
      playlists.push({ id: item.id, name: item.name });
    }
    nextUrl = page.next;
  }

  return { playlists, tokens: currentTokens };
}

export async function searchTrack(
  tokens: SpotifyTokens,
  query: string
): Promise<{ track: SpotifyTrackMatch | null; tokens: SpotifyTokens }> {
  const params = new URLSearchParams({
    q: query,
    type: "track",
    limit: "3",
  });

  const { data, tokens: updatedTokens } = await spotifyFetch(
    tokens,
    `/search?${params.toString()}`
  );

  const results = data as {
    tracks: {
      items: Array<{
        id: string;
        uri: string;
        name: string;
        artists: Array<{ name: string }>;
      }>;
    };
  };

  const first = results.tracks.items[0];
  if (!first) {
    return { track: null, tokens: updatedTokens };
  }

  return {
    track: {
      id: first.id,
      uri: first.uri,
      name: first.name,
      artists: first.artists.map((a) => a.name),
    },
    tokens: updatedTokens,
  };
}

export async function addTrackToPlaylist(
  tokens: SpotifyTokens,
  playlistId: string,
  trackUri: string
): Promise<{ tokens: SpotifyTokens }> {
  const { tokens: updatedTokens } = await spotifyFetch(
    tokens,
    `/playlists/${playlistId}/tracks`,
    {
      method: "POST",
      body: JSON.stringify({ uris: [trackUri] }),
    }
  );

  return { tokens: updatedTokens };
}
