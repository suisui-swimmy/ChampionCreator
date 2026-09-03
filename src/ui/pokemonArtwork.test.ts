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

  it.each([
    ["プルリル メスのすがた", "Frillish", "592-female.png"],
    ["ブルンゲル メスのすがた", "Jellicent", "593-female.png"],
    ["カエンジシ メスのすがた", "Pyroar", "668-female.png"],
  ] as const)("uses the dedicated Pokemon HOME artwork for %s", (input, canonicalName, artwork) => {
    const match = findPokemonArtwork({ input, canonicalName });

    expect(match).toMatchObject({
      label: input,
      showdownName: canonicalName,
    });
    expect(match?.artworkUrl).toContain(`assets/pokemon-home/${artwork}`);
  });

  it("uses distinct artwork for the Three- and Four-family Maushold forms", () => {
    expect(findPokemonArtwork({
      input: "イッカネズミ ３びきかぞく",
      canonicalName: "Maushold",
    })).toMatchObject({
      label: "イッカネズミ ３びきかぞく",
      showdownName: "Maushold",
      artworkUrl: expect.stringContaining("assets/official-artwork/925-family-of-three.png"),
    });
    expect(findPokemonArtwork({
      input: "イッカネズミ ４ひきかぞく",
      canonicalName: "Maushold-Four",
    })).toMatchObject({
      label: "イッカネズミ ４ひきかぞく",
      showdownName: "Maushold-Four",
      artworkUrl: expect.stringContaining("assets/official-artwork/925.png"),
    });
  });

  it("keeps the copied artwork catalog broad enough for UI lookup", () => {
    expect(pokemonArtworkSummary.totalOptions).toBeGreaterThan(1000);
    expect(pokemonArtworkSummary.withArtwork).toBe(pokemonArtworkSummary.totalOptions);
  });
});
