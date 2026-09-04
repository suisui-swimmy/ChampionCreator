import unconfirmedMegaAbilitiesJson from "../data/overrides/unconfirmed-mega-abilities.json";
import {
  getPokemonAbilityInputOptions,
  type EntityInputOption,
} from "../localization/resolver";
import { getMegaBasePokemonCanonicalName } from "./pokemonFormVariants";

type UnconfirmedMegaAbilitiesPayload = {
  schemaVersion: 1;
  kind: "unconfirmed-mega-abilities";
  entries: string[];
};

const unconfirmedMegaAbilitiesPayload = (
  unconfirmedMegaAbilitiesJson as UnconfirmedMegaAbilitiesPayload
);
const unconfirmedMegaAbilityCanonicalNames = new Set(
  unconfirmedMegaAbilitiesPayload.entries,
);

export type PokemonAbilityInputPlan = {
  options: EntityInputOption[] | undefined;
  isMega: boolean;
  isUnconfirmedMega: boolean;
  defaultInput?: string;
};

/**
 * Known Mega forms have one fixed post-Mega ability. Forms explicitly marked
 * as unconfirmed keep the pre-Mega dropdown without treating calc placeholders
 * as a default; the override is reviewed when adopting a newer calc commit.
 */
export const getPokemonAbilityInputPlan = (
  pokemonCanonicalName: string | undefined,
): PokemonAbilityInputPlan => {
  if (!pokemonCanonicalName) {
    return {
      options: undefined,
      isMega: false,
      isUnconfirmedMega: false,
    };
  }

  const preMegaCanonicalName = getMegaBasePokemonCanonicalName(pokemonCanonicalName);
  const isMega = preMegaCanonicalName !== null;
  const isUnconfirmedMega = isMega
    && unconfirmedMegaAbilityCanonicalNames.has(pokemonCanonicalName);
  const optionOwner = isUnconfirmedMega
    ? preMegaCanonicalName
    : pokemonCanonicalName;
  const options = getPokemonAbilityInputOptions(optionOwner);

  return {
    options,
    isMega,
    isUnconfirmedMega,
    defaultInput: isMega && !isUnconfirmedMega && options?.length === 1
      ? options[0].value
      : undefined,
  };
};
