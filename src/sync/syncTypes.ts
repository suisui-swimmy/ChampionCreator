import type { EnemyBoxEntry } from "../ui/enemyBoxStorage";
import type { BoxEntry } from "../ui/boxStorage";

/**
 * The version of the document exchanged with the future Firestore
 * repository.  This is intentionally separate from the box and share
 * document versions: a box payload may be migrated by its existing parser
 * without changing the sync envelope version.
 */
export const SYNC_SCHEMA_VERSION = 1 as const;
export type SyncSchemaVersion = typeof SYNC_SCHEMA_VERSION;

export const LOCAL_SYNC_STATE_SCHEMA_VERSION = 1 as const;
export type LocalSyncStateSchemaVersion = typeof LOCAL_SYNC_STATE_SCHEMA_VERSION;

export const SYNC_KINDS = ["target-box", "enemy-box"] as const;
export type SyncKind = (typeof SYNC_KINDS)[number];

export const isSyncKind = (value: unknown): value is SyncKind => (
  value === "target-box" || value === "enemy-box"
);

export type SyncEntryForKind<K extends SyncKind> = K extends "target-box"
  ? BoxEntry
  : EnemyBoxEntry;

export type SyncEntry = BoxEntry | EnemyBoxEntry;

/**
 * The document shape exchanged with Firestore by the M2 repository.  The
 * `tombstone` bit and local FIFO sequence remain app-owned metadata; the
 * nullable deletedAt plus retained payload are the server-facing delete
 * representation.
 */
export interface SyncEnvelope {
  readonly ownerUid: string;
  readonly kind: SyncKind;
  readonly schemaVersion: SyncSchemaVersion;
  readonly entryId: string;
  readonly payload: string;
  readonly revision: number;
  readonly baseRevision: number;
  readonly mutationId: string;
  readonly updatedAt: string;
  readonly deletedAt: string | null;
}

export type SyncRecordEnvelope = SyncEnvelope;

export interface SyncRecord {
  readonly ownerUid: string;
  readonly kind: SyncKind;
  readonly entryId: string;
  readonly recordKey: string;
  readonly revision: number;
  readonly baseRevision: number;
  /** The normalized box document string. Tombstones retain this value. */
  readonly payload: string;
  readonly tombstone: boolean;
  readonly deletedAt: string | null;
  /** Local enqueue time until a server timestamp exists. */
  readonly updatedAt: string;
  readonly mutationId: string;
}

export interface SyncMutation extends SyncRecord {
  /** A monotonically increasing local FIFO position. */
  readonly sequence: number;
  readonly queuedAt: string;
  /** The mutation id represented by baseRevision, or null for revision one. */
  readonly baseMutationId: string | null;
}

export interface SyncConflict {
  readonly recordKey: string;
  readonly kind: SyncKind;
  readonly entryId: string;
  readonly local: SyncRecord;
  readonly remote?: SyncRecord;
  readonly detectedAt: string;
  readonly reason?: string;
}

/**
 * Metadata is deliberately extensible so the coordinator can add sync
 * cursors or timestamps without changing the local state container shape.
 */
export interface SyncMetadata {
  readonly [key: string]: unknown;
}

export interface LocalSyncState {
  readonly schemaVersion: LocalSyncStateSchemaVersion;
  readonly ownerUid: string;
  /** Records are keyed by makeSyncRecordKey(kind, entryId). */
  readonly records: Readonly<Record<string, SyncRecord>>;
  /** Mutations are kept in enqueue order. */
  readonly outbox: readonly SyncMutation[];
  /** A key's presence means that normal writes are blocked for that slot. */
  readonly conflicts: Readonly<Record<string, SyncConflict>>;
  readonly metadata: SyncMetadata;
  /** The next sequence to assign to an outbox mutation. */
  readonly nextSequence: number;
}

export const SYNC_STORAGE_KEY_PREFIX = "championcreator.sync.v1";

/**
 * Build a storage key without normalizing or trimming the account id. URI
 * escaping keeps slash, whitespace, and unicode account ids in one slot and
 * prevents them from becoming path-like localStorage keys.
 */
export const makeSyncStorageKey = (ownerUid: string): string => (
  `${SYNC_STORAGE_KEY_PREFIX}.${encodeURIComponent(ownerUid)}`
);

export const createSyncStorageKey = makeSyncStorageKey;
export const getSyncStorageKey = makeSyncStorageKey;

/**
 * A readable slot key is useful in records, conflicts, and Firestore document
 * ids.  The kind prefix keeps a target and enemy entry with the same id in
 * separate slots; the id itself is intentionally not escaped or trimmed.
 */
export const makeSyncRecordKey = (kind: SyncKind, entryId: string): string => (
  `${kind}:${entryId}`
);

export const createSyncRecordKey = makeSyncRecordKey;
export const getSyncRecordKey = makeSyncRecordKey;

export const createDefaultSyncMetadata = (): SyncMetadata => ({});

export const createEmptyLocalSyncState = (ownerUid: string): LocalSyncState => ({
  schemaVersion: LOCAL_SYNC_STATE_SCHEMA_VERSION,
  ownerUid,
  records: {},
  outbox: [],
  conflicts: {},
  metadata: createDefaultSyncMetadata(),
  nextSequence: 1,
});

/**
 * Keep state updates copy-on-write.  This helper is shared by the outbox and
 * repository tests and avoids accidentally retaining mutable nested maps.
 */
export const cloneLocalSyncState = (state: LocalSyncState): LocalSyncState => ({
  schemaVersion: state.schemaVersion,
  ownerUid: state.ownerUid,
  records: Object.fromEntries(
    Object.entries(state.records).map(([key, record]) => [key, { ...record }]),
  ),
  outbox: state.outbox.map((mutation) => ({ ...mutation })),
  conflicts: Object.fromEntries(
    Object.entries(state.conflicts).map(([key, conflict]) => [key, {
      ...conflict,
      local: { ...conflict.local },
      remote: conflict.remote ? { ...conflict.remote } : undefined,
    }]),
  ),
  metadata: { ...state.metadata },
  nextSequence: state.nextSequence,
});
