import { describe, expect, it } from "vitest";
import { calculateSmogonHit, toSmogonPokemon } from "../calc/smogonAdapter";
import type { EntityKind } from "../data/localizationTypes";
import type { Build, EntityRef, FieldState, Scenario, ScenarioHit, SideState, StatTable } from "../domain/model";
import { toEntityRef } from "../domain/model";
import { resolveEntity } from "../localization/resolver";
import {
  calculateSurvivalProbability,
  enumerateDefenceEvCandidates,
  evaluateCandidate,
  evaluateScenario,
  searchDefenceCandidates,
  type CalculateHit,
} from "./defenceSearch";

const mustResolve = <K extends EntityKind>(kind: K, input: string): EntityRef<K> => {
  const ref = toEntityRef(resolveEntity(kind, input), kind);
  if (!ref) {
    throw new Error(`Expected ${kind}:${input} to resolve`);
  }
  return ref;
};

const defaultIvs: StatTable = {
  hp: 31,
  atk: 31,
  def: 31,
  spa: 31,
  spd: 31,
  spe: 31,
};

const zeroEvs: StatTable = {
  hp: 0,
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
};

const emptySide: SideState = {
  reflect: false,
  lightScreen: false,
  auroraVeil: false,
  helpingHand: false,
};

const emptyField: FieldState = {
  gameType: "singles",
  weather: "none",
  terrain: "none",
};

const makeBuild = (
  id: string,
  pokemonInput: string,
  evs: StatTable = zeroEvs,
  level = 50,
  natureInput?: string,
): Build => ({
  id,
  pokemon: mustResolve("pokemon", pokemonInput),
  level,
  nature: natureInput ? mustResolve("nature", natureInput) : undefined,
  ivs: defaultIvs,
  evs,
});

const makeHit = (
  id: string,
  attacker: Build,
  moveInput: string,
  repeat = 1,
): ScenarioHit => ({
  id,
  attacker,
  move: mustResolve("move", moveInput),
  repeat,
  critical: false,
  attackerBoosts: {},
  defenderBoosts: {},
  attackerSide: emptySide,
  defenderSide: emptySide,
});

const makeScenario = (
  id: string,
  hits: ScenarioHit[],
  requiredSurvivedHits: number,
  minSurvivalProbability: number,
): Scenario => ({
  id,
  label: id,
  enabled: true,
  hits,
  field: emptyField,
  constraint: {
    enabled: true,
    requiredSurvivedHits,
    minSurvivalProbability,
  },
});

describe("enumerateDefenceEvCandidates", () => {
  it("enumerates only legal H/B/D SP candidates and counts fixed A/C/S SP in the total budget", () => {
    const defender = makeBuild("target", "カイリュー", { ...zeroEvs, atk: 252, spa: 252 });

    const candidates = enumerateDefenceEvCandidates(defender);

    expect(candidates).toEqual(
      expect.arrayContaining([
        { hp: 0, def: 0, spd: 0 },
        { hp: 1, def: 0, spd: 0 },
        { hp: 0, def: 1, spd: 0 },
        { hp: 0, def: 0, spd: 1 },
        { hp: 2, def: 0, spd: 0 },
      ]),
    );
    expect(candidates).toHaveLength(10);
    expect(candidates.every((candidate) => (
      [candidate.hp, candidate.def, candidate.spd].every((sp) => sp >= 0 && sp <= 32)
      && candidate.hp + candidate.def + candidate.spd + 64 <= 66
    ))).toBe(true);
  });

  it("enumerates only requested defence stats and keeps inactive defence stats fixed", () => {
    const defender = makeBuild("target", "カイリュー", { ...zeroEvs, atk: 252, spa: 252 });

    const candidates = enumerateDefenceEvCandidates(defender, { searchStatKeys: ["hp", "def"] });

    expect(candidates).toHaveLength(6);
    expect(candidates).toEqual(
      expect.arrayContaining([
        { hp: 0, def: 0, spd: 0 },
        { hp: 0, def: 1, spd: 0 },
        { hp: 1, def: 0, spd: 0 },
        { hp: 0, def: 2, spd: 0 },
        { hp: 1, def: 1, spd: 0 },
        { hp: 2, def: 0, spd: 0 },
      ]),
    );
    expect(candidates.every((candidate) => candidate.spd === 0)).toBe(true);
  });
});

describe("calculateSurvivalProbability", () => {
  it("treats each repeated hit as an independent damage roll from the same HP pool", () => {
    expect(calculateSurvivalProbability(101, [[50], [50]])).toBe(1);
    expect(calculateSurvivalProbability(100, [[50], [50]])).toBe(0);
    expect(calculateSurvivalProbability(101, [[40, 60], [40, 60]])).toBe(0.75);
  });
});

describe("evaluateScenario", () => {
  it("uses ScenarioHit.repeat for continuous survival probability and fails below minSurvivalProbability", () => {
    const defender = makeBuild("target", "カイリュー");
    const attacker = makeBuild("attacker", "ピカチュウ", { ...zeroEvs, spa: 252 }, 50, "ひかえめ");
    const singleHit = makeScenario("single", [makeHit("thunderbolt", attacker, "10まんボルト", 1)], 1, 1);
    const repeatedHit = makeScenario("repeat", [makeHit("thunderbolt", attacker, "10まんボルト", 3)], 3, 0.99);

    const singleResult = evaluateScenario(defender, singleHit);
    const repeatedResult = evaluateScenario(defender, repeatedHit);

    expect(singleResult).toMatchObject({ passed: true, survivalProbability: 1 });
    expect(repeatedResult.passed).toBe(false);
    expect(repeatedResult.survivalProbability).toBeGreaterThan(0);
    expect(repeatedResult.survivalProbability).toBeLessThan(0.99);
    expect(repeatedResult.hitEvaluations[0].description).toContain("Thunderbolt");
  });

  it("uses per-hit damage rolls from multi-hit move evaluations without repeating the flattened total", () => {
    const defender = makeBuild("target", "カイリュー");
    const attacker = makeBuild("attacker", "ピカチュウ");
    const multiHit = makeScenario("multi-hit", [makeHit("bullet-seed", attacker, "タネマシンガン", 2)], 2, 1);

    const result = evaluateScenario(defender, multiHit, {
      calculateHit: () => ({
        hitId: "bullet-seed",
        damageRolls: [999],
        damageRollsByHit: [[40], [40]],
        damageRange: { min: 80, max: 80, percentMin: 50, percentMax: 50 },
      }),
    });

    expect(result.passed).toBe(true);
    expect(result.survivalProbability).toBe(1);
  });

  it("passes hit-specific field state to the damage adapter", () => {
    const defender = makeBuild("target", "カイリュー");
    const attacker = makeBuild("attacker", "ピカチュウ");
    const hit = {
      ...makeHit("field-hit", attacker, "10まんボルト"),
      field: { gameType: "doubles", weather: "rain", terrain: "electric" } as FieldState,
    };
    const scenario = makeScenario("field", [hit], 1, 1);
    const fields: FieldState[] = [];

    evaluateScenario(defender, scenario, {
      calculateHit: (_build, currentHit, field) => {
        fields.push(field);
        return {
          hitId: currentHit.id,
          damageRolls: [1],
          damageRange: { min: 1, max: 1, percentMin: 1, percentMax: 1 },
        };
      },
    });

    expect(fields).toEqual([{ gameType: "doubles", weather: "rain", terrain: "electric" }]);
  });

  it("evaluates hit-specific survival constraints against cumulative damage", () => {
    const defender = makeBuild("target", "カイリュー");
    const attacker = makeBuild("attacker", "ピカチュウ");
    const firstHit = {
      ...makeHit("first-hit", attacker, "10まんボルト"),
      constraint: { enabled: true, requiredSurvivedHits: 1, minSurvivalProbability: 1 },
    };
    const secondHit = {
      ...makeHit("second-hit", attacker, "10まんボルト"),
      constraint: { enabled: true, requiredSurvivedHits: 2, minSurvivalProbability: 1 },
    };
    const scenario = makeScenario("cumulative-cards", [firstHit, secondHit], 1, 1);

    const result = evaluateScenario(defender, scenario, {
      calculateHit: (_build, hit) => ({
        hitId: hit.id,
        damageRolls: hit.id === "first-hit" ? [1] : [999],
        damageRange: { min: 1, max: 999, percentMin: 1, percentMax: 999 },
      }),
    });

    expect(result).toMatchObject({
      passed: false,
      requiredSurvivedHits: 2,
      minSurvivalProbability: 1,
      survivalProbability: 0,
    });
  });
});

describe("evaluateCandidate", () => {
  it("fails the whole candidate if any enabled scenario fails", () => {
    const defender = makeBuild("target", "カイリュー");
    const easyAttacker = makeBuild("easy-attacker", "ピカチュウ", zeroEvs, 1);
    const hardAttacker = makeBuild("hard-attacker", "ガブリアス", { ...zeroEvs, atk: 252 }, 50, "ようき");
    const easyScenario = makeScenario("easy", [makeHit("easy-hit", easyAttacker, "10まんボルト")], 1, 1);
    const hardScenario = makeScenario("hard", [makeHit("hard-hit", hardAttacker, "げきりん")], 1, 1);

    const result = evaluateCandidate(defender, [easyScenario, hardScenario], { hp: 0, def: 0, spd: 0 });

    expect(result.passed).toBe(false);
    expect(result.scenarioResults.map((scenario) => scenario.passed)).toEqual([true, false]);
  });
});

describe("searchDefenceCandidates", () => {
  it("evaluates one H/B/D candidate against every scenario through the M3 adapter and revalidates final candidates", () => {
    const defender = makeBuild("target", "カイリュー");
    const specialAttacker = makeBuild("special-attacker", "ピカチュウ", { ...zeroEvs, spa: 252 }, 50, "ひかえめ");
    const physicalAttacker = makeBuild("physical-attacker", "ガブリアス", zeroEvs, 1);
    const scenarios = [
      makeScenario("special", [makeHit("special-hit", specialAttacker, "10まんボルト")], 1, 1),
      makeScenario("physical", [makeHit("physical-hit", physicalAttacker, "げきりん")], 1, 1),
    ];
    const hitIds: string[] = [];
    const calculateHit: CalculateHit = (build, hit, field) => {
      hitIds.push(hit.id);
      return calculateSmogonHit(build, hit, field);
    };

    const results = searchDefenceCandidates(defender, scenarios, { maxResults: 1, calculateHit });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      rank: 1,
      candidate: { hp: 0, def: 0, spd: 0 },
      passed: true,
    });
    expect(results[0].scenarioResults).toHaveLength(2);
    expect(results[0].scenarioResults.every((scenario) => scenario.passed)).toBe(true);
    expect(hitIds).toEqual(["special-hit", "physical-hit", "special-hit", "physical-hit"]);
  });

  it("does not return candidates that fail final scenario validation", () => {
    const defender = makeBuild("target", "カイリュー", { ...zeroEvs, atk: 252, spa: 252, spe: 4 });
    const attacker = makeBuild("attacker", "ガブリアス", { ...zeroEvs, atk: 252 }, 50, "ようき");
    const impossibleScenario = makeScenario("impossible", [makeHit("outrage", attacker, "げきりん")], 1, 1);

    const results = searchDefenceCandidates(defender, [impossibleScenario], { maxResults: 5 });

    expect(results).toEqual([]);
  });

  it("filters passing candidates below integrated H/B/D minimum requirements", () => {
    const defender = makeBuild("target", "ピカチュウ");
    const scenario = makeScenario("easy", [makeHit("hit", makeBuild("attacker", "ピチュー"), "でんこうせっか")], 1, 1);
    const calculateHit: CalculateHit = () => ({
      hitId: "hit",
      damageRolls: [1],
      damageRange: { min: 1, max: 1, percentMin: 1, percentMax: 1 },
    });

    const results = searchDefenceCandidates(defender, [scenario], {
      maxResults: 3,
      calculateHit,
      minimumStatPoints: { hp: 2, def: 1 },
    });

    expect(results).not.toHaveLength(0);
    expect(results.every((result) => result.candidate.hp >= 2 && result.candidate.def >= 1)).toBe(true);
  });

  it("collects every passing candidate when maxResults is null", () => {
    const defender = makeBuild("target", "カイリュー", { ...zeroEvs, atk: 252, spa: 252 });
    const scenario = makeScenario("easy", [makeHit("hit", makeBuild("attacker", "ピチュー"), "でんこうせっか")], 1, 1);
    const calculateHit: CalculateHit = () => ({
      hitId: "hit",
      damageRolls: [1],
      damageRange: { min: 1, max: 1, percentMin: 1, percentMax: 1 },
    });

    const limitedResults = searchDefenceCandidates(defender, [scenario], { maxResults: 3, calculateHit });
    const allResults = searchDefenceCandidates(defender, [scenario], { maxResults: null, calculateHit });

    expect(limitedResults).toHaveLength(3);
    expect(allResults).toHaveLength(enumerateDefenceEvCandidates(defender).length);
    expect(allResults.length).toBeGreaterThan(limitedResults.length);
    expect(allResults.map((result) => result.rank)).toEqual(Array.from({ length: allResults.length }, (_, index) => index + 1));
  });

  it("collects all passing candidates only across requested defence stats", () => {
    const defender = makeBuild("target", "カイリュー", { ...zeroEvs, atk: 252, spa: 252 });
    const scenario = makeScenario("easy", [makeHit("hit", makeBuild("attacker", "ピチュー"), "でんこうせっか")], 1, 1);
    const calculateHit: CalculateHit = () => ({
      hitId: "hit",
      damageRolls: [1],
      damageRange: { min: 1, max: 1, percentMin: 1, percentMax: 1 },
    });

    const results = searchDefenceCandidates(defender, [scenario], {
      maxResults: null,
      calculateHit,
      searchStatKeys: ["hp", "def"],
    });

    expect(results).toHaveLength(6);
    expect(results.every((result) => result.candidate.spd === 0 && result.appliedStatPoints.spd === 0)).toBe(true);
  });
});

describe("fixed HP damage integration", () => {
  const makeHundredHpDefender = (evs: StatTable = zeroEvs): Build => ({
    ...makeBuild("target", "ミュウ", evs, 30),
    ivs: { ...defaultIvs, hp: 0 },
  });

  const withDefenderSand = (hit: ScenarioHit): ScenarioHit => ({
    ...hit,
    hpEvents: [{
      id: `${hit.id}-sand`,
      effectId: "sandstorm-damage",
      enabled: true,
      sequenceContext: "currentMove",
    }],
  });

  const fixedDamageCalculator = (
    damageByHitId: Readonly<Record<string, number>>,
  ): CalculateHit => (_build, hit) => {
    const damage = damageByHitId[hit.id] ?? 0;
    return {
      hitId: hit.id,
      damageRolls: [damage],
      damageRange: {
        min: damage,
        max: damage,
        percentMin: damage,
        percentMax: damage,
      },
    };
  };

  it("can flip a guaranteed direct-damage survival into failure after end-of-turn sand damage", () => {
    const defender = makeHundredHpDefender();
    const attacker = makeBuild("attacker", "ピチュー");
    const directHit = makeHit("direct-hit", attacker, "でんこうせっか");
    const directScenario = makeScenario("direct-only", [directHit], 1, 1);
    const sandScenario = makeScenario(
      "with-sand",
      [withDefenderSand({ ...directHit, id: "sand-hit" })],
      1,
      1,
    );
    const calculateHit = fixedDamageCalculator({
      "direct-hit": 94,
      "sand-hit": 94,
    });

    const directResult = evaluateScenario(defender, directScenario, { calculateHit });
    const sandResult = evaluateScenario(defender, sandScenario, { calculateHit });

    expect(directResult).toMatchObject({
      passed: true,
      survivalProbability: 1,
    });
    expect(sandResult).toMatchObject({
      passed: false,
      survivalProbability: 0,
      hpEventEvaluations: [
        expect.objectContaining({
          effectId: "sandstorm-damage",
          damage: 6,
          applied: true,
        }),
      ],
    });
  });

  it("evaluates Stealth Rock before the move damage", () => {
    const defender = makeHundredHpDefender();
    const attacker = makeBuild("attacker", "ピチュー");
    const directHit = makeHit("direct-hit", attacker, "でんこうせっか");
    const rocksHit: ScenarioHit = {
      ...makeHit("rocks-hit", attacker, "でんこうせっか"),
      hpEvents: [{
        id: "rocks",
        effectId: "stealth-rock-damage",
        enabled: true,
        sequenceContext: "currentMove",
      }],
    };
    const calculateHit = fixedDamageCalculator({
      "direct-hit": 88,
      "rocks-hit": 88,
    });

    expect(evaluateScenario(
      defender,
      makeScenario("direct-only", [directHit], 1, 1),
      { calculateHit },
    ).passed).toBe(true);
    expect(evaluateScenario(
      defender,
      makeScenario("with-rocks", [rocksHit], 1, 1),
      { calculateHit },
    )).toMatchObject({
      passed: false,
      hpEventEvaluations: [
        expect.objectContaining({
          effectId: "stealth-rock-damage",
          damage: 12,
          applied: true,
        }),
      ],
    });
  });

  it("lets one Sitrus Berry activation change a two-hit survival line", () => {
    const defender = makeHundredHpDefender();
    const attacker = makeBuild("attacker", "ピチュー");
    const directHit = makeHit("repeat-direct", attacker, "でんこうせっか", 2);
    const sitrusHit: ScenarioHit = {
      ...makeHit("repeat-sitrus", attacker, "でんこうせっか", 2),
      hpEvents: [{
        id: "sitrus",
        effectId: "sitrus-berry-heal",
        enabled: true,
        sequenceContext: "currentMove",
      }],
    };
    const calculateHit = fixedDamageCalculator({
      "repeat-direct": 55,
      "repeat-sitrus": 55,
    });

    expect(evaluateScenario(
      defender,
      makeScenario("direct-only", [directHit], 2, 1),
      { calculateHit },
    ).passed).toBe(false);
    expect(evaluateScenario(
      defender,
      makeScenario("with-sitrus", [sitrusHit], 2, 1),
      { calculateHit },
    )).toMatchObject({
      passed: true,
      survivalProbability: 1,
      hpEventEvaluations: [
        expect.objectContaining({
          effectId: "sitrus-berry-heal",
          healing: 25,
          applied: true,
        }),
        expect.objectContaining({
          effectId: "sitrus-berry-heal",
          applied: false,
        }),
      ],
    });
  });

  it("drops an event-aware candidate that fails final revalidation", () => {
    const defender = makeHundredHpDefender({
      ...zeroEvs,
      atk: 252,
      spa: 252,
      spe: 12,
    });
    const attacker = makeBuild("attacker", "ピチュー");
    const scenario = makeScenario(
      "revalidation-with-sand",
      [withDefenderSand(makeHit("revalidation-hit", attacker, "でんこうせっか"))],
      1,
      1,
    );
    let callCount = 0;
    const calculateHit: CalculateHit = (_build, hit) => {
      callCount += 1;
      const damage = callCount === 1 ? 93 : 94;
      return {
        hitId: hit.id,
        damageRolls: [damage],
        damageRange: {
          min: damage,
          max: damage,
          percentMin: damage,
          percentMax: damage,
        },
      };
    };

    const results = searchDefenceCandidates(defender, [scenario], {
      maxResults: 1,
      calculateHit,
    });

    expect(callCount).toBe(2);
    expect(results).toEqual([]);
  });

  it("does not include cards after a hit-specific survival checkpoint", () => {
    const defender = makeHundredHpDefender();
    const attacker = makeBuild("attacker", "ピチュー");
    const checkpointHit: ScenarioHit = {
      ...makeHit("checkpoint-hit", attacker, "でんこうせっか"),
      constraint: {
        enabled: true,
        requiredSurvivedHits: 1,
        minSurvivalProbability: 1,
      },
    };
    const laterHit = withDefenderSand(makeHit("later-hit", attacker, "でんこうせっか"));
    const checkpointScenario = makeScenario(
      "checkpoint-prefix",
      [checkpointHit, laterHit],
      2,
      1,
    );
    const fullSequenceScenario = makeScenario(
      "full-sequence",
      [
        makeHit("checkpoint-hit", attacker, "でんこうせっか"),
        laterHit,
      ],
      2,
      1,
    );
    const calculateHit = fixedDamageCalculator({
      "checkpoint-hit": 94,
      "later-hit": 1,
    });

    const checkpointResult = evaluateScenario(defender, checkpointScenario, { calculateHit });
    const fullSequenceResult = evaluateScenario(defender, fullSequenceScenario, { calculateHit });

    expect(checkpointResult).toMatchObject({
      passed: true,
      survivalProbability: 1,
      requiredSurvivedHits: 1,
    });
    expect(checkpointResult.hpEventEvaluations).toBeUndefined();
    expect(fullSequenceResult).toMatchObject({
      passed: false,
      survivalProbability: 0,
      requiredSurvivedHits: 2,
    });
  });

  it("treats normal repeat uses separately even when the adapter returns nested rolls", () => {
    const defender = makeHundredHpDefender();
    const attacker = makeBuild("attacker", "ミュウ");
    const hit = {
      ...makeHit("repeat-hit", attacker, "でんこうせっか", 2),
      hpEvents: [{
        id: "repeat-life-orb",
        effectId: "life-orb-recoil",
        enabled: true,
        sequenceContext: "currentMove",
      }] as ScenarioHit["hpEvents"],
    };
    const scenario = makeScenario("repeat-life-orb", [hit], 2, 1);

    const result = evaluateScenario(defender, scenario, {
      calculateHit: () => ({
        hitId: hit.id,
        damageRolls: [1],
        damageRollsByHit: [[1]],
        damageRange: { min: 1, max: 1, percentMin: 1, percentMax: 1 },
      }),
    });

    expect(result).toMatchObject({
      passed: true,
      hpEventEvaluations: [
        expect.objectContaining({ occurrence: 1, applied: true }),
        expect.objectContaining({ occurrence: 2, applied: true }),
      ],
    });
  });

  it("treats a multi-hit move as one move use for Life Orb recoil", () => {
    const defender = makeHundredHpDefender();
    const attacker = makeBuild("attacker", "ミュウ");
    const hit = {
      ...makeHit("multi-hit", attacker, "タネマシンガン", 2),
      moveHits: 2,
      hpEvents: [{
        id: "multi-life-orb",
        effectId: "life-orb-recoil",
        enabled: true,
        sequenceContext: "currentMove",
      }] as ScenarioHit["hpEvents"],
    };
    const scenario = makeScenario("multi-life-orb", [hit], 2, 1);

    const result = evaluateScenario(defender, scenario, {
      calculateHit: () => ({
        hitId: hit.id,
        damageRolls: [2],
        damageRollsByHit: [[1], [1]],
        damageRange: { min: 2, max: 2, percentMin: 2, percentMax: 2 },
      }),
    });

    expect(result).toMatchObject({
      passed: true,
      hpEventEvaluations: [
        expect.objectContaining({ occurrence: 1, applied: true }),
      ],
    });
    expect(result.hpEventEvaluations).toHaveLength(1);
  });

  it("evaluates every requested hit without stopping for automatic move recoil", () => {
    const defender = makeHundredHpDefender();
    const attacker = makeBuild("attacker", "ヌケニン");
    const hit = makeHit("flare-blitz-repeat", attacker, "フレアドライブ", 2);
    const scenario = makeScenario("flare-blitz-repeat", [hit], 2, 1);

    const result = evaluateScenario(defender, scenario, {
      calculateHit: () => ({
        hitId: hit.id,
        damageRolls: [60],
        damageRange: { min: 60, max: 60, percentMin: 60, percentMax: 60 },
      }),
    });

    expect(result).toMatchObject({
      passed: false,
      survivalProbability: 0,
      requiredSurvivedHits: 2,
    });
    expect(result.hpEventEvaluations).toBeUndefined();
  });
});

describe("current HP move integration", () => {
  it("recalculates repeated half-current-HP damage as 50 then 25 from 101 HP", () => {
    const defender: Build = {
      ...makeBuild("target", "ミュウ", zeroEvs, 30),
      ivs: { ...defaultIvs, hp: 4 },
    };
    const attacker = makeBuild("attacker", "ミュウ");
    const hit = makeHit("repeat-super-fang", attacker, "いかりのまえば", 2);
    const scenario = makeScenario("repeat-super-fang", [hit], 2, 1);
    const currentHpCalls: Array<number | undefined> = [];
    const damageCalls: number[] = [];
    const calculateHit: CalculateHit = (build, currentHit, _field, options) => {
      const currentHp = options?.defenderCurrentHp ?? toSmogonPokemon(build).maxHP();
      const damage = Math.max(1, Math.floor(currentHp / 2));
      currentHpCalls.push(options?.defenderCurrentHp);
      damageCalls.push(damage);
      return {
        hitId: currentHit.id,
        damageRolls: [damage],
        damageRange: {
          min: damage,
          max: damage,
          percentMin: (damage / toSmogonPokemon(build).maxHP()) * 100,
          percentMax: (damage / toSmogonPokemon(build).maxHP()) * 100,
        },
      };
    };

    expect(toSmogonPokemon(defender).maxHP()).toBe(101);

    const result = evaluateScenario(defender, scenario, { calculateHit });

    expect(result).toMatchObject({
      passed: true,
      survivalProbability: 1,
      requiredSurvivedHits: 2,
    });
    expect(currentHpCalls).toEqual([undefined, 101, 51]);
    expect(damageCalls).toEqual([50, 50, 25]);
  });
});
