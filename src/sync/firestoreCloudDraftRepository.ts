import {
  collection as firebaseCollection,
  doc as firebaseDoc,
  getDocsFromServer as firebaseGetDocsFromServer,
  runTransaction as firebaseRunTransaction,
  serverTimestamp as firebaseServerTimestamp,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from "firebase/firestore";
import {
  parseDraftStorageDocument,
  stringifyDraftStorageDocument,
  type DraftStorageDocument,
} from "../ui/draftStorage";
import {
  CLOUD_DRAFT_RETENTION_MS,
  CLOUD_DRAFT_SCHEMA_VERSION,
  type CloudDraftMutation,
  type CloudDraftRecord,
} from "./cloudDraftTypes";
import {
  sanitizeFirestoreError,
  type FirestoreDocumentReferenceLike,
  type FirestoreDocumentSnapshotLike,
  type SyncRepositoryError,
  type SyncRepositoryErrorKind,
} from "./firestoreSyncRepository";

/** Keep draft ids and labels comfortably below Firestore's path/string limits. */
export const CLOUD_DRAFT_DEVICE_ID_MAX_BYTES = 128;
export const CLOUD_DRAFT_DEVICE_LABEL_MAX_BYTES = 200;
export const CLOUD_DRAFT_MUTATION_ID_MAX_BYTES = 128;
export const CLOUD_DRAFT_PAYLOAD_MAX_BYTES = 200_000;

const DRAFT_COLLECTION_NAME = "drafts";

const CLOUD_DRAFT_FIELD_NAMES = [
  "ownerUid",
  "deviceId",
  "deviceLabel",
  "schemaVersion",
  "payload",
  "revision",
  "baseRevision",
  "mutationId",
  "updatedAt",
  "expiresAt",
  "deletedAt",
] as const;

/**
 * The small Firebase surface used by this adapter. Keeping it injectable is
 * useful for unit tests and keeps the repository independent from a Firebase
 * app singleton.
 */
export interface FirestoreCloudDraftDependencies {
  readonly collection: (firestore: unknown, path: string) => unknown;
  readonly doc: (collection: unknown, documentId: string) => FirestoreDocumentReferenceLike;
  readonly getDocsFromServer: (collection: unknown) => Promise<FirestoreQuerySnapshotLike>;
  readonly runTransaction: (
    firestore: unknown,
    updateFunction: (transaction: FirestoreCloudDraftTransactionLike) => Promise<unknown>,
  ) => Promise<unknown>;
  readonly serverTimestamp: () => unknown;
  /** Convert a client expiry date to a Firestore-compatible timestamp value. */
  readonly timestampFromDate?: (date: Date) => unknown;
}

export interface FirestoreQuerySnapshotLike {
  readonly docs: readonly FirestoreDocumentSnapshotLike[];
  readonly size?: number;
}

export interface FirestoreCloudDraftTransactionLike {
  get(reference: FirestoreDocumentReferenceLike): Promise<FirestoreDocumentSnapshotLike>;
  set(reference: FirestoreDocumentReferenceLike, data: Record<string, unknown>): unknown;
}

const defaultDependencies: FirestoreCloudDraftDependencies = {
  collection: (firestore, path) => (
    firebaseCollection(firestore as Firestore, path) as CollectionReference<DocumentData>
  ),
  doc: (collectionReference, documentId) => (
    firebaseDoc(
      collectionReference as CollectionReference<DocumentData>,
      documentId,
    ) as DocumentReference<DocumentData>
  ),
  getDocsFromServer: async (collectionReference) => (
    await firebaseGetDocsFromServer(
      collectionReference as CollectionReference<DocumentData>,
    ) as unknown as FirestoreQuerySnapshotLike
  ),
  runTransaction: async (firestore, updateFunction) => (
    await firebaseRunTransaction(
      firestore as Firestore,
      updateFunction as unknown as (transaction: Transaction) => Promise<unknown>,
    )
  ),
  serverTimestamp: () => firebaseServerTimestamp(),
};

export interface FirestoreCloudDraftGateway {
  readonly firestore: unknown;
  readonly uid: string;
}

export interface CreateFirestoreCloudDraftRepositoryOptions {
  readonly firestore?: unknown;
  readonly uid?: string;
  readonly ownerUid?: string;
  readonly gateway?: FirestoreCloudDraftGateway;
  readonly client?: { readonly firestore?: unknown };
  readonly dependencies?: Partial<FirestoreCloudDraftDependencies>;
  /** Alias accepted by callers that call the injected SDK surface `sdk`. */
  readonly sdk?: Partial<FirestoreCloudDraftDependencies>;
}

export type CloudDraftRepositoryErrorKind = SyncRepositoryErrorKind;
export type CloudDraftRepositoryError = SyncRepositoryError;

export type CloudDraftRepositoryIssueCode =
  | "invalid-document"
  | "future-envelope-schema"
  | "future-payload-schema"
  | "invalid-payload"
  | "canonical-document-id-mismatch"
  | "mutation-id-reuse"
  | "base-revision-mismatch"
  | "invalid-mutation";

export interface CloudDraftRepositoryIssue {
  readonly code: CloudDraftRepositoryIssueCode;
  readonly reason: CloudDraftRepositoryIssueCode;
  readonly type: CloudDraftRepositoryIssueCode;
  readonly message: string;
  readonly documentId?: string;
  readonly deviceId?: string;
  readonly expectedRevision?: number;
  readonly actualRevision?: number;
}

/** A local mutation may omit server-populated updatedAt and revision fields. */
export interface CloudDraftWriteInput {
  readonly ownerUid?: string;
  readonly deviceId: string;
  readonly deviceLabel: string;
  readonly schemaVersion?: typeof CLOUD_DRAFT_SCHEMA_VERSION;
  readonly payload: string;
  readonly revision?: number;
  readonly baseRevision?: number;
  readonly mutationId: string;
  readonly updatedAt?: string | Date;
  readonly expiresAt: string | Date;
  readonly deletedAt?: string | Date | null;
  /** Convenience input for callers that model deletes explicitly. */
  readonly tombstone?: boolean;
}

export type CloudDraftRecordInput = CloudDraftRecord | CloudDraftMutation | CloudDraftWriteInput;

export interface CloudDraftReadResult {
  readonly status: "success" | "empty" | "error";
  readonly drafts: readonly CloudDraftRecord[];
  /** Alias for generic coordinators that call records rather than drafts. */
  readonly records: readonly CloudDraftRecord[];
  readonly issues: readonly CloudDraftRepositoryIssue[];
  readonly error?: CloudDraftRepositoryError;
}

export interface CloudDraftWriteResult {
  readonly status: "written" | "duplicate" | "conflict" | "invalid" | "error";
  readonly draft?: CloudDraftRecord;
  readonly record?: CloudDraftRecord;
  readonly remote?: CloudDraftRecord;
  readonly issue?: CloudDraftRepositoryIssue;
  readonly issues: readonly CloudDraftRepositoryIssue[];
  readonly error?: CloudDraftRepositoryError;
}

export interface CloudDraftRepository {
  readonly readAll: () => Promise<CloudDraftReadResult>;
  readonly write: (input: CloudDraftRecordInput) => Promise<CloudDraftWriteResult>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const isInteger = (value: unknown): value is number => (
  typeof value === "number" && Number.isInteger(value)
);

const isNonNegativeInteger = (value: unknown): value is number => (
  isInteger(value) && value >= 0
);

const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

const hasExactFields = (value: Record<string, unknown>): boolean => {
  const keys = Object.keys(value);
  return keys.length === CLOUD_DRAFT_FIELD_NAMES.length
    && CLOUD_DRAFT_FIELD_NAMES.every((field) => Object.prototype.hasOwnProperty.call(value, field));
};

const issue = (
  code: CloudDraftRepositoryIssueCode,
  message: string,
  details: Omit<CloudDraftRepositoryIssue, "code" | "reason" | "type" | "message"> = {},
): CloudDraftRepositoryIssue => ({
  code,
  reason: code,
  type: code,
  message,
  ...details,
});

const snapshotExists = (snapshot: FirestoreDocumentSnapshotLike): boolean => {
  if (typeof snapshot.exists === "function") {
    return snapshot.exists();
  }
  return snapshot.exists !== false;
};

/** Firestore Timestamp, Date, and the timestamp-like values used by tests. */
const toTimestampString = (value: unknown): string | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (!isRecord(value)) {
    return null;
  }
  const candidate = value as {
    toDate?: () => Date;
    toMillis?: () => number;
    seconds?: number;
    nanoseconds?: number;
  };
  try {
    if (typeof candidate.toDate === "function") {
      const date = candidate.toDate();
      return date instanceof Date && !Number.isNaN(date.getTime())
        ? date.toISOString()
        : null;
    }
    if (typeof candidate.toMillis === "function") {
      const millis = candidate.toMillis();
      const date = new Date(millis);
      return Number.isFinite(millis) && !Number.isNaN(date.getTime())
        ? date.toISOString()
        : null;
    }
    if (typeof candidate.seconds === "number" && Number.isFinite(candidate.seconds)) {
      const millis = candidate.seconds * 1000
        + (typeof candidate.nanoseconds === "number"
          ? Math.floor(candidate.nanoseconds / 1_000_000)
          : 0);
      const date = new Date(millis);
      return !Number.isNaN(date.getTime()) ? date.toISOString() : null;
    }
  } catch {
    return null;
  }
  return null;
};

const toDate = (value: string | Date): Date | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis) : null;
};

const isValidDeviceId = (value: unknown): value is string => (
  typeof value === "string"
  && value.length > 0
  && !value.includes("/")
  && utf8ByteLength(value) <= CLOUD_DRAFT_DEVICE_ID_MAX_BYTES
);

const isValidDeviceLabel = (value: unknown): value is string => (
  typeof value === "string"
  && value.trim().length > 0
  && utf8ByteLength(value) <= CLOUD_DRAFT_DEVICE_LABEL_MAX_BYTES
);

const isValidMutationId = (value: unknown): value is string => (
  typeof value === "string"
  && value.length > 0
  && utf8ByteLength(value) <= CLOUD_DRAFT_MUTATION_ID_MAX_BYTES
);

const getPayloadSchemaVersion = (payload: string): number | undefined => {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return isRecord(parsed) && typeof parsed.schemaVersion === "number"
      ? parsed.schemaVersion
      : undefined;
  } catch {
    return undefined;
  }
};

const normalizePayload = (
  payload: unknown,
  details: Pick<CloudDraftRepositoryIssue, "documentId" | "deviceId"> = {},
): { payload: string; document: DraftStorageDocument } | { issue: CloudDraftRepositoryIssue } => {
  if (typeof payload !== "string") {
    return {
      issue: issue("invalid-payload", "下書きpayloadが文字列ではありません", details),
    };
  }
  if (utf8ByteLength(payload) > CLOUD_DRAFT_PAYLOAD_MAX_BYTES) {
    return {
      issue: issue("invalid-payload", "下書きpayloadが大きすぎます", details),
    };
  }
  const payloadSchemaVersion = getPayloadSchemaVersion(payload);
  if (payloadSchemaVersion !== undefined && payloadSchemaVersion > 1) {
    return {
      issue: issue(
        "future-payload-schema",
        `下書きpayloadのschemaVersion ${String(payloadSchemaVersion)}には未対応です`,
        details,
      ),
    };
  }
  try {
    const document = parseDraftStorageDocument(payload);
    const normalized = stringifyDraftStorageDocument(document);
    if (utf8ByteLength(normalized) > CLOUD_DRAFT_PAYLOAD_MAX_BYTES) {
      return {
        issue: issue("invalid-payload", "正規化後の下書きpayloadが大きすぎます", details),
      };
    }
    return { payload: normalized, document };
  } catch (error) {
    return {
      issue: issue(
        "invalid-payload",
        error instanceof Error ? error.message : "下書きpayloadを読み込めません",
        details,
      ),
    };
  }
};

const decodeRemoteDraft = (
  ownerUid: string,
  documentId: string,
  raw: Record<string, unknown>,
): { record: CloudDraftRecord } | { issue: CloudDraftRepositoryIssue } => {
  const rawSchemaVersion = raw.schemaVersion;
  if (isInteger(rawSchemaVersion) && rawSchemaVersion > CLOUD_DRAFT_SCHEMA_VERSION) {
    return {
      issue: issue(
        "future-envelope-schema",
        `クラウド下書きのschemaVersion ${String(rawSchemaVersion)}には未対応です`,
        { documentId },
      ),
    };
  }
  if (rawSchemaVersion !== CLOUD_DRAFT_SCHEMA_VERSION) {
    return {
      issue: issue("invalid-document", "クラウド下書きのschemaVersionが不正です", { documentId }),
    };
  }
  if (!hasExactFields(raw)) {
    return {
      issue: issue("invalid-document", "クラウド下書きのfield構成が不正です", { documentId }),
    };
  }
  if (raw.ownerUid !== ownerUid) {
    return {
      issue: issue("invalid-document", "クラウド下書きのownerUidが一致しません", { documentId }),
    };
  }
  if (!isValidDeviceId(raw.deviceId)) {
    return {
      issue: issue("invalid-document", "クラウド下書きのdeviceIdが不正です", { documentId }),
    };
  }
  const deviceId = raw.deviceId;
  if (documentId !== deviceId) {
    return {
      issue: issue(
        "canonical-document-id-mismatch",
        "クラウド下書きのdocument idがdeviceIdと一致しません",
        { documentId, deviceId },
      ),
    };
  }
  if (!isValidDeviceLabel(raw.deviceLabel)) {
    return {
      issue: issue("invalid-document", "クラウド下書きのdeviceLabelが不正です", {
        documentId,
        deviceId,
      }),
    };
  }
  const normalized = normalizePayload(raw.payload, { documentId, deviceId });
  if ("issue" in normalized) {
    return normalized;
  }
  if (!isNonNegativeInteger(raw.revision) || !isNonNegativeInteger(raw.baseRevision)) {
    return {
      issue: issue("invalid-document", "クラウド下書きのrevisionが不正です", {
        documentId,
        deviceId,
      }),
    };
  }
  if (raw.revision !== raw.baseRevision + 1) {
    return {
      issue: issue("invalid-document", "クラウド下書きのrevision順序が不正です", {
        documentId,
        deviceId,
      }),
    };
  }
  if (!isValidMutationId(raw.mutationId)) {
    return {
      issue: issue("invalid-document", "クラウド下書きのmutationIdが不正です", {
        documentId,
        deviceId,
      }),
    };
  }
  const updatedAt = toTimestampString(raw.updatedAt);
  if (!updatedAt) {
    return {
      issue: issue("invalid-document", "クラウド下書きのupdatedAtが不正です", {
        documentId,
        deviceId,
      }),
    };
  }
  const expiresAt = toTimestampString(raw.expiresAt);
  if (!expiresAt) {
    return {
      issue: issue("invalid-document", "クラウド下書きのexpiresAtが不正です", {
        documentId,
        deviceId,
      }),
    };
  }
  const retentionMillis = Date.parse(expiresAt) - Date.parse(updatedAt);
  if (retentionMillis <= 0 || retentionMillis > CLOUD_DRAFT_RETENTION_MS) {
    return {
      issue: issue("invalid-document", "クラウド下書きの保持期間が30日を超えています", {
        documentId,
        deviceId,
      }),
    };
  }
  const deletedAt = raw.deletedAt === null ? null : toTimestampString(raw.deletedAt);
  if (raw.deletedAt !== null && !deletedAt) {
    return {
      issue: issue("invalid-document", "クラウド下書きのdeletedAtが不正です", {
        documentId,
        deviceId,
      }),
    };
  }
  return {
    record: {
      ownerUid,
      deviceId,
      deviceLabel: raw.deviceLabel,
      schemaVersion: CLOUD_DRAFT_SCHEMA_VERSION,
      payload: normalized.payload,
      revision: raw.revision,
      baseRevision: raw.baseRevision,
      mutationId: raw.mutationId,
      updatedAt,
      expiresAt,
      deletedAt,
    },
  };
};

const normalizeMutation = (
  ownerUid: string,
  input: CloudDraftRecordInput,
): { record: CloudDraftRecord } | { issue: CloudDraftRepositoryIssue } => {
  const candidate = input as Partial<CloudDraftMutation>
    & Partial<CloudDraftRecord>
    & Partial<CloudDraftWriteInput>;
  const deviceId = candidate.deviceId;
  const details = { deviceId: typeof deviceId === "string" ? deviceId : undefined };
  if (candidate.ownerUid !== undefined && candidate.ownerUid !== ownerUid) {
    return { issue: issue("invalid-mutation", "下書きmutationのownerUidが一致しません", details) };
  }
  if (!isValidDeviceId(deviceId)) {
    return { issue: issue("invalid-mutation", "下書きmutationのdeviceIdが不正です", details) };
  }
  if (!isValidDeviceLabel(candidate.deviceLabel)) {
    return { issue: issue("invalid-mutation", "下書きmutationのdeviceLabelが不正です", details) };
  }
  if (candidate.schemaVersion !== undefined && candidate.schemaVersion !== CLOUD_DRAFT_SCHEMA_VERSION) {
    return { issue: issue("invalid-mutation", "下書きmutationのschemaVersionが不正です", details) };
  }
  const normalizedPayload = normalizePayload(candidate.payload, details);
  if ("issue" in normalizedPayload) {
    return normalizedPayload;
  }
  if (!isValidMutationId(candidate.mutationId)) {
    return { issue: issue("invalid-mutation", "下書きmutationのmutationIdが不正です", details) };
  }
  if (candidate.revision !== undefined && !isNonNegativeInteger(candidate.revision)) {
    return { issue: issue("invalid-mutation", "下書きmutationのrevisionが不正です", details) };
  }
  if (candidate.baseRevision !== undefined && !isNonNegativeInteger(candidate.baseRevision)) {
    return { issue: issue("invalid-mutation", "下書きmutationのbaseRevisionが不正です", details) };
  }
  if (
    candidate.revision !== undefined
    && candidate.baseRevision !== undefined
    && candidate.revision !== candidate.baseRevision + 1
  ) {
    return { issue: issue("invalid-mutation", "下書きmutationのrevision順序が不正です", details) };
  }
  const expiresAt = toDate(candidate.expiresAt as string | Date);
  if (!expiresAt) {
    return { issue: issue("invalid-mutation", "下書きmutationのexpiresAtが不正です", details) };
  }
  const updatedAtDate = candidate.updatedAt === undefined
    ? new Date()
    : toDate(candidate.updatedAt);
  if (!updatedAtDate) {
    return { issue: issue("invalid-mutation", "下書きmutationのupdatedAtが不正です", details) };
  }
  const retentionMillis = expiresAt.getTime() - updatedAtDate.getTime();
  if (retentionMillis <= 0 || retentionMillis > CLOUD_DRAFT_RETENTION_MS) {
    return { issue: issue("invalid-mutation", "下書きmutationの保持期間は30日以内にしてください", details) };
  }
  const tombstone = candidate.tombstone === true
    || (candidate.deletedAt !== undefined && candidate.deletedAt !== null);
  let deletedAt: string | null = null;
  if (tombstone) {
    if (candidate.deletedAt !== undefined && candidate.deletedAt !== null) {
      const parsedDeletedAt = toDate(candidate.deletedAt as string | Date);
      if (!parsedDeletedAt) {
        return { issue: issue("invalid-mutation", "下書きmutationのdeletedAtが不正です", details) };
      }
      deletedAt = parsedDeletedAt.toISOString();
    } else {
      // The server timestamp is used for the persisted value. The local
      // value only records that this mutation is a tombstone.
      deletedAt = new Date().toISOString();
    }
  }
  const revision = candidate.revision ?? 0;
  const baseRevision = candidate.baseRevision ?? Math.max(0, revision - 1);
  const updatedAt = updatedAtDate.toISOString();
  return {
    record: {
      ownerUid,
      deviceId,
      deviceLabel: candidate.deviceLabel,
      schemaVersion: CLOUD_DRAFT_SCHEMA_VERSION,
      payload: normalizedPayload.payload,
      revision,
      baseRevision,
      mutationId: candidate.mutationId,
      updatedAt,
      expiresAt: expiresAt.toISOString(),
      deletedAt,
    },
  };
};

const sameMutationContent = (left: CloudDraftRecord, right: CloudDraftRecord): boolean => (
  left.ownerUid === right.ownerUid
  && left.deviceId === right.deviceId
  && left.deviceLabel === right.deviceLabel
  && left.payload === right.payload
  && left.revision === right.revision
  && left.baseRevision === right.baseRevision
  && left.expiresAt === right.expiresAt
  && (left.deletedAt !== null) === (right.deletedAt !== null)
);

const buildWriteData = (
  record: CloudDraftRecord,
  dependencies: FirestoreCloudDraftDependencies,
): Record<string, unknown> => ({
  ownerUid: record.ownerUid,
  deviceId: record.deviceId,
  deviceLabel: record.deviceLabel,
  schemaVersion: CLOUD_DRAFT_SCHEMA_VERSION,
  payload: record.payload,
  revision: record.revision,
  baseRevision: record.baseRevision,
  mutationId: record.mutationId,
  updatedAt: dependencies.serverTimestamp(),
  expiresAt: dependencies.timestampFromDate
    ? dependencies.timestampFromDate(new Date(record.expiresAt))
    : new Date(record.expiresAt),
  // Keep tombstones forever so an offline device cannot revive an old draft.
  deletedAt: record.deletedAt !== null ? dependencies.serverTimestamp() : null,
});

const getReadDocs = (snapshot: FirestoreQuerySnapshotLike): readonly FirestoreDocumentSnapshotLike[] => (
  Array.isArray(snapshot.docs) ? snapshot.docs : []
);

export const getCloudDraftCollectionPath = (uid: string): string => (
  `users/${uid}/${DRAFT_COLLECTION_NAME}`
);

export const getFirestoreCloudDraftCollectionPath = getCloudDraftCollectionPath;

export const sanitizeFirestoreCloudDraftError = sanitizeFirestoreError;
export const classifyFirestoreCloudDraftError = sanitizeFirestoreError;

export class FirestoreCloudDraftRepository implements CloudDraftRepository {
  private readonly firestore: unknown;
  private readonly uid: string;
  private readonly dependencies: FirestoreCloudDraftDependencies;
  private readonly collectionPath: string;

  constructor(options: CreateFirestoreCloudDraftRepositoryOptions) {
    const gateway = options.gateway;
    this.firestore = gateway?.firestore ?? options.firestore ?? options.client?.firestore;
    this.uid = gateway?.uid ?? options.uid ?? options.ownerUid ?? "";
    this.dependencies = {
      ...defaultDependencies,
      ...options.dependencies,
      ...options.sdk,
    };
    this.collectionPath = getCloudDraftCollectionPath(this.uid);
  }

  get path(): string {
    return this.collectionPath;
  }

  async readAll(): Promise<CloudDraftReadResult> {
    try {
      const collectionReference = this.dependencies.collection(this.firestore, this.collectionPath);
      const snapshot = await this.dependencies.getDocsFromServer(collectionReference);
      const documents = getReadDocs(snapshot);
      if (documents.length === 0) {
        return { status: "empty", drafts: [], records: [], issues: [] };
      }
      const drafts: CloudDraftRecord[] = [];
      const issues: CloudDraftRepositoryIssue[] = [];
      for (const document of documents) {
        try {
          if (!snapshotExists(document)) {
            issues.push(issue("invalid-document", "クラウド下書きが存在しません", {
              documentId: document.id,
            }));
            continue;
          }
          const raw = document.data();
          if (!isRecord(raw)) {
            issues.push(issue("invalid-document", "クラウド下書きのdataが不正です", {
              documentId: document.id,
            }));
            continue;
          }
          const decoded = decodeRemoteDraft(this.uid, document.id, raw);
          if ("issue" in decoded) {
            issues.push(decoded.issue);
          } else {
            drafts.push(decoded.record);
          }
        } catch {
          issues.push(issue("invalid-document", "クラウド下書きを読み取れません", {
            documentId: document.id,
          }));
        }
      }
      return { status: "success", drafts, records: drafts, issues };
    } catch (error) {
      return {
        status: "error",
        drafts: [],
        records: [],
        issues: [],
        error: sanitizeFirestoreError(error),
      };
    }
  }

  async pull(): Promise<CloudDraftReadResult> {
    return this.readAll();
  }

  async getAll(): Promise<CloudDraftReadResult> {
    return this.readAll();
  }

  async write(input: CloudDraftRecordInput): Promise<CloudDraftWriteResult> {
    const normalized = normalizeMutation(this.uid, input);
    if ("issue" in normalized) {
      return {
        status: "invalid",
        issues: [normalized.issue],
        issue: normalized.issue,
      };
    }
    const requested = normalized.record;
    try {
      const collectionReference = this.dependencies.collection(this.firestore, this.collectionPath);
      const documentReference = this.dependencies.doc(collectionReference, requested.deviceId);
      const transactionResult = await this.dependencies.runTransaction(
        this.firestore,
        async (transaction) => {
          const snapshot = await transaction.get(documentReference);
          let remote: CloudDraftRecord | undefined;
          if (snapshotExists(snapshot)) {
            const raw = snapshot.data();
            if (!isRecord(raw)) {
              const invalidIssue = issue("invalid-document", "クラウド下書きのdataが不正です", {
                documentId: requested.deviceId,
                deviceId: requested.deviceId,
              });
              return { status: "invalid" as const, issues: [invalidIssue], issue: invalidIssue };
            }
            const decoded = decodeRemoteDraft(this.uid, requested.deviceId, raw);
            if ("issue" in decoded) {
              return { status: "invalid" as const, issues: [decoded.issue], issue: decoded.issue };
            }
            remote = decoded.record;
            if (remote.mutationId === requested.mutationId) {
              if (sameMutationContent(remote, requested)) {
                return {
                  status: "duplicate" as const,
                  draft: remote,
                  record: remote,
                  remote,
                  issues: [],
                };
              }
              const reuseIssue = issue(
                "mutation-id-reuse",
                "同じmutationIdが異なる内容で再利用されています",
                {
                  documentId: requested.deviceId,
                  deviceId: requested.deviceId,
                  expectedRevision: requested.revision,
                  actualRevision: remote.revision,
                },
              );
              return {
                status: "conflict" as const,
                draft: requested,
                record: requested,
                remote,
                issues: [reuseIssue],
                issue: reuseIssue,
              };
            }
            if (requested.baseRevision !== remote.revision) {
              const casIssue = issue(
                "base-revision-mismatch",
                "下書きmutationのbaseRevisionがremote revisionと一致しません",
                {
                  documentId: requested.deviceId,
                  deviceId: requested.deviceId,
                  expectedRevision: requested.baseRevision,
                  actualRevision: remote.revision,
                },
              );
              return {
                status: "conflict" as const,
                draft: requested,
                record: requested,
                remote,
                issues: [casIssue],
                issue: casIssue,
              };
            }
          } else if (requested.baseRevision !== 0) {
            const casIssue = issue(
              "base-revision-mismatch",
              "remoteに下書きがないためbaseRevisionを適用できません",
              {
                documentId: requested.deviceId,
                deviceId: requested.deviceId,
                expectedRevision: requested.baseRevision,
                actualRevision: 0,
              },
            );
            return {
              status: "conflict" as const,
              draft: requested,
              record: requested,
              issues: [casIssue],
              issue: casIssue,
            };
          }

          const record: CloudDraftRecord = {
            ...requested,
            // The repository owns the canonical create/update sequence. An
            // omitted revision is convenient for a new device; a supplied
            // revision remains subject to the transaction CAS above.
            revision: remote ? remote.revision + 1 : 1,
            baseRevision: remote ? remote.revision : 0,
          };
          transaction.set(documentReference, buildWriteData(record, this.dependencies));
          return {
            status: "written" as const,
            draft: record,
            record,
            remote,
            issues: [],
          };
        },
      );
      if (
        isRecord(transactionResult)
        && typeof transactionResult.status === "string"
        && Array.isArray(transactionResult.issues)
      ) {
        return transactionResult as unknown as CloudDraftWriteResult;
      }
      return {
        status: "error",
        issues: [],
        error: {
          kind: "unknown",
          message: "下書きtransactionの結果が不正です",
        },
      };
    } catch (error) {
      return {
        status: "error",
        issues: [],
        error: sanitizeFirestoreError(error),
      };
    }
  }

  async push(input: CloudDraftRecordInput): Promise<CloudDraftWriteResult> {
    return this.write(input);
  }

  async save(input: CloudDraftRecordInput): Promise<CloudDraftWriteResult> {
    return this.write(input);
  }

  async upsert(input: CloudDraftRecordInput): Promise<CloudDraftWriteResult> {
    return this.write(input);
  }
}

export const createFirestoreCloudDraftRepository = (
  options: CreateFirestoreCloudDraftRepositoryOptions,
): FirestoreCloudDraftRepository => new FirestoreCloudDraftRepository(options);

export const createCloudDraftRepository = createFirestoreCloudDraftRepository;
export const createFirestoreDraftRepository = createFirestoreCloudDraftRepository;
