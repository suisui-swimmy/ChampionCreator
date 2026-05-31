import appPackage from "../package.json";
import calcPackage from "@smogon/calc/package.json";
import pokemonOptions from "./data/generated/pokemon-options.gen.json";
import abilityOptions from "./data/generated/ability-options.gen.json";
import itemOptions from "./data/generated/item-options.gen.json";
import moveOptions from "./data/generated/move-options.gen.json";
import natureOptions from "./data/generated/nature-options.gen.json";
import typeOptions from "./data/generated/type-options.gen.json";

export const appVersionInfo = {
  appVersion: appPackage.version,
  smogonCalcVersion: calcPackage.version,
  localizationEntries:
    pokemonOptions.entries.length
    + abilityOptions.entries.length
    + itemOptions.entries.length
    + moveOptions.entries.length
    + natureOptions.entries.length
    + typeOptions.entries.length,
};
