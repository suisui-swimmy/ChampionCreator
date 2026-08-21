import {
  createDefaultBoxExampleEntry,
  DEFAULT_BOX_EXAMPLE_ID,
  type BoxEntry,
} from "../ui/boxStorage";
import type { EnemyBoxEntry } from "../ui/enemyBoxStorage";
import { sha256Hex } from "./firestoreSyncRepository";
import {
  decodeSyncPayload,
  encodeSyncPayload,
} from "./syncPayload";
import {
  createEmptyLocalSyncState,
  makeSyncRecordKey,
  type LocalSyncState,
  type SyncEntry,
  type SyncKind,
  type SyncRecord,
} from "./syncTypes";
import {
  enqueueSyncMutation,
  enqueueSyncTombstone,
} from "./syncOutbox";

/** The four states recorded by the legacy-storage snapshotter. */
export type MigrationDefaultExampleState =
  | "deleted"
  | "untouched"
  | "modified"
  | "uninitialized";

/**
 * Only this four-field view is needed by the pure planner.  The storage
 * reader's richer `LegacyMigrationSnapshot` is structurally compatible, so
 * callers do not have to pass raw strings or storage diagnostics here.
 */
export interface MigrationPlanSnapshot {
  readonly targetEntries: readonly BoxEntry[];
  readonly enemyEntries: readonly EnemyBoxEntry[];
  readonly defaultExampleState: MigrationDefaultExampleState;
  readonly fingerprint: string;
}

export type LegacyMigrationSnapshot = MigrationPlanSnapshot;

export type MigrationDecision = "merge" | "cloud" | "device";

export interface MigrationPlanInput {
  readonly decision: MigrationDecision;
  readonly ownerUid: string;
  readonly snapshot: LegacyMigrationSnapshot;
  /** `remoteRecords` is accepted as a descriptive compatibility alias. */
  readonly remote?: readonly SyncRecord[];
  readonly remoteRecords?: readonly SyncRecord[];
}

export interface MigrationPlanCounts {
  readonly target: number;
  readonly enemy: number;
  readonly total: number;
}

export interface MigrationPlanSummary {
  readonly decision: MigrationDecision;
  readonly snapshotFingerprint: string;
  readonly local: MigrationPlanCounts;
  readonly remote: MigrationPlanCounts;
  readonly final: MigrationPlanCounts;
  readonly localEntryCount: number;
  readonly remoteRecordCount: number;
  readonly finalRecordCount: number;
  readonly activeRecordCount: number;
  readonly tombstoneCount: number;
  readonly upsertCount: number;
  readonly tombstoneMutationCount: number;
  readonly deduplicatedCount: number;
  readonly conflictCopyCount: number;
  readonly remoteOnlyTombstoneCount: number;
  readonly deletedDefaultTombstoneCount: number;
}

export interface MigrationPlanResult {
  readonly state: LocalSyncState;
  readonly summary: MigrationPlanSummary;
}

type ResolvedMigrationPlanInput = Omit<MigrationPlanInput, "remote" | "remoteRecords"> & {
  readonly remote: readonly SyncRecord[];
};

type CanonicalEntry = {
  readonly kind: SyncKind;
  readonly entry: SyncEntry;
  readonly payload: string;
};

type PlanStats = {
  deduplicatedCount: number;
  conflictCopyCount: number;
  remoteOnlyTombstoneCount: number;
  deletedDefaultTombstoneCount: number;
};

/**
 * `enqueueSync*` normally use wall-clock/random metadata.  Migration plans
 * are replayed after an interrupted migration, so both values must instead
 * be stable for the same input.
 */
const MIGRATION_NOW = "1970-01-01T00:00:00.000Z";
const DEVICE_COPY_SUFFIX = "（このブラウザ）";

const isTargetKind = (kind: SyncKind): kind is "target-box" => kind === "target-box";

const compareStrings = (left: string, right: string): number => (
  left < right ? -1 : left > right ? 1 : 0
);

const compareCanonicalEntries = (left: CanonicalEntry, right: CanonicalEntry): number => {
  const keyComparison = compareStrings(
    makeSyncRecordKey(left.kind, left.entry.id),
    makeSyncRecordKey(right.kind, right.entry.id),
  );
  return keyComparison !== 0 ? keyComparison : compareStrings(left.payload, right.payload);
};

const compareRecords = (left: SyncRecord, right: SyncRecord): number => {
  const keyComparison = compareStrings(left.recordKey, right.recordKey);
  if (keyComparison !== 0) {
    return keyComparison;
  }
  if (left.revision !== right.revision) {
    return left.revision - right.revision;
  }
  const mutationComparison = compareStrings(left.mutationId, right.mutationId);
  return mutationComparison !== 0
    ? mutationComparison
    : compareStrings(left.payload, right.payload);
};

const getEntryName = (entry: SyncEntry): string => {
  if (entry.name) {
    return entry.name;
  }
  return "保存スロット";
};

const canonicalizeEntry = (kind: SyncKind, entry: SyncEntry): CanonicalEntry => {
  const encoded = isTargetKind(kind)
    ? encodeSyncPayload("target-box", entry as BoxEntry)
    : encodeSyncPayload("enemy-box", entry as EnemyBoxEntry);
  const decoded = decodeSyncPayload(kind, encoded, entry.id);
  if (decoded.status === "error") {
    throw decoded.error;
  }
  const canonicalPayload = isTargetKind(kind)
    ? encodeSyncPayload("target-box", decoded.entry as BoxEntry)
    : encodeSyncPayload("enemy-box", decoded.entry as EnemyBoxEntry);
  return {
    kind,
    entry: decoded.entry,
    payload: canonicalPayload,
  };
};

const canonicalizeRemoteRecord = (
  ownerUid: string,
  record: SyncRecord,
): SyncRecord => {
  if (record.ownerUid !== ownerUid) {
    throw new Error("移行対象のremote record ownerUidが一致しません");
  }
  const decoded = decodeSyncPayload(record.kind, record.payload, record.entryId);
  if (decoded.status === "error") {
    throw decoded.error;
  }
  const payload = decoded.kind === "target-box"
    ? encodeSyncPayload("target-box", decoded.entry as BoxEntry)
    : encodeSyncPayload("enemy-box", decoded.entry as EnemyBoxEntry);
  return {
    ...record,
    ownerUid,
    recordKey: makeSyncRecordKey(record.kind, record.entryId),
    payload,
  };
};

/**
 * The generated sample's timestamps are intentionally not part of its
 * identity.  The legacy snapshot reader compares the semantic entry fields
 * for the same reason: a freshly seeded sample has a new createdAt value on
 * every browser.  Keep this comparison local to the deletion-intent path so
 * ordinary conflict detection still uses the complete canonical payload.
 */
const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(object[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
};

const defaultEntrySemanticPayload = (entry: BoxEntry): string => stableStringify({
  id: entry.id,
  name: entry.name,
  summary: entry.summary,
  payload: entry.payload,
});

const chooseRemoteRecord = (current: SyncRecord | undefined, candidate: SyncRecord): SyncRecord => {
  if (!current) {
    return candidate;
  }
  return compareRecords(current, candidate) <= 0 ? candidate : current;
};

const seedRemote = (
  ownerUid: string,
  remote: readonly SyncRecord[],
): LocalSyncState => {
  const records: Record<string, SyncRecord> = {};
  for (const rawRecord of [...remote].sort(compareRecords)) {
    const record = canonicalizeRemoteRecord(ownerUid, rawRecord);
    const key = makeSyncRecordKey(record.kind, record.entryId);
    records[key] = chooseRemoteRecord(records[key], record);
  }
  return {
    ...createEmptyLocalSyncState(ownerUid),
    records,
  };
};

const makeMutationId = (
  ownerUid: string,
  fingerprint: string,
  decision: MigrationDecision,
  kind: SyncKind,
  entryId: string,
  action: string,
  payload: string,
): string => `m3-${sha256Hex([
  ownerUid,
  fingerprint,
  decision,
  kind,
  entryId,
  action,
  payload,
].join("\u001f"))}`;

const makeCopyId = (
  kind: SyncKind,
  entryId: string,
  payload: string,
  collisionSalt = "",
): string => (
  `m3-device-${sha256Hex([kind, entryId, payload, collisionSalt].join("\u001f"))}`
);

const makeDeviceCopy = (item: CanonicalEntry, collisionSalt = ""): CanonicalEntry => {
  const copiedEntry = {
    ...item.entry,
    id: makeCopyId(item.kind, item.entry.id, item.payload, collisionSalt),
    name: `${getEntryName(item.entry)}${DEVICE_COPY_SUFFIX}`,
  } as SyncEntry;
  return canonicalizeEntry(item.kind, copiedEntry);
};

const enqueueUpsert = (
  state: LocalSyncState,
  item: CanonicalEntry,
  input: MigrationPlanInput,
): LocalSyncState => {
  const mutationId = makeMutationId(
    input.ownerUid,
    input.snapshot.fingerprint,
    input.decision,
    item.kind,
    item.entry.id,
    "upsert",
    item.payload,
  );
  const result = item.kind === "target-box"
    ? enqueueSyncMutation(state, {
      kind: "target-box",
      entry: item.entry as BoxEntry,
      now: MIGRATION_NOW,
      mutationId,
    })
    : enqueueSyncMutation(state, {
      kind: "enemy-box",
      entry: item.entry as EnemyBoxEntry,
      now: MIGRATION_NOW,
      mutationId,
    });
  if (result.status === "error") {
    throw result.error;
  }
  return result.state;
};

const enqueueTombstone = (
  state: LocalSyncState,
  kind: SyncKind,
  entryId: string,
  input: MigrationPlanInput,
  action: "tombstone" | "remote-only-tombstone" | "deleted-default-tombstone",
): LocalSyncState => {
  const previous = state.records[makeSyncRecordKey(kind, entryId)];
  if (!previous || previous.tombstone) {
    return state;
  }
  const result = enqueueSyncTombstone(state, {
    kind,
    entryId,
    now: MIGRATION_NOW,
    mutationId: makeMutationId(
      input.ownerUid,
      input.snapshot.fingerprint,
      input.decision,
      kind,
      entryId,
      action === "tombstone" ? "tombstone" : action,
      previous.payload,
    ),
  });
  if (result.status === "error") {
    throw result.error;
  }
  return result.state;
};

const collectLocalEntries = (snapshot: LegacyMigrationSnapshot): CanonicalEntry[] => {
  const raw: CanonicalEntry[] = [];
  for (const entry of snapshot.targetEntries) {
    if (entry.id === DEFAULT_BOX_EXAMPLE_ID && snapshot.defaultExampleState !== "modified") {
      continue;
    }
    raw.push(canonicalizeEntry("target-box", entry));
  }
  for (const entry of snapshot.enemyEntries) {
    raw.push(canonicalizeEntry("enemy-box", entry));
  }
  return raw.sort(compareCanonicalEntries);
};

const groupLocalEntries = (
  entries: readonly CanonicalEntry[],
): ReadonlyMap<string, readonly CanonicalEntry[]> => {
  const groups = new Map<string, CanonicalEntry[]>();
  for (const item of entries) {
    const key = makeSyncRecordKey(item.kind, item.entry.id);
    const group = groups.get(key) ?? [];
    if (!group.some((existing) => existing.payload === item.payload)) {
      group.push(item);
      groups.set(key, group);
    }
  }
  return groups;
};

const sameActivePayload = (record: SyncRecord | undefined, item: CanonicalEntry): boolean => (
  !!record
  && !record.tombstone
  && record.payload === item.payload
);

const placeDeviceCopy = (
  initial: LocalSyncState,
  item: CanonicalEntry,
  input: MigrationPlanInput,
  stats: PlanStats,
): LocalSyncState => {
  let collisionSalt = "";
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const copy = makeDeviceCopy(item, collisionSalt);
    const existing = initial.records[makeSyncRecordKey(copy.kind, copy.entry.id)];
    if (!existing) {
      stats.conflictCopyCount += 1;
      return enqueueUpsert(initial, copy, input);
    }
    if (sameActivePayload(existing, copy)) {
      stats.deduplicatedCount += 1;
      return initial;
    }
    // Never overwrite an independently edited deterministic copy on retry.
    // The occupied record becomes part of the next deterministic id so both
    // versions remain addressable.
    collisionSalt = sha256Hex([
      collisionSalt,
      existing.payload,
      existing.mutationId,
      String(existing.revision),
    ].join("\u001f"));
  }
  throw new Error("移行競合コピーの保存先を確保できません");
};

const applyMerge = (
  initial: LocalSyncState,
  localEntries: readonly CanonicalEntry[],
  input: MigrationPlanInput,
  stats: PlanStats,
): LocalSyncState => {
  let state = initial;
  const groups = groupLocalEntries(localEntries);
  for (const [key, group] of [...groups.entries()].sort(([left], [right]) => compareStrings(left, right))) {
    const [first] = group;
    if (!first) {
      continue;
    }
    const remoteRecord = state.records[key];
    if (sameActivePayload(remoteRecord, first)) {
      stats.deduplicatedCount += 1;
      for (const item of group.slice(1)) {
        state = placeDeviceCopy(state, item, input, stats);
      }
      continue;
    }

    if (!remoteRecord) {
      // No cloud version owns this slot, so the first local version can keep
      // the original id.  Later local versions are deterministic copies.
      state = enqueueUpsert(state, first, input);
      for (const item of group.slice(1)) {
        state = placeDeviceCopy(state, item, input, stats);
      }
      continue;
    }

    const matchingIndex = remoteRecord && !remoteRecord.tombstone
      ? group.findIndex((item) => item.payload === remoteRecord.payload)
      : -1;
    if (matchingIndex >= 0) {
      stats.deduplicatedCount += 1;
    }
    for (const [index, item] of group.entries()) {
      if (index === matchingIndex) {
        continue;
      }
      state = placeDeviceCopy(state, item, input, stats);
    }
  }
  return state;
};

const applyDevice = (
  initial: LocalSyncState,
  localEntries: readonly CanonicalEntry[],
  input: MigrationPlanInput,
  stats: PlanStats,
): LocalSyncState => {
  let state = initial;
  const groups = groupLocalEntries(localEntries);
  const localKeys = new Set(groups.keys());
  for (const [key, group] of [...groups.entries()].sort(([left], [right]) => compareStrings(left, right))) {
    const [first] = group;
    if (!first) {
      continue;
    }
    const remoteRecord = state.records[key];
    if (sameActivePayload(remoteRecord, first)) {
      stats.deduplicatedCount += 1;
    } else {
      state = enqueueUpsert(state, first, input);
    }
    for (const item of group.slice(1)) {
      state = placeDeviceCopy(state, item, input, stats);
    }
  }

  for (const record of Object.values(initial.records).sort(compareRecords)) {
    if (record.tombstone || localKeys.has(record.recordKey)) {
      continue;
    }
    if (
      record.kind === "target-box"
      && record.entryId === DEFAULT_BOX_EXAMPLE_ID
    ) {
      continue;
    }
    state = enqueueTombstone(
      state,
      record.kind,
      record.entryId,
      input,
      "remote-only-tombstone",
    );
    stats.remoteOnlyTombstoneCount += 1;
  }
  return state;
};

const applyDeletedDefaultIntent = (
  initial: LocalSyncState,
  input: MigrationPlanInput,
  stats: PlanStats,
): LocalSyncState => {
  if (input.decision === "cloud" || input.snapshot.defaultExampleState !== "deleted") {
    return initial;
  }
  let state = initial;
  const seed = canonicalizeEntry(
    "target-box",
    createDefaultBoxExampleEntry(MIGRATION_NOW),
  );
  const key = makeSyncRecordKey("target-box", DEFAULT_BOX_EXAMPLE_ID);
  const existing = state.records[key];
  if (!existing) {
    state = enqueueUpsert(state, seed, input);
    state = enqueueTombstone(state, "target-box", DEFAULT_BOX_EXAMPLE_ID, input, "deleted-default-tombstone");
    stats.deletedDefaultTombstoneCount += 1;
    return state;
  }
  if (existing.tombstone) {
    return state;
  }
  const decodedExisting = decodeSyncPayload("target-box", existing.payload, DEFAULT_BOX_EXAMPLE_ID);
  if (
    decodedExisting.status === "error"
    || defaultEntrySemanticPayload(decodedExisting.entry) !== defaultEntrySemanticPayload(seed.entry as BoxEntry)
  ) {
    // A changed cloud entry is user data, not the generated sample.  A local
    // deletion must not silently erase it during migration.
    return state;
  }
  state = enqueueTombstone(state, "target-box", DEFAULT_BOX_EXAMPLE_ID, input, "deleted-default-tombstone");
  stats.deletedDefaultTombstoneCount += 1;
  return state;
};

const countRecords = (records: Readonly<Record<string, SyncRecord>>): MigrationPlanCounts => {
  let target = 0;
  let enemy = 0;
  for (const record of Object.values(records)) {
    if (record.kind === "target-box") {
      target += 1;
    } else {
      enemy += 1;
    }
  }
  return { target, enemy, total: target + enemy };
};

const countEntries = (entries: readonly CanonicalEntry[]): MigrationPlanCounts => {
  const target = entries.filter((entry) => entry.kind === "target-box").length;
  const enemy = entries.length - target;
  return { target, enemy, total: entries.length };
};

const buildSummary = (
  input: MigrationPlanInput,
  localEntries: readonly CanonicalEntry[],
  remoteRecords: readonly SyncRecord[],
  state: LocalSyncState,
  stats: PlanStats,
): MigrationPlanSummary => {
  const final = countRecords(state.records);
  const upsertCount = state.outbox.filter((mutation) => !mutation.tombstone).length;
  const tombstoneMutationCount = state.outbox.filter((mutation) => mutation.tombstone).length;
  const tombstoneCount = Object.values(state.records).filter((record) => record.tombstone).length;
  return {
    decision: input.decision,
    snapshotFingerprint: input.snapshot.fingerprint,
    local: countEntries(localEntries),
    remote: countRecords(Object.fromEntries(remoteRecords.map((record) => [record.recordKey, record]))),
    final,
    localEntryCount: localEntries.length,
    remoteRecordCount: remoteRecords.length,
    finalRecordCount: final.total,
    activeRecordCount: final.total - tombstoneCount,
    tombstoneCount,
    upsertCount,
    tombstoneMutationCount,
    deduplicatedCount: stats.deduplicatedCount,
    conflictCopyCount: stats.conflictCopyCount,
    remoteOnlyTombstoneCount: stats.remoteOnlyTombstoneCount,
    deletedDefaultTombstoneCount: stats.deletedDefaultTombstoneCount,
  };
};

const normalizeInput = (
  first: MigrationPlanInput | MigrationDecision | string,
  second?: string | LegacyMigrationSnapshot,
  third?: LegacyMigrationSnapshot | readonly SyncRecord[],
  fourth?: readonly SyncRecord[] | MigrationDecision,
): ResolvedMigrationPlanInput => {
  if (typeof first === "object") {
    const input = first as MigrationPlanInput & { readonly remoteRecords?: readonly SyncRecord[] };
    return {
      decision: input.decision,
      ownerUid: input.ownerUid,
      snapshot: input.snapshot,
      remote: input.remote ?? input.remoteRecords ?? [],
    };
  }
  if (typeof second === "string") {
    return {
      decision: first as MigrationDecision,
      ownerUid: second,
      snapshot: third as LegacyMigrationSnapshot,
      remote: fourth as readonly SyncRecord[],
    };
  }
  return {
    decision: fourth as MigrationDecision,
    ownerUid: first,
    snapshot: second as LegacyMigrationSnapshot,
    remote: third as readonly SyncRecord[],
  };
};

/**
 * Build the one-time migration result.  This function has no Storage,
 * Firestore, clock, or UI dependency; callers persist `state` only after the
 * user has chosen a decision and the coordinator has accepted the result.
 */
export function planLocalMigration(input: MigrationPlanInput): MigrationPlanResult;
export function planLocalMigration(
  decision: MigrationDecision,
  ownerUid: string,
  snapshot: LegacyMigrationSnapshot,
  remote: readonly SyncRecord[],
): MigrationPlanResult;
export function planLocalMigration(
  ownerUid: string,
  snapshot: LegacyMigrationSnapshot,
  remote: readonly SyncRecord[],
  decision: MigrationDecision,
): MigrationPlanResult;
export function planLocalMigration(
  first: MigrationPlanInput | MigrationDecision | string,
  second?: string | LegacyMigrationSnapshot,
  third?: LegacyMigrationSnapshot | readonly SyncRecord[],
  fourth?: readonly SyncRecord[] | MigrationDecision,
): MigrationPlanResult {
  const input = normalizeInput(first, second, third, fourth);
  const localEntries = collectLocalEntries(input.snapshot);
  const seeded = seedRemote(input.ownerUid, input.remote);
  const stats: PlanStats = {
    deduplicatedCount: 0,
    conflictCopyCount: 0,
    remoteOnlyTombstoneCount: 0,
    deletedDefaultTombstoneCount: 0,
  };
  let state = seeded;
  if (input.decision === "merge") {
    state = applyMerge(state, localEntries, input, stats);
  } else if (input.decision === "device") {
    state = applyDevice(state, localEntries, input, stats);
  }
  state = applyDeletedDefaultIntent(state, input, stats);
  return {
    state,
    summary: buildSummary(input, localEntries, input.remote, state, stats),
  };
}

export const createMigrationPlan = planLocalMigration;
export const buildMigrationPlan = planLocalMigration;
