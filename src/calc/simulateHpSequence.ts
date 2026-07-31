import type { Build } from "../domain/model";
import type {
  HpEvent,
  HpEventEvaluation,
  HpEventSubject,
} from "../domain/hpEvents";
import {
  evaluateHpEventRule,
  getHpEventRuleDefinition,
  type HpEventRuleFrequency,
  type HpEventRuleTiming,
} from "./hpEventRules";
import { toSmogonPokemon } from "./smogonAdapter";

export interface HpSequenceMoveUse {
  id: string;
  damageRollsByHit: readonly (readonly number[])[];
  completed?: boolean;
}

export interface HpSequenceCard {
  id: string;
  attackerBuild: Build;
  defenderBuild: Build;
  moveUses: HpSequenceMoveUse[];
  hpEvents?: HpEvent[];
  completed?: boolean;
}

export interface HpSequenceSimulationInput {
  cards: HpSequenceCard[];
}

export interface HpSequenceState {
  hpByBuildId: Record<string, number>;
  probability: number;
}

export interface HpSequenceSimulationResult {
  states: HpSequenceState[];
  maxHpByBuildId: Record<string, number>;
  hpEventEvaluations: HpEventEvaluation[];
}

interface InternalHpSequenceState extends HpSequenceState {
  moveExecuted: boolean;
  moveDealtDamage: boolean;
}

type HpDistribution = Map<string, InternalHpSequenceState>;

const getHpEventSubject = (event: HpEvent): HpEventSubject =>
  getHpEventRuleDefinition(event.effectId)?.subject ?? "defender";

const serializeHpState = (hpByBuildId: Record<string, number>): string =>
  Object.keys(hpByBuildId)
    .sort()
    .map((id) => `${id}:${hpByBuildId[id]}`)
    .join("|");

const serializeInternalState = (state: InternalHpSequenceState): string =>
  `${serializeHpState(state.hpByBuildId)}|executed:${state.moveExecuted ? 1 : 0}|damaged:${state.moveDealtDamage ? 1 : 0}`;

const addState = (
  distribution: HpDistribution,
  hpByBuildId: Record<string, number>,
  probability: number,
  moveExecuted: boolean,
  moveDealtDamage: boolean,
): void => {
  if (probability <= 0) {
    return;
  }

  const state = {
    hpByBuildId,
    probability,
    moveExecuted,
    moveDealtDamage,
  };
  const key = serializeInternalState(state);
  const existing = distribution.get(key);
  if (existing) {
    existing.probability += probability;
    return;
  }

  distribution.set(key, state);
};

const resetMoveResolution = (distribution: HpDistribution): HpDistribution => {
  const reset: HpDistribution = new Map();
  for (const state of distribution.values()) {
    addState(reset, { ...state.hpByBuildId }, state.probability, false, false);
  }
  return reset;
};

const applyDirectHit = (
  distribution: HpDistribution,
  attackerBuildId: string,
  defenderBuildId: string,
  damageRolls: readonly number[],
): HpDistribution => {
  const finiteRolls = damageRolls.filter((damage) => Number.isFinite(damage) && damage >= 0);
  if (finiteRolls.length === 0) {
    return distribution;
  }

  const nextDistribution: HpDistribution = new Map();
  const rollProbability = 1 / finiteRolls.length;

  for (const state of distribution.values()) {
    const attackerHp = state.hpByBuildId[attackerBuildId] ?? 0;
    const defenderHp = state.hpByBuildId[defenderBuildId] ?? 0;
    if (attackerHp <= 0 || defenderHp <= 0) {
      addState(
        nextDistribution,
        { ...state.hpByBuildId },
        state.probability,
        state.moveExecuted,
        state.moveDealtDamage,
      );
      continue;
    }

    for (const damage of finiteRolls) {
      const appliedDamage = Math.min(defenderHp, Math.trunc(damage));
      addState(
        nextDistribution,
        {
          ...state.hpByBuildId,
          [defenderBuildId]: Math.max(0, defenderHp - appliedDamage),
        },
        state.probability * rollProbability,
        true,
        state.moveDealtDamage || appliedDamage > 0,
      );
    }
  }

  return nextDistribution;
};

const canApplyHpEvent = (
  state: InternalHpSequenceState,
  card: HpSequenceCard,
  event: HpEvent,
): boolean => {
  const attackerHp = state.hpByBuildId[card.attackerBuild.id] ?? 0;
  const defenderHp = state.hpByBuildId[card.defenderBuild.id] ?? 0;
  const subject = getHpEventSubject(event);
  const subjectBuildId = subject === "attacker"
    ? card.attackerBuild.id
    : card.defenderBuild.id;
  const subjectHp = state.hpByBuildId[subjectBuildId] ?? 0;

  if (subjectHp <= 0) {
    return false;
  }

  if (event.sequenceContext === "priorMove") {
    return true;
  }

  // Life Orb recoil is part of move resolution and still happens after the
  // direct hit KOs the defender. Other later residual events stop on a faint.
  if (event.effectId === "life-orb-recoil") {
    const timing = getHpEventRuleDefinition(event.effectId)?.timing;
    return (
      timing === "afterMove"
      && subject === "attacker"
      && attackerHp > 0
      && state.moveExecuted
      && state.moveDealtDamage
    );
  }

  return attackerHp > 0 && defenderHp > 0;
};

const applyHpEvent = (
  distribution: HpDistribution,
  card: HpSequenceCard,
  event: HpEvent,
  occurrence: number,
): {
  distribution: HpDistribution;
  evaluation: HpEventEvaluation;
} => {
  const ruleResult = evaluateHpEventRule({
    event,
    attackerBuild: card.attackerBuild,
    defenderBuild: card.defenderBuild,
  });
  const ruleDefinition = getHpEventRuleDefinition(event.effectId);
  const subject = ruleDefinition?.subject ?? "defender";
  const subjectBuild = subject === "attacker"
    ? card.attackerBuild
    : card.defenderBuild;
  let activationProbability = 0;
  const nextDistribution: HpDistribution = new Map();

  for (const state of distribution.values()) {
    const eligible = event.enabled && canApplyHpEvent(state, card, event);
    if (eligible) {
      activationProbability += state.probability;
    }

    if (!eligible || ruleResult.damage <= 0) {
      addState(
        nextDistribution,
        { ...state.hpByBuildId },
        state.probability,
        state.moveExecuted,
        state.moveDealtDamage,
      );
      continue;
    }

    const currentHp = state.hpByBuildId[subjectBuild.id] ?? 0;
    addState(
      nextDistribution,
      {
        ...state.hpByBuildId,
        [subjectBuild.id]: Math.max(0, currentHp - ruleResult.damage),
      },
      state.probability,
      state.moveExecuted,
      state.moveDealtDamage,
    );
  }

  return {
    distribution: nextDistribution,
    evaluation: {
      cardId: card.id,
      eventId: event.id,
      effectId: event.effectId,
      label: ruleResult.label,
      subject,
      subjectBuildId: subjectBuild.id,
      timing: ruleDefinition?.timing ?? "afterMove",
      frequency: ruleDefinition?.frequency ?? "once",
      sequenceContext: event.sequenceContext,
      occurrence,
      damage: ruleResult.damage,
      applied: (
        event.enabled
        && ruleResult.supported
        && ruleResult.damage > 0
        && activationProbability > 0
      ),
      activationProbability,
      supported: ruleResult.supported,
      reason: ruleResult.reason,
    },
  };
};

const getInitialDistribution = (
  cards: readonly HpSequenceCard[],
): {
  distribution: HpDistribution;
  maxHpByBuildId: Record<string, number>;
} => {
  const maxHpByBuildId: Record<string, number> = {};
  for (const card of cards) {
    maxHpByBuildId[card.attackerBuild.id] = toSmogonPokemon(card.attackerBuild).maxHP();
    maxHpByBuildId[card.defenderBuild.id] = toSmogonPokemon(card.defenderBuild).maxHP();
  }

  const initialHp = { ...maxHpByBuildId };
  return {
    distribution: new Map([[
      serializeInternalState({
        hpByBuildId: initialHp,
        probability: 1,
        moveExecuted: false,
        moveDealtDamage: false,
      }),
      {
        hpByBuildId: initialHp,
        probability: 1,
        moveExecuted: false,
        moveDealtDamage: false,
      },
    ]]),
    maxHpByBuildId,
  };
};

export const simulateHpSequence = ({
  cards,
}: HpSequenceSimulationInput): HpSequenceSimulationResult => {
  const initial = getInitialDistribution(cards);
  let distribution = initial.distribution;
  const hpEventEvaluations: HpEventEvaluation[] = [];
  const occurrences = new Map<string, number>();

  const runEvent = (card: HpSequenceCard, event: HpEvent): void => {
    const occurrenceKey = `${card.id}:${event.id}`;
    const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
    occurrences.set(occurrenceKey, occurrence);
    const result = applyHpEvent(distribution, card, event, occurrence);
    distribution = result.distribution;
    hpEventEvaluations.push(result.evaluation);
  };

  const getEventTiming = (event: HpEvent): HpEventRuleTiming =>
    getHpEventRuleDefinition(event.effectId)?.timing ?? "afterMove";

  const getEventFrequency = (event: HpEvent): HpEventRuleFrequency =>
    getHpEventRuleDefinition(event.effectId)?.frequency ?? "once";

  const shouldRunOnce = (
    isFirstMove: boolean,
    isLastMove: boolean,
    cardCompleted: boolean,
    timing: HpEventRuleTiming,
  ): boolean => (
    timing === "beforeMove"
      ? isFirstMove
      : isLastMove && cardCompleted
  );

  for (const card of cards) {
    const hpEvents = card.hpEvents ?? [];
    const priorMoveEvents = hpEvents.filter((event) => event.sequenceContext === "priorMove");
    const currentMoveEvents = hpEvents.filter((event) => event.sequenceContext === "currentMove");
    const moveUses = card.moveUses;
    const cardCompleted = card.completed !== false;

    for (const event of priorMoveEvents) {
      runEvent(card, event);
    }

    for (let moveIndex = 0; moveIndex < moveUses.length; moveIndex += 1) {
      const moveUse = moveUses[moveIndex];
      const isFirstMove = moveIndex === 0;
      const isLastMove = moveIndex === moveUses.length - 1;
      distribution = resetMoveResolution(distribution);

      for (const event of currentMoveEvents.filter((candidate) => getEventTiming(candidate) === "beforeMove")) {
        const frequency = getEventFrequency(event);
        if (
          frequency === "perMove"
          || frequency === "perTurn"
          || (frequency === "once" && shouldRunOnce(isFirstMove, isLastMove, cardCompleted, "beforeMove"))
        ) {
          runEvent(card, event);
        }
      }

      for (const damageRolls of moveUse.damageRollsByHit) {
        distribution = applyDirectHit(
          distribution,
          card.attackerBuild.id,
          card.defenderBuild.id,
          damageRolls,
        );
      }

      if (moveUse.completed !== false) {
        for (const event of currentMoveEvents.filter((candidate) => getEventTiming(candidate) === "afterMove")) {
          const frequency = getEventFrequency(event);
          if (
            frequency === "perMove"
            || frequency === "perTurn"
            || (frequency === "once" && shouldRunOnce(isFirstMove, isLastMove, cardCompleted, "afterMove"))
          ) {
            runEvent(card, event);
          }
        }

        for (const event of currentMoveEvents.filter((candidate) => getEventTiming(candidate) === "endOfTurn")) {
          const frequency = getEventFrequency(event);
          if (
            frequency === "perMove"
            || frequency === "perTurn"
            || (frequency === "once" && shouldRunOnce(isFirstMove, isLastMove, cardCompleted, "endOfTurn"))
          ) {
            runEvent(card, event);
          }
        }
      }
    }
  }

  const publicStates = new Map<string, HpSequenceState>();
  for (const state of distribution.values()) {
    const key = serializeHpState(state.hpByBuildId);
    const existing = publicStates.get(key);
    if (existing) {
      existing.probability += state.probability;
    } else {
      publicStates.set(key, {
        hpByBuildId: { ...state.hpByBuildId },
        probability: state.probability,
      });
    }
  }

  return {
    states: [...publicStates.values()].sort((left, right) => (
      serializeHpState(left.hpByBuildId).localeCompare(serializeHpState(right.hpByBuildId))
    )),
    maxHpByBuildId: initial.maxHpByBuildId,
    hpEventEvaluations,
  };
};

export const getHpSequenceSurvivalProbability = (
  result: HpSequenceSimulationResult,
  buildId: string,
): number => result.states.reduce((probability, state) => (
  probability + ((state.hpByBuildId[buildId] ?? 0) > 0 ? state.probability : 0)
), 0);

export const getHpSequenceKoProbability = (
  result: HpSequenceSimulationResult,
  buildId: string,
): number => result.states.reduce((probability, state) => (
  probability + ((state.hpByBuildId[buildId] ?? 0) <= 0 ? state.probability : 0)
), 0);
