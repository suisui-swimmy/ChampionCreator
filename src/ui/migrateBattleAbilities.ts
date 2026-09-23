import { isLegacyAllyAbilityCanonicalName } from "../domain/allyAbilitySupport";
import { toEntityRef } from "../domain/model";
import { resolveEntity } from "../localization/resolver";
import type { ScenarioFormState } from "./defenceSearchUi";
import { getBattleAbilities } from "./battleAbilities";

/** Snapshot schema <=15's neighbor inference once, before retiring support-only cards. */
export const migrateBattleAbilities = (scenario: ScenarioFormState): ScenarioFormState => {
  const abilityNames = scenario.attacks.map((attack) =>
    toEntityRef(resolveEntity("ability", attack.attackerAbilityInput), "ability")?.canonicalName);
  if (scenario.adjustmentType === "defence") {
    scenario.attacks.forEach((source, index) => {
      // The old resolver rejected unknown ally inputs. Do not turn that blocked
      // condition into a passing attack by silently dropping the unknown effect.
      if (source.attackerAbilityInput.trim() && !abilityNames[index]
        && scenario.attacks.some((attack) => attack.id !== source.id && attack.gameType === "doubles" && attack.moveInput.trim())) {
        throw new Error(`旧条件の味方特性「${source.attackerAbilityInput}」が未解決です（${scenario.label} / ${source.label}）`);
      }
    });
  }
  const attacks = scenario.attacks.map((attack) => {
    const battleAbilities = getBattleAbilities({ friendGuard: attack.friendGuard }, scenario.adjustmentType);
    if (scenario.adjustmentType === "defence") {
      battleAbilities.opponentAlly = [...new Set(abilityNames.filter((name, index): name is NonNullable<typeof name> =>
        scenario.attacks[index].id !== attack.id && isLegacyAllyAbilityCanonicalName(name)))];
    }
    return { ...attack, friendGuard: false, ...(battleAbilities.targetAlly.length || battleAbilities.opponentAlly.length
      ? { battleAbilities } : {}) };
  });
  const regularAttacks = attacks.filter((attack, index) => scenario.adjustmentType !== "defence"
    || attack.moveInput.trim() || !isLegacyAllyAbilityCanonicalName(abilityNames[index]));
  return { ...scenario, attacks: regularAttacks.length ? regularAttacks : attacks };
};
