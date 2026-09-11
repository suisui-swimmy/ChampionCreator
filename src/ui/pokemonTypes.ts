import pokemonOptions from "../data/generated/pokemon-options.gen.json";
import { toEntityRef, type PokemonTypeOverride } from "../domain/model";
import { getEntityInputOptions, resolveEntity, resolveEntityWithCanonicalHint } from "../localization/resolver";

export type PokemonTypeOverrideForm = {
  type1Input: string;
  type2Input: string;
  addedTypeInput: string;
};

export const pokemonTypeOptions = getEntityInputOptions("type").filter((option) => option.canonicalName !== "Stellar");
export const addedPokemonTypeOptions = pokemonTypeOptions.filter((option) => ["Ghost", "Grass"].includes(option.canonicalName));
const normalTypeNames = new Set(pokemonTypeOptions.map((option) => option.canonicalName));
const typesByPokemon = new Map(pokemonOptions.entries.map((option) => [option.showdownName, option.types]));

export const isTypelessPokemon = (input: string, canonicalName?: string): boolean => {
  const resolved = resolveEntityWithCanonicalHint("pokemon", input, canonicalName);
  return (resolved.status === "exact" || resolved.status === "alias")
    && typesByPokemon.get(resolved.canonicalName!)?.length === 0;
};

export const getPokemonBaseTypes = (input: string, canonicalName?: string): string[] => {
  const resolved = resolveEntityWithCanonicalHint("pokemon", input, canonicalName);
  if (resolved.status !== "exact" && resolved.status !== "alias") return [];
  return (typesByPokemon.get(resolved.canonicalName!) ?? []).filter((type) => normalTypeNames.has(type));
};

export const getPokemonTypeLabel = (canonicalName: string): string =>
  pokemonTypeOptions.find((option) => option.canonicalName === canonicalName)?.displayNameJa ?? "未解決";

export const getPokemonTypeSelectionValue = (input: string): string => {
  const resolved = resolveEntity("type", input);
  return pokemonTypeOptions.find((option) => option.canonicalName === resolved.canonicalName)?.value ?? input;
};

export const resolvePokemonTypeOverride = (form: PokemonTypeOverrideForm | undefined): PokemonTypeOverride | undefined => {
  if (form === undefined) return undefined;
  const resolveType = (input: string) => {
    const ref = toEntityRef(resolveEntity("type", input), "type");
    if (!ref || !normalTypeNames.has(ref.canonicalName)) throw new Error(`通常タイプ「${input}」を解決できません`);
    return ref;
  };
  const first = resolveType(form.type1Input);
  const second = form.type2Input ? resolveType(form.type2Input) : undefined;
  const addedType = form.addedTypeInput ? resolveType(form.addedTypeInput) : undefined;
  if (addedType && !["Ghost", "Grass"].includes(addedType.canonicalName)) {
    throw new Error("追加タイプは、なし・くさ・ゴーストから選択してください");
  }
  const names = [first, second, addedType].filter((type) => type !== undefined).map((type) => type.canonicalName);
  if (new Set(names).size !== names.length) throw new Error("通常タイプと追加タイプが重複しています");
  return { types: second ? [first, second] : [first], ...(addedType ? { addedType } : {}) };
};

export const createPokemonTypeOverride = (input: string, canonicalName?: string): PokemonTypeOverrideForm | undefined => {
  const types = getPokemonBaseTypes(input, canonicalName);
  if (!types.length) return undefined;
  return {
    type1Input: getPokemonTypeLabel(types[0]),
    type2Input: types[1] ? getPokemonTypeLabel(types[1]) : "",
    addedTypeInput: "",
  };
};

export const updatePokemonTypeOverride = (
  current: PokemonTypeOverrideForm,
  field: keyof PokemonTypeOverrideForm,
  value: string,
): PokemonTypeOverrideForm => {
  const next = { ...current, [field]: value };
  const name = (input: string) => input ? resolveEntity("type", input).canonicalName : undefined;
  if (next.type2Input && name(next.type1Input) === name(next.type2Input)) next.type2Input = "";
  if (next.addedTypeInput && [name(next.type1Input), name(next.type2Input)].includes(name(next.addedTypeInput))) next.addedTypeInput = "";
  resolvePokemonTypeOverride(next);
  return next;
};
