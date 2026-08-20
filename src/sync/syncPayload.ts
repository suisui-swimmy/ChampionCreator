import {
  BOX_STORAGE_SCHEMA_VERSION,
  parseBoxStorageDocument,
  stringifyBoxStorageDocument,
  type BoxEntry,
} from "../ui/boxStorage";
import {
  ENEMY_BOX_STORAGE_SCHEMA_VERSION,
  parseEnemyBoxStorageDocument,
  stringifyEnemyBoxStorageDocument,
  type EnemyBoxEntry,
} from "../ui/enemyBoxStorage";
import { SHARE_SCHEMA_VERSION } from "../ui/shareState";
import type {
  SyncEntry,
  SyncEntryForKind,
  SyncKind,
} from "./syncTypes";

type PayloadDecodeFailureReason = "unknown-future-schema" | "invalid-payload";

export interface SyncPayloadDecodeSuccess<K extends SyncKind = SyncKind> {
  readonly status: "success";
  readonly kind: K;
  readonly entry: SyncEntryForKind<K>;
  readonly entryId: string;
  /** The input is retained for callers that need to forward the exact bytes. */
  readonly raw: string;
}

export interface SyncPayloadDecodeFailure {
  readonly status: "error";
  readonly reason: PayloadDecodeFailureReason;
  readonly message: string;
  readonly error: SyncPayloadError;
}

export type SyncPayloadDecodeResult<K extends SyncKind = SyncKind> =
  | SyncPayloadDecodeSuccess<K>
  | SyncPayloadDecodeFailure;

export class SyncPayloadError extends Error {
  readonly reason: PayloadDecodeFailureReason;

  constructor(reason: PayloadDecodeFailureReason, message: string) {
    super(message);
    this.name = "SyncPayloadError";
    this.reason = reason;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const failure = (
  reason: PayloadDecodeFailureReason,
  message: string,
): SyncPayloadDecodeFailure => {
  const error = new SyncPayloadError(reason, message);
  return {
    status: "error",
    reason,
    message,
    error,
  };
};

const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
};

const isFutureSchema = (value: unknown, expected: number): boolean => (
  typeof value === "number"
  && Number.isInteger(value)
  && value > expected
);

const hasExpectedSchema = (value: unknown, expected: number): boolean => (
  typeof value === "number"
  && Number.isInteger(value)
  && value === expected
);

const schemaFailure = (
  parsed: unknown,
  expectedOuterSchema: number,
): SyncPayloadDecodeFailure | null => {
  if (!isRecord(parsed)) {
    return failure("invalid-payload", "同期payloadのJSONオブジェクトが不正です");
  }

  if (isFutureSchema(parsed.schemaVersion, expectedOuterSchema)) {
    return failure(
      "unknown-future-schema",
      `同期payloadの外側schemaVersion ${String(parsed.schemaVersion)}には未対応です`,
    );
  }
  if (!hasExpectedSchema(parsed.schemaVersion, expectedOuterSchema)) {
    return failure(
      "invalid-payload",
      `同期payloadの外側schemaVersion ${String(parsed.schemaVersion)}が不正です`,
    );
  }
  return null;
};

const inspectInnerShareSchema = (
  entry: unknown,
  kind: SyncKind,
): SyncPayloadDecodeFailure | null => {
  if (!isRecord(entry) || !isRecord(entry.payload)) {
    return failure("invalid-payload", "同期payloadのentryまたはpayloadが不正です");
  }

  const innerSchema = entry.payload.schemaVersion;
  if (isFutureSchema(innerSchema, SHARE_SCHEMA_VERSION)) {
    return failure(
      "unknown-future-schema",
      `同期payloadの条件schemaVersion ${String(innerSchema)}には未対応です`,
    );
  }
  if (!hasExpectedSchema(innerSchema, SHARE_SCHEMA_VERSION)
    && !(typeof innerSchema === "number" && Number.isInteger(innerSchema) && innerSchema >= 1)) {
    return failure(
      "invalid-payload",
      `同期payloadの条件schemaVersion ${String(innerSchema)}が不正です`,
    );
  }
  const hasTarget = Object.prototype.hasOwnProperty.call(entry.payload, "target");
  if ((kind === "target-box" && !hasTarget) || (kind === "enemy-box" && hasTarget)) {
    return failure("invalid-payload", "同期payloadのkindとentryの形式が一致しません");
  }
  return null;
};

const normalizeExpectedEntryId = (expectedEntryId: string | undefined): string | undefined => (
  expectedEntryId === undefined ? undefined : expectedEntryId
);

/** Encode exactly the same storage document shape used by local box storage. */
export function encodeSyncPayload(kind: "target-box", entry: BoxEntry): string;
export function encodeSyncPayload(kind: "enemy-box", entry: EnemyBoxEntry): string;
export function encodeSyncPayload(kind: SyncKind, entry: SyncEntry): string;
export function encodeSyncPayload(entry: SyncEntry, kind: SyncKind): string;
export function encodeSyncPayload(input: { kind: SyncKind; entry: SyncEntry }): string;
export function encodeSyncPayload(
  first: SyncKind | SyncEntry | { kind: SyncKind; entry: SyncEntry },
  second?: SyncEntry | SyncKind,
): string {
  const objectInput = first as { kind?: SyncKind; entry?: SyncEntry };
  const kind: SyncKind = typeof first === "string"
    ? first
    : objectInput.kind ?? second as SyncKind;
  const entry: SyncEntry = typeof first === "string"
    ? second as SyncEntry
    : objectInput.entry ?? first as SyncEntry;

  if (kind === "target-box") {
    return stringifyBoxStorageDocument([entry as BoxEntry]);
  }
  return stringifyEnemyBoxStorageDocument([entry as EnemyBoxEntry]);
}

export const encodeTargetBoxSyncPayload = (entry: BoxEntry): string => (
  stringifyBoxStorageDocument([entry])
);

export const encodeEnemyBoxSyncPayload = (entry: EnemyBoxEntry): string => (
  stringifyEnemyBoxStorageDocument([entry])
);

const decodeTargetBoxPayload = (
  raw: string,
  expectedEntryId?: string,
): SyncPayloadDecodeResult<"target-box"> => {
  const parsed = parseJson(raw);
  const outerFailure = schemaFailure(parsed, BOX_STORAGE_SCHEMA_VERSION);
  if (outerFailure) {
    return outerFailure;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.entries) || parsed.entries.length !== 1) {
    return failure("invalid-payload", "調整対象同期payloadはentryを1件だけ含む必要があります");
  }

  const [rawEntry] = parsed.entries;
  const innerFailure = inspectInnerShareSchema(rawEntry, "target-box");
  if (innerFailure) {
    return innerFailure;
  }
  if (!isRecord(rawEntry) || typeof rawEntry.id !== "string" || rawEntry.id.length === 0) {
    return failure("invalid-payload", "調整対象同期payloadのentry idが空です");
  }
  const normalizedExpectedEntryId = normalizeExpectedEntryId(expectedEntryId);
  if (normalizedExpectedEntryId !== undefined && rawEntry.id !== normalizedExpectedEntryId) {
    return failure("invalid-payload", "調整対象同期payloadのentry idが一致しません");
  }

  const entries = parseBoxStorageDocument(raw);
  if (entries.length !== 1 || entries[0]?.id !== rawEntry.id) {
    return failure("invalid-payload", "調整対象同期payloadを正規化できません");
  }
  return {
    status: "success",
    kind: "target-box",
    entry: entries[0],
    entryId: entries[0].id,
    raw,
  };
};

const decodeEnemyBoxPayload = (
  raw: string,
  expectedEntryId?: string,
): SyncPayloadDecodeResult<"enemy-box"> => {
  const parsed = parseJson(raw);
  const outerFailure = schemaFailure(parsed, ENEMY_BOX_STORAGE_SCHEMA_VERSION);
  if (outerFailure) {
    return outerFailure;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.entries) || parsed.entries.length !== 1) {
    return failure("invalid-payload", "仮想敵同期payloadはentryを1件だけ含む必要があります");
  }

  const [rawEntry] = parsed.entries;
  const innerFailure = inspectInnerShareSchema(rawEntry, "enemy-box");
  if (innerFailure) {
    return innerFailure;
  }
  if (!isRecord(rawEntry) || typeof rawEntry.id !== "string" || rawEntry.id.length === 0) {
    return failure("invalid-payload", "仮想敵同期payloadのentry idが空です");
  }
  const normalizedExpectedEntryId = normalizeExpectedEntryId(expectedEntryId);
  if (normalizedExpectedEntryId !== undefined && rawEntry.id !== normalizedExpectedEntryId) {
    return failure("invalid-payload", "仮想敵同期payloadのentry idが一致しません");
  }

  const entries = parseEnemyBoxStorageDocument(raw);
  if (entries.length !== 1 || entries[0]?.id !== rawEntry.id) {
    return failure("invalid-payload", "仮想敵同期payloadを正規化できません");
  }
  return {
    status: "success",
    kind: "enemy-box",
    entry: entries[0],
    entryId: entries[0].id,
    raw,
  };
};

export function decodeSyncPayload(
  kind: SyncKind,
  raw: string,
  expectedEntryId?: string,
): SyncPayloadDecodeResult;
export function decodeSyncPayload(
  kind: "target-box",
  raw: string,
  expectedEntryId?: string,
): SyncPayloadDecodeResult<"target-box">;
export function decodeSyncPayload(
  kind: "enemy-box",
  raw: string,
  expectedEntryId?: string,
): SyncPayloadDecodeResult<"enemy-box">;
export function decodeSyncPayload(
  raw: string,
  kind: SyncKind,
  expectedEntryId?: string,
): SyncPayloadDecodeResult;
export function decodeSyncPayload(
  input: { kind: SyncKind; raw: string; expectedEntryId?: string },
): SyncPayloadDecodeResult;
export function decodeSyncPayload(
  first: SyncKind | string | { kind: SyncKind; raw: string; expectedEntryId?: string },
  second?: string | SyncKind,
  third?: string,
): SyncPayloadDecodeResult {
  const objectInput = first as { kind?: SyncKind; raw?: string; expectedEntryId?: string };
  const kind: SyncKind = typeof first === "object"
    ? objectInput.kind!
    : typeof first === "string" && (first === "target-box" || first === "enemy-box")
      ? first
      : second as SyncKind;
  const raw: string = typeof first === "object"
    ? objectInput.raw!
    : typeof first === "string" && (first === "target-box" || first === "enemy-box")
      ? second as string
      : first;
  const expectedEntryId = typeof first === "object" ? objectInput.expectedEntryId : third;

  return kind === "target-box"
    ? decodeTargetBoxPayload(raw, expectedEntryId)
    : decodeEnemyBoxPayload(raw, expectedEntryId);
}

export const parseSyncPayload = decodeSyncPayload;

export const decodeSyncPayloadOrThrow = (
  kind: SyncKind,
  raw: string,
  expectedEntryId?: string,
): SyncPayloadDecodeSuccess => {
  const result = decodeSyncPayload(kind, raw, expectedEntryId);
  if (result.status === "error") {
    throw result.error;
  }
  return result;
};

export type { PayloadDecodeFailureReason as SyncPayloadDecodeFailureReason };
