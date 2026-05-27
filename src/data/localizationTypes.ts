export type EntityKind = "pokemon" | "move" | "item" | "ability" | "nature" | "type";

export type SourceStatus = "seed" | "manual" | "fallback" | "needs-confirmation";

export interface LocalizedCatalogEntry {
  kind: EntityKind;
  id: string;
  canonicalName: string;
  displayNameJa: string;
  searchText: string[];
  sourceStatus: SourceStatus;
}

export interface LocalizedCatalogPayload {
  schemaVersion: 1;
  dataVersion: string;
  generatedBy: string;
  source: string;
  entries: LocalizedCatalogEntry[];
}

export interface JaAliasOverrideEntry {
  kind: EntityKind;
  id: string;
  aliasesJa: string[];
  sourceStatus: SourceStatus;
  note?: string;
}

export interface JaAliasOverridePayload {
  schemaVersion: 1;
  dataVersion: string;
  entries: JaAliasOverrideEntry[];
}

export interface JaLabelOverrideEntry {
  kind: EntityKind;
  id: string;
  displayNameJa: string;
  sourceStatus: SourceStatus;
  note?: string;
}

export interface JaLabelOverridePayload {
  schemaVersion: 1;
  dataVersion: string;
  entries: JaLabelOverrideEntry[];
}
