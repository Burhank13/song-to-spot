import { describe, expect, it } from "vitest";
import { cleanArtist, cleanTitle, cleanTrack } from "../src/shared/clean";
import type { TrackInfo } from "../src/shared/track";

function track(title: string, artist: string, sourceHost: string): TrackInfo {
  return {
    title,
    artist,
    album: "",
    isPlaying: true,
    sourceUrl: `https://${sourceHost}/`,
    sourceHost,
  };
}

describe("cleanTitle", () => {
  it.each([
    ["Blinding Lights (Official Video)", "Blinding Lights"],
    ["Blinding Lights [Official Music Video]", "Blinding Lights"],
    ["Levitating (Lyrics)", "Levitating"],
    ["Levitating (Lyric Video)", "Levitating"],
    ["Stay (Official Audio) [4K]", "Stay"],
    ["Bad Habit (Visualizer)", "Bad Habit"],
    ["Paint The Town Red | Official Video", "Paint The Town Red"],
    ["Paint The Town Red Official Music Video", "Paint The Town Red"],
    ["Peaches (feat. Daniel Caesar & Giveon)", "Peaches"],
    ["Peaches ft. Daniel Caesar", "Peaches"],
    ['"Vampire"', "Vampire"],
    ["Here Comes The Sun - Remastered 2009", "Here Comes The Sun - Remastered 2009"],
  ])("%s -> %s", (input, expected) => {
    expect(cleanTitle(input)).toBe(expected);
  });

  it("keeps meaningful parentheses", () => {
    expect(cleanTitle("Heroes (Live at Wembley)")).toBe("Heroes (Live at Wembley)");
  });
});

describe("cleanArtist", () => {
  it.each([
    ["Daft Punk - Topic", "Daft Punk"],
    ["AdeleVEVO", "Adele"],
    ["Drake ft. Future", "Drake"],
    ["Tyler, The Creator", "Tyler, The Creator"],
    ["Simon & Garfunkel", "Simon & Garfunkel"],
  ])("%s -> %s", (input, expected) => {
    expect(cleanArtist(input)).toBe(expected);
  });
});

describe("cleanTrack", () => {
  it("splits 'Artist - Song' on YouTube, where the artist field is the channel", () => {
    const result = cleanTrack(
      track("The Weeknd - Blinding Lights (Official Video)", "TheWeekndVEVO", "www.youtube.com")
    );
    expect(result.artist).toBe("The Weeknd");
    expect(result.title).toBe("Blinding Lights");
  });

  it("uses the cleaned channel name on YouTube when the title has no dash", () => {
    const result = cleanTrack(track("Get Lucky", "Daft Punk - Topic", "www.youtube.com"));
    expect(result.artist).toBe("Daft Punk");
    expect(result.title).toBe("Get Lucky");
  });

  it("trusts the artist field on real music sites", () => {
    const result = cleanTrack(
      track("Here Comes The Sun - Remastered 2009", "The Beatles", "music.youtube.com")
    );
    expect(result.artist).toBe("The Beatles");
    expect(result.title).toBe("Here Comes The Sun - Remastered 2009");
  });

  it("splits the title when there is no artist (page-title fallback)", () => {
    const result = cleanTrack(track("Bicep - Glue", "", "example.com"));
    expect(result.artist).toBe("Bicep");
    expect(result.title).toBe("Glue");
  });
});
