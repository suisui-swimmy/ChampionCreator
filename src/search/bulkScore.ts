import { toSmogonPokemon } from "../calc/smogonAdapter";
import type { Build, BulkScore, StatTable } from "../domain/model";

/**
 * Calculates the three defensive comparison scores from final in-game stats.
 *
 * These scores are intentionally only ranking helpers. They do not replace
 * scenario evaluation, which remains responsible for type, move, item,
 * ability, and HP-event mechanics.
 */
export const computeBulkScore = (
  stats: Pick<StatTable, "hp" | "def" | "spd">,
): BulkScore => {
  const defenceTotal = stats.def + stats.spd;
  return {
    physicalBulk: stats.hp * stats.def,
    specialBulk: stats.hp * stats.spd,
    overallBulk: defenceTotal === 0
      ? 0
      : (stats.hp * stats.def * stats.spd) / defenceTotal,
  };
};

/**
 * Returns the actual stats used by @smogon/calc for a build.
 *
 * `Pokemon.stats.hp` is not the authoritative max HP accessor in calc, so H
 * deliberately comes from `maxHP()`. B and D come directly from the
 * calculated stat table and therefore include level, IVs, EVs/SPs, and nature.
 */
export const getBuildDerivedStats = (build: Build): StatTable => {
  const pokemon = toSmogonPokemon(build);
  return {
    ...pokemon.stats,
    hp: pokemon.maxHP(),
  };
};

export const getBuildBulkScore = (build: Build): BulkScore =>
  computeBulkScore(getBuildDerivedStats(build));
