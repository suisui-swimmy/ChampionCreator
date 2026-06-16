import { describe, expect, it } from "vitest";
import { searchDefenceCandidates } from "../search/defenceSearch";
import {
  buildDefenceSearchInput,
  createDefaultScenarioForms,
  createDefaultTargetForm,
} from "./defenceSearchUi";

describe("golden UI scenario", () => {
  it("finds the Mega Starmie bulk that survives Adamant Kingambit Sucker Punch", () => {
    const target = {
      ...createDefaultTargetForm(),
      pokemonInput: "メガスターミー",
      natureInput: "ひかえめ",
      abilityInput: "",
      statPoints: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    };
    const scenarios = createDefaultScenarioForms().map((scenario) => ({
      ...scenario,
      label: "対ドドゲザン",
      attacks: scenario.attacks.map((attack) => ({
        ...attack,
        attackerPokemonInput: "ドドゲザン",
        attackerNatureInput: "いじっぱり",
        attackerAbilityInput: "まけんき",
        attackerItemInput: "",
        moveInput: "ふいうち",
        requiredSurvivedHits: 1,
        minSurvivalProbabilityPercent: 100,
      })),
    }));
    const input = buildDefenceSearchInput(target, scenarios);

    const results = searchDefenceCandidates(input.build, input.scenarios, { maxResults: 20 });

    expect(input.build.pokemon.canonicalName).toBe("Starmie-Mega");
    expect(input.scenarios[0].hits[0].attacker.evs.atk).toBe(252);
    expect(results[0].candidate).toEqual({ hp: 12, def: 7, spd: 0 });
    expect(results.map((result) => result.candidate)).not.toContainEqual({ hp: 0, def: 0, spd: 0 });
    expect(results.map((result) => result.candidate)).toContainEqual({ hp: 0, def: 19, spd: 0 });
    expect(results[0].scenarioResults[0].hitEvaluations[0].description).toContain(
      "252+ Atk Kingambit Sucker Punch vs. 92 HP / 52 Def Starmie-Mega: 122-146",
    );
    expect(results.every((result) => result.passed)).toBe(true);
  });

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

  it("resolves base Vivillon and finds candidates for Jolly Garchomp Rock Slide in doubles", () => {
    const target = {
      ...createDefaultTargetForm(),
      pokemonInput: "ビビヨン はなぞののもよう",
      natureInput: "おくびょう",
      abilityInput: "",
      statPoints: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
    };
    const [defaultScenario] = createDefaultScenarioForms();
    const scenarios = [{
      ...defaultScenario,
      label: "対ガブリアス",
      attacks: defaultScenario.attacks.map((attack) => ({
        ...attack,
        attackerPokemonInput: "ガブリアス",
        attackerNatureInput: "ようき",
        attackerAbilityInput: "",
        attackerItemInput: "",
        attackerStatPoints: { hp: 0, atk: 32, def: 0, spa: 0, spd: 0, spe: 0 },
        moveInput: "いわなだれ",
        gameType: "doubles" as const,
        requiredSurvivedHits: 1,
        minSurvivalProbabilityPercent: 100,
      })),
    }];
    const input = buildDefenceSearchInput(target, scenarios);

    const results = searchDefenceCandidates(input.build, input.scenarios, { maxResults: 1 });

    expect(input.build.pokemon.canonicalName).toBe("Vivillon");
    expect(input.scenarios[0].hits[0].attacker.pokemon.canonicalName).toBe("Garchomp");
    expect(input.scenarios[0].hits[0].move.canonicalName).toBe("Rock Slide");
    expect(input.scenarios[0].hits[0].field?.gameType).toBe("doubles");
    expect(results).toHaveLength(1);
    expect(results.every((result) => result.passed)).toBe(true);
  });
});
