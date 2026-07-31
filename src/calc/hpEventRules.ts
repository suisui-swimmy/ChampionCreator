import type { Build } from "../domain/model";
import {
  CHAMPIONS_HP_RULESET_ID,
  isSupportedHpEventEffectId,
  type HpEvent,
  type HpEventFrequency,
  type HpEventSubject,
  type HpEventTiming,
  type SupportedHpEventEffectId,
} from "../domain/hpEvents";
import { toSmogonPokemon } from "./smogonAdapter";

export type HpEventRuleTiming = Extract<
  HpEventTiming,
  "beforeMove" | "afterMove" | "endOfTurn"
>;
export type HpEventRuleFrequency = Extract<
  HpEventFrequency,
  "once" | "perMove" | "perTurn"
>;

export interface HpEventRuleDefinition {
  effectId: SupportedHpEventEffectId;
  label: string;
  formulaLabel: string;
  frequency: HpEventRuleFrequency;
  timing: HpEventRuleTiming;
  subject: HpEventSubject;
  sourceRef: string;
}

export interface HpEventRuleContext {
  event: HpEvent;
  attackerBuild: Build;
  defenderBuild: Build;
}

export interface HpEventRuleResult {
  supported: boolean;
  label: string;
  damage: number;
  reason?: string;
}

export const hpEventRuleDefinitions: Record<SupportedHpEventEffectId, HpEventRuleDefinition> = {
  "life-orb-recoil": {
    effectId: "life-orb-recoil",
    label: "いのちのたま反動",
    formulaLabel: "最大HPの1/10（切り捨て・最低1）",
    frequency: "perMove",
    timing: "afterMove",
    subject: "attacker",
    sourceRef: "Pokemon Showdown derived rule: max HP / 10, floor, minimum 1",
  },
  "sandstorm-damage": {
    effectId: "sandstorm-damage",
    label: "すなあらしダメージ",
    formulaLabel: "最大HPの1/16（切り捨て・最低1）",
    frequency: "perTurn",
    timing: "endOfTurn",
    subject: "defender",
    sourceRef: "Pokemon Showdown derived rule: max HP / 16, floor, minimum 1",
  },
};

export const floorMin1 = (value: number): number =>
  Math.max(1, Math.floor(value));

export const getHpEventRuleDefinition = (
  effectId: string,
): HpEventRuleDefinition | undefined => (
  isSupportedHpEventEffectId(effectId)
    ? hpEventRuleDefinitions[effectId]
    : undefined
);

export const compileHpEventForMove = (
  event: Omit<HpEvent, "sequenceContext">,
): HpEvent => ({
  ...event,
  sequenceContext: "currentMove",
});

const getSubjectBuild = (
  subject: HpEventSubject,
  attackerBuild: Build,
  defenderBuild: Build,
): Build => subject === "attacker" ? attackerBuild : defenderBuild;

const isWeatherSuppressed = (
  attackerBuild: Build,
  defenderBuild: Build,
): boolean => {
  const attacker = toSmogonPokemon(attackerBuild);
  const defender = toSmogonPokemon(defenderBuild);
  return attacker.hasAbility("Air Lock", "Cloud Nine")
    || defender.hasAbility("Air Lock", "Cloud Nine");
};

export const evaluateHpEventRule = ({
  event,
  attackerBuild,
  defenderBuild,
}: HpEventRuleContext): HpEventRuleResult => {
  const definition = getHpEventRuleDefinition(event.effectId);
  if (!definition) {
    return {
      supported: false,
      label: `未対応: ${event.effectId || "unknown"}`,
      damage: 0,
      reason: "このHP変化は現在のルールセットでは未対応です",
    };
  }

  if (!event.enabled) {
    return {
      supported: true,
      label: definition.label,
      damage: 0,
      reason: "無効に設定されています",
    };
  }

  const subjectBuild = getSubjectBuild(definition.subject, attackerBuild, defenderBuild);
  const subject = toSmogonPokemon(subjectBuild);

  if (event.effectId === "life-orb-recoil") {
    if (subject.hasAbility("Magic Guard")) {
      return {
        supported: true,
        label: definition.label,
        damage: 0,
        reason: "マジックガードで無効",
      };
    }

    return {
      supported: true,
      label: definition.label,
      damage: floorMin1(subject.maxHP() / 10),
    };
  }

  if (isWeatherSuppressed(attackerBuild, defenderBuild)) {
    return {
      supported: true,
      label: definition.label,
      damage: 0,
      reason: "ノーてんき / エアロックで天候が無効",
    };
  }

  if (
    subject.hasType("Rock", "Ground", "Steel")
    || subject.hasAbility("Magic Guard", "Overcoat", "Sand Force", "Sand Rush", "Sand Veil")
    || subject.hasItem("Safety Goggles")
  ) {
    return {
      supported: true,
      label: definition.label,
      damage: 0,
      reason: "タイプ・特性・持ち物で無効",
    };
  }

  return {
    supported: true,
    label: definition.label,
    damage: floorMin1(subject.maxHP() / 16),
  };
};

export { CHAMPIONS_HP_RULESET_ID };
