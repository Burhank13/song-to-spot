import { describe, expect, it } from "vitest";
import { parseRetryAfter, spotifyError } from "../src/spotify/errors";

describe("spotifyError", () => {
  it("asks the user to reconnect on 401", () => {
    const error = spotifyError(401, "/search");
    expect(error.reconnect).toBe(true);
    expect(error.message).toMatch(/Connect Spotify again/);
  });

  it("explains dev-mode requirements on 403", () => {
    expect(spotifyError(403, "/search").message).toMatch(/Premium.*User Management/);
    expect(spotifyError(403, "/playlists/abc/items").message).toMatch(/Pick one you own/);
    expect(spotifyError(403, "/search").reconnect).toBe(false);
  });

  it("points at the playlist on 404", () => {
    expect(spotifyError(404, "/playlists/abc").message).toMatch(/Choose another playlist/);
  });

  it("includes the wait time on 429", () => {
    expect(spotifyError(429, "/search", 30).message).toBe(
      "Spotify is limiting requests. Try again in 30 seconds."
    );
    expect(spotifyError(429, "/search").message).toMatch(/Try again shortly/);
  });

  it("reports server errors without the raw body", () => {
    expect(spotifyError(503, "/search").message).toBe(
      "Spotify is having problems right now (503). Try again shortly."
    );
  });
});

describe("parseRetryAfter", () => {
  it.each([
    ["3", 3],
    ["2.5", 3],
    ["0", 0],
    [null, null],
    ["soon", null],
  ])("%s -> %s", (header, expected) => {
    expect(parseRetryAfter(header)).toBe(expected);
  });
});
