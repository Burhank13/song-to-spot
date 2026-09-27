import type { SpotifyTokens } from "../shared/storage";
import { getValidAccessToken } from "./auth";
import type { Candidate } from "./match";

const API_BASE = "https://api.spotify.com/v1";

export interface SpotifyPlaylist {
  id: string;
  name: string;
}

interface ApiTrack {
  uri: string;
  name: string;
  artists: Array<{ name: string }>;
  album?: { name: string; images?: Array<{ url: string; width: number | null }> };
}

function toCandidate(track: ApiTrack): Candidate {
  const images = track.album?.images ?? [];
  // Smallest image is plenty for a 40px thumbnail.
  const image = [...images].sort((a, b) => (a.width ?? 0) - (b.width ?? 0))[0];
  return {
    uri: track.uri,
    name: track.name,
    artists: track.artists.map((a) => a.name),
    album: track.album?.name ?? "",
    imageUrl: image?.url ?? null,
  };
}

// Wraps the Web API for one batch of calls. Tokens may be refreshed along the
// way; callers persist `api.tokens` afterwards (see withSpotify).
export class SpotifyApi {
  constructor(public tokens: SpotifyTokens) {}

  private async request<T>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : `${API_BASE}${pathOrUrl}`;

    const send = async () => {
      const { accessToken, tokens } = await getValidAccessToken(this.tokens);
      this.tokens = tokens;
      return fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
    };

    let response = await send();
    if (response.status === 401) {
      this.tokens = { ...this.tokens, expiresAt: 0 };
      response = await send();
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Spotify API error (${response.status}): ${text}`);
    }

    return (response.status === 204 ? null : await response.json()) as T;
  }

  // Only playlists the user can add to: their own and collaborative ones.
  async playlists(): Promise<SpotifyPlaylist[]> {
    const me = await this.request<{ id: string }>("/me");
    const playlists: SpotifyPlaylist[] = [];
    let next: string | null = "/me/playlists?limit=50";

    while (next) {
      const page: {
        items: Array<{ id: string; name: string; collaborative: boolean; owner: { id: string } }>;
        next: string | null;
      } = await this.request(next);
      for (const item of page.items) {
        if (item.owner.id === me.id || item.collaborative) {
          playlists.push({ id: item.id, name: item.name });
        }
      }
      next = page.next;
    }
    return playlists;
  }

  async search(query: string, limit = 10): Promise<Candidate[]> {
    const params = new URLSearchParams({ q: query, type: "track", limit: String(limit) });
    const data = await this.request<{ tracks: { items: ApiTrack[] } }>(
      `/search?${params.toString()}`
    );
    return data.tracks.items.map(toCandidate);
  }

  async playlistSnapshot(playlistId: string): Promise<string> {
    const data = await this.request<{ snapshot_id: string }>(
      `/playlists/${playlistId}?fields=snapshot_id`
    );
    return data.snapshot_id;
  }

  async playlistUris(playlistId: string): Promise<string[]> {
    const uris: string[] = [];
    const fields = encodeURIComponent("next,items(item(uri))");
    let next: string | null = `/playlists/${playlistId}/items?limit=50&fields=${fields}`;

    while (next) {
      const page: { items: Array<{ item: { uri: string } | null }>; next: string | null } =
        await this.request(next);
      for (const entry of page.items) {
        if (entry.item?.uri) {
          uris.push(entry.item.uri);
        }
      }
      next = page.next;
    }
    return uris;
  }

  async addToPlaylist(playlistId: string, uri: string): Promise<string> {
    const data = await this.request<{ snapshot_id: string }>(
      `/playlists/${playlistId}/items`,
      { method: "POST", body: JSON.stringify({ uris: [uri] }) }
    );
    return data.snapshot_id;
  }

  async removeFromPlaylist(playlistId: string, uri: string): Promise<string> {
    const data = await this.request<{ snapshot_id: string }>(
      `/playlists/${playlistId}/items`,
      { method: "DELETE", body: JSON.stringify({ items: [{ uri }] }) }
    );
    return data.snapshot_id;
  }
}
