import { describe, expect, it } from "vitest";
import { searchDefenceCandidates } from "../search/defenceSearch";
import {
  buildDefenceSearchInput,
  createDefaultScenarioForms,
  createDefaultTargetForm,
} from "./defenceSearchUi";

describe("golden UI scenario", () => {
  it("keeps the Oonyuura Close Combat fixture stable from UI input to ranked candidates", () => {
    const target = {
      ...createDefaultTargetForm(),
      pokemonInput: "オオニューラ",
      natureInput: "いじっぱり",
      abilityInput: "かるわざ",
      statPoints: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    };
    const scenarios = createDefaultScenarioForms().map((scenario) => ({
      ...scenario,
      label: "対オオニューラ",
      attacks: scenario.attacks.map((attack) => ({
        ...attack,
        attackerPokemonInput: "オオニューラ",
        attackerNatureInput: "いじっぱり",
        attackerAbilityInput: "かるわざ",
        attackerItemInput: "こだわりハチマキ",
        attackerTeraTypeInput: "かくとう",
        attackerTeraEnabled: true,
        attackerStatPoints: { hp: 0, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 },
        moveInput: "インファイト",
        minSurvivalProbabilityPercent: 100,
      })),
    }));
    const input = buildDefenceSearchInput(target, scenarios);

    const results = searchDefenceCandidates(input.build, input.scenarios, { maxResults: 5 });

    expect(results[0].candidate).toEqual({ hp: 1, def: 23, spd: 0 });
    expect(results[0].scenarioResults[0].hitEvaluations[0].description).toContain(
      "252+ Atk Choice Band Tera Fighting Sneasler Close Combat vs.",
    );
    expect(results.every((result) => result.passed)).toBe(true);
  });
});
