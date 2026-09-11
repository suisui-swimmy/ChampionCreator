import type { State } from "@smogon/calc";
import debugPokemon from "../data/overrides/debug-pokemon.json";

/** Synthetic species metadata only; all mechanics remain inside Calc. */
export const getDebugPokemonSpecies = (canonicalName: string): State.Pokemon["overrides"] | undefined =>
  canonicalName === debugPokemon.canonicalName
    ? debugPokemon.species as State.Pokemon["overrides"]
    : undefined;
