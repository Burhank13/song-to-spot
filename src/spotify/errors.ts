// Turns Spotify HTTP failures into messages a user can act on. Raw response
// bodies go to the console, not the UI.

export class SpotifyError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    // True when the stored login is no longer usable and the user must
    // connect again.
    public readonly reconnect = false
  ) {
    super(message);
    this.name = "SpotifyError";
  }
}

export const NETWORK_ERROR_MESSAGE =
  "Couldn't reach Spotify. Check your internet connection and try again.";

export function loginExpiredError(status: number): SpotifyError {
  return new SpotifyError(
    "Your Spotify login expired or was revoked. Connect Spotify again in the extension.",
    status,
    true
  );
}

export function spotifyError(
  status: number,
  path: string,
  retryAfterSeconds: number | null = null
): SpotifyError {
  const isPlaylist = path.startsWith("/playlists/");

  if (status === 401) {
    return loginExpiredError(status);
  }
  if (status === 403) {
    return new SpotifyError(
      isPlaylist
        ? "Spotify won't let you change this playlist. Pick one you own, and check that the app owner has Premium and your account is listed under User Management in the Spotify dashboard."
        : "Spotify refused the request. The app owner needs Premium, and your account must be listed under User Management in the Spotify dashboard.",
      status
    );
  }
  if (status === 404 && isPlaylist) {
    return new SpotifyError(
      "Your target playlist wasn't found. It may have been deleted. Choose another playlist.",
      status
    );
  }
  if (status === 429) {
    const wait = retryAfterSeconds ? ` Try again in ${retryAfterSeconds} seconds.` : " Try again shortly.";
    return new SpotifyError(`Spotify is limiting requests.${wait}`, status);
  }
  if (status >= 500) {
    return new SpotifyError(
      `Spotify is having problems right now (${status}). Try again shortly.`,
      status
    );
  }
  return new SpotifyError(`Spotify request failed (${status}).`, status);
}

export function parseRetryAfter(header: string | null): number | null {
  if (!header) {
    return null;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : null;
}
