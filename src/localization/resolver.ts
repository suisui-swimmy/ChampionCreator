import abilityOptionsJson from "../data/generated/ability-options.gen.json";
import itemOptionsJson from "../data/generated/item-options.gen.json";
import catalogJson from "../data/generated/localized-catalog.gen.json";
import moveOptionsJson from "../data/generated/move-options.gen.json";
import natureOptionsJson from "../data/generated/nature-options.gen.json";
import pokemonOptionsJson from "../data/generated/pokemon-options.gen.json";
import typeOptionsJson from "../data/generated/type-options.gen.json";
import aliasOverridesJson from "../data/overrides/ja-aliases.json";
import labelOverridesJson from "../data/overrides/ja-label-overrides.json";
import type {
  EntityKind,
  JaAliasOverridePayload,
  JaLabelOverridePayload,
  LocalizedCatalogEntry,
  LocalizedCatalogPayload,
  LocalizedOptionPayload,
  SourceStatus,
} from "../data/localizationTypes";
import { applyDisplayNameRules } from "./displayNameRules";
import { normalizeSearchText } from "./normalize";

export type ResolveStatus = "exact" | "alias" | "ambiguous" | "not-found";
export type ResolveMatchedBy = "displayNameJa" | "canonicalName" | "id" | "searchText" | "manualAlias";

export interface ResolveCandidate {
  kind: EntityKind;
  canonicalName: string;
  calcId: string;
  displayNameJa: string;
  sourceStatus: SourceStatus;
  matchedBy: ResolveMatchedBy;
  matchText: string;
}

export interface ResolveResult {
  status: ResolveStatus;
  kind: EntityKind;
  input: string;
  canonicalName?: string;
  calcId?: string;
  displayNameJa?: string;
  sourceStatus?: SourceStatus;
  candidates: ResolveCandidate[];
}

export interface EntityInputOption {
  kind: EntityKind;
  value: string;
  canonicalName: string;
  displayNameJa: string;
}

interface SearchEntry {
  entry: LocalizedCatalogEntry;
  matchedBy: ResolveMatchedBy;
  matchText: string;
  sourceStatus?: SourceStatus;
}

const catalog = catalogJson as LocalizedCatalogPayload;
const optionPayloads = [
  pokemonOptionsJson,
  moveOptionsJson,
  itemOptionsJson,
  abilityOptionsJson,
  natureOptionsJson,
  typeOptionsJson,
] as LocalizedOptionPayload[];
const aliasOverrides = aliasOverridesJson as JaAliasOverridePayload;
const labelOverrides = labelOverridesJson as JaLabelOverridePayload;

const labelOverridesByKey = new Map(
  labelOverrides.entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]),
);

const aliasOverridesByKey = new Map(
  aliasOverrides.entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]),
);

const applyLabelOverrides = (entry: LocalizedCatalogEntry): LocalizedCatalogEntry => {
  const override = labelOverridesByKey.get(`${entry.kind}:${entry.id}`);
  if (!override) {
    return entry;
  }

  return {
    ...entry,
    displayNameJa: override.displayNameJa,
    sourceStatus: override.sourceStatus,
  };
};

const withDisplayNameRules = (entry: LocalizedCatalogEntry): LocalizedCatalogEntry => ({
  ...entry,
  displayNameJa: applyDisplayNameRules(entry.kind, entry.canonicalName, entry.displayNameJa),
});

const withLabelOverrides = (entry: LocalizedCatalogEntry): LocalizedCatalogEntry =>
  withDisplayNameRules(applyLabelOverrides(entry));

const splitSearchText = (searchText: string): string[] =>
  searchText
    .split(/\s+/)
    .map((text) => text.trim())
    .filter(Boolean);

const optionKindToEntityKind = (kind: LocalizedOptionPayload["kind"]): EntityKind =>
  kind.replace(/-options$/, "") as EntityKind;

const optionPayloadToEntries = (payload: LocalizedOptionPayload): LocalizedCatalogEntry[] => {
  const kind = optionKindToEntityKind(payload.kind);
  return payload.entries.map((entry) => ({
    kind,
    id: entry.id,
    canonicalName: entry.showdownName,
    displayNameJa: entry.label,
    searchText: splitSearchText(entry.searchText),
    sourceStatus: entry.sourceStatus ?? "supported",
  }));
};

const mergeResolverEntries = (): LocalizedCatalogEntry[] => {
  const byKey = new Map<string, LocalizedCatalogEntry>();

  for (const optionEntry of optionPayloads.flatMap(optionPayloadToEntries)) {
    byKey.set(`${optionEntry.kind}:${optionEntry.id}`, optionEntry);
  }

  for (const catalogEntry of catalog.entries) {
    const key = `${catalogEntry.kind}:${catalogEntry.id}`;
    const existing = byKey.get(key);
    byKey.set(key, {
      ...catalogEntry,
      searchText: Array.from(new Set([...(existing?.searchText ?? []), ...catalogEntry.searchText])),
    });
  }

  return Array.from(byKey.values());
};

const resolverEntries = mergeResolverEntries();

const addIndexValue = (
  index: Map<string, SearchEntry[]>,
  rawText: string,
  value: SearchEntry,
) => {
  const key = normalizeSearchText(rawText);
  if (!key) {
    return;
  }

  const current = index.get(key) ?? [];
  if (!current.some(({ entry }) => entry.kind === value.entry.kind && entry.id === value.entry.id)) {
    current.push(value);
  }
  index.set(key, current);
};

const buildIndex = (entries: LocalizedCatalogEntry[]) => {
  const exactIndex = new Map<string, SearchEntry[]>();
  const aliasIndex = new Map<string, SearchEntry[]>();

  for (const rawEntry of entries) {
    const labeledEntry = applyLabelOverrides(rawEntry);
    const entry = withDisplayNameRules(labeledEntry);

    addIndexValue(exactIndex, entry.displayNameJa, {
      entry,
      matchedBy: "displayNameJa",
      matchText: entry.displayNameJa,
    });
    if (labeledEntry.displayNameJa !== entry.displayNameJa) {
      addIndexValue(aliasIndex, labeledEntry.displayNameJa, {
        entry,
        matchedBy: "searchText",
        matchText: labeledEntry.displayNameJa,
      });
    }
    addIndexValue(exactIndex, entry.canonicalName, {
      entry,
      matchedBy: "canonicalName",
      matchText: entry.canonicalName,
    });
    addIndexValue(exactIndex, entry.id, { entry, matchedBy: "id", matchText: entry.id });

    for (const text of entry.searchText) {
      addIndexValue(aliasIndex, text, { entry, matchedBy: "searchText", matchText: text });
    }

    const aliasOverride = aliasOverridesByKey.get(`${entry.kind}:${entry.id}`);
    for (const alias of aliasOverride?.aliasesJa ?? []) {
      addIndexValue(aliasIndex, alias, {
        entry,
        matchedBy: "manualAlias",
        matchText: alias,
        sourceStatus: aliasOverride?.sourceStatus,
      });
    }
  }

  return { exactIndex, aliasIndex };
};

const entriesByKind = resolverEntries.reduce(
  (groups, entry) => {
    groups[entry.kind].push(entry);
    return groups;
  },
  {
    pokemon: [],
    move: [],
    item: [],
    ability: [],
    nature: [],
    type: [],
  } as Record<EntityKind, LocalizedCatalogEntry[]>,
);

const searchByKind = Object.fromEntries(
  Object.entries(entriesByKind).map(([kind, entries]) => [kind, buildIndex(entries)]),
) as Record<EntityKind, ReturnType<typeof buildIndex>>;

const entityKinds = ["pokemon", "move", "item", "ability", "nature", "type"] as const satisfies readonly EntityKind[];

const addInputOption = (
  optionsByKey: Map<string, EntityInputOption>,
  option: EntityInputOption,
) => {
  const key = normalizeSearchText(option.value);
  if (key && !optionsByKey.has(key)) {
    optionsByKey.set(key, option);
  }
};

const buildInputOptions = (entries: LocalizedCatalogEntry[]): EntityInputOption[] => {
  const optionsByKey = new Map<string, EntityInputOption>();

  for (const entry of entries.map(withLabelOverrides)) {
    addInputOption(optionsByKey, {
      kind: entry.kind,
      value: entry.displayNameJa,
      canonicalName: entry.canonicalName,
      displayNameJa: entry.displayNameJa,
    });
  }

  return Array.from(optionsByKey.values()).sort((a, b) => (
    a.value.localeCompare(b.value, "ja") || a.canonicalName.localeCompare(b.canonicalName, "en")
  ));
};

const inputOptionsByKind = Object.fromEntries(
  entityKinds.map((kind) => [kind, buildInputOptions(entriesByKind[kind])]),
) as Record<EntityKind, EntityInputOption[]>;

const toCandidate = ({ entry, matchedBy, matchText, sourceStatus }: SearchEntry): ResolveCandidate => ({
  kind: entry.kind,
  canonicalName: entry.canonicalName,
  calcId: entry.id,
  displayNameJa: entry.displayNameJa,
  sourceStatus: sourceStatus ?? entry.sourceStatus,
  matchedBy,
  matchText,
});

const resolveMatches = (
  kind: EntityKind,
  input: string,
  status: Exclude<ResolveStatus, "ambiguous" | "not-found">,
  matches: SearchEntry[],
): ResolveResult => {
  const candidates = matches.map(toCandidate);
  if (candidates.length === 1) {
    const [candidate] = candidates;
    return {
      status,
      kind,
      input,
      canonicalName: candidate.canonicalName,
      calcId: candidate.calcId,
      displayNameJa: candidate.displayNameJa,
      sourceStatus: candidate.sourceStatus,
      candidates,
    };
  }

  return {
    status: "ambiguous",
    kind,
    input,
    candidates,
  };
};

export const resolveEntity = (kind: EntityKind, input: string): ResolveResult => {
  const normalizedInput = normalizeSearchText(input);
  if (!normalizedInput) {
    return { status: "not-found", kind, input, candidates: [] };
  }

  const search = searchByKind[kind];
  const exactMatches = search.exactIndex.get(normalizedInput);
  if (exactMatches) {
    return resolveMatches(kind, input, "exact", exactMatches);
  }

  const aliasMatches = search.aliasIndex.get(normalizedInput);
  if (aliasMatches) {
    return resolveMatches(kind, input, "alias", aliasMatches);
  }

  return { status: "not-found", kind, input, candidates: [] };
};

export const getDisplayNameJa = (kind: EntityKind, canonicalName: string): string => {
  const result = resolveEntity(kind, canonicalName);
  return result.displayNameJa ?? canonicalName;
};

export const getEntityInputOptions = (kind: EntityKind): EntityInputOption[] => inputOptionsByKind[kind];

export const getMatchingEntityInputOptions = (
  kind: EntityKind,
  input: string,
  limit = 40,
): EntityInputOption[] => {
  const normalizedInput = normalizeSearchText(input);
  const options = inputOptionsByKind[kind];
  if (!normalizedInput) {
    return options.slice(0, limit);
  }

  return options
    .filter((option) => normalizeSearchText(option.value).startsWith(normalizedInput))
    .slice(0, limit);
};
