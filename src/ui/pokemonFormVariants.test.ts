import { describe, expect, it } from "vitest";
import {
  getMegaStoneForPokemonForm,
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
        expect.objectContaining({
          value: "メガリザードンX",
          showdownName: "Charizard-Mega-X",
          megaStone: { id: "charizarditex", value: "リザードナイトＸ", showdownName: "Charizardite X" },
        }),
        expect.objectContaining({
          value: "メガリザードンY",
          showdownName: "Charizard-Mega-Y",
          megaStone: { id: "charizarditey", value: "リザードナイトＹ", showdownName: "Charizardite Y" },
        }),
      ]),
    );
  });

  it.each([
    {
      input: "アブソル",
      normal: {
        form: "Absol-Mega",
        stone: { id: "absolite", value: "アブソルナイト", showdownName: "Absolite" },
      },
      z: {
        form: "Absol-Mega-Z",
        stone: { id: "absolitez", value: "アブソルナイトＺ", showdownName: "Absolite Z" },
      },
    },
    {
      input: "ガブリアス",
      normal: {
        form: "Garchomp-Mega",
        stone: { id: "garchompite", value: "ガブリアスナイト", showdownName: "Garchompite" },
      },
      z: {
        form: "Garchomp-Mega-Z",
        stone: { id: "garchompitez", value: "ガブリアスナイトＺ", showdownName: "Garchompite Z" },
      },
    },
    {
      input: "ルカリオ",
      normal: {
        form: "Lucario-Mega",
        stone: { id: "lucarionite", value: "ルカリオナイト", showdownName: "Lucarionite" },
      },
      z: {
        form: "Lucario-Mega-Z",
        stone: { id: "lucarionitez", value: "ルカリオナイトＺ", showdownName: "Lucarionite Z" },
      },
    },
  ])("keeps normal and Z mega choices in order with their stones for $input", ({ input, normal, z }) => {
    const options = getPokemonFormVariantOptions(input, "mega");
    expect(options).toEqual([
      expect.objectContaining({ showdownName: normal.form, megaStone: normal.stone }),
      expect.objectContaining({ showdownName: z.form, megaStone: z.stone }),
    ]);
    expect(getMegaStoneForPokemonForm(normal.form)).toEqual(normal.stone);
    expect(getMegaStoneForPokemonForm(z.form)).toEqual(z.stone);
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
    const options = getPokemonFormVariantOptions("レックウザ", "mega");
    expect(options).toEqual([
      expect.objectContaining({
        value: "メガレックウザ",
        showdownName: "Rayquaza-Mega",
      }),
    ]);
    expect(options[0]).not.toHaveProperty("megaStone");
    expect(getMegaStoneForPokemonForm("Rayquaza-Mega")).toBeNull();
  });

  it.each([
    {
      input: "マギアナ",
      form: "Magearna-Mega",
      value: "メガマギアナ",
      stone: { id: "magearnite", value: "マギアナイト", showdownName: "Magearnite" },
    },
    {
      input: "マギアナ ５００ねんまえのいろ",
      form: "Magearna-Original-Mega",
      value: "メガマギアナ",
      stone: { id: "magearnite", value: "マギアナイト", showdownName: "Magearnite" },
    },
    {
      input: "ニャオニクス オスのすがた",
      form: "Meowstic-M-Mega",
      value: "メガニャオニクス",
      stone: { id: "meowsticite", value: "ニャオニクスナイト", showdownName: "Meowsticite" },
    },
    {
      input: "ニャオニクス メスのすがた",
      form: "Meowstic-F-Mega",
      value: "メガニャオニクス",
      stone: { id: "meowsticite", value: "ニャオニクスナイト", showdownName: "Meowsticite" },
    },
    {
      input: "シャリタツ そったすがた",
      form: "Tatsugiri-Curly-Mega",
      value: "メガシャリタツ",
      stone: { id: "tatsugirinite", value: "シャリタツナイト", showdownName: "Tatsugirinite" },
    },
    {
      input: "シャリタツ たれたすがた",
      form: "Tatsugiri-Droopy-Mega",
      value: "メガシャリタツ",
      stone: { id: "tatsugirinite", value: "シャリタツナイト", showdownName: "Tatsugirinite" },
    },
    {
      input: "シャリタツ のびたすがた",
      form: "Tatsugiri-Stretchy-Mega",
      value: "メガシャリタツ",
      stone: { id: "tatsugirinite", value: "シャリタツナイト", showdownName: "Tatsugirinite" },
    },
  ])("keeps the canonical mega branch and shared stone for $input", ({ input, form, value, stone }) => {
    expect(getPokemonFormVariantOptions(input, "mega")).toEqual([
      expect.objectContaining({
        value,
        showdownName: form,
        megaStone: stone,
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

  it("uses the canonical hint to keep identical display labels on their own mega branch", () => {
    expect(getPokemonFormVariantOptions("マギアナ", "mega", "Magearna-Original")).toEqual([
      expect.objectContaining({
        value: "メガマギアナ",
        showdownName: "Magearna-Original-Mega",
      }),
    ]);
    expect(isPokemonFormVariant("メガマギアナ", "mega", "Magearna-Original-Mega")).toBe(true);
    expect(getPokemonBaseFormValue("メガマギアナ", "Magearna-Original-Mega")).toBe("マギアナ ５００ねんまえのいろ");
    expect(getMegaStoneForPokemonForm("メガマギアナ", "Magearna-Original-Mega")).toEqual({
      id: "magearnite",
      value: "マギアナイト",
      showdownName: "Magearnite",
    });
  });

  it("uses the canonical hint for identical Meowstic and Tatsugiri labels", () => {
    expect(getPokemonFormVariantOptions("ニャオニクス メガニャオニクス", "mega", "Meowstic-F-Mega")[0]).toEqual(
      expect.objectContaining({ showdownName: "Meowstic-F-Mega" }),
    );
    expect(getPokemonFormVariantOptions("シャリタツ メガシャリタツ", "mega", "Tatsugiri-Stretchy-Mega")[0]).toEqual(
      expect.objectContaining({ showdownName: "Tatsugiri-Stretchy-Mega" }),
    );
  });
});
