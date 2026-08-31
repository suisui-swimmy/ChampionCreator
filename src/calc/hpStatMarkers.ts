import {
  CHAMPIONS_MAX_STAT_POINTS_PER_STAT,
  statPointsToSmogonEv,
} from "../domain/championsStats";
import {
  hpStatMarkerRules,
  type HpStatMarkerRuleId,
} from "../domain/hpStatMarkerRules";
import type { Build } from "../domain/model";
import { toSmogonPokemon } from "./smogonAdapter";

export type HpStatMarkerCell = {
  sp: number;
  hp: number;
  ruleIds: readonly HpStatMarkerRuleId[];
  isFirstReach: boolean;
};

export type HpStatMarkerRow = ReadonlyArray<HpStatMarkerCell>;

export type HpStatMarkerDisplayCell = {
  matched: boolean;
  boundary: boolean;
};

export type HpStatMarkerDisplayRow = ReadonlyArray<HpStatMarkerDisplayCell>;

const calculateNormalHpAt = (build: Build, hpStatPoints: number): number => {
  const pokemon = toSmogonPokemon({
    ...build,
    statPoints: build.statPoints
      ? { ...build.statPoints, hp: hpStatPoints }
      : undefined,
    evs: {
      ...build.evs,
      hp: statPointsToSmogonEv(hpStatPoints),
    },
  });

  return pokemon.maxHP(true);
};

export const calculateHpStatMarkerRow = (build: Build): HpStatMarkerRow => {
  const cells: HpStatMarkerCell[] = [];
  let previousHp: number | null = null;

  for (let sp = 0; sp <= CHAMPIONS_MAX_STAT_POINTS_PER_STAT; sp += 1) {
    const hp = calculateNormalHpAt(build, sp);
    const isFirstReach = previousHp === null || hp !== previousHp;
    const ruleIds = hp <= 1
      ? []
      : hpStatMarkerRules.filter((rule) => rule.matches(hp)).map((rule) => rule.id);

    cells.push({ sp, hp, ruleIds, isFirstReach });
    previousHp = hp;
  }

  return cells;
};

export const buildHpStatMarkerDisplay = (
  row: HpStatMarkerRow,
  ruleId: HpStatMarkerRuleId,
): HpStatMarkerDisplayRow => {
  const display: HpStatMarkerDisplayCell[] = row.map(() => ({ matched: false, boundary: false }));
  const matchingIndexes = row.flatMap((cell, index) => (
    cell.ruleIds.includes(ruleId) ? [index] : []
  ));

  for (const index of matchingIndexes) {
    if (row[index]?.isFirstReach) {
      display[index] = { matched: true, boundary: true };
    }
  }

  return display;
};
