export interface TrackInfo {
  title: string;
  artist: string;
  album: string;
  isPlaying: boolean;
  sourceUrl: string;
  sourceHost: string;
}

export function trackKey(track: Pick<TrackInfo, "title" | "artist">): string {
  return `${track.title.trim().toLowerCase()}::${track.artist.trim().toLowerCase()}`;
}

export function isSpotifySource(host: string): boolean {
  return host.includes("spotify.com");
}
