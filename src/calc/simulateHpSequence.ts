import type { Build, FieldState } from "../domain/model";
import type {
  HpEvent,
  HpEventChangeKind,
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
  resolveDamageRollsByHit?: (
    attackerCurrentHp: number,
    defenderCurrentHp: number,
  ) => readonly (readonly number[])[];
  automaticHpEffects?: {
    makesContact: boolean;
    hpCost?: {
      effectId: string;
      label: string;
      formulaLabel: string;
      amount: number;
      once?: boolean;
    };
    damageBasedRecoil?: {
      effectId: string;
      label: string;
      numerator: number;
      denominator: number;
    };
    specialRecoil?: {
      effectId: string;
      label: string;
      amount: number;
    };
    forcesAttackerFaint?: {
      effectId: string;
      label: string;
    };
  };
  completed?: boolean;
}

export interface HpSequenceCard {
  id: string;
  attackerBuild: Build;
  defenderBuild: Build;
  moveUses: HpSequenceMoveUse[];
  hpEvents?: HpEvent[];
  field?: FieldState;
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
  hitExecuted: boolean;
  hitDealtDamage: boolean;
  lastAppliedDamage: number;
  moveAppliedDamageTotal: number;
  moveCanExecute: boolean;
  consumedEventKeys: string[];
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
  `${serializeHpState(state.hpByBuildId)}`
  + `|executed:${state.moveExecuted ? 1 : 0}`
  + `|damaged:${state.moveDealtDamage ? 1 : 0}`
  + `|hit:${state.hitExecuted ? 1 : 0}`
  + `|hitDamage:${state.hitDealtDamage ? 1 : 0}`
  + `|last:${state.lastAppliedDamage}`
  + `|moveDamage:${state.moveAppliedDamageTotal}`
  + `|canExecute:${state.moveCanExecute ? 1 : 0}`
  + `|consumed:${[...state.consumedEventKeys].sort().join(",")}`;

const addState = (
  distribution: HpDistribution,
  state: InternalHpSequenceState,
): void => {
  if (state.probability <= 0) {
    return;
  }

  const normalizedState: InternalHpSequenceState = {
    ...state,
    hpByBuildId: { ...state.hpByBuildId },
    consumedEventKeys: [...state.consumedEventKeys],
  };
  const key = serializeInternalState(normalizedState);
  const existing = distribution.get(key);
  if (existing) {
    existing.probability += normalizedState.probability;
    return;
  }

  distribution.set(key, normalizedState);
};

const resetMoveResolution = (distribution: HpDistribution): HpDistribution => {
  const reset: HpDistribution = new Map();
  for (const state of distribution.values()) {
    addState(reset, {
      ...state,
      moveExecuted: false,
      moveDealtDamage: false,
      hitExecuted: false,
      hitDealtDamage: false,
      lastAppliedDamage: 0,
      moveAppliedDamageTotal: 0,
      moveCanExecute: true,
    });
  }
  return reset;
};

const resetHitResolution = (distribution: HpDistribution): HpDistribution => {
  const reset: HpDistribution = new Map();
  for (const state of distribution.values()) {
    addState(reset, {
      ...state,
      hitExecuted: false,
      hitDealtDamage: false,
      lastAppliedDamage: 0,
    });
  }
  return reset;
};

const applyDirectHit = (
  distribution: HpDistribution,
  attackerBuildId: string,
  defenderBuildId: string,
  moveUse: HpSequenceMoveUse,
  hitIndex: number,
): HpDistribution => {
  const nextDistribution: HpDistribution = new Map();

  for (const state of distribution.values()) {
    const attackerHp = state.hpByBuildId[attackerBuildId] ?? 0;
    const defenderHp = state.hpByBuildId[defenderBuildId] ?? 0;
    if (attackerHp <= 0 || defenderHp <= 0 || !state.moveCanExecute) {
      addState(nextDistribution, state);
      continue;
    }

    const damageRollsByHit = moveUse.resolveDamageRollsByHit?.(
      attackerHp,
      defenderHp,
    ) ?? moveUse.damageRollsByHit;
    const finiteRolls = (damageRollsByHit[hitIndex] ?? [])
      .filter((damage) => Number.isFinite(damage) && damage >= 0);
    if (finiteRolls.length === 0) {
      addState(nextDistribution, state);
      continue;
    }

    const rollProbability = 1 / finiteRolls.length;
    for (const damage of finiteRolls) {
      const appliedDamage = Math.min(defenderHp, Math.trunc(damage));
      addState(nextDistribution, {
        ...state,
        hpByBuildId: {
          ...state.hpByBuildId,
          [defenderBuildId]: Math.max(0, defenderHp - appliedDamage),
        },
        probability: state.probability * rollProbability,
        moveExecuted: true,
        moveDealtDamage: state.moveDealtDamage || appliedDamage > 0,
        hitExecuted: true,
        hitDealtDamage: appliedDamage > 0,
        lastAppliedDamage: appliedDamage,
        moveAppliedDamageTotal: state.moveAppliedDamageTotal + appliedDamage,
      });
    }
  }

  return nextDistribution;
};

const canApplyHpEvent = (
  state: InternalHpSequenceState,
  card: HpSequenceCard,
  event: HpEvent,
  damage: number,
  healing: number,
  consumptionKey: string,
): boolean => {
  const attackerHp = state.hpByBuildId[card.attackerBuild.id] ?? 0;
  const subject = getHpEventSubject(event);
  const subjectBuild = subject === "attacker"
    ? card.attackerBuild
    : card.defenderBuild;
  const subjectHp = state.hpByBuildId[subjectBuild.id] ?? 0;
  const subjectMaxHp = toSmogonPokemon(subjectBuild).maxHP();

  if (subjectHp <= 0) {
    return false;
  }

  const ruleDefinition = getHpEventRuleDefinition(event.effectId);
  if (
    ruleDefinition?.maxActivations
    && state.consumedEventKeys.includes(consumptionKey)
  ) {
    return false;
  }

  if (event.sequenceContext === "priorMove") {
    return true;
  }

  if (
    ruleDefinition?.timing === "afterHit"
    && (!state.hitExecuted || !state.hitDealtDamage)
  ) {
    return false;
  }

  // Life Orb recoil is part of move resolution and still happens after the
  // direct hit KOs the defender. Other later residual events stop on a faint.
  if (event.effectId === "life-orb-recoil") {
    const timing = ruleDefinition?.timing;
    return (
      timing === "afterMove"
      && subject === "attacker"
      && attackerHp > 0
      && state.moveExecuted
      && state.moveDealtDamage
    );
  }

  if (
    event.effectId === "sitrus-berry-heal"
    && (
      !state.hitExecuted
      || !state.hitDealtDamage
      || subjectHp * 2 > subjectMaxHp
    )
  ) {
    return false;
  }

  if (healing > 0 && subjectHp >= subjectMaxHp) {
    return false;
  }

  return damage > 0 || healing > 0;
};

const applyHpEvent = (
  distribution: HpDistribution,
  card: HpSequenceCard,
  event: HpEvent,
  occurrence: number,
  moveUse?: HpSequenceMoveUse,
): {
  distribution: HpDistribution;
  evaluation: HpEventEvaluation;
} => {
  const ruleResult = evaluateHpEventRule({
    event,
    attackerBuild: card.attackerBuild,
    defenderBuild: card.defenderBuild,
    field: card.field,
    occurrence,
    moveMakesContact: moveUse?.automaticHpEffects?.makesContact,
  });
  const ruleDefinition = getHpEventRuleDefinition(event.effectId);
  const subject = ruleDefinition?.subject ?? "defender";
  const subjectBuild = subject === "attacker"
    ? card.attackerBuild
    : card.defenderBuild;
  const healing = ruleResult.healing ?? 0;
  const consumptionKey = `${subjectBuild.id}:${event.effectId}`;
  let activationProbability = 0;
  const nextDistribution: HpDistribution = new Map();

  for (const state of distribution.values()) {
    const eligible = event.enabled && canApplyHpEvent(
      state,
      card,
      event,
      ruleResult.damage,
      healing,
      consumptionKey,
    );
    if (!eligible) {
      addState(nextDistribution, state);
      continue;
    }

    const currentHp = state.hpByBuildId[subjectBuild.id] ?? 0;
    const maxHp = toSmogonPokemon(subjectBuild).maxHP();
    const nextHp = Math.min(
      maxHp,
      Math.max(0, currentHp - ruleResult.damage + healing),
    );
    const didApply = nextHp !== currentHp;
    if (didApply) {
      activationProbability += state.probability;
    }
    const consumedEventKeys = (
      didApply
      && ruleDefinition?.maxActivations
      && !state.consumedEventKeys.includes(consumptionKey)
    )
      ? [...state.consumedEventKeys, consumptionKey]
      : state.consumedEventKeys;
    addState(nextDistribution, {
      ...state,
      hpByBuildId: {
        ...state.hpByBuildId,
        [subjectBuild.id]: nextHp,
      },
      consumedEventKeys: [...consumedEventKeys],
    });
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
      changeKind: healing > 0 ? "healing" : "damage",
      ...(healing > 0 ? { healing } : {}),
      applied: (
        event.enabled
        && ruleResult.supported
        && (ruleResult.damage > 0 || healing > 0)
        && activationProbability > 0
      ),
      activationProbability,
      supported: ruleResult.supported,
      reason: ruleResult.reason ?? (
        event.effectId === "sitrus-berry-heal" && activationProbability <= 0
          ? "HP条件を満たしていないか、すでに発動済みです"
          : undefined
      ),
    },
  };
};

const buildAutomaticEvaluation = ({
  card,
  moveUse,
  effectId,
  label,
  timing,
  frequency,
  occurrence,
  changeKind,
  amounts,
  activationProbability,
  reason,
}: {
  card: HpSequenceCard;
  moveUse: HpSequenceMoveUse;
  effectId: string;
  label: string;
  timing: HpEventEvaluation["timing"];
  frequency: HpEventEvaluation["frequency"];
  occurrence: number;
  changeKind: HpEventChangeKind;
  amounts: number[];
  activationProbability: number;
  reason?: string;
}): HpEventEvaluation => {
  const min = amounts.length > 0 ? Math.min(...amounts) : 0;
  const max = amounts.length > 0 ? Math.max(...amounts) : 0;
  return {
    cardId: card.id,
    eventId: `${moveUse.id}:${effectId}`,
    effectId,
    label,
    subject: "attacker",
    subjectBuildId: card.attackerBuild.id,
    timing,
    frequency,
    sequenceContext: "currentMove",
    occurrence,
    damage: min,
    ...(min !== max ? { damageRange: { min, max } } : {}),
    changeKind,
    applied: activationProbability > 0,
    activationProbability,
    supported: true,
    ...(activationProbability <= 0 && reason ? { reason } : {}),
  };
};

const applyAutomaticHpCost = (
  distribution: HpDistribution,
  card: HpSequenceCard,
  moveUse: HpSequenceMoveUse,
  occurrence: number,
): {
  distribution: HpDistribution;
  evaluation?: HpEventEvaluation;
} => {
  const hpCost = moveUse.automaticHpEffects?.hpCost;
  if (!hpCost) {
    return { distribution };
  }

  const consumptionKey = `${card.attackerBuild.id}:${card.id}:${hpCost.effectId}`;
  const nextDistribution: HpDistribution = new Map();
  let activationProbability = 0;
  let consumedProbability = 0;
  let insufficientProbability = 0;

  for (const state of distribution.values()) {
    const attackerHp = state.hpByBuildId[card.attackerBuild.id] ?? 0;
    const alreadyConsumed = Boolean(
      hpCost.once
      && state.consumedEventKeys.includes(consumptionKey)
    );
    const canPay = attackerHp > hpCost.amount && !alreadyConsumed;
    if (!canPay) {
      if (alreadyConsumed) {
        consumedProbability += state.probability;
      } else {
        insufficientProbability += state.probability;
      }
      addState(nextDistribution, {
        ...state,
        moveCanExecute: false,
      });
      continue;
    }

    activationProbability += state.probability;
    addState(nextDistribution, {
      ...state,
      hpByBuildId: {
        ...state.hpByBuildId,
        [card.attackerBuild.id]: attackerHp - hpCost.amount,
      },
      consumedEventKeys: hpCost.once
        ? [...state.consumedEventKeys, consumptionKey]
        : state.consumedEventKeys,
    });
  }

  const reason = consumedProbability > 0 && insufficientProbability <= 0
    ? "この技由来のHPコストはすでに支払い済みです"
    : "現在HPがコスト以下のため技が失敗します";
  return {
    distribution: nextDistribution,
    evaluation: buildAutomaticEvaluation({
      card,
      moveUse,
      effectId: hpCost.effectId,
      label: hpCost.label,
      timing: "beforeMove",
      frequency: "perMove",
      occurrence,
      changeKind: "hpCost",
      amounts: [hpCost.amount],
      activationProbability,
      reason,
    }),
  };
};

const applyAutomaticForcedFaint = (
  distribution: HpDistribution,
  card: HpSequenceCard,
  moveUse: HpSequenceMoveUse,
  occurrence: number,
): {
  distribution: HpDistribution;
  evaluation?: HpEventEvaluation;
} => {
  const forcedFaint = moveUse.automaticHpEffects?.forcesAttackerFaint;
  if (!forcedFaint) {
    return { distribution };
  }

  const nextDistribution: HpDistribution = new Map();
  const amounts: number[] = [];
  let activationProbability = 0;
  for (const state of distribution.values()) {
    const attackerHp = state.hpByBuildId[card.attackerBuild.id] ?? 0;
    if (!state.hitExecuted || !state.hitDealtDamage || attackerHp <= 0) {
      addState(nextDistribution, state);
      continue;
    }

    activationProbability += state.probability;
    amounts.push(attackerHp);
    addState(nextDistribution, {
      ...state,
      hpByBuildId: {
        ...state.hpByBuildId,
        [card.attackerBuild.id]: 0,
      },
    });
  }

  return {
    distribution: nextDistribution,
    evaluation: buildAutomaticEvaluation({
      card,
      moveUse,
      effectId: forcedFaint.effectId,
      label: forcedFaint.label,
      timing: "afterHit",
      frequency: "once",
      occurrence,
      changeKind: "forcedFaint",
      amounts,
      activationProbability,
      reason: "技が命中しなかったため使用者はひんししません",
    }),
  };
};

const applyAutomaticRecoil = (
  distribution: HpDistribution,
  card: HpSequenceCard,
  moveUse: HpSequenceMoveUse,
  occurrence: number,
): {
  distribution: HpDistribution;
  evaluations: HpEventEvaluation[];
} => {
  const automatic = moveUse.automaticHpEffects;
  if (!automatic?.damageBasedRecoil && !automatic?.specialRecoil) {
    return { distribution, evaluations: [] };
  }

  const attacker = toSmogonPokemon(card.attackerBuild);
  const standardRecoilBlocked = attacker.hasAbility("Magic Guard", "Rock Head");
  const effects = [
    automatic.damageBasedRecoil
      ? {
          effectId: automatic.damageBasedRecoil.effectId,
          label: automatic.damageBasedRecoil.label,
          blocked: standardRecoilBlocked,
          blockedReason: attacker.hasAbility("Magic Guard")
            ? "マジックガードで無効"
            : "いしあたまで無効",
          requiresDamage: true,
          getAmount: (state: InternalHpSequenceState) => Math.max(
            1,
            Math.round(
              state.moveAppliedDamageTotal
              * automatic.damageBasedRecoil!.numerator
              / automatic.damageBasedRecoil!.denominator,
            ),
          ),
        }
      : undefined,
    automatic.specialRecoil
      ? {
          effectId: automatic.specialRecoil.effectId,
          label: automatic.specialRecoil.label,
          blocked: false,
          blockedReason: undefined,
          requiresDamage: false,
          getAmount: () => automatic.specialRecoil!.amount,
        }
      : undefined,
  ].filter((effect): effect is NonNullable<typeof effect> => Boolean(effect));

  let currentDistribution = distribution;
  const evaluations: HpEventEvaluation[] = [];
  for (const effect of effects) {
    const nextDistribution: HpDistribution = new Map();
    const amounts: number[] = [];
    let activationProbability = 0;
    for (const state of currentDistribution.values()) {
      const attackerHp = state.hpByBuildId[card.attackerBuild.id] ?? 0;
      const eligible = (
        !effect.blocked
        && attackerHp > 0
        && state.moveExecuted
        && (!effect.requiresDamage || state.moveAppliedDamageTotal > 0)
      );
      if (!eligible) {
        addState(nextDistribution, state);
        continue;
      }

      const amount = effect.getAmount(state);
      amounts.push(amount);
      activationProbability += state.probability;
      addState(nextDistribution, {
        ...state,
        hpByBuildId: {
          ...state.hpByBuildId,
          [card.attackerBuild.id]: Math.max(0, attackerHp - amount),
        },
      });
    }

    const reason = effect.blocked
      ? effect.blockedReason
      : effect.requiresDamage
        ? "技がダメージを与えていないため反動は発生しません"
        : "技を実行していないため反動は発生しません";
    evaluations.push(buildAutomaticEvaluation({
      card,
      moveUse,
      effectId: effect.effectId,
      label: effect.label,
      timing: "afterMove",
      frequency: "perMove",
      occurrence,
      changeKind: "recoil",
      amounts,
      activationProbability,
      reason,
    }));
    currentDistribution = nextDistribution;
  }

  return {
    distribution: currentDistribution,
    evaluations,
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
        hitExecuted: false,
        hitDealtDamage: false,
        lastAppliedDamage: 0,
        moveAppliedDamageTotal: 0,
        moveCanExecute: true,
        consumedEventKeys: [],
      }),
      {
        hpByBuildId: initialHp,
        probability: 1,
        moveExecuted: false,
        moveDealtDamage: false,
        hitExecuted: false,
        hitDealtDamage: false,
        lastAppliedDamage: 0,
        moveAppliedDamageTotal: 0,
        moveCanExecute: true,
        consumedEventKeys: [],
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

  const runEvent = (
    card: HpSequenceCard,
    event: HpEvent,
    moveUse?: HpSequenceMoveUse,
  ): void => {
    const occurrenceKey = `${card.id}:${event.id}`;
    const occurrence = (occurrences.get(occurrenceKey) ?? 0) + 1;
    occurrences.set(occurrenceKey, occurrence);
    const result = applyHpEvent(distribution, card, event, occurrence, moveUse);
    distribution = result.distribution;
    hpEventEvaluations.push(result.evaluation);
  };

  const getEventTiming = (event: HpEvent): HpEventRuleTiming =>
    getHpEventRuleDefinition(event.effectId)?.timing ?? "afterMove";

  const getEventFrequency = (event: HpEvent): HpEventRuleFrequency =>
    getHpEventRuleDefinition(event.effectId)?.frequency ?? "once";

  const sortEvents = (events: readonly HpEvent[]): HpEvent[] =>
    [...events].sort((left, right) => (
      (getHpEventRuleDefinition(left.effectId)?.priority ?? 0)
      - (getHpEventRuleDefinition(right.effectId)?.priority ?? 0)
    ));

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
    const currentMoveEvents = sortEvents(
      hpEvents.filter((event) => event.sequenceContext === "currentMove"),
    );
    const moveUses = card.moveUses;
    const cardCompleted = card.completed !== false;

    for (const event of priorMoveEvents) {
      runEvent(card, event);
    }

    for (const event of currentMoveEvents.filter((candidate) => getEventTiming(candidate) === "onEntry")) {
      runEvent(card, event);
    }

    for (let moveIndex = 0; moveIndex < moveUses.length; moveIndex += 1) {
      const moveUse = moveUses[moveIndex];
      const isFirstMove = moveIndex === 0;
      const isLastMove = moveIndex === moveUses.length - 1;
      distribution = resetMoveResolution(distribution);

      const hpCostResult = applyAutomaticHpCost(
        distribution,
        card,
        moveUse,
        moveIndex + 1,
      );
      distribution = hpCostResult.distribution;
      if (hpCostResult.evaluation) {
        hpEventEvaluations.push(hpCostResult.evaluation);
      }

      for (const event of currentMoveEvents.filter((candidate) => getEventTiming(candidate) === "beforeMove")) {
        const frequency = getEventFrequency(event);
        if (
          frequency === "perMove"
          || frequency === "perTurn"
          || (frequency === "once" && shouldRunOnce(isFirstMove, isLastMove, cardCompleted, "beforeMove"))
        ) {
          runEvent(card, event, moveUse);
        }
      }

      for (
        let hitIndex = 0;
        hitIndex < moveUse.damageRollsByHit.length;
        hitIndex += 1
      ) {
        distribution = resetHitResolution(distribution);
        distribution = applyDirectHit(
          distribution,
          card.attackerBuild.id,
          card.defenderBuild.id,
          moveUse,
          hitIndex,
        );

        const forcedFaintResult = applyAutomaticForcedFaint(
          distribution,
          card,
          moveUse,
          hitIndex + 1,
        );
        distribution = forcedFaintResult.distribution;
        if (forcedFaintResult.evaluation) {
          hpEventEvaluations.push(forcedFaintResult.evaluation);
        }

        for (const event of currentMoveEvents.filter((candidate) => getEventTiming(candidate) === "afterHit")) {
          const frequency = getEventFrequency(event);
          if (frequency === "perHit" || frequency === "once") {
            runEvent(card, event, moveUse);
          }
        }
      }

      if (moveUse.completed !== false) {
        const recoilResult = applyAutomaticRecoil(
          distribution,
          card,
          moveUse,
          moveIndex + 1,
        );
        distribution = recoilResult.distribution;
        hpEventEvaluations.push(...recoilResult.evaluations);

        for (const event of currentMoveEvents.filter((candidate) => getEventTiming(candidate) === "afterMove")) {
          const frequency = getEventFrequency(event);
          if (
            frequency === "perMove"
            || frequency === "perTurn"
            || (frequency === "once" && shouldRunOnce(isFirstMove, isLastMove, cardCompleted, "afterMove"))
          ) {
            runEvent(card, event, moveUse);
          }
        }

        for (const event of currentMoveEvents.filter((candidate) => getEventTiming(candidate) === "endOfTurn")) {
          const frequency = getEventFrequency(event);
          if (
            frequency === "perMove"
            || frequency === "perTurn"
            || (frequency === "once" && shouldRunOnce(isFirstMove, isLastMove, cardCompleted, "endOfTurn"))
          ) {
            runEvent(card, event, moveUse);
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
