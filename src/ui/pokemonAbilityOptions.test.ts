import { describe, expect, it } from "vitest";
import pokemonOptionsPayload from "../data/generated/pokemon-options.gen.json";
import { getPokemonAbilityInputPlan } from "./pokemonAbilityOptions";

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
  });

  it("keeps unconfirmed Mega defaults blank and exposes every pre-Mega ability", () => {
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
        "Magearna-Mega",
        "Magearna-Original-Mega",
        "Tatsugiri-Curly-Mega",
        "Tatsugiri-Droopy-Mega",
        "Tatsugiri-Stretchy-Mega",
      ]);
    expect(plans.filter(({ plan }) => !plan.isUnconfirmedMega).every(({ plan }) => (
      plan.isMega && plan.options?.length === 1 && plan.defaultInput === plan.options[0].value
    ))).toBe(true);
  });
});
