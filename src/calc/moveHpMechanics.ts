import type { ScenarioHit } from "../domain/model";
import { toSmogonMove, toSmogonPokemon } from "./smogonAdapter";

export type MoveHpCostKind =
  | "belly-drum"
  | "substitute"
  | "ghost-curse"
  | "clangorous-soul"
  | "shed-tail"
  | "fillet-away";

export interface MoveHpCostProfile {
  kind: MoveHpCostKind;
  label: string;
  formulaLabel: string;
  amount: (maxHp: number) => number;
  canPay: (currentHp: number, maxHp: number) => boolean;
}

export interface DamageBasedRecoilProfile {
  numerator: number;
  denominator: number;
}

export interface SpecialRecoilProfile {
  kind: "struggle" | "mind-blown";
}

export interface MoveHpMechanicsProfile {
  canonicalName: string;
  makesContact: boolean;
  damageBasedRecoil?: DamageBasedRecoilProfile;
  specialRecoil?: SpecialRecoilProfile;
  hpCost?: MoveHpCostProfile;
  usesCurrentHpDamage: boolean;
  currentHpDependency?: "attacker" | "defender";
  currentHpFormulaLabel?: string;
  forcesAttackerFaint: boolean;
}

interface HpCostDefinition {
  kind: MoveHpCostKind;
  label: string;
  formulaLabel: string;
  amount: (maxHp: number) => number;
}

const floorMin1 = (value: number): number => Math.max(1, Math.floor(value));

const hpCostDefinitions: Partial<Record<string, HpCostDefinition>> = {
  "Belly Drum": {
    kind: "belly-drum",
    label: "はらだいこ",
    formulaLabel: "最大HPの1/2（切り捨て・最低1）",
    amount: (maxHp) => floorMin1(maxHp / 2),
  },
  Substitute: {
    kind: "substitute",
    label: "みがわり",
    formulaLabel: "最大HPの1/4（切り捨て・最低1）",
    amount: (maxHp) => floorMin1(maxHp / 4),
  },
  Curse: {
    kind: "ghost-curse",
    label: "のろい（ゴースト）",
    formulaLabel: "最大HPの1/2（切り捨て・最低1）",
    amount: (maxHp) => floorMin1(maxHp / 2),
  },
  "Clangorous Soul": {
    kind: "clangorous-soul",
    label: "ソウルビート",
    formulaLabel: "最大HPの33/100（切り捨て・最低1）",
    amount: (maxHp) => floorMin1((maxHp * 33) / 100),
  },
  "Shed Tail": {
    kind: "shed-tail",
    label: "しっぽきり",
    formulaLabel: "最大HPの1/2（切り上げ）",
    amount: (maxHp) => Math.max(1, Math.ceil(maxHp / 2)),
  },
  "Fillet Away": {
    kind: "fillet-away",
    label: "みをけずる",
    formulaLabel: "最大HPの1/2（切り捨て・最低1）",
    amount: (maxHp) => floorMin1(maxHp / 2),
  },
};

const currentHpDamageProfiles: Partial<
  Record<
    string,
    {
      dependency: "attacker" | "defender";
      formulaLabel: string;
    }
  >
> = {
  "Super Fang": {
    dependency: "defender",
    formulaLabel: "相手の現在HPの1/2（切り捨て・最低1）",
  },
  "Nature's Madness": {
    dependency: "defender",
    formulaLabel: "相手の現在HPの1/2（切り捨て・最低1）",
  },
  Ruination: {
    dependency: "defender",
    formulaLabel: "相手の現在HPの1/2（切り捨て・最低1）",
  },
  "Guardian of Alola": {
    dependency: "defender",
    formulaLabel: "相手の現在HPの3/4（切り捨て・最低1）",
  },
  "Final Gambit": {
    dependency: "attacker",
    formulaLabel: "使用者の現在HP",
  },
  Eruption: {
    dependency: "attacker",
    formulaLabel: "使用者の現在HP割合で威力変動",
  },
  "Water Spout": {
    dependency: "attacker",
    formulaLabel: "使用者の現在HP割合で威力変動",
  },
  "Dragon Energy": {
    dependency: "attacker",
    formulaLabel: "使用者の現在HP割合で威力変動",
  },
  Flail: {
    dependency: "attacker",
    formulaLabel: "使用者の現在HP割合で威力変動",
  },
  Reversal: {
    dependency: "attacker",
    formulaLabel: "使用者の現在HP割合で威力変動",
  },
  "Hard Press": {
    dependency: "defender",
    formulaLabel: "相手の現在HP割合で威力変動",
  },
  "Crush Grip": {
    dependency: "defender",
    formulaLabel: "相手の現在HP割合で威力変動",
  },
  "Wring Out": {
    dependency: "defender",
    formulaLabel: "相手の現在HP割合で威力変動",
  },
  Brine: {
    dependency: "defender",
    formulaLabel: "相手の現在HPが半分以下なら威力2倍",
  },
};

const getHpCostProfile = (
  hit: ScenarioHit,
  canonicalName: string,
): MoveHpCostProfile | undefined => {
  const definition = hpCostDefinitions[canonicalName];
  if (!definition) {
    return undefined;
  }

  if (
    definition.kind === "ghost-curse" &&
    !toSmogonPokemon(hit.attacker).hasType("Ghost")
  ) {
    return undefined;
  }

  return {
    ...definition,
    canPay: (currentHp, maxHp) => currentHp > definition.amount(maxHp),
  };
};

export const getMoveHpMechanicsProfile = (
  hit: ScenarioHit,
): MoveHpMechanicsProfile => {
  const move = toSmogonMove(hit);
  const canonicalName = move.name;
  const attackerAbility = hit.attacker.ability?.canonicalName;
  const attackerItem = hit.attacker.item?.canonicalName;
  const contactIsSuppressed =
    attackerAbility === "Long Reach" ||
    attackerItem === "Protective Pads" ||
    (attackerItem === "Punching Glove" && Boolean(move.flags.punch));
  const currentHpDamageProfile = currentHpDamageProfiles[canonicalName];

  return {
    canonicalName,
    makesContact: Boolean(move.flags.contact) && !contactIsSuppressed,
    damageBasedRecoil: move.recoil
      ? {
          numerator: move.recoil[0],
          denominator: move.recoil[1],
        }
      : undefined,
    specialRecoil: move.struggleRecoil
      ? { kind: "struggle" }
      : move.mindBlownRecoil
        ? { kind: "mind-blown" }
        : undefined,
    hpCost: getHpCostProfile(hit, canonicalName),
    usesCurrentHpDamage: Boolean(currentHpDamageProfile),
    currentHpDependency: currentHpDamageProfile?.dependency,
    currentHpFormulaLabel: currentHpDamageProfile?.formulaLabel,
    forcesAttackerFaint: canonicalName === "Final Gambit",
  };
};
