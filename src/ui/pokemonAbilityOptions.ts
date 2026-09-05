import megaAbilityManifestJson from "../data/overrides/mega-ability-manifest.json";
import {
  getPokemonAbilityInputOptions,
  type EntityInputOption,
} from "../localization/resolver";
import { getMegaBasePokemonCanonicalName } from "./pokemonFormVariants";

type MegaAbilityManifestPayload = {
  schemaVersion: 1;
  kind: "mega-ability-manifest";
  dataVersion: string;
  source: {
    authority: string;
    applicableVersion: string;
    checkedAt: string;
    canonicalBasis: string;
    calcBase: string;
  };
  summary: {
    totalForms: number;
    confirmed: number;
    unconfirmed: number;
  };
  entries: Array<{
    showdownName: string;
    status: "confirmed" | "unconfirmed";
    ability: string | null;
  }>;
};

const megaAbilityManifestPayload = (
  megaAbilityManifestJson as MegaAbilityManifestPayload
);
const megaAbilityManifestByCanonicalName = new Map(
  megaAbilityManifestPayload.entries.map((entry) => [entry.showdownName, entry]),
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
 * as a default; the manifest is reviewed when adopting a newer calc commit.
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
  const megaAbilityManifestEntry = isMega
    ? megaAbilityManifestByCanonicalName.get(pokemonCanonicalName)
    : undefined;
  const isUnconfirmedMega = isMega
    && megaAbilityManifestEntry?.status === "unconfirmed";
  const optionOwner = isUnconfirmedMega
    ? preMegaCanonicalName
    : pokemonCanonicalName;
  const options = getPokemonAbilityInputOptions(optionOwner);

  return {
    options,
    isMega,
    isUnconfirmedMega,
    defaultInput: isMega
      && megaAbilityManifestEntry?.status === "confirmed"
      && options?.length === 1
      ? options[0].value
      : undefined,
  };
};
