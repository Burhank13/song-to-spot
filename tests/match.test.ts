import { describe, expect, it } from "vitest";
import {
  artistSimilarity,
  isConfident,
  rankCandidates,
  similarity,
  titleSimilarity,
  type Candidate,
} from "../src/spotify/match";

function candidate(name: string, artists: string[], album = name, uri = `spotify:track:${name}`): Candidate {
  return { uri, name, artists, album, imageUrl: null };
}

describe("similarity", () => {
  it("ignores case, accents and punctuation", () => {
    expect(similarity("Beyoncé", "beyonce")).toBe(1);
    expect(similarity("Don't Stop Me Now", "Dont Stop Me Now")).toBe(1);
  });

  it("scores unrelated strings low", () => {
    expect(similarity("Blinding Lights", "Bohemian Rhapsody")).toBeLessThan(0.4);
  });
});

describe("titleSimilarity", () => {
  it("matches through Spotify version suffixes", () => {
    expect(titleSimilarity("Here Comes The Sun", "Here Comes The Sun - Remastered 2009")).toBeGreaterThanOrEqual(0.9);
    expect(titleSimilarity("Peaches", "Peaches (feat. Daniel Caesar & Giveon)")).toBeGreaterThanOrEqual(0.9);
  });
});

describe("artistSimilarity", () => {
  it("matches any credited artist", () => {
    expect(artistSimilarity("Giveon", ["Justin Bieber", "Daniel Caesar", "Giveon"])).toBe(1);
  });

  it("handles collaborations in the detected artist", () => {
    expect(artistSimilarity("Calvin Harris & Dua Lipa", ["Calvin Harris", "Dua Lipa"])).toBeGreaterThanOrEqual(0.9);
    expect(artistSimilarity("Calvin Harris and Dua Lipa", ["Calvin Harris"])).toBeGreaterThanOrEqual(0.9);
  });

  it("is 0 when the artist is unknown", () => {
    expect(artistSimilarity("", ["Anyone"])).toBe(0);
  });
});

describe("rankCandidates", () => {
  const detected = { title: "Blinding Lights", artist: "The Weeknd" };

  it("ranks the original above karaoke, covers and sped up versions", () => {
    const ranked = rankCandidates(detected, [
      candidate("Blinding Lights (Karaoke Version)", ["Sing2Piano"]),
      candidate("Blinding Lights - Sped Up", ["The Weeknd"]),
      candidate("Blinding Lights", ["Acoustic Covers Band"], "Acoustic Covers 2020"),
      candidate("Blinding Lights", ["The Weeknd"], "After Hours"),
    ]);
    expect(ranked[0].artists).toEqual(["The Weeknd"]);
    expect(ranked[0].name).toBe("Blinding Lights");
    expect(isConfident(detected, ranked[0])).toBe(true);
  });

  it("keeps the requested version when the detected title asks for it", () => {
    const ranked = rankCandidates(
      { title: "Blinding Lights (Remix)", artist: "The Weeknd" },
      [
        candidate("Blinding Lights", ["The Weeknd"]),
        candidate("Blinding Lights - Remix", ["The Weeknd", "ROSALÍA"]),
      ]
    );
    expect(ranked[0].name).toBe("Blinding Lights - Remix");
    expect(ranked[0].penalty).toBe(0);
  });

  it("collapses the same song on different albums, keeping Spotify's first", () => {
    const ranked = rankCandidates(detected, [
      candidate("Blinding Lights", ["The Weeknd"], "After Hours", "spotify:track:a"),
      candidate("Blinding Lights", ["The Weeknd"], "The Highlights", "spotify:track:b"),
    ]);
    expect(ranked).toHaveLength(1);
    expect(ranked[0].uri).toBe("spotify:track:a");
  });
});

describe("isConfident", () => {
  it("asks when the artist is unknown", () => {
    const detected = { title: "Glue", artist: "" };
    const [best] = rankCandidates(detected, [candidate("Glue", ["Bicep"])]);
    expect(isConfident(detected, best)).toBe(false);
  });

  it("asks when only the title matches", () => {
    const detected = { title: "Glue", artist: "Bicep" };
    const [best] = rankCandidates(detected, [candidate("Glue", ["Someone Else"])]);
    expect(isConfident(detected, best)).toBe(false);
  });

  it("asks when the best result is a karaoke version", () => {
    const detected = { title: "Glue", artist: "Bicep" };
    const [best] = rankCandidates(detected, [candidate("Glue (Karaoke Version)", ["Bicep"])]);
    expect(isConfident(detected, best)).toBe(false);
  });

  it("asks when there are no results", () => {
    expect(isConfident({ title: "x", artist: "y" }, undefined)).toBe(false);
  });
});
