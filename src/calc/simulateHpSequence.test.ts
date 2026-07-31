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
  options: Pick<HpEvent, "toxicStage" | "spikesLayers"> = {},
): HpEvent => ({
  id,
  effectId,
  enabled: true,
  sequenceContext: "currentMove",
  ...options,
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

  it("continues defender end-of-turn events after Life Orb KOs the attacker", () => {
    const attacker = makeBuild("attacker", "ヌケニン");
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

    expect(getOnlyStateHp(result, attacker.id)).toBe(0);
    expect(getOnlyStateHp(result, defender.id)).toBe(93);
    expect(result.hpEventEvaluations.map((evaluation) => ({
      effectId: evaluation.effectId,
      applied: evaluation.applied,
    }))).toEqual([
      { effectId: "life-orb-recoil", applied: true },
      { effectId: "sandstorm-damage", applied: true },
    ]);
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

  it("applies entry hazards before the direct hit", () => {
    const attacker = makeBuild("attacker");
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });

    const result = simulateHpSequence({
      cards: [makeCard(attacker, defender, [[88]], [
        makeEvent("rocks", "stealth-rock-damage"),
      ])],
    });

    expect(result.maxHpByBuildId[defender.id]).toBe(100);
    expect(getOnlyStateHp(result, defender.id)).toBe(0);
    expect(result.hpEventEvaluations).toEqual([
      expect.objectContaining({
        effectId: "stealth-rock-damage",
        timing: "onEntry",
        damage: 12,
        applied: true,
      }),
    ]);
  });

  it("increments toxic stage once per completed move use", () => {
    const attacker = makeBuild("attacker");
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const card = makeCard(attacker, defender, [[0]], [
      makeEvent("toxic", "toxic-damage", { toxicStage: 1 }),
    ]);
    card.moveUses = [
      { id: "move-1", damageRollsByHit: [[0]] },
      { id: "move-2", damageRollsByHit: [[0]] },
    ];

    const result = simulateHpSequence({ cards: [card] });

    expect(getOnlyStateHp(result, defender.id)).toBe(82);
    expect(result.hpEventEvaluations.map((evaluation) => ({
      occurrence: evaluation.occurrence,
      label: evaluation.label,
      damage: evaluation.damage,
    }))).toEqual([
      { occurrence: 1, label: "もうどくダメージ（1段階）", damage: 6 },
      { occurrence: 2, label: "もうどくダメージ（2段階）", damage: 12 },
    ]);
  });

  it("orders weather, status, Salt Cure, and Leftovers at turn end", () => {
    const attacker = makeBuild("attacker");
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });

    const result = simulateHpSequence({
      cards: [makeCard(attacker, defender, [[1]], [
        makeEvent("leftovers", "leftovers-heal"),
        makeEvent("salt", "salt-cure-damage"),
        makeEvent("burn", "burn-damage"),
        makeEvent("sand", "sandstorm-damage"),
      ])],
    });

    expect(getOnlyStateHp(result, defender.id)).toBe(87);
    expect(result.hpEventEvaluations.map((evaluation) => evaluation.effectId)).toEqual([
      "sandstorm-damage",
      "burn-damage",
      "salt-cure-damage",
      "leftovers-heal",
    ]);
  });

  it("triggers Sitrus Berry between multi-hit damage rolls and only once", () => {
    const attacker = makeBuild("attacker");
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });

    const result = simulateHpSequence({
      cards: [makeCard(attacker, defender, [[60], [30]], [
        makeEvent("sitrus", "sitrus-berry-heal"),
      ])],
    });

    expect(getOnlyStateHp(result, defender.id)).toBe(35);
    expect(result.hpEventEvaluations.map((evaluation) => ({
      occurrence: evaluation.occurrence,
      healing: evaluation.healing,
      applied: evaluation.applied,
      activationProbability: evaluation.activationProbability,
    }))).toEqual([
      { occurrence: 1, healing: 25, applied: true, activationProbability: 1 },
      { occurrence: 2, healing: 25, applied: false, activationProbability: 0 },
    ]);
  });

  it("keeps Sitrus activation branch-specific at the half-HP boundary", () => {
    const attacker = makeBuild("attacker");
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });

    const result = simulateHpSequence({
      cards: [makeCard(attacker, defender, [[49, 50]], [
        makeEvent("sitrus", "sitrus-berry-heal"),
      ])],
    });

    expect(result.states).toEqual([
      { hpByBuildId: { attacker: 175, defender: 51 }, probability: 0.5 },
      { hpByBuildId: { attacker: 175, defender: 75 }, probability: 0.5 },
    ]);
    expect(result.hpEventEvaluations).toEqual([
      expect.objectContaining({
        effectId: "sitrus-berry-heal",
        healing: 25,
        activationProbability: 0.5,
        applied: true,
      }),
    ]);
  });

  it("stops a five-hit contact move when Rocky Helmet faints the attacker mid-move", () => {
    const attacker = makeBuild("attacker", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const setupCard = makeCard(attacker, defender, [[0]]);
    setupCard.id = "setup-card";
    setupCard.moveUses[0].automaticHpEffects = {
      makesContact: false,
      hpCost: {
        effectId: "setup-cost",
        label: "事前HP消費",
        formulaLabel: "テスト用",
        amount: 50,
      },
    };
    const contactCard = makeCard(
      attacker,
      defender,
      [[1], [1], [1], [1], [1]],
      [makeEvent("helmet", "rocky-helmet-damage")],
    );
    contactCard.id = "contact-card";
    contactCard.moveUses[0].automaticHpEffects = {
      makesContact: true,
    };

    const result = simulateHpSequence({
      cards: [setupCard, contactCard],
    });

    expect(result.maxHpByBuildId[attacker.id]).toBe(100);
    expect(getOnlyStateHp(result, attacker.id)).toBe(0);
    expect(getOnlyStateHp(result, defender.id)).toBe(96);
    expect(result.hpEventEvaluations
      .filter((evaluation) => evaluation.effectId === "rocky-helmet-damage")
      .map((evaluation) => evaluation.applied)).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it("does not trigger a phantom Sitrus Berry on hits skipped after contact retaliation", () => {
    const attacker = makeBuild("attacker", "ヌケニン");
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const card = makeCard(
      attacker,
      defender,
      [[60], [30], [30], [30], [30]],
      [
        makeEvent("helmet", "rocky-helmet-damage"),
        makeEvent("sitrus", "sitrus-berry-heal"),
      ],
    );
    card.moveUses[0].automaticHpEffects = {
      makesContact: true,
    };

    const result = simulateHpSequence({ cards: [card] });

    expect(getOnlyStateHp(result, attacker.id)).toBe(0);
    expect(getOnlyStateHp(result, defender.id)).toBe(65);
    expect(result.hpEventEvaluations
      .filter((evaluation) => evaluation.effectId === "sitrus-berry-heal")
      .map((evaluation) => ({
        applied: evaluation.applied,
        activationProbability: evaluation.activationProbability,
      }))).toEqual([
      { applied: true, activationProbability: 1 },
      { applied: false, activationProbability: 0 },
      { applied: false, activationProbability: 0 },
      { applied: false, activationProbability: 0 },
      { applied: false, activationProbability: 0 },
    ]);
  });

  it("orders Rocky Helmet before Rough Skin and stops later hits after retaliation faints the attacker", () => {
    const attacker = makeBuild("attacker", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const setupCard = makeCard(attacker, defender, [[0]]);
    setupCard.id = "setup-card";
    setupCard.moveUses[0].automaticHpEffects = {
      makesContact: false,
      hpCost: {
        effectId: "setup-cost",
        label: "事前HP消費",
        formulaLabel: "テスト用",
        amount: 50,
      },
    };
    const contactCard = makeCard(
      attacker,
      defender,
      [[1], [1], [1], [1], [1]],
      [
        makeEvent("rough-skin", "rough-skin-damage"),
        makeEvent("helmet", "rocky-helmet-damage"),
      ],
    );
    contactCard.id = "contact-card";
    contactCard.moveUses[0].automaticHpEffects = {
      makesContact: true,
    };

    const result = simulateHpSequence({
      cards: [setupCard, contactCard],
    });
    const contactEvaluations = result.hpEventEvaluations.filter(
      (evaluation) => (
        evaluation.effectId === "rocky-helmet-damage"
        || evaluation.effectId === "rough-skin-damage"
      ),
    );

    expect(getOnlyStateHp(result, attacker.id)).toBe(0);
    expect(getOnlyStateHp(result, defender.id)).toBe(98);
    expect(contactEvaluations.map((evaluation) => evaluation.effectId)).toEqual([
      "rocky-helmet-damage",
      "rough-skin-damage",
      "rocky-helmet-damage",
      "rough-skin-damage",
      "rocky-helmet-damage",
      "rough-skin-damage",
      "rocky-helmet-damage",
      "rough-skin-damage",
      "rocky-helmet-damage",
      "rough-skin-damage",
    ]);
    expect(contactEvaluations.map((evaluation) => evaluation.applied)).toEqual([
      true,
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("still applies contact retaliation when the direct hit KOs the defender", () => {
    const attacker = makeBuild("attacker", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const card = makeCard(attacker, defender, [[999]], [
      makeEvent("helmet", "rocky-helmet-damage"),
    ]);
    card.moveUses[0].automaticHpEffects = {
      makesContact: true,
    };

    const result = simulateHpSequence({ cards: [card] });

    expect(getOnlyStateHp(result, defender.id)).toBe(0);
    expect(getOnlyStateHp(result, attacker.id)).toBe(84);
    expect(result.hpEventEvaluations).toEqual([
      expect.objectContaining({
        effectId: "rocky-helmet-damage",
        damage: 16,
        applied: true,
        activationProbability: 1,
      }),
    ]);
  });

  it("bases damage recoil on capped actual damage rather than the overkill roll", () => {
    const attacker = makeBuild("attacker", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const card = makeCard(attacker, defender, [[999]]);
    card.moveUses[0].automaticHpEffects = {
      makesContact: false,
      damageBasedRecoil: {
        effectId: "one-third-recoil",
        label: "与えたダメージの1/3反動",
        numerator: 1,
        denominator: 3,
      },
    };

    const result = simulateHpSequence({ cards: [card] });

    expect(getOnlyStateHp(result, defender.id)).toBe(0);
    expect(getOnlyStateHp(result, attacker.id)).toBe(67);
    expect(result.hpEventEvaluations).toEqual([
      expect.objectContaining({
        effectId: "one-third-recoil",
        damage: 33,
        changeKind: "recoil",
        applied: true,
      }),
    ]);
  });

  it("sums actual multi-hit damage and applies damage recoil only once per move", () => {
    const attacker = makeBuild("attacker", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const card = makeCard(attacker, defender, [[10], [10], [10]]);
    card.moveUses[0].automaticHpEffects = {
      makesContact: false,
      damageBasedRecoil: {
        effectId: "one-third-recoil",
        label: "与えたダメージの1/3反動",
        numerator: 1,
        denominator: 3,
      },
    };

    const result = simulateHpSequence({ cards: [card] });

    expect(getOnlyStateHp(result, defender.id)).toBe(70);
    expect(getOnlyStateHp(result, attacker.id)).toBe(90);
    expect(result.hpEventEvaluations).toEqual([
      expect.objectContaining({
        effectId: "one-third-recoil",
        damage: 10,
        occurrence: 1,
        applied: true,
      }),
    ]);
  });

  it("requires current HP to be strictly greater than an HP cost", () => {
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const exactBoundaryAttacker = makeBuild("exact-attacker", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const exactBoundaryCard = makeCard(
      exactBoundaryAttacker,
      defender,
      [[0]],
    );
    exactBoundaryCard.moveUses = [
      {
        id: "cost-1",
        damageRollsByHit: [[0]],
        automaticHpEffects: {
          makesContact: false,
          hpCost: {
            effectId: "half-cost",
            label: "HP50消費",
            formulaLabel: "テスト用",
            amount: 50,
          },
        },
      },
      {
        id: "cost-2",
        damageRollsByHit: [[99]],
        automaticHpEffects: {
          makesContact: false,
          hpCost: {
            effectId: "half-cost",
            label: "HP50消費",
            formulaLabel: "テスト用",
            amount: 50,
          },
        },
      },
    ];

    const exactBoundaryResult = simulateHpSequence({
      cards: [exactBoundaryCard],
    });

    expect(getOnlyStateHp(exactBoundaryResult, exactBoundaryAttacker.id)).toBe(50);
    expect(getOnlyStateHp(exactBoundaryResult, defender.id)).toBe(100);
    expect(exactBoundaryResult.hpEventEvaluations.map((evaluation) => ({
      applied: evaluation.applied,
      activationProbability: evaluation.activationProbability,
    }))).toEqual([
      { applied: true, activationProbability: 1 },
      { applied: false, activationProbability: 0 },
    ]);

    const aboveBoundaryAttacker = makeBuild("above-attacker", "ミュウ", {
      level: 30,
      hpIv: 4,
    });
    const aboveBoundaryCard = makeCard(
      aboveBoundaryAttacker,
      defender,
      [[0]],
    );
    aboveBoundaryCard.moveUses = exactBoundaryCard.moveUses;

    const aboveBoundaryResult = simulateHpSequence({
      cards: [aboveBoundaryCard],
    });

    expect(aboveBoundaryResult.maxHpByBuildId[aboveBoundaryAttacker.id]).toBe(101);
    expect(getOnlyStateHp(aboveBoundaryResult, aboveBoundaryAttacker.id)).toBe(1);
    expect(aboveBoundaryResult.hpEventEvaluations.map(
      (evaluation) => evaluation.applied,
    )).toEqual([true, true]);
  });

  it("re-resolves current-HP-dependent damage at 101, then 50, then 25 HP", () => {
    const attacker = makeBuild("attacker", "ミュウ", {
      level: 30,
      hpIv: 4,
    });
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const seenAttackerHp: number[] = [];
    const resolveAtCurrentHp = (attackerCurrentHp: number): number[][] => {
      seenAttackerHp.push(attackerCurrentHp);
      return [[1]];
    };
    const card = makeCard(attacker, defender, [[1]]);
    card.moveUses = [
      {
        id: "move-1",
        damageRollsByHit: [[1]],
        resolveDamageRollsByHit: resolveAtCurrentHp,
        automaticHpEffects: {
          makesContact: false,
          specialRecoil: {
            effectId: "fixed-recoil-51",
            label: "固定51反動",
            amount: 51,
          },
        },
      },
      {
        id: "move-2",
        damageRollsByHit: [[1]],
        resolveDamageRollsByHit: resolveAtCurrentHp,
        automaticHpEffects: {
          makesContact: false,
          specialRecoil: {
            effectId: "fixed-recoil-25",
            label: "固定25反動",
            amount: 25,
          },
        },
      },
      {
        id: "move-3",
        damageRollsByHit: [[1]],
        resolveDamageRollsByHit: resolveAtCurrentHp,
        automaticHpEffects: {
          makesContact: false,
        },
      },
    ];

    const result = simulateHpSequence({ cards: [card] });

    expect(seenAttackerHp).toEqual([101, 50, 25]);
    expect(getOnlyStateHp(result, attacker.id)).toBe(25);
    expect(getOnlyStateHp(result, defender.id)).toBe(97);
  });

  it("applies special self-recoil after an executed zero-damage hit", () => {
    const attacker = makeBuild("attacker", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const defender = makeBuild("defender", "ミュウ", {
      level: 30,
      hpIv: 0,
    });
    const card = makeCard(attacker, defender, [[0]]);
    card.moveUses[0].automaticHpEffects = {
      makesContact: false,
      specialRecoil: {
        effectId: "mind-blown-style-recoil",
        label: "最大HP半分の自傷",
        amount: 50,
      },
    };

    const result = simulateHpSequence({ cards: [card] });

    expect(getOnlyStateHp(result, defender.id)).toBe(100);
    expect(getOnlyStateHp(result, attacker.id)).toBe(50);
    expect(result.hpEventEvaluations).toEqual([
      expect.objectContaining({
        effectId: "mind-blown-style-recoil",
        damage: 50,
        changeKind: "recoil",
        applied: true,
      }),
    ]);
  });
});
