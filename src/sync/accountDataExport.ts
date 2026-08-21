import {
  parseDraftStorageDocument,
  stringifyDraftStorageDocument,
} from "../ui/draftStorage";
import type { AuthUser } from "./authSession";
import {
  type CloudDraftReadResult,
  type CloudDraftRepository,
} from "./firestoreCloudDraftRepository";
import type { CloudDraftRecord } from "./cloudDraftTypes";
import { parseCloudDraftRecord } from "./cloudDraftLocalRepository";
import {
  type CloudSyncRepository,
  type SyncReadResult,
} from "./firestoreSyncRepository";
import { decodeSyncPayload, encodeSyncPayload } from "./syncPayload";
import { isSyncKind, makeSyncRecordKey, type SyncKind, type SyncRecord } from "./syncTypes";

export const ACCOUNT_EXPORT_SCHEMA_VERSION = 1 as const;

export interface AccountExportProfile {
  readonly displayName: string | null;
  readonly email: string | null;
  readonly photoURL: string | null;
}

/** This is intentionally a small, credential-free copy of the auth profile. */
export const sanitizeAccountExportProfile = (
  profile?: Pick<AuthUser, "displayName" | "email" | "photoURL"> | null,
): AccountExportProfile => ({
  displayName: sanitizeProfileString(profile?.displayName, 256),
  email: sanitizeProfileString(profile?.email, 320),
  photoURL: sanitizeProfileString(profile?.photoURL, 2048),
});

const sanitizeProfileString = (value: unknown, maxLength: number): string | null => (
  typeof value === "string" && value.length <= maxLength ? value : null
);

export interface AccountExportWarning {
  readonly code:
    | "synchronization-incomplete"
    | "sync-issues"
    | "draft-issues"
    | "invalid-sync-record"
    | "invalid-draft-record";
  readonly message: string;
}

export interface AccountExportDocument {
  readonly schemaVersion: typeof ACCOUNT_EXPORT_SCHEMA_VERSION;
  readonly exportedAt: string;
  readonly uid: string;
  readonly profile: AccountExportProfile;
  readonly complete: boolean;
  readonly warnings: readonly AccountExportWarning[];
  readonly syncRecords: readonly SyncRecord[];
  readonly draftRecords: readonly CloudDraftRecord[];
}

export class AccountExportError extends Error {
  readonly code:
    | "invalid-uid"
    | "invalid-document"
    | "sync-read-failed"
    | "draft-read-failed"
    | "synchronization-failed"
    | "download-unavailable";

  constructor(
    code: AccountExportError["code"],
    message: string,
  ) {
    super(message);
    this.name = "AccountExportError";
    this.code = code;
  }
}

export type AccountExportBuildResult =
  | {
      readonly status: "complete" | "partial";
      readonly document: AccountExportDocument;
      readonly json: string;
      readonly warnings: readonly AccountExportWarning[];
    }
  | {
      readonly status: "error";
      readonly error: AccountExportError;
    };

export interface AccountExportBuildOptions {
  readonly uid: string;
  readonly profile?: Pick<AuthUser, "displayName" | "email" | "photoURL"> | null;
  readonly syncRecords: readonly SyncRecord[];
  readonly draftRecords: readonly CloudDraftRecord[];
  readonly exportedAt?: string | Date;
  readonly includeTombstones?: boolean;
  readonly synchronizationWarnings?: readonly AccountExportWarning[];
}

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === "string" && value.length > 0
);

const isIsoDate = (value: unknown): value is string => (
  isNonEmptyString(value) && Number.isFinite(Date.parse(value))
);

const resolveExportedAt = (value?: string | Date): string => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return new Date().toISOString();
};

const stableSyncRecord = (uid: string, value: SyncRecord): SyncRecord => {
  if (!value || value.ownerUid !== uid || !isSyncKind(value.kind) || !isNonEmptyString(value.entryId)) {
    throw new AccountExportError("invalid-document", "アカウント書き出しの同期レコードが不正です");
  }
  const kind: SyncKind = value.kind;
  const decoded = decodeSyncPayload(kind, value.payload, value.entryId);
  if (decoded.status === "error") {
    throw new AccountExportError("invalid-document", "アカウント書き出しの同期payloadが不正です");
  }
  if (!Number.isInteger(value.revision) || value.revision < 1
    || !Number.isInteger(value.baseRevision) || value.baseRevision < 0
    || !isNonEmptyString(value.mutationId)
    || !isIsoDate(value.updatedAt)
    || (value.deletedAt !== null && !isIsoDate(value.deletedAt))) {
    throw new AccountExportError("invalid-document", "アカウント書き出しの同期メタデータが不正です");
  }
  return {
    ...value,
    ownerUid: uid,
    recordKey: makeSyncRecordKey(kind, decoded.entryId),
    payload: encodeSyncPayload(kind, decoded.entry),
    tombstone: value.tombstone === true,
    deletedAt: value.deletedAt ?? null,
  };
};

const stableDraftRecord = (uid: string, value: CloudDraftRecord): CloudDraftRecord => {
  const parsed = parseCloudDraftRecord(value, uid);
  if (!parsed) {
    throw new AccountExportError("invalid-document", "アカウント書き出しの下書きレコードが不正です");
  }
  try {
    // Re-run the existing draft parser and serializer so an export never
    // becomes a second, weaker persistence format.
    const document = parseDraftStorageDocument(parsed.payload);
    return {
      ...parsed,
      payload: stringifyDraftStorageDocument(document),
    };
  } catch {
    throw new AccountExportError("invalid-document", "アカウント書き出しの下書きpayloadが不正です");
  }
};

const warning = (
  code: AccountExportWarning["code"],
  message: string,
): AccountExportWarning => ({ code, message });

const uniqueRecords = <T>(records: readonly T[], keyOf: (record: T) => string): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const record of records) {
    const key = keyOf(record);
    if (seen.has(key)) {
      throw new AccountExportError("invalid-document", "アカウント書き出しに重複レコードがあります");
    }
    seen.add(key);
    result.push(record);
  }
  return result;
};

const serializeAccountExportDocument = (document: AccountExportDocument): string => (
  `${JSON.stringify(document, null, 2)}\n`
);

/** Build a parser-normalized export from already synchronized server records. */
export const buildAccountExport = (
  options: AccountExportBuildOptions,
): AccountExportBuildResult => {
  if (!isNonEmptyString(options.uid)) {
    return {
      status: "error",
      error: new AccountExportError("invalid-uid", "アカウントIDを確認できないため書き出せません"),
    };
  }

  const warnings: AccountExportWarning[] = [...(options.synchronizationWarnings ?? [])];
  const syncRecords: SyncRecord[] = [];
  for (const record of options.syncRecords) {
    try {
      const normalized = stableSyncRecord(options.uid, record);
      if (options.includeTombstones !== false || !normalized.tombstone) {
        syncRecords.push(normalized);
      }
    } catch {
      warnings.push(warning("invalid-sync-record", "一部の同期レコードを検証できませんでした"));
    }
  }

  const draftRecords: CloudDraftRecord[] = [];
  for (const record of options.draftRecords) {
    try {
      const normalized = stableDraftRecord(options.uid, record);
      if (options.includeTombstones !== false || normalized.deletedAt === null) {
        draftRecords.push(normalized);
      }
    } catch {
      warnings.push(warning("invalid-draft-record", "一部の下書きレコードを検証できませんでした"));
    }
  }

  try {
    uniqueRecords(syncRecords, (record) => record.recordKey);
    uniqueRecords(draftRecords, (record) => record.deviceId);
  } catch {
    return {
      status: "error",
      error: new AccountExportError("invalid-document", "アカウント書き出しに重複レコードがあります"),
    };
  }

  const exportedAt = resolveExportedAt(options.exportedAt);
  const document: AccountExportDocument = {
    schemaVersion: ACCOUNT_EXPORT_SCHEMA_VERSION,
    exportedAt,
    uid: options.uid,
    profile: sanitizeAccountExportProfile(options.profile),
    complete: warnings.length === 0,
    warnings,
    syncRecords,
    draftRecords,
  };
  return {
    status: document.complete ? "complete" : "partial",
    document,
    json: serializeAccountExportDocument(document),
    warnings,
  };
};

export const createAccountExport = buildAccountExport;

const readResultWarnings = (
  result: SyncReadResult | CloudDraftReadResult,
  source: "sync" | "draft",
): AccountExportWarning[] => {
  if (result.issues.length === 0) return [];
  return [warning(
    source === "sync" ? "sync-issues" : "draft-issues",
    source === "sync"
      ? "一部の同期レコードを読み込めなかったため、完全な書き出しではありません"
      : "一部の下書きを読み込めなかったため、完全な書き出しではありません",
  )];
};

export interface AccountExportSynchronizationSummary {
  readonly status?: "success" | "error";
  readonly outboxCount?: number;
  readonly conflictCount?: number;
  readonly issues?: readonly unknown[];
  readonly error?: { readonly message?: string };
}

export interface AccountDataExportOptions {
  readonly uid: string;
  readonly profile?: Pick<AuthUser, "displayName" | "email" | "photoURL"> | null;
  readonly syncRepository: Pick<CloudSyncRepository, "readAll">;
  readonly draftRepository: Pick<CloudDraftRepository, "readAll">;
  /** Must flush both coordinators before the server reads below. */
  readonly synchronize?: () => Promise<AccountExportSynchronizationSummary | void>;
  readonly exportedAt?: string | Date;
  readonly includeTombstones?: boolean;
}

/**
 * Synchronize first, then read both collections from the server repositories.
 * A pending outbox, conflict, issue, or malformed record yields a visibly
 * partial result; an actual server read failure yields no export document.
 */
export const exportAccountData = async (
  options: AccountDataExportOptions,
): Promise<AccountExportBuildResult> => {
  if (!isNonEmptyString(options.uid)) {
    return {
      status: "error",
      error: new AccountExportError("invalid-uid", "アカウントIDを確認できないため書き出せません"),
    };
  }

  const warnings: AccountExportWarning[] = [];
  let synchronization: AccountExportSynchronizationSummary | void;
  if (options.synchronize) {
    try {
      synchronization = await options.synchronize();
    } catch {
      return {
        status: "error",
        error: new AccountExportError("synchronization-failed", "同期を完了できないため書き出せません"),
      };
    }
    if (synchronization?.status === "error") {
      return {
        status: "error",
        error: new AccountExportError(
          "synchronization-failed",
          synchronization.error?.message ?? "同期を完了できないため書き出せません",
        ),
      };
    }
    if ((synchronization?.outboxCount ?? 0) > 0
      || (synchronization?.conflictCount ?? 0) > 0
      || (synchronization?.issues?.length ?? 0) > 0) {
      warnings.push(warning(
        "synchronization-incomplete",
        "未送信データまたは競合が残っているため、完全な書き出しではありません",
      ));
    }
  }

  let sync: SyncReadResult;
  try {
    sync = await options.syncRepository.readAll();
  } catch {
    return {
      status: "error",
      error: new AccountExportError("sync-read-failed", "同期データをサーバーから読み込めません"),
    };
  }
  if (sync.status === "error") {
    return {
      status: "error",
      error: new AccountExportError("sync-read-failed", "同期データをサーバーから読み込めません"),
    };
  }

  let drafts: CloudDraftReadResult;
  try {
    drafts = await options.draftRepository.readAll();
  } catch {
    return {
      status: "error",
      error: new AccountExportError("draft-read-failed", "下書きデータをサーバーから読み込めません"),
    };
  }
  if (drafts.status === "error") {
    return {
      status: "error",
      error: new AccountExportError("draft-read-failed", "下書きデータをサーバーから読み込めません"),
    };
  }
  warnings.push(...readResultWarnings(sync, "sync"), ...readResultWarnings(drafts, "draft"));

  return buildAccountExport({
    uid: options.uid,
    profile: options.profile,
    syncRecords: sync.records,
    draftRecords: drafts.drafts,
    exportedAt: options.exportedAt,
    includeTombstones: options.includeTombstones,
    synchronizationWarnings: warnings,
  });
};

export const runAccountDataExport = exportAccountData;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

/** Parse a downloaded account export through the same payload parsers. */
export const parseAccountExportDocument = (raw: string): AccountExportDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new AccountExportError("invalid-document", "アカウント書き出しJSONを読み込めません");
  }
  if (!isRecord(parsed)
    || parsed.schemaVersion !== ACCOUNT_EXPORT_SCHEMA_VERSION
    || !isNonEmptyString(parsed.uid)
    || !isIsoDate(parsed.exportedAt)
    || !Array.isArray(parsed.syncRecords)
    || !Array.isArray(parsed.draftRecords)
    || typeof parsed.complete !== "boolean"
    || !Array.isArray(parsed.warnings)) {
    throw new AccountExportError("invalid-document", "アカウント書き出しの形式が不正です");
  }
  const normalized = buildAccountExport({
    uid: parsed.uid,
    profile: isRecord(parsed.profile)
      ? {
          displayName: typeof parsed.profile.displayName === "string" ? parsed.profile.displayName : null,
          email: typeof parsed.profile.email === "string" ? parsed.profile.email : null,
          photoURL: typeof parsed.profile.photoURL === "string" ? parsed.profile.photoURL : null,
        }
      : null,
    syncRecords: parsed.syncRecords as SyncRecord[],
    draftRecords: parsed.draftRecords as CloudDraftRecord[],
    exportedAt: parsed.exportedAt,
    synchronizationWarnings: parsed.warnings as AccountExportWarning[],
  });
  if (normalized.status === "error" || normalized.document.complete !== parsed.complete) {
    throw new AccountExportError("invalid-document", "アカウント書き出しのpayloadを検証できません");
  }
  return normalized.document;
};

export interface AccountExportDownloadOptions {
  readonly filename?: string;
  readonly document?: Document;
  readonly urlApi?: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
}

/** Download only a successfully-built document and always revoke its Blob URL. */
export const downloadAccountExport = (
  result: Exclude<AccountExportBuildResult, { readonly status: "error" }>,
  options: AccountExportDownloadOptions = {},
): string => {
  const document = options.document ?? globalThis.document;
  const urlApi = options.urlApi ?? globalThis.URL;
  if (!document || !urlApi?.createObjectURL || !urlApi.revokeObjectURL) {
    throw new AccountExportError("download-unavailable", "書き出しファイルをダウンロードできません");
  }
  const blob = new Blob([result.json], { type: "application/json;charset=utf-8" });
  const url = urlApi.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = options.filename ?? `championcreator-account-${result.document.uid}.json`;
  anchor.click();
  urlApi.revokeObjectURL(url);
  return anchor.download;
};
