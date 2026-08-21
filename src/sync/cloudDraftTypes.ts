/**
 * The cloud-draft contract is deliberately independent from the box-sync
 * contract in `syncTypes.ts`. A draft is a per-device snapshot of the
 * current work, not a `target-box` or `enemy-box` entry.
 */

export const CLOUD_DRAFT_SCHEMA_VERSION = 1 as const;
export type CloudDraftSchemaVersion = typeof CLOUD_DRAFT_SCHEMA_VERSION;

export const CLOUD_DRAFT_MAX_ACTIVE_RECORDS = 10 as const;
export const CLOUD_DRAFT_MAX_ACTIVE = CLOUD_DRAFT_MAX_ACTIVE_RECORDS;
export const CLOUD_DRAFT_MAX_ACTIVE_COUNT = CLOUD_DRAFT_MAX_ACTIVE_RECORDS;
export const CLOUD_DRAFT_RETENTION_DAYS = 30 as const;
export const CLOUD_DRAFT_RETENTION_MS = CLOUD_DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000;
export const CLOUD_DRAFT_DELIVERY_DELAY_MS = 2000 as const;

// The 750ms device autosave remains owned by ui/draftStorage. These aliases
// describe only the later cloud-delivery eligibility window.
export const CLOUD_DRAFT_DELAY_MS = CLOUD_DRAFT_DELIVERY_DELAY_MS;
export const CLOUD_DRAFT_QUEUE_DELAY_MS = CLOUD_DRAFT_DELIVERY_DELAY_MS;
export const CLOUD_DRAFT_STORAGE_SCHEMA_VERSION = CLOUD_DRAFT_SCHEMA_VERSION;
export const LOCAL_CLOUD_DRAFT_STATE_SCHEMA_VERSION = CLOUD_DRAFT_SCHEMA_VERSION;

export interface CloudDraftEnvelope {
  readonly ownerUid: string;
  readonly deviceId: string;
  readonly deviceLabel: string;
  readonly schemaVersion: CloudDraftSchemaVersion;
  /** Normalized `DraftStorageDocument` JSON. */
  readonly payload: string;
  readonly revision: number;
  readonly baseRevision: number;
  readonly mutationId: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
  /** A non-null value is the retained tombstone timestamp. */
  readonly deletedAt: string | null;
}

/** A server/local record. Tombstones retain their payload. */
export interface CloudDraftRecord extends CloudDraftEnvelope {}

export interface CloudDraftMutation extends CloudDraftRecord {
  /** Monotonically increasing local FIFO position. */
  readonly sequence: number;
  readonly queuedAt: string;
  /** The mutation represented by `baseRevision`, or null for revision one. */
  readonly baseMutationId: string | null;
}

export interface CloudDraftMetadata {
  readonly [key: string]: unknown;
}

export interface CloudDraftLocalState {
  readonly schemaVersion: CloudDraftSchemaVersion;
  readonly ownerUid: string;
  readonly currentDeviceId: string;
  /** Records are keyed by deviceId. */
  readonly records: Readonly<Record<string, CloudDraftRecord>>;
  readonly outbox: readonly CloudDraftMutation[];
  readonly nextSequence: number;
  readonly metadata: CloudDraftMetadata;
}

export const createEmptyCloudDraftLocalState = (
  ownerUid: string,
  currentDeviceId: string,
): CloudDraftLocalState => ({
  schemaVersion: CLOUD_DRAFT_SCHEMA_VERSION,
  ownerUid,
  currentDeviceId,
  records: {},
  outbox: [],
  nextSequence: 1,
  metadata: {},
});

export const makeCloudDraftRecordKey = (deviceId: string): string => deviceId;
export const createCloudDraftRecordKey = makeCloudDraftRecordKey;
export const getCloudDraftRecordKey = makeCloudDraftRecordKey;
