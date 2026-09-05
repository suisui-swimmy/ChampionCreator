import { describe, expect, it } from "vitest";
import megaAbilityManifestPayload from "../data/overrides/mega-ability-manifest.json";
import pokemonOptionsPayload from "../data/generated/pokemon-options.gen.json";
import { getPokemonAbilityInputOptions } from "../localization/resolver";
import { getPokemonAbilityInputPlan } from "./pokemonAbilityOptions";
import { getMegaBasePokemonCanonicalName } from "./pokemonFormVariants";

describe("getPokemonAbilityInputPlan", () => {
  it("uses each known Mega form's sole fixed ability without usage data", () => {
    expect(getPokemonAbilityInputPlan("Charizard-Mega-X")).toMatchObject({
      isMega: true,
      isUnconfirmedMega: false,
      defaultInput: "かたいツメ",
      options: [expect.objectContaining({ canonicalName: "Tough Claws", value: "かたいツメ" })],
    });
    expect(getPokemonAbilityInputPlan("Charizard-Mega-Y")).toMatchObject({
      isMega: true,
      isUnconfirmedMega: false,
      defaultInput: "ひでり",
      options: [expect.objectContaining({ canonicalName: "Drought", value: "ひでり" })],
    });
    expect(getPokemonAbilityInputPlan("Meowstic-M-Mega")).toMatchObject({
      isMega: true,
      isUnconfirmedMega: false,
      defaultInput: "トレース",
      options: [expect.objectContaining({ canonicalName: "Trace", value: "トレース" })],
    });

    for (const [showdownName, value, canonicalName] of [
      ["Skarmory-Mega", "すじがねいり", "Stalwart"],
      ["Hawlucha-Mega", "ノーガード", "No Guard"],
      ["Absol-Mega-Z", "きれあじ", "Sharpness"],
      ["Garchomp-Mega-Z", "ふゆう", "Levitate"],
      ["Lucario-Mega-Z", "はどうのぼうご", "Aura Guard"],
    ] as const) {
      expect(getPokemonAbilityInputPlan(showdownName)).toMatchObject({
        isMega: true,
        isUnconfirmedMega: false,
        defaultInput: value,
        options: [expect.objectContaining({ canonicalName, value })],
      });
    }
  });

  it("keeps unconfirmed Mega defaults blank and exposes every pre-Mega ability", () => {
    for (const pokemon of [
      "Heatran-Mega",
      "Darkrai-Mega",
      "Zygarde-Mega",
      "Golisopod-Mega",
      "Zeraora-Mega",
      "Baxcalibur-Mega",
    ]) {
      expect(getPokemonAbilityInputPlan(pokemon)).toMatchObject({
        isMega: true,
        isUnconfirmedMega: true,
        defaultInput: undefined,
        options: expect.arrayContaining([expect.anything()]),
      });
    }

    for (const pokemon of [
      "Tatsugiri-Curly-Mega",
      "Tatsugiri-Droopy-Mega",
      "Tatsugiri-Stretchy-Mega",
    ]) {
      expect(getPokemonAbilityInputPlan(pokemon)).toMatchObject({
        isMega: true,
        isUnconfirmedMega: true,
        defaultInput: undefined,
        options: [
          expect.objectContaining({ canonicalName: "Commander", value: "しれいとう" }),
          expect.objectContaining({ canonicalName: "Storm Drain", value: "よびみず" }),
        ],
      });
    }

    for (const pokemon of ["Magearna-Mega", "Magearna-Original-Mega"]) {
      expect(getPokemonAbilityInputPlan(pokemon)).toMatchObject({
        isMega: true,
        isUnconfirmedMega: true,
        defaultInput: undefined,
        options: [
          expect.objectContaining({ canonicalName: "Soul-Heart", value: "ソウルハート" }),
        ],
      });
    }
  });

  it("leaves normal Pokemon on their existing ability-list path", () => {
    expect(getPokemonAbilityInputPlan("Charizard")).toMatchObject({
      isMega: false,
      isUnconfirmedMega: false,
      defaultInput: undefined,
      options: [
        expect.objectContaining({ canonicalName: "Blaze", value: "もうか" }),
        expect.objectContaining({ canonicalName: "Solar Power", value: "サンパワー" }),
      ],
    });
    expect(getPokemonAbilityInputPlan(undefined)).toEqual({
      options: undefined,
      isMega: false,
      isUnconfirmedMega: false,
    });
  });

  it("covers every supported Mega form with either a fixed default or an explicit unconfirmed fallback", () => {
    const megaCanonicalNames = (pokemonOptionsPayload.entries as Array<{ showdownName: string }>)
      .map((option) => option.showdownName)
      .filter((showdownName) => /-Mega(?:-[XYZ])?$/u.test(showdownName));
    const plans = megaCanonicalNames.map((showdownName) => ({
      showdownName,
      plan: getPokemonAbilityInputPlan(showdownName),
    }));

    expect(plans).toHaveLength(97);
    expect(plans
      .filter(({ plan }) => plan.isUnconfirmedMega)
      .map(({ showdownName }) => showdownName)
      .sort())
      .toEqual([
        "Baxcalibur-Mega",
        "Darkrai-Mega",
        "Golisopod-Mega",
        "Heatran-Mega",
        "Magearna-Mega",
        "Magearna-Original-Mega",
        "Tatsugiri-Curly-Mega",
        "Tatsugiri-Droopy-Mega",
        "Tatsugiri-Stretchy-Mega",
        "Zeraora-Mega",
        "Zygarde-Mega",
      ]);
    expect(plans.filter(({ plan }) => !plan.isUnconfirmedMega).every(({ plan }) => (
      plan.isMega && plan.options?.length === 1 && plan.defaultInput === plan.options[0].value
    ))).toBe(true);
  });

  it("keeps the tracked Mega manifest at 97 forms with 86 confirmed and 11 unconfirmed", () => {
    expect(megaAbilityManifestPayload.summary).toEqual({
      totalForms: 97,
      confirmed: 86,
      unconfirmed: 11,
    });
    expect(megaAbilityManifestPayload.entries).toHaveLength(97);
    expect(megaAbilityManifestPayload.entries.filter((entry) => entry.status === "confirmed")).toHaveLength(86);
    expect(megaAbilityManifestPayload.entries.filter((entry) => entry.status === "unconfirmed")).toHaveLength(11);
    expect(megaAbilityManifestPayload.entries
      .filter((entry) => entry.status === "unconfirmed")
      .map((entry) => entry.showdownName)
      .sort())
      .toEqual([
        "Baxcalibur-Mega",
        "Darkrai-Mega",
        "Golisopod-Mega",
        "Heatran-Mega",
        "Magearna-Mega",
        "Magearna-Original-Mega",
        "Tatsugiri-Curly-Mega",
        "Tatsugiri-Droopy-Mega",
        "Tatsugiri-Stretchy-Mega",
        "Zeraora-Mega",
        "Zygarde-Mega",
      ]);
  });

  it("uses the resolved pre-Mega ability list for every unconfirmed form", () => {
    for (const entry of megaAbilityManifestPayload.entries.filter((candidate) => (
      candidate.status === "unconfirmed"
    ))) {
      const baseCanonicalName = getMegaBasePokemonCanonicalName(entry.showdownName);
      expect(baseCanonicalName).not.toBeNull();
      expect(getPokemonAbilityInputPlan(entry.showdownName)).toMatchObject({
        isUnconfirmedMega: true,
        defaultInput: undefined,
        options: getPokemonAbilityInputOptions(baseCanonicalName ?? undefined),
      });
    }
  });
});
