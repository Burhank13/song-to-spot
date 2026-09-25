import type { TrackInfo } from "./track";

const DASH_SEPARATORS = [" - ", " – ", " — "];

// Sites where the Media Session "artist" is a channel name and the real
// artist is usually in the title as "Artist - Song".
const CHANNEL_ARTIST_HOSTS = ["www.youtube.com", "m.youtube.com", "youtube.com"];

const NOISE_WORDS =
  "official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|mv|m/v|explicit|clean|remastered|remaster";

const BRACKETED_NOISE = new RegExp(
  `\\s*[(\\[][^)\\]]*\\b(${NOISE_WORDS})\\b[^)\\]]*[)\\]]`,
  "gi"
);
const BRACKETED_FEATURE = /\s*[(\[]\s*(feat\.?|ft\.?|featuring)\s[^)\]]*[)\]]/gi;
const TRAILING_FEATURE = /\s+(feat\.?|ft\.?|featuring)\s.*$/i;
const TRAILING_PIPE_NOISE = new RegExp(`\\s*[|｜].*\\b(${NOISE_WORDS})\\b.*$`, "i");
const TRAILING_OFFICIAL = /\s+official\s+(music\s+|lyric\s+)?(video|audio)$/i;

function collapse(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/[\s\-–—|:]+$/, "")
    .trim();
}

export function cleanTitle(title: string): string {
  return collapse(
    title
      .replace(BRACKETED_FEATURE, "")
      .replace(BRACKETED_NOISE, "")
      .replace(TRAILING_PIPE_NOISE, "")
      .replace(TRAILING_OFFICIAL, "")
      .replace(TRAILING_FEATURE, "")
  );
}

export function cleanArtist(artist: string): string {
  return collapse(
    artist
      .replace(/\s*-\s*Topic$/i, "")
      .replace(/VEVO$/, "")
      .replace(/\s+official$/i, "")
      .replace(BRACKETED_FEATURE, "")
      .replace(TRAILING_FEATURE, "")
  );
}

function splitArtistTitle(title: string): { artist: string; title: string } | null {
  for (const sep of DASH_SEPARATORS) {
    const index = title.indexOf(sep);
    if (index > 0) {
      const left = title.slice(0, index).trim();
      const right = title.slice(index + sep.length).trim();
      if (left && right) {
        return { artist: left, title: right };
      }
    }
  }
  return null;
}

export function cleanTrack(track: TrackInfo): TrackInfo {
  let { title, artist } = track;

  const titleHasArtist =
    !artist.trim() || CHANNEL_ARTIST_HOSTS.includes(track.sourceHost);
  if (titleHasArtist) {
    const split = splitArtistTitle(title);
    if (split) {
      artist = split.artist;
      title = split.title;
    }
  }

  return { ...track, title: cleanTitle(title), artist: cleanArtist(artist) };
}
