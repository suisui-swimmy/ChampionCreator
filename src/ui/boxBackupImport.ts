import type { BoxEntry } from "./boxStorage";
import type { EnemyBoxEntry } from "./enemyBoxStorage";

/**
 * The result of a backup import is previewed before it is committed.  Counts
 * describe the difference between the entries currently in the box and the
 * entries returned by the selected plan.
 */
export interface BackupImportImpactCounts {
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  readonly unchanged: number;
}

export type BackupImportCounts = BackupImportImpactCounts;
export type BackupImportImpact = BackupImportImpactCounts;

export type BackupImportMode = "merge" | "replace";

export interface BackupImportPlan<TEntry> {
  readonly mode: BackupImportMode;
  readonly entries: readonly TEntry[];
  readonly impact: BackupImportImpactCounts;
  /** `counts` is a descriptive alias for callers that render a preview. */
  readonly counts: BackupImportImpactCounts;
  readonly deduplicatedCount: number;
  readonly conflictCopyCount: number;
}

export interface BackupImportPlanSet<TEntry> {
  readonly merge: BackupImportPlan<TEntry>;
  readonly replace: BackupImportPlan<TEntry>;
}

type BackupEntry = BoxEntry | EnemyBoxEntry;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

/**
 * Entry objects are JSON data, but their property insertion order can differ
 * between a browser storage read and a backup import.  A stable key keeps
 * equality deterministic without mutating either input collection.
 */
const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
};

const entryKey = <TEntry extends BackupEntry>(entry: TEntry): string => stableStringify(entry);

const entryContentKey = <TEntry extends BackupEntry>(entry: TEntry): string => {
  const { id: _id, ...content } = entry;
  return stableStringify(content);
};

const createImpact = (
  added: number,
  updated: number,
  removed: number,
  unchanged: number,
): BackupImportImpactCounts => ({
  added: Math.max(0, Math.trunc(added)),
  updated: Math.max(0, Math.trunc(updated)),
  removed: Math.max(0, Math.trunc(removed)),
  unchanged: Math.max(0, Math.trunc(unchanged)),
});

const createPlan = <TEntry extends BackupEntry>(
  mode: BackupImportMode,
  entries: readonly TEntry[],
  impact: BackupImportImpactCounts,
  deduplicatedCount: number,
  conflictCopyCount: number,
): BackupImportPlan<TEntry> => ({
  mode,
  entries,
  impact,
  counts: impact,
  deduplicatedCount: Math.max(0, Math.trunc(deduplicatedCount)),
  conflictCopyCount: Math.max(0, Math.trunc(conflictCopyCount)),
});

const makeUniqueId = (
  sourceId: string,
  occupiedIds: ReadonlySet<string>,
  reservedIds: ReadonlySet<string> = occupiedIds,
): string => {
  const baseId = sourceId || "backup-entry";
  const base = `${baseId}-backup-copy`;
  let candidate = base;
  let suffix = 2;
  while (occupiedIds.has(candidate) || reservedIds.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
};

const withUniqueId = <TEntry extends BackupEntry>(entry: TEntry, id: string): TEntry => ({
  ...entry,
  id,
});

const isGeneratedConflictId = (candidateId: string, sourceId: string): boolean => {
  const base = `${sourceId || "backup-entry"}-backup-copy`;
  return candidateId === base || candidateId.startsWith(`${base}-`);
};

const countReplacementImpact = <TEntry extends BackupEntry>(
  currentEntries: readonly TEntry[],
  replacementEntries: readonly TEntry[],
): BackupImportImpactCounts => {
  const currentById = new Map<string, TEntry>();
  currentEntries.forEach((entry) => {
    if (!currentById.has(entry.id)) {
      currentById.set(entry.id, entry);
    }
  });

  const replacementIds = new Set<string>();
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const entry of replacementEntries) {
    replacementIds.add(entry.id);
    const current = currentById.get(entry.id);
    if (!current) {
      added += 1;
    } else if (entryKey(current) === entryKey(entry)) {
      unchanged += 1;
    } else {
      updated += 1;
    }
  }

  let removed = 0;
  for (const entry of currentEntries) {
    if (!replacementIds.has(entry.id)) {
      removed += 1;
    }
  }

  return createImpact(added, updated, removed, unchanged);
};

/**
 * Plan a merge for one box.  Existing entries are never replaced: an
 * incoming entry with a new id is appended, an exact id/content duplicate is
 * ignored, and a same-id/different-content entry is appended under a stable
 * unique id.  The content-key check makes retrying the same import idempotent
 * even after a conflict copy has already been created.
 */
const planMerge = <TEntry extends BackupEntry>(
  currentEntries: readonly TEntry[],
  importedEntries: readonly TEntry[],
): BackupImportPlan<TEntry> => {
  const entries = [...currentEntries];
  const occupiedIds = new Set(entries.map((entry) => entry.id));
  let deduplicatedCount = 0;
  let conflictCopyCount = 0;

  for (const importedEntry of importedEntries) {
    const importedExactKey = entryKey(importedEntry);
    const sameIdEntry = entries.find((entry) => entry.id === importedEntry.id);

    if (!sameIdEntry) {
      entries.push(importedEntry);
      occupiedIds.add(importedEntry.id);
      continue;
    }

    if (entryKey(sameIdEntry) === importedExactKey) {
      deduplicatedCount += 1;
      continue;
    }

    const contentKey = entryContentKey(importedEntry);
    if (entries.some((entry) => (
      entry.id !== importedEntry.id
      && isGeneratedConflictId(entry.id, importedEntry.id)
      && entryContentKey(entry) === contentKey
    ))) {
      // This is the conflict copy from an earlier attempt at importing the
      // same backup.  Keep the first copy and do not grow the box on retry.
      deduplicatedCount += 1;
      continue;
    }

    const conflictId = makeUniqueId(importedEntry.id, occupiedIds);
    entries.push(withUniqueId(importedEntry, conflictId));
    occupiedIds.add(conflictId);
    conflictCopyCount += 1;
  }

  const impact = createImpact(
    entries.length - currentEntries.length,
    0,
    0,
    currentEntries.length,
  );
  return createPlan("merge", entries, impact, deduplicatedCount, conflictCopyCount);
};

/**
 * Plan a replacement for one box.  The incoming order is retained.  Duplicate
 * incoming entries with identical content are collapsed; entries that repeat
 * an id with different content receive a unique copy id instead of silently
 * overwriting one another.
 */
const planReplace = <TEntry extends BackupEntry>(
  currentEntries: readonly TEntry[],
  importedEntries: readonly TEntry[],
): BackupImportPlan<TEntry> => {
  const entries: TEntry[] = [];
  const occupiedIds = new Set(currentEntries.map((entry) => entry.id));
  const reservedIncomingIds = new Set(importedEntries.map((entry) => entry.id));
  const seenEntryKeys = new Set<string>();
  let deduplicatedCount = 0;
  let conflictCopyCount = 0;

  for (const importedEntry of importedEntries) {
    const importedKey = entryKey(importedEntry);
    if (seenEntryKeys.has(importedKey)) {
      deduplicatedCount += 1;
      continue;
    }
    seenEntryKeys.add(importedKey);

    if (entries.some((entry) => entry.id === importedEntry.id)) {
      // A duplicate id with different content must remain visible.  Reserve
      // all raw incoming ids as well as current ids so a generated copy cannot
      // collide with another real slot or make the impact preview ambiguous.
      const contentKey = entryContentKey(importedEntry);
      const reusableCopy = currentEntries.find((entry) => (
        isGeneratedConflictId(entry.id, importedEntry.id)
        && !reservedIncomingIds.has(entry.id)
        && !entries.some((planned) => planned.id === entry.id)
        && entryContentKey(entry) === contentKey
      ));
      if (reusableCopy) {
        entries.push(withUniqueId(importedEntry, reusableCopy.id));
        occupiedIds.add(reusableCopy.id);
        continue;
      }
      const uniqueId = makeUniqueId(importedEntry.id, occupiedIds, reservedIncomingIds);
      entries.push(withUniqueId(importedEntry, uniqueId));
      occupiedIds.add(uniqueId);
      conflictCopyCount += 1;
      continue;
    }

    entries.push(importedEntry);
    occupiedIds.add(importedEntry.id);
  }

  const impact = countReplacementImpact(currentEntries, entries);
  return createPlan("replace", entries, impact, deduplicatedCount, conflictCopyCount);
};

export const planBoxBackupMerge = (
  currentEntries: readonly BoxEntry[],
  importedEntries: readonly BoxEntry[],
): BackupImportPlan<BoxEntry> => planMerge(currentEntries, importedEntries);

export const planBoxBackupReplace = (
  currentEntries: readonly BoxEntry[],
  importedEntries: readonly BoxEntry[],
): BackupImportPlan<BoxEntry> => planReplace(currentEntries, importedEntries);

export const planEnemyBoxBackupMerge = (
  currentEntries: readonly EnemyBoxEntry[],
  importedEntries: readonly EnemyBoxEntry[],
): BackupImportPlan<EnemyBoxEntry> => planMerge(currentEntries, importedEntries);

export const planEnemyBoxBackupReplace = (
  currentEntries: readonly EnemyBoxEntry[],
  importedEntries: readonly EnemyBoxEntry[],
): BackupImportPlan<EnemyBoxEntry> => planReplace(currentEntries, importedEntries);

export const planBoxBackupImport = (
  currentEntries: readonly BoxEntry[],
  importedEntries: readonly BoxEntry[],
): BackupImportPlanSet<BoxEntry> => ({
  merge: planBoxBackupMerge(currentEntries, importedEntries),
  replace: planBoxBackupReplace(currentEntries, importedEntries),
});

export const planEnemyBoxBackupImport = (
  currentEntries: readonly EnemyBoxEntry[],
  importedEntries: readonly EnemyBoxEntry[],
): BackupImportPlanSet<EnemyBoxEntry> => ({
  merge: planEnemyBoxBackupMerge(currentEntries, importedEntries),
  replace: planEnemyBoxBackupReplace(currentEntries, importedEntries),
});

// Descriptive aliases for callers that use "target" instead of the existing
// box-storage name.  They intentionally keep the target/enemy type boundary.
export const planTargetBoxBackupMerge = planBoxBackupMerge;
export const planTargetBoxBackupReplace = planBoxBackupReplace;
export const planTargetBoxBackupImport = planBoxBackupImport;
export const planTargetBackupMerge = planBoxBackupMerge;
export const planTargetBackupReplace = planBoxBackupReplace;
export const planTargetBackupImport = planBoxBackupImport;
export const planEnemyBackupMerge = planEnemyBoxBackupMerge;
export const planEnemyBackupReplace = planEnemyBoxBackupReplace;
export const planEnemyBackupImport = planEnemyBoxBackupImport;
