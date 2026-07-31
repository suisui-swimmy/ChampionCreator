import { describe, expect, it } from "vitest";
import type { EntityKind } from "../data/localizationTypes";
import type { Build, EntityRef, StatTable } from "../domain/model";
import { toEntityRef } from "../domain/model";
import type { HpEvent } from "../domain/hpEvents";
import { resolveEntity } from "../localization/resolver";
import {
  getHpSequenceKoProbability,
  getHpSequenceSurvivalProbability,
  simulateHpSequence,
  type HpSequenceCard,
} from "./simulateHpSequence";

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

const makeBuild = (
  id: string,
  pokemonInput = "ミュウ",
  options: {
    level?: number;
    hpIv?: number;
    hpEv?: number;
  } = {},
): Build => ({
  id,
  pokemon: mustResolve("pokemon", pokemonInput),
  level: options.level ?? 50,
  ivs: { ...defaultIvs, hp: options.hpIv ?? defaultIvs.hp },
  evs: { ...zeroEvs, hp: options.hpEv ?? zeroEvs.hp },
});

const makeEvent = (
  id: string,
  effectId: HpEvent["effectId"],
): HpEvent => ({
  id,
  effectId,
  enabled: true,
  sequenceContext: "currentMove",
});

const makeCard = (
  attackerBuild: Build,
  defenderBuild: Build,
  damageRollsByHit: number[][],
  hpEvents: HpEvent[] = [],
): HpSequenceCard => ({
  id: "card",
  attackerBuild,
  defenderBuild,
  moveUses: [{
    id: "move-1",
    damageRollsByHit,
  }],
  hpEvents,
});

const getOnlyStateHp = (
  result: ReturnType<typeof simulateHpSequence>,
  buildId: string,
): number => {
  expect(result.states).toHaveLength(1);
  return result.states[0].hpByBuildId[buildId];
};

describe("simulateHpSequence", () => {
  it("produces a 50% KO chance for rolls 93/94 followed by six sand damage against H=100", () => {
    const attacker = makeBuild("attacker");
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const result = simulateHpSequence({
      cards: [makeCard(attacker, defender, [[93, 94]], [
        makeEvent("sand", "sandstorm-damage"),
      ])],
    });

    expect(result.maxHpByBuildId[defender.id]).toBe(100);
    expect(getHpSequenceKoProbability(result, defender.id)).toBe(0.5);
    expect(getHpSequenceSurvivalProbability(result, defender.id)).toBe(0.5);
    expect(result.states).toEqual([
      { hpByBuildId: { attacker: 175, defender: 0 }, probability: 0.5 },
      { hpByBuildId: { attacker: 175, defender: 1 }, probability: 0.5 },
    ]);
    expect(result.hpEventEvaluations).toEqual([
      expect.objectContaining({
        eventId: "sand",
        damage: 6,
        activationProbability: 1,
        applied: true,
      }),
    ]);
  });

  it("applies Life Orb recoil once after one five-hit move", () => {
    const attacker = makeBuild("attacker", "ミュウ", { hpEv: 128 });
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const result = simulateHpSequence({
      cards: [makeCard(attacker, defender, [[1], [1], [1], [1], [1]], [
        makeEvent("life-orb", "life-orb-recoil"),
      ])],
    });

    expect(getOnlyStateHp(result, attacker.id)).toBe(172);
    expect(getOnlyStateHp(result, defender.id)).toBe(95);
    expect(result.hpEventEvaluations).toEqual([
      expect.objectContaining({
        eventId: "life-orb",
        occurrence: 1,
        damage: 19,
        applied: true,
      }),
    ]);
  });

  it("applies Life Orb recoil after each of two move uses", () => {
    const attacker = makeBuild("attacker", "ミュウ", { hpEv: 128 });
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const card = makeCard(attacker, defender, [[1]], [
      makeEvent("life-orb", "life-orb-recoil"),
    ]);
    card.moveUses = [
      { id: "move-1", damageRollsByHit: [[1]] },
      { id: "move-2", damageRollsByHit: [[1]] },
    ];
    const result = simulateHpSequence({ cards: [card] });

    expect(getOnlyStateHp(result, attacker.id)).toBe(153);
    expect(getOnlyStateHp(result, defender.id)).toBe(98);
    expect(result.hpEventEvaluations.map((evaluation) => ({
      eventId: evaluation.eventId,
      occurrence: evaluation.occurrence,
      damage: evaluation.damage,
      applied: evaluation.applied,
    }))).toEqual([
      { eventId: "life-orb", occurrence: 1, damage: 19, applied: true },
      { eventId: "life-orb", occurrence: 2, damage: 19, applied: true },
    ]);
  });

  it("still applies attacker Life Orb recoil after the direct hit KOs the defender", () => {
    const attacker = makeBuild("attacker", "ヌケニン");
    const defender = makeBuild("defender", "ピチュー");
    const result = simulateHpSequence({
      cards: [makeCard(attacker, defender, [[999]], [
        makeEvent("life-orb-after", "life-orb-recoil"),
      ])],
    });

    expect(getOnlyStateHp(result, attacker.id)).toBe(0);
    expect(getOnlyStateHp(result, defender.id)).toBe(0);
    expect(getHpSequenceKoProbability(result, defender.id)).toBe(1);
    expect(result.hpEventEvaluations).toEqual([
      expect.objectContaining({
        eventId: "life-orb-after",
        damage: 1,
        activationProbability: 1,
        applied: true,
      }),
    ]);
  });

  it("does not apply another Life Orb recoil for a later move use that never executes", () => {
    const attacker = makeBuild("attacker", "ミュウ", { hpEv: 128 });
    const defender = makeBuild("defender", "ピチュー");
    const card = makeCard(attacker, defender, [[999]], [
      makeEvent("life-orb-after", "life-orb-recoil"),
    ]);
    card.moveUses = [
      { id: "move-1", damageRollsByHit: [[999]] },
      { id: "move-2", damageRollsByHit: [[1]] },
    ];

    const result = simulateHpSequence({ cards: [card] });

    expect(getOnlyStateHp(result, attacker.id)).toBe(172);
    expect(result.hpEventEvaluations.map((evaluation) => ({
      occurrence: evaluation.occurrence,
      applied: evaluation.applied,
      activationProbability: evaluation.activationProbability,
    }))).toEqual([
      { occurrence: 1, applied: true, activationProbability: 1 },
      { occurrence: 2, applied: false, activationProbability: 0 },
    ]);
  });

  it("does not apply Life Orb recoil when the move deals no damage", () => {
    const attacker = makeBuild("attacker", "ミュウ", { hpEv: 128 });
    const defender = makeBuild("defender");
    const result = simulateHpSequence({
      cards: [makeCard(attacker, defender, [[0]], [
        makeEvent("life-orb-after", "life-orb-recoil"),
      ])],
    });

    expect(getOnlyStateHp(result, attacker.id)).toBe(191);
    expect(result.hpEventEvaluations).toEqual([
      expect.objectContaining({
        eventId: "life-orb-after",
        applied: false,
        activationProbability: 0,
      }),
    ]);
  });

  it("applies sandstorm at the end of each completed normal move use", () => {
    const attacker = makeBuild("attacker");
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const card = makeCard(attacker, defender, [[1]], [
      makeEvent("sand", "sandstorm-damage"),
    ]);
    card.moveUses = [
      { id: "move-1", damageRollsByHit: [[1]] },
      { id: "move-2", damageRollsByHit: [[1]] },
    ];

    const result = simulateHpSequence({ cards: [card] });

    expect(getOnlyStateHp(result, defender.id)).toBe(86);
    expect(result.hpEventEvaluations.map((evaluation) => ({
      occurrence: evaluation.occurrence,
      timing: evaluation.timing,
      frequency: evaluation.frequency,
    }))).toEqual([
      { occurrence: 1, timing: "endOfTurn", frequency: "perTurn" },
      { occurrence: 2, timing: "endOfTurn", frequency: "perTurn" },
    ]);
  });

  it("applies sandstorm once after one completed multi-hit move", () => {
    const attacker = makeBuild("attacker");
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });

    const result = simulateHpSequence({
      cards: [makeCard(attacker, defender, [[1], [1], [1], [1], [1]], [
        makeEvent("sand", "sandstorm-damage"),
      ])],
    });

    expect(getOnlyStateHp(result, defender.id)).toBe(89);
    expect(result.hpEventEvaluations).toHaveLength(1);
  });

  it("orders current-move Life Orb recoil before end-of-turn sandstorm damage", () => {
    const attacker = makeBuild("attacker", "ミュウ", { hpEv: 128 });
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });

    const result = simulateHpSequence({
      cards: [makeCard(attacker, defender, [[1]], [
        makeEvent("life-orb", "life-orb-recoil"),
        makeEvent("sand", "sandstorm-damage"),
      ])],
    });

    expect(result.hpEventEvaluations.map((evaluation) => evaluation.effectId)).toEqual([
      "life-orb-recoil",
      "sandstorm-damage",
    ]);
    expect(getOnlyStateHp(result, attacker.id)).toBe(172);
    expect(getOnlyStateHp(result, defender.id)).toBe(93);
  });

  it("includes per-turn sand after a completed repeat prefix even when its card is not complete", () => {
    const attacker = makeBuild("attacker");
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const card = makeCard(attacker, defender, [[1]], [
      makeEvent("sand", "sandstorm-damage"),
    ]);
    card.completed = false;

    const result = simulateHpSequence({ cards: [card] });

    expect(getOnlyStateHp(result, defender.id)).toBe(93);
    expect(result.hpEventEvaluations).toHaveLength(1);
  });

  it("does not run move-end or turn-end events for an incomplete multi-hit prefix", () => {
    const attacker = makeBuild("attacker", "ミュウ", { hpEv: 128 });
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const card = makeCard(attacker, defender, [[1], [1]], [
      makeEvent("life-orb", "life-orb-recoil"),
      makeEvent("sand", "sandstorm-damage"),
    ]);
    card.completed = false;
    card.moveUses[0].completed = false;

    const result = simulateHpSequence({ cards: [card] });

    expect(getOnlyStateHp(result, attacker.id)).toBe(191);
    expect(getOnlyStateHp(result, defender.id)).toBe(98);
    expect(result.hpEventEvaluations).toEqual([]);
  });
});
