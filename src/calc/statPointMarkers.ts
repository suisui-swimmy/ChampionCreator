import { Generations, toID } from "@smogon/calc";
import {
  CHAMPIONS_MAX_STAT_POINTS_PER_STAT,
  statPointTableToSmogonEvs,
} from "../domain/championsStats";
import type { Build, StatKey, StatTable } from "../domain/model";
import { toSmogonPokemon } from "./smogonAdapter";

const SMOGON_GENERATION = Generations.get(9);

const nonHpStatKeys = ["atk", "def", "spa", "spd", "spe"] as const satisfies readonly StatKey[];

export type StatPointMarker = "red" | "blue";
export type StatPointMarkerRow = ReadonlyArray<StatPointMarker | null>;
export type StatPointMarkerTable = StatTable<StatPointMarkerRow>;

type NatureDirection = "up" | "down" | null;
type MutableStatPointMarkerTable = StatTable<Array<StatPointMarker | null>>;

const createUniformStatPointTable = (statPoints: number): StatTable => ({
  hp: statPoints,
  atk: statPoints,
  def: statPoints,
  spa: statPoints,
  spd: statPoints,
  spe: statPoints,
});

const createEmptyMarkerRow = (): Array<StatPointMarker | null> => (
  Array.from({ length: CHAMPIONS_MAX_STAT_POINTS_PER_STAT + 1 }, () => null)
);

const createEmptyMarkerTable = (): MutableStatPointMarkerTable => ({
  hp: createEmptyMarkerRow(),
  atk: createEmptyMarkerRow(),
  def: createEmptyMarkerRow(),
  spa: createEmptyMarkerRow(),
  spd: createEmptyMarkerRow(),
  spe: createEmptyMarkerRow(),
});

const getNatureDirections = (build: Build): StatTable<NatureDirection> => {
  const directions: StatTable<NatureDirection> = {
    hp: null,
    atk: null,
    def: null,
    spa: null,
    spd: null,
    spe: null,
  };
  const nature = build.nature
    ? SMOGON_GENERATION.natures.get(toID(build.nature.canonicalName))
    : undefined;

  if (!nature || nature.plus === nature.minus) {
    return directions;
  }

  if (nature.plus) {
    directions[nature.plus] = "up";
  }
  if (nature.minus) {
    directions[nature.minus] = "down";
  }
  return directions;
};

const getActualStatsAt = (
  build: Build,
  statPoints: number,
  includeNature: boolean,
): StatTable => {
  const statPointTable = createUniformStatPointTable(statPoints);
  const pokemon = toSmogonPokemon({
    ...build,
    nature: includeNature ? build.nature : undefined,
    statPoints: statPointTable,
    evs: statPointTableToSmogonEvs(statPointTable),
  });

  return { ...pokemon.stats, hp: pokemon.maxHP() };
};

export const calculateStatPointMarkerTable = (build: Build): StatPointMarkerTable => {
  const markers = createEmptyMarkerTable();
  const directions = getNatureDirections(build);
  let previousNeutralStats = getActualStatsAt(build, 0, false);
  let previousNatureStats = getActualStatsAt(build, 0, true);

  for (let statPoints = 1; statPoints <= CHAMPIONS_MAX_STAT_POINTS_PER_STAT; statPoints += 1) {
    const currentNeutralStats = getActualStatsAt(build, statPoints, false);
    const currentNatureStats = getActualStatsAt(build, statPoints, true);

    for (const stat of nonHpStatKeys) {
      const neutralGain = currentNeutralStats[stat] - previousNeutralStats[stat];
      const natureGain = currentNatureStats[stat] - previousNatureStats[stat];

      if (directions[stat] === "up" && natureGain > neutralGain) {
        markers[stat][statPoints] = "red";
      } else if (directions[stat] === "down" && natureGain < neutralGain) {
        markers[stat][statPoints] = "blue";
      }
    }

    previousNeutralStats = currentNeutralStats;
    previousNatureStats = currentNatureStats;
  }

  return markers;
};
