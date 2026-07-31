import type {
  Build,
  FieldState,
  ScenarioHit,
  ScenarioHitEvaluation,
} from "../domain/model";
import { getMoveHpMechanicsProfile } from "./moveHpMechanics";
import type { HpSequenceMoveUse } from "./simulateHpSequence";
import {
  calculateSmogonHit,
  toSmogonPokemon,
  type SmogonHitCalculationOptions,
} from "./smogonAdapter";

export type HpSequenceHitCalculator = (
  defenderBuild: Build,
  hit: ScenarioHit,
  fieldState: FieldState,
  options?: SmogonHitCalculationOptions,
) => ScenarioHitEvaluation;

export interface AutomaticMoveHpNotice {
  id: string;
  label: string;
  timingLabel: string;
  formulaLabel: string;
}

const getDamageRollsByHit = (
  evaluation: ScenarioHitEvaluation,
): readonly (readonly number[])[] =>
  evaluation.damageRollsByHit ?? [evaluation.damageRolls];

const getSpecialRecoilAmount = (
  kind: "struggle" | "mind-blown",
  maxHp: number,
): number => (
  kind === "struggle"
    ? Math.max(1, Math.round(maxHp / 4))
    : Math.max(1, Math.ceil(maxHp / 2))
);

export const getAutomaticMoveHpNotices = (
  hit: ScenarioHit,
): AutomaticMoveHpNotice[] => {
  const profile = getMoveHpMechanicsProfile(hit);
  const moveLabel = hit.move.displayNameJa;
  const notices: AutomaticMoveHpNotice[] = [];

  if (profile.hpCost) {
    notices.push({
      id: `hp-cost:${profile.hpCost.kind}`,
      label: `${moveLabel}のHP消費`,
      timingLabel: "技を使う前",
      formulaLabel: profile.hpCost.formulaLabel,
    });
  }

  if (profile.currentHpFormulaLabel) {
    notices.push({
      id: `current-hp:${profile.canonicalName}`,
      label: `${moveLabel}の現在HP計算`,
      timingLabel: "各攻撃の直前",
      formulaLabel: profile.currentHpFormulaLabel,
    });
  }

  if (profile.damageBasedRecoil) {
    notices.push({
      id: `damage-recoil:${profile.canonicalName}`,
      label: `${moveLabel}の反動`,
      timingLabel: "技の後",
      formulaLabel:
        `実際に与えたダメージの${profile.damageBasedRecoil.numerator}`
        + `/${profile.damageBasedRecoil.denominator}（四捨五入・最低1）`,
    });
  }

  if (profile.specialRecoil) {
    notices.push({
      id: `special-recoil:${profile.specialRecoil.kind}`,
      label: `${moveLabel}の反動`,
      timingLabel: "技の後",
      formulaLabel: profile.specialRecoil.kind === "struggle"
        ? "使用者の最大HPの1/4（四捨五入・最低1）"
        : "使用者の最大HPの1/2（切り上げ）",
    });
  }

  if (profile.forcesAttackerFaint) {
    notices.push({
      id: "forced-faint:final-gambit",
      label: `${moveLabel}の使用者ひんし`,
      timingLabel: "命中後",
      formulaLabel: "ダメージを与えた使用者がひんし",
    });
  }

  return notices;
};

export const buildHpSequenceMoveUses = ({
  defenderBuild,
  hit,
  field,
  evaluation,
  calculateHit = calculateSmogonHit,
}: {
  defenderBuild: Build;
  hit: ScenarioHit;
  field: FieldState;
  evaluation: ScenarioHitEvaluation;
  calculateHit?: HpSequenceHitCalculator;
}): HpSequenceMoveUse[] => {
  const repeat = Math.max(0, Math.trunc(hit.repeat));
  const initialDamageRollsByHit = getDamageRollsByHit(evaluation);
  const profile = getMoveHpMechanicsProfile(hit);
  const attackerMaxHp = toSmogonPokemon(hit.attacker).maxHP();
  const automaticHpEffects: NonNullable<HpSequenceMoveUse["automaticHpEffects"]> = {
    makesContact: profile.makesContact,
    ...(profile.hpCost
      ? {
          hpCost: {
            effectId: `move-hp-cost:${profile.hpCost.kind}`,
            label: `${hit.move.displayNameJa}のHP消費`,
            formulaLabel: profile.hpCost.formulaLabel,
            amount: profile.hpCost.amount(attackerMaxHp),
          },
        }
      : {}),
    ...(profile.damageBasedRecoil
      ? {
          damageBasedRecoil: {
            effectId: "move-damage-recoil",
            label: `${hit.move.displayNameJa}の反動`,
            numerator: profile.damageBasedRecoil.numerator,
            denominator: profile.damageBasedRecoil.denominator,
          },
        }
      : {}),
    ...(profile.specialRecoil
      ? {
          specialRecoil: {
            effectId: `move-special-recoil:${profile.specialRecoil.kind}`,
            label: `${hit.move.displayNameJa}の反動`,
            amount: getSpecialRecoilAmount(profile.specialRecoil.kind, attackerMaxHp),
          },
        }
      : {}),
    ...(profile.forcesAttackerFaint
      ? {
          forcesAttackerFaint: {
            effectId: "move-forced-faint:final-gambit",
            label: `${hit.move.displayNameJa}の使用者ひんし`,
          },
        }
      : {}),
  };

  const dynamicDamageCache = new Map<string, readonly (readonly number[])[]>();
  const resolveDamageRollsByHit = profile.usesCurrentHpDamage
    ? (attackerCurrentHp: number, defenderCurrentHp: number) => {
        const cacheKey = `${attackerCurrentHp}:${defenderCurrentHp}`;
        const cached = dynamicDamageCache.get(cacheKey);
        if (cached) {
          return cached;
        }

        const dynamicEvaluation = calculateHit(defenderBuild, hit, field, {
          attackerCurrentHp,
          defenderCurrentHp,
        });
        const damageRollsByHit = getDamageRollsByHit(dynamicEvaluation);
        dynamicDamageCache.set(cacheKey, damageRollsByHit);
        return damageRollsByHit;
      }
    : undefined;

  const buildMoveUse = (
    id: string,
    damageRollsByHit: readonly (readonly number[])[],
  ): HpSequenceMoveUse => ({
    id,
    damageRollsByHit,
    automaticHpEffects,
    ...(resolveDamageRollsByHit ? { resolveDamageRollsByHit } : {}),
  });

  if (hit.moveHits !== undefined) {
    return [buildMoveUse(
      `${hit.id}-move-1`,
      initialDamageRollsByHit.slice(0, repeat),
    )];
  }

  return Array.from({ length: repeat }, (_value, index) => buildMoveUse(
    `${hit.id}-move-${index + 1}`,
    initialDamageRollsByHit,
  ));
};

export const moveUseRequiresHpSequence = (
  moveUse: HpSequenceMoveUse,
): boolean => Boolean(
  moveUse.resolveDamageRollsByHit
  || moveUse.automaticHpEffects?.hpCost
  || moveUse.automaticHpEffects?.damageBasedRecoil
  || moveUse.automaticHpEffects?.specialRecoil
  || moveUse.automaticHpEffects?.forcesAttackerFaint
);
