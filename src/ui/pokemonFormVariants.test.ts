import { describe, expect, it } from "vitest";
import {
  getPokemonBaseFormValue,
  getPokemonFormVariantOptions,
  isPokemonFormVariant,
} from "./pokemonFormVariants";

describe("pokemonFormVariants", () => {
  it("returns a single mega form for Pokemon with one mega option", () => {
    expect(getPokemonFormVariantOptions("フシギバナ", "mega")).toEqual([
      expect.objectContaining({
        value: "メガフシギバナ",
        showdownName: "Venusaur-Mega",
      }),
    ]);
  });

  it("keeps multiple mega forms as explicit choices", () => {
    expect(getPokemonFormVariantOptions("リザードン", "mega")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "メガリザードンX", showdownName: "Charizard-Mega-X" }),
        expect.objectContaining({ value: "メガリザードンY", showdownName: "Charizard-Mega-Y" }),
      ]),
    );
  });

  it("only offers Mega Floette from Eternal Flower Floette", () => {
    expect(getPokemonFormVariantOptions("フラエッテ あかいはな", "mega")).toEqual([]);
    expect(getPokemonFormVariantOptions("フラエッテ えいえんのはな", "mega")).toEqual([
      expect.objectContaining({
        value: "メガフラエッテ",
        showdownName: "Floette-Mega",
      }),
    ]);
  });

  it("keeps mega forms that do not have an explicit mega stone mapping", () => {
    expect(getPokemonFormVariantOptions("レックウザ", "mega")).toEqual([
      expect.objectContaining({
        value: "メガレックウザ",
        showdownName: "Rayquaza-Mega",
      }),
    ]);
  });

  it("does not return Gmax choices when upstream calc no longer exposes Gmax species", () => {
    expect(getPokemonFormVariantOptions("フシギバナ", "gmax")).toEqual([]);
    expect(getPokemonFormVariantOptions("ガブリアス", "gmax")).toEqual([]);
  });

  it("returns from a variant form to the base label", () => {
    expect(isPokemonFormVariant("メガフシギバナ", "mega")).toBe(true);
    expect(getPokemonBaseFormValue("メガフシギバナ")).toBe("フシギバナ");
    expect(isPokemonFormVariant("フシギバナ キョダイマックスのすがた", "gmax")).toBe(false);
    expect(getPokemonBaseFormValue("フシギバナ キョダイマックスのすがた")).toBeNull();
  });
});
