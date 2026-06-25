import pokemonOptionsPayload from "../data/generated/pokemon-options.gen.json";
import itemOptionsPayload from "../data/generated/item-options.gen.json";
import { normalizeSearchText } from "../localization/normalize";

type PokemonOptionEntry = {
  id: string;
  label: string;
  showdownName: string;
  searchText: string;
  artwork?: string;
};

type ItemOptionEntry = {
  megaStone?: {
    baseSpecies: string;
    megaSpecies: string;
  };
};

export type PokemonFormVariantKind = "mega" | "gmax";

export type PokemonFormVariantOption = {
  id: string;
  value: string;
  label: string;
  showdownName: string;
};

const pokemonOptions = pokemonOptionsPayload.entries as PokemonOptionEntry[];
const itemOptions = itemOptionsPayload.entries as ItemOptionEntry[];

const optionByExactKey = new Map<string, PokemonOptionEntry>();
const optionByShowdownName = new Map<string, PokemonOptionEntry>();
const megaBaseByVariantShowdownName = new Map<string, string>();
const megaSearchPrefix = normalizeSearchText("メガ");

const addExactKey = (rawKey: string, option: PokemonOptionEntry) => {
  const key = normalizeSearchText(rawKey);
  if (key && !optionByExactKey.has(key)) {
    optionByExactKey.set(key, option);
  }
};

const getMegaDisplayLabel = (option: PokemonOptionEntry): string | undefined => {
  const labels = [option.label, option.searchText].flatMap((text) => text.split(/\s+/u));
  return labels.find((text) => normalizeSearchText(text).startsWith(megaSearchPrefix));
};

for (const item of itemOptions) {
  if (!item.megaStone) {
    continue;
  }
  megaBaseByVariantShowdownName.set(item.megaStone.megaSpecies, item.megaStone.baseSpecies);
}

for (const option of pokemonOptions) {
  optionByShowdownName.set(option.showdownName, option);
  addExactKey(option.id, option);
  addExactKey(option.label, option);
  addExactKey(option.showdownName, option);
  for (const text of option.searchText.split(/\s+/u)) {
    addExactKey(text, option);
  }
  if (/-Mega(?:-[XY])?$/u.test(option.showdownName)) {
    const megaDisplayLabel = getMegaDisplayLabel(option);
    if (megaDisplayLabel) {
      addExactKey(megaDisplayLabel, option);
    }
  }
}

const getBaseShowdownName = (showdownName: string): string =>
  megaBaseByVariantShowdownName.get(showdownName) ?? showdownName.replace(/-(Mega(?:-[XY])?|Gmax)$/u, "");

const findOption = (input: string): PokemonOptionEntry | undefined =>
  optionByExactKey.get(normalizeSearchText(input));

const getBaseOption = (input: string): PokemonOptionEntry | undefined => {
  const option = findOption(input);
  if (!option) {
    return undefined;
  }
  return optionByShowdownName.get(getBaseShowdownName(option.showdownName)) ?? option;
};

const isVariant = (option: PokemonOptionEntry, kind: PokemonFormVariantKind): boolean => {
  if (kind === "mega") {
    return /-Mega(?:-[XY])?$/u.test(option.showdownName);
  }
  return option.showdownName.endsWith("-Gmax") && Boolean(option.artwork);
};

const toMegaDisplayValue = (option: PokemonOptionEntry): string => {
  return (getMegaDisplayLabel(option) ?? option.label).normalize("NFKC");
};

const toVariantOption = (
  option: PokemonOptionEntry,
  kind: PokemonFormVariantKind,
): PokemonFormVariantOption => ({
  id: option.id,
  value: kind === "mega" ? toMegaDisplayValue(option) : option.label,
  label: option.label,
  showdownName: option.showdownName,
});

export const getPokemonBaseFormValue = (input: string): string | null => {
  const baseOption = getBaseOption(input);
  return baseOption?.label ?? null;
};

export const getPokemonFormVariantOptions = (
  input: string,
  kind: PokemonFormVariantKind,
): PokemonFormVariantOption[] => {
  const baseOption = getBaseOption(input);
  if (!baseOption) {
    return [];
  }

  const baseShowdownName = baseOption.showdownName;
  return pokemonOptions
    .filter((option) => {
      if (kind === "mega") {
        const explicitMegaBase = megaBaseByVariantShowdownName.get(option.showdownName);
        return explicitMegaBase
          ? explicitMegaBase === baseShowdownName
          : getBaseShowdownName(option.showdownName) === baseShowdownName;
      }
      return getBaseShowdownName(option.showdownName) === baseShowdownName;
    })
    .filter((option) => isVariant(option, kind))
    .map((option) => toVariantOption(option, kind));
};

export const isPokemonFormVariant = (input: string, kind: PokemonFormVariantKind): boolean => {
  const option = findOption(input);
  return option ? isVariant(option, kind) : false;
};
