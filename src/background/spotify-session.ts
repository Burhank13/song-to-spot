import { saveTokens, type SpotifyTokens } from "../shared/storage";
import { SpotifyApi } from "../spotify/client";
import { SpotifyError } from "../spotify/errors";

// Runs Spotify calls, persists tokens if they were refreshed on the way, and
// signs the user out when the login is no longer usable so the popup offers
// "Connect Spotify" instead of failing on every action.
export async function withSpotify<T>(
  tokens: SpotifyTokens,
  run: (api: SpotifyApi) => Promise<T>
): Promise<T> {
  const api = new SpotifyApi(tokens);
  try {
    return await run(api);
  } catch (error) {
    if (error instanceof SpotifyError && error.reconnect) {
      await saveTokens(null);
    }
    throw error;
  } finally {
    if (api.tokens !== tokens) {
      const { spotifyTokens } = await chrome.storage.local.get("spotifyTokens");
      // Don't resurrect a login that was just cleared above.
      if (spotifyTokens) {
        await saveTokens(api.tokens);
      }
    }
  }
}
