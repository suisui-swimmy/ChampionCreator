export type EntityKind = "pokemon" | "move" | "item" | "ability" | "nature" | "type";

export type SourceStatus =
  | "supported"
  | "seed"
  | "manual"
  | "fallback"
  | "needs-confirmation"
  | "adapter-temporary"
  | "unsupported-temporary";

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

export type LocalizedOptionKind = `${EntityKind}-options`;

export interface LocalizedOptionEntry {
  id: string;
  label: string;
  showdownName: string;
  searchText: string;
  sourceStatus?: SourceStatus;
  fallback?: {
    from?: string;
    reason?: string;
    nameSourceStatus?: SourceStatus;
    assetSourceStatus?: SourceStatus;
  };
}

export interface LocalizedOptionPayload {
  schemaVersion: 1;
  dataVersion: string;
  generatedBy: string;
  kind: LocalizedOptionKind;
  entries: LocalizedOptionEntry[];
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
