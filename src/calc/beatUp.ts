import { Generations, toID } from "@smogon/calc";
import type { GameType } from "../domain/model";

const SMOGON_GENERATION = Generations.get(9);

export const BEAT_UP_CANONICAL_NAME = "Beat Up";

export const getBeatUpParticipantLimit = (gameType: GameType): number =>
  gameType === "doubles" ? 4 : 3;

export const calculateBeatUpBasePower = (baseAttack: number): number =>
  5 + Math.floor(Math.max(0, baseAttack) / 10);

export const getBeatUpBasePowerForPokemon = (
  canonicalPokemonName: string,
): number | undefined => {
  const species = SMOGON_GENERATION.species.get(toID(canonicalPokemonName));
  return species
    ? calculateBeatUpBasePower(species.baseStats.atk)
    : undefined;
};
