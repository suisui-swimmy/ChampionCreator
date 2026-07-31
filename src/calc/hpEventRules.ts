import type { Build, FieldState } from "../domain/model";
import {
  CHAMPIONS_HP_RULESET_ID,
  isSupportedHpEventEffectId,
  type HpEvent,
  type HpEventFrequency,
  type HpEventSubject,
  type HpEventTiming,
  type SupportedHpEventEffectId,
} from "../domain/hpEvents";
import {
  getSmogonTypeEffectiveness,
  isSmogonGrounded,
  toSmogonPokemon,
} from "./smogonAdapter";

export type HpEventRuleTiming = Extract<
  HpEventTiming,
  "onEntry" | "beforeMove" | "afterHit" | "afterMove" | "endOfTurn"
>;
export type HpEventRuleFrequency = Extract<
  HpEventFrequency,
  "once" | "perMove" | "perHit" | "perTurn"
>;

export interface HpEventRuleDefinition {
  effectId: SupportedHpEventEffectId;
  label: string;
  formulaLabel: string;
  frequency: HpEventRuleFrequency;
  timing: HpEventRuleTiming;
  subject: HpEventSubject;
  priority: number;
  maxActivations?: 1;
  sourceRef: string;
}

export interface HpEventRuleContext {
  event: HpEvent;
  attackerBuild: Build;
  defenderBuild: Build;
  field?: FieldState;
  occurrence?: number;
  moveMakesContact?: boolean;
}

export interface HpEventRuleResult {
  supported: boolean;
  label: string;
  damage: number;
  healing?: number;
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
    priority: 10,
    sourceRef: "Pokemon Showdown derived rule: max HP / 10, floor, minimum 1",
  },
  "sandstorm-damage": {
    effectId: "sandstorm-damage",
    label: "すなあらしダメージ",
    formulaLabel: "最大HPの1/16（切り捨て・最低1）",
    frequency: "perTurn",
    timing: "endOfTurn",
    subject: "defender",
    priority: 10,
    sourceRef: "Pokemon Showdown derived rule: max HP / 16, floor, minimum 1",
  },
  "poison-damage": {
    effectId: "poison-damage",
    label: "どくダメージ",
    formulaLabel: "最大HPの1/8（切り捨て・最低1）",
    frequency: "perTurn",
    timing: "endOfTurn",
    subject: "defender",
    priority: 20,
    sourceRef: "Pokemon Showdown status rule: max HP / 8",
  },
  "toxic-damage": {
    effectId: "toxic-damage",
    label: "もうどくダメージ",
    formulaLabel: "切り捨てた最大HPの1/16 × 段階（最大15）",
    frequency: "perTurn",
    timing: "endOfTurn",
    subject: "defender",
    priority: 20,
    sourceRef: "Pokemon Showdown toxic rule: floor(max HP / 16) multiplied by toxic stage",
  },
  "burn-damage": {
    effectId: "burn-damage",
    label: "やけどダメージ",
    formulaLabel: "最大HPの1/16（たいねつ時1/32、切り捨て・最低1）",
    frequency: "perTurn",
    timing: "endOfTurn",
    subject: "defender",
    priority: 20,
    sourceRef: "Pokemon Showdown burn rule: max HP / 16, Heatproof max HP / 32",
  },
  "stealth-rock-damage": {
    effectId: "stealth-rock-damage",
    label: "ステルスロック",
    formulaLabel: "最大HP × いわ相性 / 8（相性適用後に切り捨て・最低1）",
    frequency: "once",
    timing: "onEntry",
    subject: "defender",
    priority: 10,
    sourceRef: "@smogon/calc hazard rule using the generation type chart",
  },
  "spikes-damage": {
    effectId: "spikes-damage",
    label: "まきびし",
    formulaLabel: "1層=最大HPの1/8、2層=1/6、3層=1/4",
    frequency: "once",
    timing: "onEntry",
    subject: "defender",
    priority: 20,
    sourceRef: "@smogon/calc grounded and Spikes hazard rules",
  },
  "salt-cure-damage": {
    effectId: "salt-cure-damage",
    label: "しおづけダメージ",
    formulaLabel: "Champions仕様: 最大HPの1/16（みず・はがねは1/8）",
    frequency: "perTurn",
    timing: "endOfTurn",
    subject: "defender",
    priority: 30,
    sourceRef: "Pokemon Champions rule: max HP / 16, Water or Steel max HP / 8",
  },
  "sitrus-berry-heal": {
    effectId: "sitrus-berry-heal",
    label: "オボンのみ回復",
    formulaLabel: "HPが半分以下になった時、最大HPの1/4回復（じゅくせい時1/2）",
    frequency: "once",
    timing: "afterHit",
    subject: "defender",
    priority: 30,
    maxActivations: 1,
    sourceRef: "Pokemon Showdown Sitrus Berry onUpdate and onEat rules",
  },
  "leftovers-heal": {
    effectId: "leftovers-heal",
    label: "たべのこし回復",
    formulaLabel: "最大HPの1/16回復（切り捨て・最低1）",
    frequency: "perTurn",
    timing: "endOfTurn",
    subject: "defender",
    priority: 40,
    sourceRef: "Pokemon Showdown Leftovers residual rule: max HP / 16",
  },
  "rocky-helmet-damage": {
    effectId: "rocky-helmet-damage",
    label: "ゴツゴツメット",
    formulaLabel: "接触ヒットごとに技使用者の最大HPの1/6（切り捨て・最低1）",
    frequency: "perHit",
    timing: "afterHit",
    subject: "attacker",
    priority: 10,
    sourceRef: "Pokemon Showdown Rocky Helmet onDamagingHit rule",
  },
  "rough-skin-damage": {
    effectId: "rough-skin-damage",
    label: "さめはだ／てつのトゲ",
    formulaLabel: "接触ヒットごとに技使用者の最大HPの1/8（切り捨て・最低1）",
    frequency: "perHit",
    timing: "afterHit",
    subject: "attacker",
    priority: 20,
    sourceRef: "Pokemon Showdown Rough Skin and Iron Barbs onDamagingHit rules",
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

const clampInt = (value: number | undefined, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value ?? min)));
};

const getDamageImmunityReason = (subject: ReturnType<typeof toSmogonPokemon>): string | undefined =>
  subject.hasAbility("Magic Guard") ? "マジックガードで無効" : undefined;

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
  field,
  occurrence = 1,
  moveMakesContact,
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
  const magicGuardReason = getDamageImmunityReason(subject);

  if (event.effectId === "life-orb-recoil") {
    if (magicGuardReason) {
      return {
        supported: true,
        label: definition.label,
        damage: 0,
        reason: magicGuardReason,
      };
    }

    return {
      supported: true,
      label: definition.label,
      damage: floorMin1(subject.maxHP() / 10),
    };
  }

  if (event.effectId === "sandstorm-damage") {
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
  }

  if (event.effectId === "poison-damage" || event.effectId === "toxic-damage") {
    if (subject.hasAbility("Poison Heal")) {
      return {
        supported: true,
        label: definition.label.replace("ダメージ", "（ポイズンヒール）"),
        damage: 0,
        healing: floorMin1(subject.maxHP() / 8),
      };
    }

    if (magicGuardReason) {
      return {
        supported: true,
        label: definition.label,
        damage: 0,
        reason: magicGuardReason,
      };
    }

    if (event.effectId === "toxic-damage") {
      const initialStage = clampInt(event.toxicStage, 1, 15);
      const toxicStage = Math.min(15, initialStage + Math.max(0, occurrence - 1));
      return {
        supported: true,
        label: `${definition.label}（${toxicStage}段階）`,
        damage: floorMin1(subject.maxHP() / 16) * toxicStage,
      };
    }

    return {
      supported: true,
      label: definition.label,
      damage: floorMin1(subject.maxHP() / 8),
    };
  }

  if (event.effectId === "burn-damage") {
    if (magicGuardReason) {
      return {
        supported: true,
        label: definition.label,
        damage: 0,
        reason: magicGuardReason,
      };
    }

    return {
      supported: true,
      label: definition.label,
      damage: floorMin1(subject.maxHP() / (subject.hasAbility("Heatproof") ? 32 : 16)),
    };
  }

  if (event.effectId === "stealth-rock-damage") {
    if (subject.hasItem("Heavy-Duty Boots")) {
      return {
        supported: true,
        label: definition.label,
        damage: 0,
        reason: "あつぞこブーツで無効",
      };
    }
    if (subject.hasAbility("Magic Guard", "Mountaineer")) {
      return {
        supported: true,
        label: definition.label,
        damage: 0,
        reason: "特性で無効",
      };
    }

    const effectiveness = getSmogonTypeEffectiveness("Rock", subjectBuild);
    return {
      supported: true,
      label: `${definition.label}（いわ${effectiveness}倍）`,
      damage: effectiveness <= 0
        ? 0
        : floorMin1((subject.maxHP() * effectiveness) / 8),
      ...(effectiveness <= 0 ? { reason: "タイプ相性で無効" } : {}),
    };
  }

  if (event.effectId === "spikes-damage") {
    if (subject.hasItem("Heavy-Duty Boots")) {
      return {
        supported: true,
        label: definition.label,
        damage: 0,
        reason: "あつぞこブーツで無効",
      };
    }
    if (magicGuardReason) {
      return {
        supported: true,
        label: definition.label,
        damage: 0,
        reason: magicGuardReason,
      };
    }
    if (!isSmogonGrounded(subjectBuild, field)) {
      return {
        supported: true,
        label: definition.label,
        damage: 0,
        reason: "地面にいないため無効",
      };
    }

    const layers = clampInt(event.spikesLayers, 1, 3);
    const divisor = layers === 1 ? 8 : layers === 2 ? 6 : 4;
    return {
      supported: true,
      label: `${definition.label}（${layers}層）`,
      damage: floorMin1(subject.maxHP() / divisor),
    };
  }

  if (event.effectId === "salt-cure-damage") {
    if (magicGuardReason) {
      return {
        supported: true,
        label: definition.label,
        damage: 0,
        reason: magicGuardReason,
      };
    }

    const waterOrSteel = subject.hasType("Water", "Steel");
    return {
      supported: true,
      label: `${definition.label}${waterOrSteel ? "（みず・はがね）" : ""}`,
      damage: floorMin1(subject.maxHP() / (waterOrSteel ? 8 : 16)),
    };
  }

  if (event.effectId === "sitrus-berry-heal") {
    return {
      supported: true,
      label: definition.label,
      damage: 0,
      healing: floorMin1(subject.maxHP() / (subject.hasAbility("Ripen") ? 2 : 4)),
    };
  }

  if (event.effectId === "leftovers-heal") {
    return {
      supported: true,
      label: definition.label,
      damage: 0,
      healing: floorMin1(subject.maxHP() / 16),
    };
  }

  if (
    event.effectId === "rocky-helmet-damage"
    || event.effectId === "rough-skin-damage"
  ) {
    if (!moveMakesContact) {
      return {
        supported: true,
        label: definition.label,
        damage: 0,
        reason: "非接触技、えんかく、ぼうごパット等により接触していません",
      };
    }
    if (magicGuardReason) {
      return {
        supported: true,
        label: definition.label,
        damage: 0,
        reason: magicGuardReason,
      };
    }

    return {
      supported: true,
      label: definition.label,
      damage: floorMin1(subject.maxHP() / (
        event.effectId === "rocky-helmet-damage" ? 6 : 8
      )),
    };
  }

  return {
    supported: false,
    label: definition.label,
    damage: 0,
    reason: "このHP変化の計算ルールが実装されていません",
  };
};

export { CHAMPIONS_HP_RULESET_ID };
