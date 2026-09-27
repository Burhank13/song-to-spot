// Ranks Spotify search results against the detected track. Pure functions so
// they can be unit tested without the extension APIs.

export interface Candidate {
  uri: string;
  name: string;
  artists: string[];
  album: string;
  imageUrl: string | null;
}

export interface ScoredCandidate extends Candidate {
  score: number;
  titleScore: number;
  artistScore: number;
  penalty: number;
}

// Versions that are almost never what someone heard unless the detected
// title says so.
const VERSION_WORDS = [
  "karaoke",
  "instrumental",
  "cover",
  "tribute",
  "originally performed",
  "made famous",
  "in the style of",
  "remix",
  "sped up",
  "slowed",
  "reverb",
  "nightcore",
  "8d",
  "acoustic",
  "live",
  "lullaby",
  "piano version",
  "backing track",
];

const AUTO_ADD_MIN_TITLE = 0.8;
const AUTO_ADD_MIN_ARTIST = 0.8;

export function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Strips version suffixes Spotify adds to titles: "Song - Remastered 2009",
// "Song (feat. X)", "Song [Radio Edit]".
function coreTitle(value: string): string {
  return value
    .replace(/\s*[(\[][^)\]]*[)\]]/g, "")
    .replace(/\s+[-–—]\s+.*$/, "");
}

function bigrams(value: string): Map<string, number> {
  const grams = new Map<string, number>();
  const compact = value.replace(/ /g, "");
  for (let i = 0; i < compact.length - 1; i++) {
    const gram = compact.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

// Sørensen–Dice coefficient on character bigrams, 0..1.
export function similarity(a: string, b: string): number {
  const x = normalize(a);
  const y = normalize(b);
  if (!x || !y) {
    return 0;
  }
  if (x === y) {
    return 1;
  }
  if (x.replace(/ /g, "").length < 2 || y.replace(/ /g, "").length < 2) {
    return 0;
  }

  const gx = bigrams(x);
  const gy = bigrams(y);
  let overlap = 0;
  for (const [gram, count] of gx) {
    overlap += Math.min(count, gy.get(gram) ?? 0);
  }
  const total = [...gx.values(), ...gy.values()].reduce((sum, n) => sum + n, 0);
  return (2 * overlap) / total;
}

export function titleSimilarity(detected: string, result: string): number {
  return Math.max(
    similarity(detected, result),
    0.95 * similarity(coreTitle(detected), coreTitle(result))
  );
}

function containsWords(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

export function artistSimilarity(detected: string, resultArtists: string[]): number {
  const det = normalize(detected);
  if (!det || resultArtists.length === 0) {
    return 0;
  }

  let best = similarity(detected, resultArtists.join(" & "));
  for (const artist of resultArtists) {
    best = Math.max(best, similarity(detected, artist));
    // "Calvin Harris and Dua Lipa" detected vs ["Calvin Harris"].
    const name = normalize(artist);
    if (name && containsWords(det, name)) {
      best = Math.max(best, 0.9);
    }
  }
  return best;
}

export function versionPenalty(detectedTitle: string, candidate: Candidate): number {
  const detected = normalize(detectedTitle);
  const text = normalize(`${candidate.name} ${candidate.album} ${candidate.artists.join(" ")}`);
  let penalty = 0;
  for (const word of VERSION_WORDS) {
    if (containsWords(text, word) && !containsWords(detected, word)) {
      penalty += 0.25;
    }
  }
  return Math.min(penalty, 0.5);
}

export function scoreCandidate(
  detected: { title: string; artist: string },
  candidate: Candidate
): ScoredCandidate {
  const titleScore = titleSimilarity(detected.title, candidate.name);
  const artistScore = artistSimilarity(detected.artist, candidate.artists);
  const penalty = versionPenalty(detected.title, candidate);
  const base = detected.artist.trim()
    ? 0.55 * titleScore + 0.45 * artistScore
    : 0.9 * titleScore;
  return { ...candidate, score: base - penalty, titleScore, artistScore, penalty };
}

// Scores, drops repeats of the same song on different albums (keeping
// Spotify's first, usually the canonical release), and sorts best first.
// Ties keep Spotify's relevance order.
export function rankCandidates(
  detected: { title: string; artist: string },
  candidates: Candidate[]
): ScoredCandidate[] {
  const seen = new Set<string>();
  const unique: Candidate[] = [];
  for (const candidate of candidates) {
    const key = `${normalize(candidate.name)}::${candidate.artists.map(normalize).join(",")}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(candidate);
    }
  }

  return unique
    .map((candidate) => scoreCandidate(detected, candidate))
    .sort((a, b) => b.score - a.score);
}

// Auto-add only when both title and artist clearly match and the result is
// not an unwanted version. Without a known artist we always ask.
export function isConfident(
  detected: { title: string; artist: string },
  best: ScoredCandidate | undefined
): boolean {
  return Boolean(
    best &&
      detected.artist.trim() &&
      best.titleScore >= AUTO_ADD_MIN_TITLE &&
      best.artistScore >= AUTO_ADD_MIN_ARTIST &&
      best.penalty === 0
  );
}
