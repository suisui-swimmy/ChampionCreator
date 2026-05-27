import catalogJson from "../data/generated/localized-catalog.gen.json";
import aliasOverridesJson from "../data/overrides/ja-aliases.json";
import labelOverridesJson from "../data/overrides/ja-label-overrides.json";
import type {
  EntityKind,
  JaAliasOverridePayload,
  JaLabelOverridePayload,
  LocalizedCatalogEntry,
  LocalizedCatalogPayload,
  SourceStatus,
} from "../data/localizationTypes";
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

interface SearchEntry {
  entry: LocalizedCatalogEntry;
  matchedBy: ResolveMatchedBy;
  matchText: string;
  sourceStatus?: SourceStatus;
}

const catalog = catalogJson as LocalizedCatalogPayload;
const aliasOverrides = aliasOverridesJson as JaAliasOverridePayload;
const labelOverrides = labelOverridesJson as JaLabelOverridePayload;

const labelOverridesByKey = new Map(
  labelOverrides.entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]),
);

const aliasOverridesByKey = new Map(
  aliasOverrides.entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]),
);

const withLabelOverrides = (entry: LocalizedCatalogEntry): LocalizedCatalogEntry => {
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

  for (const entry of entries.map(withLabelOverrides)) {
    addIndexValue(exactIndex, entry.displayNameJa, {
      entry,
      matchedBy: "displayNameJa",
      matchText: entry.displayNameJa,
    });
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

const entriesByKind = catalog.entries.reduce(
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
