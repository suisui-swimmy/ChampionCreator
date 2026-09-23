import { describe, expect, it } from "vitest";
import {
  applyMoveInputDefaults, applyBeatUpParticipants, applyBeatUpGameTypeDefaults,
  createDefaultScenarioAttackForm, createDefaultTargetForm,
  buildDefenceSearchInput, getDefenceCumulativeCountLimit, getDefenceHitsBefore,
  updateDefenceCumulativeCounts, type ScenarioFormState,
} from "./defenceSearchUi";
import { toSmogonPokemon } from "../calc/smogonAdapter";
import { evaluateScenario } from "../search/defenceSearch";
import { createShareStateDocument, parseShareStateDocument } from "./shareState";
import { createSharedAdjustmentUrl, readSharedAdjustmentHash, validateSharedConditions } from "../share/sharedAdjustment";

const makeScenario = (): ScenarioFormState => ({
  id: "cumulative", label: "累計の確認", enabled: true, adjustmentType: "defence",
  attacks: ["a", "b"].map((id, index) => ({ ...createDefaultScenarioAttackForm(id), moveInput: "いわなだれ",
    repeat: 1, requiredSurvivedHits: index + 1, minSurvivalProbabilityPercent: 100 })),
});
const move = (scenario: ScenarioFormState, id: string, moveInput: string) =>
  updateDefenceCumulativeCounts(scenario, (local) => ({ ...local,
    attacks: local.attacks.map((attack) => attack.id === id ? applyMoveInputDefaults(attack, moveInput, true) : attack),
  }));
const repeat = (scenario: ScenarioFormState, id: string, count: number) =>
  updateDefenceCumulativeCounts(scenario, (local) => ({ ...local,
    attacks: local.attacks.map((attack) => attack.id === id ? { ...attack, repeat: count } : attack),
  }));
const required = (scenario: ScenarioFormState) => scenario.attacks.map((attack) => attack.requiredSurvivedHits);

describe("defence cumulative hit defaults", () => {
  it.each([["a", "b"], ["b", "a"]])("counts two Rock Blasts as 5 then 10, editing %s before %s", (first, second) => {
    const original = makeScenario();
    const before = JSON.stringify(original);
    const scenario = move(move(original, first, "ロックブラスト"), second, "ロックブラスト");
    expect(required(scenario)).toEqual([5, 10]);
    expect(scenario.attacks.map((attack) => attack.repeat)).toEqual([5, 5]);
    const input = buildDefenceSearchInput(createDefaultTargetForm(), [scenario]);
    expect(input.scenarios[0].hits.map((hit) => hit.constraint?.requiredSurvivedHits)).toEqual([5, 10]);
    const hp = toSmogonPokemon(input.build).maxHP();
    const damage = Math.ceil(hp / 7);
    const result = evaluateScenario(input.build, input.scenarios[0], { calculateHit: (_build, hit) => ({
      hitId: hit.id, damageRolls: [damage * 5], damageRollsByHit: Array.from({ length: 5 }, () => [damage]),
      damageRange: { min: damage * 5, max: damage * 5, percentMin: 0, percentMax: 0 },
    }) });
    expect(damage * 6).toBeLessThan(hp);
    expect(result.passed).toBe(false); // Six hits would pass; all ten must be checked.
    expect(result.requiredSurvivedHits).toBe(10);
    expect(JSON.stringify(original)).toBe(before);
  });

  it("includes preceding single attacks, handles repeat changes, and resets a full multi-hit default on a single move", () => {
    let scenario = move(makeScenario(), "b", "ロックブラスト");
    expect(required(scenario)).toEqual([1, 6]);
    scenario = repeat(scenario, "a", 2);
    expect(required(scenario)).toEqual([2, 7]);
    scenario = repeat(scenario, "b", 3);
    expect(required(scenario)).toEqual([2, 5]);
    scenario = move(move(scenario, "b", "ロックブラスト"), "b", "いわなだれ");
    expect(required(scenario)).toEqual([2, 3]);
    expect(scenario.attacks[1].repeat).toBe(1);
  });

  it("keeps a manual third-hit checkpoint when a previous card changes or is removed", () => {
    let scenario = move(move(makeScenario(), "a", "ロックブラスト"), "b", "ロックブラスト");
    scenario.attacks[1].requiredSurvivedHits = 8;
    scenario = move(scenario, "a", "いわなだれ");
    expect(required(scenario)).toEqual([1, 4]);
    scenario = updateDefenceCumulativeCounts(scenario, (local) => ({ ...local, attacks: local.attacks.slice(1) }));
    expect(required(scenario)).toEqual([3]);
    expect(required(repeat(scenario, "b", 4))).toEqual([3]);
  });

  it("supports addition beyond ten, exact calc checkpoints, and backup / s2 restoration", async () => {
    let scenario = move(move(makeScenario(), "a", "ロックブラスト"), "b", "ロックブラスト");
    scenario = updateDefenceCumulativeCounts(scenario, (local) => ({ ...local,
      attacks: [...local.attacks, { ...createDefaultScenarioAttackForm("c"), moveInput: "", requiredSurvivedHits: 1 }],
    }));
    expect(required(scenario)).toEqual([5, 10, 11]);
    scenario = move(scenario, "c", "ロックブラスト");
    expect(required(scenario)).toEqual([5, 10, 15]);
    expect(getDefenceCumulativeCountLimit(scenario)).toBe(15);
    const input = buildDefenceSearchInput(createDefaultTargetForm(), [scenario]);
    expect(input.scenarios[0].hits[2].constraint?.requiredSurvivedHits).toBe(15);
    const document = createShareStateDocument(createDefaultTargetForm(), [scenario]);
    expect(required(parseShareStateDocument(JSON.stringify(document)).scenarios[0])).toEqual([5, 10, 15]);
    const url = new URL(await createSharedAdjustmentUrl(document, "https://example.com/"));
    const restored = await readSharedAdjustmentHash(url.hash);
    expect(required(restored.document.scenarios[0])).toEqual([5, 10, 15]);
    expect(() => validateSharedConditions(document, true)).toThrow("累計回数");
  });

  it("keeps Beat Up counts cumulative when participants or format change", () => {
    let scenario = move(move(makeScenario(), "a", "ロックブラスト"), "b", "ふくろだたき");
    scenario = updateDefenceCumulativeCounts(scenario, (local) => ({ ...local, attacks: local.attacks.map((attack) => {
      if (attack.id !== "b") return attack;
      const doubles = { ...attack, gameType: "doubles" as const };
      return applyBeatUpParticipants(doubles, [doubles.beatUpParticipants[0], ...[1, 2, 3].map((n) => ({
        id: `party-${n}`, source: "party" as const, pokemonInput: "ガブリアス", powerMode: "auto" as const, powerValue: 0,
      }))]);
    }) }));
    expect(required(scenario)).toEqual([5, 9]);
    scenario = updateDefenceCumulativeCounts(scenario, (local) => ({ ...local,
      attacks: local.attacks.map((attack) => applyBeatUpGameTypeDefaults(attack, "singles")),
    }));
    expect(required(scenario)).toEqual([5, 8]);
  });

  it("does not count support cards as hits or change offense and speed inputs", () => {
    const scenario = makeScenario();
    scenario.attacks.unshift({ ...createDefaultScenarioAttackForm("support"), moveInput: "", attackerAbilityInput: "フレンドガード" });
    expect(getDefenceHitsBefore(scenario, "b")).toBe(1);
    for (const adjustmentType of ["offense", "speed"] as const) {
      const other = { ...scenario, adjustmentType };
      expect(updateDefenceCumulativeCounts(other, (local) => local)).toBe(other);
    }
    expect(updateDefenceCumulativeCounts(scenario, (local) => local)).toBe(scenario);
  });
});
