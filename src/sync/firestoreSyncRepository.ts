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
  decodeSyncPayload,
  encodeSyncPayload,
  type SyncPayloadDecodeFailureReason,
} from "./syncPayload";
import {
  SYNC_SCHEMA_VERSION,
  isSyncKind,
  makeSyncRecordKey,
  type SyncKind,
  type SyncMutation,
  type SyncRecord,
} from "./syncTypes";

/** The Firestore shapes used by this adapter. They intentionally expose only
 * the small SDK surface needed by the repository so tests do not need a live
 * Firebase app. */
export interface FirestoreDocumentSnapshotLike {
  readonly id: string;
  readonly exists?: boolean | (() => boolean);
  data(): Record<string, unknown> | undefined;
}

export interface FirestoreQuerySnapshotLike {
  readonly docs: readonly FirestoreDocumentSnapshotLike[];
  readonly size?: number;
}

export interface FirestoreDocumentReferenceLike {
  readonly id?: string;
  readonly path?: string;
}

export interface FirestoreTransactionLike {
  get(reference: FirestoreDocumentReferenceLike):
    Promise<FirestoreDocumentSnapshotLike>;
  set(reference: FirestoreDocumentReferenceLike, data: Record<string, unknown>): unknown;
}

export interface FirestoreSyncDependencies {
  readonly collection: (firestore: unknown, path: string) => unknown;
  readonly doc: (collection: unknown, documentId: string) => FirestoreDocumentReferenceLike;
  readonly getDocsFromServer: (collection: unknown) => Promise<FirestoreQuerySnapshotLike>;
  readonly runTransaction: (
    firestore: unknown,
    updateFunction: (transaction: FirestoreTransactionLike) => Promise<unknown>,
  ) => Promise<unknown>;
  readonly serverTimestamp: () => unknown;
}

const defaultDependencies: FirestoreSyncDependencies = {
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

/** A ready Firestore instance and the authenticated owner it belongs to. */
export interface FirestoreSyncGateway {
  readonly firestore: unknown;
  readonly uid: string;
}

export interface CreateFirestoreSyncRepositoryOptions {
  readonly firestore?: unknown;
  readonly uid?: string;
  readonly ownerUid?: string;
  readonly gateway?: FirestoreSyncGateway;
  /** The ready client shape returned by createFirebaseClient is also accepted. */
  readonly client?: { readonly firestore?: unknown };
  readonly dependencies?: Partial<FirestoreSyncDependencies>;
  /** Alias kept for callers that name the injected SDK surface `sdk`. */
  readonly sdk?: Partial<FirestoreSyncDependencies>;
}

export type SyncRepositoryErrorKind =
  | "network"
  | "permission-denied"
  | "quota"
  | "unavailable"
  | "unknown";

export interface SyncRepositoryError {
  readonly kind: SyncRepositoryErrorKind;
  /** A Firebase error code is useful for diagnostics, but raw error objects
   * are never returned to the UI or persisted. */
  readonly code?: string;
  readonly message: string;
}

export type SyncRepositoryIssueCode =
  | "invalid-document"
  | "future-envelope-schema"
  | "future-payload-schema"
  | "invalid-payload"
  | "canonical-document-id-mismatch"
  | "mutation-id-reuse"
  | "base-revision-mismatch"
  | "invalid-mutation";

export interface SyncRepositoryIssue {
  readonly code: SyncRepositoryIssueCode;
  /** `reason` and `type` make the issue convenient to consume without
   * coupling the coordinator to the concrete repository implementation. */
  readonly reason: SyncRepositoryIssueCode;
  readonly type: SyncRepositoryIssueCode;
  readonly message: string;
  readonly documentId?: string;
  readonly recordKey?: string;
  readonly entryId?: string;
  readonly kind?: SyncKind;
  readonly expectedRevision?: number;
  readonly actualRevision?: number;
}

export interface SyncReadResult {
  readonly status: "success" | "empty" | "error";
  readonly records: readonly SyncRecord[];
  readonly issues: readonly SyncRepositoryIssue[];
  readonly error?: SyncRepositoryError;
}

export interface SyncWriteResult {
  readonly status: "written" | "duplicate" | "conflict" | "invalid" | "error";
  readonly record?: SyncRecord;
  readonly remote?: SyncRecord;
  readonly issue?: SyncRepositoryIssue;
  readonly issues: readonly SyncRepositoryIssue[];
  readonly error?: SyncRepositoryError;
}

/** A caller may pass a mutation from the outbox, or a plain record. */
export type SyncRecordInput = SyncRecord | SyncMutation | (
  Omit<SyncRecord, "recordKey"> & Partial<Pick<SyncRecord, "recordKey">>
);

export interface CloudSyncRepository {
  readonly readAll: () => Promise<SyncReadResult>;
  readonly write: (record: SyncRecordInput) => Promise<SyncWriteResult>;
}

const COLLECTION_NAME = "syncRecords";
const SYNC_RECORD_FIELD_NAMES = [
  "ownerUid",
  "kind",
  "schemaVersion",
  "entryId",
  "payload",
  "revision",
  "baseRevision",
  "mutationId",
  "updatedAt",
  "deletedAt",
] as const;

export const getSyncCollectionPath = (uid: string): string => (
  `users/${uid}/${COLLECTION_NAME}`
);

/**
 * SHA-256 without a Node-only dependency. Firestore document ids are always
 * the fixed 64 lowercase hex characters returned by this function; the raw
 * entry id never becomes a path segment. The preimage uses the fixed kind
 * enum plus a colon separator, matching the Firestore Rules contract.
 */
export const sha256Hex = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
    0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
    0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
    0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
    0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ] as const;
  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const schedule = new Uint32Array(64);
  const rotateRight = (word: number, amount: number): number => (
    (word >>> amount) | (word << (32 - amount))
  );

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const lower = schedule[index - 15];
      const upper = schedule[index - 2];
      const sigma0 = rotateRight(lower, 7) ^ rotateRight(lower, 18) ^ (lower >>> 3);
      const sigma1 = rotateRight(upper, 17) ^ rotateRight(upper, 19) ^ (upper >>> 10);
      schedule[index] = (
        schedule[index - 16]
        + sigma0
        + schedule[index - 7]
        + sigma1
      ) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (h + sigma1 + choose + constants[index] + schedule[index]) >>> 0;
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  return [...hash].map((word) => word.toString(16).padStart(8, "0")).join("");
};

export const makeSyncDocumentId = (kind: SyncKind, entryId: string): string => (
  sha256Hex(`${kind}:${entryId}`)
);
export const createSyncDocumentId = makeSyncDocumentId;
export const getSyncDocumentId = makeSyncDocumentId;
export const makeFirestoreDocumentId = makeSyncDocumentId;

const isInteger = (value: unknown): value is number => (
  typeof value === "number" && Number.isInteger(value)
);

const isNonNegativeInteger = (value: unknown): value is number => (
  isInteger(value) && value >= 0
);

const snapshotExists = (snapshot: FirestoreDocumentSnapshotLike): boolean => {
  if (typeof snapshot.exists === "function") {
    return snapshot.exists();
  }
  return snapshot.exists !== false;
};

const toTimestampString = (value: unknown): string | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value === "object" && value !== null) {
    const candidate = value as {
      toDate?: () => Date;
      toMillis?: () => number;
      seconds?: number;
      nanoseconds?: number;
    };
    try {
      if (typeof candidate.toDate === "function") {
        const date = candidate.toDate();
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
      }
      if (typeof candidate.toMillis === "function") {
        const date = new Date(candidate.toMillis());
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
      }
      if (typeof candidate.seconds === "number") {
        const millis = candidate.seconds * 1000
          + (typeof candidate.nanoseconds === "number"
            ? Math.floor(candidate.nanoseconds / 1_000_000)
            : 0);
        const date = new Date(millis);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
      }
    } catch {
      return null;
    }
  }
  return null;
};

const utf8ByteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

const hasExactSyncRecordFields = (raw: Record<string, unknown>): boolean => {
  const keys = Object.keys(raw);
  return keys.length === SYNC_RECORD_FIELD_NAMES.length
    && SYNC_RECORD_FIELD_NAMES.every((field) => Object.prototype.hasOwnProperty.call(raw, field));
};

const issue = (
  code: SyncRepositoryIssueCode,
  message: string,
  details: Omit<SyncRepositoryIssue, "code" | "reason" | "type" | "message"> = {},
): SyncRepositoryIssue => ({
  code,
  reason: code,
  type: code,
  message,
  ...details,
});

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const getFirestoreErrorCode = (error: unknown): string | undefined => {
  if (!isRecord(error) || typeof error.code !== "string") {
    return undefined;
  }
  return error.code;
};

/** Convert Firebase/transport failures into a stable, UI-safe classification. */
export const sanitizeFirestoreError = (error: unknown): SyncRepositoryError => {
  const code = getFirestoreErrorCode(error);
  const normalizedCode = code?.toLowerCase();
  let kind: SyncRepositoryErrorKind;
  if (
    normalizedCode === "permission-denied"
    || normalizedCode === "unauthenticated"
    || normalizedCode === "auth/unauthenticated"
  ) {
    kind = "permission-denied";
  } else if (
    normalizedCode === "resource-exhausted"
    || normalizedCode === "quota-exceeded"
    || normalizedCode === "quota"
  ) {
    kind = "quota";
  } else if (normalizedCode === "unavailable") {
    kind = "unavailable";
  } else if (
    normalizedCode === "network-request-failed"
    || normalizedCode === "failed-to-fetch"
    || normalizedCode === "deadline-exceeded"
    || normalizedCode === "cancelled"
  ) {
    kind = "network";
  } else {
    kind = "unknown";
  }

  const messages: Record<SyncRepositoryErrorKind, string> = {
    network: "同期サーバーへ接続できません",
    "permission-denied": "同期データへのアクセス権がありません",
    quota: "同期の利用上限に達しました",
    unavailable: "同期サーバーが一時的に利用できません",
    unknown: "同期処理に失敗しました",
  };
  return { kind, code, message: messages[kind] };
};

export const classifyFirestoreError = sanitizeFirestoreError;

interface DecodedRemoteRecord {
  readonly record: SyncRecord;
  readonly canonicalPayload: string;
}

interface RemoteDecodeFailure {
  readonly issue: SyncRepositoryIssue;
}

type RemoteDecodeResult = DecodedRemoteRecord | RemoteDecodeFailure;

const isFutureSchemaVersion = (value: unknown): boolean => (
  isInteger(value) && value > SYNC_SCHEMA_VERSION
);

const decodeRemoteRecord = (
  ownerUid: string,
  documentId: string,
  raw: Record<string, unknown>,
): RemoteDecodeResult => {
  const rawSchemaVersion = raw.schemaVersion;
  if (isFutureSchemaVersion(rawSchemaVersion)) {
    return {
      issue: issue(
        "future-envelope-schema",
        `同期レコードのschemaVersion ${String(rawSchemaVersion)}には未対応です`,
        { documentId },
      ),
    };
  }
  if (!isInteger(rawSchemaVersion) || rawSchemaVersion !== SYNC_SCHEMA_VERSION) {
    return {
      issue: issue("invalid-document", "同期レコードのschemaVersionが不正です", { documentId }),
    };
  }
  if (!hasExactSyncRecordFields(raw)) {
    return {
      issue: issue("invalid-document", "同期レコードのfield構成が不正です", { documentId }),
    };
  }
  if (raw.ownerUid !== ownerUid) {
    return {
      issue: issue("invalid-document", "同期レコードのownerUidが一致しません", { documentId }),
    };
  }
  if (!isSyncKind(raw.kind)) {
    return {
      issue: issue("invalid-document", "同期レコードのkindが不正です", { documentId }),
    };
  }
  const kind = raw.kind;
  if (typeof raw.entryId !== "string" || raw.entryId.length === 0) {
    return {
      issue: issue("invalid-document", "同期レコードのentryIdが不正です", {
        documentId,
        kind,
      }),
    };
  }
  const entryId = raw.entryId;
  if (utf8ByteLength(entryId) > 4096) {
    return {
      issue: issue("invalid-document", "同期レコードのentryIdが長すぎます", {
        documentId,
        kind,
      }),
    };
  }
  const recordKey = makeSyncRecordKey(kind, entryId);
  if (makeSyncDocumentId(kind, entryId) !== documentId) {
    return {
      issue: issue(
        "canonical-document-id-mismatch",
        "同期レコードのdocument idがentryIdのcanonical hashと一致しません",
        { documentId, recordKey, entryId, kind },
      ),
    };
  }
  if (typeof raw.payload !== "string") {
    return {
      issue: issue("invalid-payload", "同期レコードのpayloadが文字列ではありません", {
        documentId,
        recordKey,
        entryId,
        kind,
      }),
    };
  }
  if (utf8ByteLength(raw.payload) > 200_000) {
    return {
      issue: issue("invalid-payload", "同期レコードのpayloadが大きすぎます", {
        documentId,
        recordKey,
        entryId,
        kind,
      }),
    };
  }
  const decoded = decodeSyncPayload(kind, raw.payload, entryId);
  if (decoded.status === "error") {
    const code: SyncRepositoryIssueCode = decoded.reason === "unknown-future-schema"
      ? "future-payload-schema"
      : "invalid-payload";
    return {
      issue: issue(code, decoded.message, {
        documentId,
        recordKey,
        entryId,
        kind,
      }),
    };
  }
  if (!isNonNegativeInteger(raw.revision) || !isNonNegativeInteger(raw.baseRevision)) {
    return {
      issue: issue("invalid-document", "同期レコードのrevisionが不正です", {
        documentId,
        recordKey,
        entryId,
        kind,
      }),
    };
  }
  if (raw.revision !== raw.baseRevision + 1) {
    return {
      issue: issue("invalid-document", "同期レコードのrevision順序が不正です", {
        documentId,
        recordKey,
        entryId,
        kind,
      }),
    };
  }
  if (typeof raw.mutationId !== "string" || raw.mutationId.length === 0) {
    return {
      issue: issue("invalid-document", "同期レコードのmutationIdが不正です", {
        documentId,
        recordKey,
        entryId,
        kind,
      }),
    };
  }
  if (utf8ByteLength(raw.mutationId) > 128) {
    return {
      issue: issue("invalid-document", "同期レコードのmutationIdが長すぎます", {
        documentId,
        recordKey,
        entryId,
        kind,
      }),
    };
  }
  if (!("updatedAt" in raw)) {
    return {
      issue: issue("invalid-document", "同期レコードのupdatedAtがありません", {
        documentId,
        recordKey,
        entryId,
        kind,
      }),
    };
  }
  const updatedAt = toTimestampString(raw.updatedAt);
  if (!updatedAt) {
    return {
      issue: issue("invalid-document", "同期レコードのupdatedAtが不正です", {
        documentId,
        recordKey,
        entryId,
        kind,
      }),
    };
  }
  if (!("deletedAt" in raw)) {
    return {
      issue: issue("invalid-document", "同期レコードのdeletedAtがありません", {
        documentId,
        recordKey,
        entryId,
        kind,
      }),
    };
  }
  const deletedAt = raw.deletedAt === null ? null : toTimestampString(raw.deletedAt);
  if (raw.deletedAt !== null && !deletedAt) {
    return {
      issue: issue("invalid-document", "同期レコードのdeletedAtが不正です", {
        documentId,
        recordKey,
        entryId,
        kind,
      }),
    };
  }

  return {
    canonicalPayload: encodeSyncPayload(kind, decoded.entry),
    record: {
      ownerUid,
      kind,
      entryId,
      recordKey,
      revision: raw.revision,
      baseRevision: raw.baseRevision,
      payload: encodeSyncPayload(kind, decoded.entry),
      tombstone: deletedAt !== null,
      deletedAt,
      updatedAt,
      mutationId: raw.mutationId,
    },
  };
};

const toIssueFromThrownError = (error: unknown): SyncRepositoryIssue => (
  issue("invalid-document", "同期レコードを読み取れません")
);

const sameMutationContent = (left: SyncRecord, right: SyncRecord): boolean => (
  left.ownerUid === right.ownerUid
  && left.kind === right.kind
  && left.entryId === right.entryId
  && left.recordKey === right.recordKey
  && left.revision === right.revision
  && left.baseRevision === right.baseRevision
  && left.payload === right.payload
  && left.tombstone === right.tombstone
);

const toRecordInput = (
  ownerUid: string,
  input: SyncRecordInput,
): { record: SyncRecord; issue?: SyncRepositoryIssue } => {
  const candidate = input as Partial<SyncRecord> & { readonly ownerUid?: string };
  if (candidate.ownerUid !== undefined && candidate.ownerUid !== ownerUid) {
    return {
      record: {} as SyncRecord,
      issue: issue("invalid-mutation", "同期mutationのownerUidが一致しません"),
    };
  }
  if (!isSyncKind(candidate.kind)) {
    return {
      record: {} as SyncRecord,
      issue: issue("invalid-mutation", "同期mutationのkindが不正です"),
    };
  }
  if (typeof candidate.entryId !== "string" || candidate.entryId.length === 0) {
    return {
      record: {} as SyncRecord,
      issue: issue("invalid-mutation", "同期mutationのentryIdが不正です"),
    };
  }
  const recordKey = makeSyncRecordKey(candidate.kind, candidate.entryId);
  if (candidate.recordKey !== undefined && candidate.recordKey !== recordKey) {
    return {
      record: {} as SyncRecord,
      issue: issue("invalid-mutation", "同期mutationのrecordKeyが不正です", {
        recordKey,
        entryId: candidate.entryId,
        kind: candidate.kind,
      }),
    };
  }
  if (utf8ByteLength(candidate.entryId) > 4096) {
    return {
      record: {} as SyncRecord,
      issue: issue("invalid-mutation", "同期mutationのentryIdが長すぎます"),
    };
  }
  if (typeof candidate.payload !== "string") {
    return {
      record: {} as SyncRecord,
      issue: issue("invalid-mutation", "同期mutationのpayloadが不正です", {
        recordKey,
        entryId: candidate.entryId,
        kind: candidate.kind,
      }),
    };
  }
  if (utf8ByteLength(candidate.payload) > 200_000) {
    return {
      record: {} as SyncRecord,
      issue: issue("invalid-mutation", "同期mutationのpayloadが大きすぎます", {
        recordKey,
        entryId: candidate.entryId,
        kind: candidate.kind,
      }),
    };
  }
  const decoded = decodeSyncPayload(candidate.kind, candidate.payload, candidate.entryId);
  if (decoded.status === "error") {
    const code: SyncRepositoryIssueCode = decoded.reason === "unknown-future-schema"
      ? "future-payload-schema"
      : "invalid-payload";
    return {
      record: {} as SyncRecord,
      issue: issue(code, decoded.message, {
        recordKey,
        entryId: candidate.entryId,
        kind: candidate.kind,
      }),
    };
  }
  if (!isNonNegativeInteger(candidate.revision) || !isNonNegativeInteger(candidate.baseRevision)) {
    return {
      record: {} as SyncRecord,
      issue: issue("invalid-mutation", "同期mutationのrevisionが不正です", {
        recordKey,
        entryId: candidate.entryId,
        kind: candidate.kind,
      }),
    };
  }
  if (candidate.revision !== candidate.baseRevision + 1) {
    return {
      record: {} as SyncRecord,
      issue: issue("invalid-mutation", "同期mutationのrevision順序が不正です", {
        recordKey,
        entryId: candidate.entryId,
        kind: candidate.kind,
      }),
    };
  }
  if (typeof candidate.mutationId !== "string" || candidate.mutationId.length === 0) {
    return {
      record: {} as SyncRecord,
      issue: issue("invalid-mutation", "同期mutationのmutationIdが不正です", {
        recordKey,
        entryId: candidate.entryId,
        kind: candidate.kind,
      }),
    };
  }
  if (utf8ByteLength(candidate.mutationId) > 128) {
    return {
      record: {} as SyncRecord,
      issue: issue("invalid-mutation", "同期mutationのmutationIdが長すぎます", {
        recordKey,
        entryId: candidate.entryId,
        kind: candidate.kind,
      }),
    };
  }
  const updatedAt = typeof candidate.updatedAt === "string" && candidate.updatedAt.length > 0
    ? candidate.updatedAt
    : new Date().toISOString();
  const tombstone = candidate.tombstone === true
    || (candidate.deletedAt !== undefined && candidate.deletedAt !== null);
  const deletedAt = tombstone
    ? (typeof candidate.deletedAt === "string" && candidate.deletedAt.length > 0
      ? candidate.deletedAt
      : updatedAt)
    : null;
  const canonicalPayload = encodeSyncPayload(candidate.kind, decoded.entry);
  return {
    record: {
      ownerUid,
      kind: candidate.kind,
      entryId: candidate.entryId,
      recordKey,
      revision: candidate.revision,
      baseRevision: candidate.baseRevision,
      payload: canonicalPayload,
      tombstone,
      deletedAt,
      updatedAt,
      mutationId: candidate.mutationId,
    },
  };
};

const buildWriteData = (
  record: SyncRecord,
  dependencies: FirestoreSyncDependencies,
): Record<string, unknown> => ({
  ownerUid: record.ownerUid,
  kind: record.kind,
  schemaVersion: SYNC_SCHEMA_VERSION,
  entryId: record.entryId,
  payload: record.payload,
  revision: record.revision,
  baseRevision: record.baseRevision,
  mutationId: record.mutationId,
  updatedAt: dependencies.serverTimestamp(),
  // A tombstone is retained as a document. Physical delete is deliberately
  // not part of this repository because stale offline writes must not revive
  // deleted entries.
  deletedAt: record.tombstone ? dependencies.serverTimestamp() : null,
});

const getReadDocs = (snapshot: FirestoreQuerySnapshotLike): readonly FirestoreDocumentSnapshotLike[] => (
  Array.isArray(snapshot.docs) ? snapshot.docs : []
);

export class FirestoreSyncRepository implements CloudSyncRepository {
  private readonly firestore: unknown;
  private readonly uid: string;
  private readonly dependencies: FirestoreSyncDependencies;
  private readonly collectionPath: string;

  constructor(options: CreateFirestoreSyncRepositoryOptions) {
    const gateway = options.gateway;
    this.firestore = gateway?.firestore ?? options.firestore ?? options.client?.firestore;
    this.uid = gateway?.uid ?? options.uid ?? options.ownerUid ?? "";
    this.dependencies = {
      ...defaultDependencies,
      ...options.dependencies,
      ...options.sdk,
    };
    this.collectionPath = getSyncCollectionPath(this.uid);
  }

  get path(): string {
    return this.collectionPath;
  }

  async readAll(): Promise<SyncReadResult> {
    try {
      const collectionReference = this.dependencies.collection(this.firestore, this.collectionPath);
      const snapshot = await this.dependencies.getDocsFromServer(collectionReference);
      const documents = getReadDocs(snapshot);
      if (documents.length === 0) {
        return { status: "empty", records: [], issues: [] };
      }
      const records: SyncRecord[] = [];
      const issues: SyncRepositoryIssue[] = [];
      for (const document of documents) {
        try {
          if (!snapshotExists(document)) {
            issues.push(issue("invalid-document", "同期レコードが存在しません", {
              documentId: document.id,
            }));
            continue;
          }
          const raw = document.data();
          if (!isRecord(raw)) {
            issues.push(issue("invalid-document", "同期レコードのdataが不正です", {
              documentId: document.id,
            }));
            continue;
          }
          const decoded = decodeRemoteRecord(this.uid, document.id, raw);
          if ("issue" in decoded) {
            issues.push(decoded.issue);
          } else {
            records.push(decoded.record);
          }
        } catch {
          issues.push(toIssueFromThrownError(undefined));
        }
      }
      return { status: "success", records, issues };
    } catch (error) {
      return {
        status: "error",
        records: [],
        issues: [],
        error: sanitizeFirestoreError(error),
      };
    }
  }

  /** Alias used by coordinators that call the remote read a pull. */
  async pull(): Promise<SyncReadResult> {
    return this.readAll();
  }

  async getAll(): Promise<SyncReadResult> {
    return this.readAll();
  }

  async write(input: SyncRecordInput): Promise<SyncWriteResult> {
    const normalized = toRecordInput(this.uid, input);
    if (normalized.issue) {
      return {
        status: "invalid",
        issues: [normalized.issue],
        issue: normalized.issue,
      };
    }
    const record = normalized.record;
    try {
      const collectionReference = this.dependencies.collection(this.firestore, this.collectionPath);
      const documentId = makeSyncDocumentId(record.kind, record.entryId);
      const documentReference = this.dependencies.doc(collectionReference, documentId);
      const transactionResult = await this.dependencies.runTransaction(
        this.firestore,
        async (transaction) => {
          const snapshot = await transaction.get(documentReference);
          let remote: SyncRecord | undefined;
          if (snapshotExists(snapshot)) {
            const raw = snapshot.data();
            if (!isRecord(raw)) {
              const invalidIssue = issue("invalid-document", "同期レコードのdataが不正です", {
                documentId,
                recordKey: record.recordKey,
                entryId: record.entryId,
                kind: record.kind,
              });
              return {
                status: "invalid" as const,
                issues: [invalidIssue],
                issue: invalidIssue,
              };
            }
            const decoded = decodeRemoteRecord(this.uid, documentId, raw);
            if ("issue" in decoded) {
              return {
                status: "invalid" as const,
                issues: [decoded.issue],
                issue: decoded.issue,
              };
            }
            remote = decoded.record;
            if (remote.mutationId === record.mutationId) {
              if (sameMutationContent(remote, record)) {
                return {
                  status: "duplicate" as const,
                  record,
                  remote,
                  issues: [],
                };
              }
              const reuseIssue = issue(
                "mutation-id-reuse",
                "同じmutationIdが異なる内容で再利用されています",
                {
                  documentId,
                  recordKey: record.recordKey,
                  entryId: record.entryId,
                  kind: record.kind,
                  expectedRevision: record.revision,
                  actualRevision: remote.revision,
                },
              );
              return {
                status: "conflict" as const,
                record,
                remote,
                issues: [reuseIssue],
                issue: reuseIssue,
              };
            }
            if (record.baseRevision !== remote.revision) {
              const casIssue = issue(
                "base-revision-mismatch",
                "同期レコードのbaseRevisionがremote revisionと一致しません",
                {
                  documentId,
                  recordKey: record.recordKey,
                  entryId: record.entryId,
                  kind: record.kind,
                  expectedRevision: record.baseRevision,
                  actualRevision: remote.revision,
                },
              );
              return {
                status: "conflict" as const,
                record,
                remote,
                issues: [casIssue],
                issue: casIssue,
              };
            }
          } else if (record.baseRevision !== 0) {
            const casIssue = issue(
              "base-revision-mismatch",
              "remoteにレコードがないためbaseRevisionを適用できません",
              {
                documentId,
                recordKey: record.recordKey,
                entryId: record.entryId,
                kind: record.kind,
                expectedRevision: record.baseRevision,
                actualRevision: 0,
              },
            );
            return {
              status: "conflict" as const,
              record,
              issues: [casIssue],
              issue: casIssue,
            };
          }
          transaction.set(documentReference, buildWriteData(record, this.dependencies));
          return {
            status: "written" as const,
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
        return transactionResult as unknown as SyncWriteResult;
      }
      return {
        status: "error",
        issues: [],
        error: {
          kind: "unknown",
          message: "同期transactionの結果が不正です",
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

  async push(input: SyncRecordInput): Promise<SyncWriteResult> {
    return this.write(input);
  }

  async save(input: SyncRecordInput): Promise<SyncWriteResult> {
    return this.write(input);
  }

  async upsert(input: SyncRecordInput): Promise<SyncWriteResult> {
    return this.write(input);
  }
}

export const createFirestoreSyncRepository = (
  options: CreateFirestoreSyncRepositoryOptions,
): FirestoreSyncRepository => new FirestoreSyncRepository(options);

export const createCloudSyncRepository = createFirestoreSyncRepository;
