import { isBattleAbilityCanonicalName } from "../domain/allyAbilitySupport";
import { toEntityRef, type AbilityRef, type ScenarioHit } from "../domain/model";
import { resolveEntity } from "../localization/resolver";

/** Arrays retain multiple simultaneous effects from old saves; new selections use one per side. */
export interface BattleAbilitiesForm {
  targetAlly: string[];
  opponentAlly: string[];
}

type BattleAbilitySource = { battleAbilities?: BattleAbilitiesForm; friendGuard: boolean };

export const getBattleAbilities = (form: BattleAbilitySource, kind: string): BattleAbilitiesForm =>
  form.battleAbilities ?? {
    targetAlly: form.friendGuard && kind !== "offense" ? ["Friend Guard"] : [],
    opponentAlly: form.friendGuard && kind === "offense" ? ["Friend Guard"] : [],
  };

export const validateBattleAbilities = (value: unknown): BattleAbilitiesForm => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("場の特性の形式が不正です");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join() !== "opponentAlly,targetAlly") throw new Error("場の特性の項目が不正です");
  const validate = (names: unknown): string[] => {
    if (!Array.isArray(names) || names.length > 14
      || names.some((name) => typeof name !== "string" || !isBattleAbilityCanonicalName(name))
      || new Set(names).size !== names.length) throw new Error("場の特性に未対応または不正な特性があります");
    return [...names];
  };
  return { targetAlly: validate(input.targetAlly), opponentAlly: validate(input.opponentAlly) };
};

export const toBattleAbilityRefs = (
  form: BattleAbilitySource & { gameType: string }, kind: "defence" | "offense",
): Pick<ScenarioHit, "allyAbilities" | "defenderAllyAbilities"> => {
  const value = validateBattleAbilities(getBattleAbilities(form, kind));
  if (form.gameType !== "doubles") return {};
  const refs = (names: string[]): AbilityRef[] => names.map((name) => {
    const ref = toEntityRef(resolveEntity("ability", name), "ability");
    if (!ref) throw new Error("場の特性を解決できません");
    return ref;
  });
  return {
    allyAbilities: refs(kind === "offense" ? value.targetAlly : value.opponentAlly),
    defenderAllyAbilities: refs(kind === "offense" ? value.opponentAlly : value.targetAlly),
  };
};
