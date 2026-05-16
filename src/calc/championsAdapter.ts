import type { ChampionsStatPoints, Build, RankStages, StatKey, StatTable } from "../domain/model";
import { validateStatPoints } from "../domain/statPoints";

export type CalcTypeName =
  | "Bug"
  | "Dark"
  | "Dragon"
  | "Electric"
  | "Fairy"
  | "Fighting"
  | "Fire"
  | "Flying"
  | "Ghost"
  | "Grass"
  | "Ground"
  | "Ice"
  | "Normal"
  | "Poison"
  | "Psychic"
  | "Rock"
  | "Steel"
  | "Stellar"
  | "Water"
  | "???";

const UNSET_TEXT_VALUES = new Set(["", "none", "未指定", "任意"]);

const JAPANESE_TYPE_TO_CALC = {
  ノーマル: "Normal",
  ほのお: "Fire",
  みず: "Water",
  でんき: "Electric",
  くさ: "Grass",
  こおり: "Ice",
  かくとう: "Fighting",
  どく: "Poison",
  じめん: "Ground",
  ひこう: "Flying",
  エスパー: "Psychic",
  むし: "Bug",
  いわ: "Rock",
  ゴースト: "Ghost",
  ドラゴン: "Dragon",
  あく: "Dark",
  はがね: "Steel",
  フェアリー: "Fairy",
  ステラ: "Stellar",
} as const;

export const CHAMPIONS_SP_TO_CALC_EV = 8;
export const CALC_EV_LIMIT_PER_STAT = 252;

export interface CalcPokemonOptions {
  level: number;
  nature: string;
  ivs: StatTable;
  evs: StatTable;
  boosts?: Partial<Record<Exclude<StatKey, "hp">, number>>;
  ability?: string;
  item?: string;
  teraType?: CalcTypeName;
}

export const statPointToCalcEv = (statPoint: number): number => {
  if (!Number.isInteger(statPoint) || statPoint < 0) {
    throw new Error(`SP must be a non-negative integer: ${statPoint}`);
  }

  return Math.min(statPoint * CHAMPIONS_SP_TO_CALC_EV, CALC_EV_LIMIT_PER_STAT);
};

export const statPointsToCalcEvs = (points: ChampionsStatPoints): StatTable => {
  const errors = validateStatPoints(points);
  if (errors.length > 0) {
    throw new Error(`Invalid Champions SP: ${errors.join(", ")}`);
  }

  return {
    hp: statPointToCalcEv(points.hp),
    atk: statPointToCalcEv(points.atk),
    def: statPointToCalcEv(points.def),
    spa: statPointToCalcEv(points.spa),
    spd: statPointToCalcEv(points.spd),
    spe: statPointToCalcEv(points.spe),
  };
};

export const normalizeOptionalShowdownName = (value?: string): string | undefined => {
  if (!value || UNSET_TEXT_VALUES.has(value.trim().toLowerCase())) {
    return undefined;
  }

  return value;
};

export const normalizeOptionalCalcType = (value?: string): CalcTypeName | undefined => {
  const normalized = normalizeOptionalShowdownName(value);

  if (!normalized) {
    return undefined;
  }

  return (JAPANESE_TYPE_TO_CALC[normalized as keyof typeof JAPANESE_TYPE_TO_CALC] ??
    normalized) as CalcTypeName;
};

export const rankStagesToCalcBoosts = (
  stages: RankStages = {},
): CalcPokemonOptions["boosts"] => {
  const boosts = {
    atk: stages.atk,
    def: stages.def,
    spa: stages.spa,
    spd: stages.spd,
    spe: stages.spe,
  };

  return Object.fromEntries(
    Object.entries(boosts).filter(([, value]) => value !== undefined),
  ) as CalcPokemonOptions["boosts"];
};

export const buildToCalcPokemonOptions = (
  build: Build,
  stages?: RankStages,
): CalcPokemonOptions => ({
  level: build.level,
  nature: build.nature,
  ivs: build.ivs,
  evs: statPointsToCalcEvs(build.statPoints),
  boosts: rankStagesToCalcBoosts(stages),
  ability: normalizeOptionalShowdownName(build.ability),
  item: normalizeOptionalShowdownName(build.item),
  teraType: normalizeOptionalCalcType(build.teraType),
});
