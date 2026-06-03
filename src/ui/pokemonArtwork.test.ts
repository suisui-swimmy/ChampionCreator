import { describe, expect, it } from "vitest";
import { findPokemonArtwork, pokemonArtworkSummary } from "./pokemonArtwork";

describe("pokemonArtwork", () => {
  it("finds artwork from Japanese input", () => {
    const match = findPokemonArtwork({ input: "カイリュー" });

    expect(match?.showdownName).toBe("Dragonite");
    expect(match?.label).toBe("カイリュー");
    expect(match?.artworkUrl).toContain("assets/official-artwork/149.png");
  });

  it("prefers canonical names when available", () => {
    const match = findPokemonArtwork({ input: "ガブ", canonicalName: "Garchomp" });

    expect(match?.showdownName).toBe("Garchomp");
    expect(match?.artworkUrl).toContain("assets/official-artwork/445.png");
  });

  it("uses concise labels for mega Pokemon artwork", () => {
    const match = findPokemonArtwork({ input: "スターミー メガスターミー", canonicalName: "Starmie-Mega" });

    expect(match?.showdownName).toBe("Starmie-Mega");
    expect(match?.label).toBe("メガスターミー");
  });

  it("keeps the copied artwork catalog broad enough for UI lookup", () => {
    expect(pokemonArtworkSummary.totalOptions).toBeGreaterThan(1000);
    expect(pokemonArtworkSummary.withArtwork).toBe(pokemonArtworkSummary.totalOptions);
  });
});
