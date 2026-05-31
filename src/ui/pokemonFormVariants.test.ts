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

  it("returns gmax options only when a matching image-backed form exists", () => {
    expect(getPokemonFormVariantOptions("フシギバナ", "gmax")).toEqual([
      expect.objectContaining({
        value: "フシギバナ キョダイマックスのすがた",
        showdownName: "Venusaur-Gmax",
      }),
    ]);
    expect(getPokemonFormVariantOptions("ガブリアス", "gmax")).toEqual([]);
  });

  it("returns from a variant form to the base label", () => {
    expect(isPokemonFormVariant("メガフシギバナ", "mega")).toBe(true);
    expect(getPokemonBaseFormValue("メガフシギバナ")).toBe("フシギバナ");
    expect(isPokemonFormVariant("フシギバナ キョダイマックスのすがた", "gmax")).toBe(true);
    expect(getPokemonBaseFormValue("フシギバナ キョダイマックスのすがた")).toBe("フシギバナ");
  });
});
