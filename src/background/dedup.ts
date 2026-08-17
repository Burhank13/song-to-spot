const DEDUP_WINDOW_MS = 30_000;

export function shouldSkipDuplicate(
  key: string,
  lastKey: string | null,
  lastSentAt: number,
  now = Date.now()
): boolean {
  if (!lastKey || key !== lastKey) {
    return false;
  }
  return now - lastSentAt < DEDUP_WINDOW_MS;
}

export function buildSearchQuery(title: string, artist: string): string {
  const parts: string[] = [];
  if (title.trim()) {
    parts.push(`track:${title.trim()}`);
  }
  if (artist.trim()) {
    parts.push(`artist:${artist.trim()}`);
  }
  return parts.join(" ") || title.trim();
}
