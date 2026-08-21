import {
  collection as firebaseCollection,
  doc as firebaseDoc,
  getDocsFromServer as firebaseGetDocsFromServer,
  writeBatch as firebaseWriteBatch,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type Firestore,
  type WriteBatch,
} from "firebase/firestore";
import { makeAccountDraftStorageKey, DRAFT_STORAGE_KEY } from "../ui/draftStorage";
import {
  CLOUD_DRAFT_LOCAL_STORAGE_KEY_PREFIX,
  makeCloudDraftStorageKey,
} from "./cloudDraftLocalRepository";
import { makeMigrationStateStorageKey } from "./migrationStorage";
import { AuthSessionError, type AuthUser } from "./authSession";
import {
  getCloudDraftCollectionPath,
} from "./firestoreCloudDraftRepository";
import {
  getSyncCollectionPath,
  sanitizeFirestoreError,
} from "./firestoreSyncRepository";
import { SYNC_STORAGE_KEY_PREFIX, makeSyncStorageKey } from "./syncTypes";

/**
 * The small Firestore surface used by account deletion.  It intentionally
 * lists raw snapshots instead of going through the normal parsers: malformed
 * or future documents still belong to the account and must be deleted.
 */
export interface AccountDeletionFirestoreDependencies {
  readonly collection: (firestore: unknown, path: string) => unknown;
  readonly doc: (collection: unknown, documentId: string) => AccountDeletionDocumentReference;
  readonly getDocsFromServer: (collection: unknown) => Promise<AccountDeletionQuerySnapshot>;
  readonly writeBatch: (firestore: unknown) => AccountDeletionWriteBatch;
}

export interface AccountDeletionDocumentReference {
  readonly id?: string;
  readonly path?: string;
}

export interface AccountDeletionDocumentSnapshot {
  readonly id: string;
}

export interface AccountDeletionQuerySnapshot {
  readonly docs: readonly AccountDeletionDocumentSnapshot[];
}

export interface AccountDeletionWriteBatch {
  delete(reference: AccountDeletionDocumentReference): unknown;
  commit(): Promise<unknown>;
}

const defaultFirestoreDependencies: AccountDeletionFirestoreDependencies = {
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
    ) as unknown as AccountDeletionQuerySnapshot
  ),
  writeBatch: (firestore) => firebaseWriteBatch(firestore as Firestore) as WriteBatch,
};

/** Firebase/Auth operations needed by the deletion flow, without exposing a Firebase User. */
export interface AccountDeletionAuthGateway {
  readonly reauthenticateWithGoogle?: (expectedUid: string) => Promise<AuthUser>;
  readonly reauthenticate?: (expectedUid: string) => Promise<AuthUser>;
  readonly deleteAccount?: (expectedUid: string) => Promise<void>;
  readonly deleteCurrentUser?: (expectedUid: string) => Promise<void>;
  /** Return null when Firebase currently has no user. */
  readonly getCurrentUserUid?: () => string | null;
}

export interface AccountDeletionStorageLike {
  readonly length?: number;
  readonly key?: (index: number) => string | null;
  removeItem(key: string): void;
}

export type AccountDeletionErrorCode =
  | "not-authenticated"
  | "unsupported"
  | "uid-changed"
  | "reauthentication-failed"
  | "cloud-read-failed"
  | "cloud-delete-failed"
  | "cloud-not-empty"
  | "local-cleanup-failed"
  | "delete-account-failed";

export class AccountDeletionError extends Error {
  readonly code: AccountDeletionErrorCode;
  readonly retryable: boolean;
  /** True once physical cloud deletion may have changed account data. */
  readonly destructive: boolean;

  constructor(
    code: AccountDeletionErrorCode,
    message: string,
    options: { readonly retryable?: boolean; readonly destructive?: boolean } = {},
  ) {
    super(message);
    this.name = "AccountDeletionError";
    this.code = code;
    this.retryable = options.retryable ?? code !== "uid-changed";
    this.destructive = options.destructive ?? false;
  }
}

export interface AccountDeletionOptions {
  readonly uid: string;
  readonly auth: AccountDeletionAuthGateway;
  readonly firestore?: unknown;
  readonly dependencies?: Partial<AccountDeletionFirestoreDependencies>;
  readonly sdk?: Partial<AccountDeletionFirestoreDependencies>;
  readonly storage?: AccountDeletionStorageLike | null;
  /** Current device id is optional; all matching UID-scoped keys are removed. */
  readonly deviceId?: string | null;
  /** After reauthentication, suspend providers and await any in-flight sync. */
  readonly prepareAccountDeletion?: () => void | Promise<void>;
  /** Resume providers only when failure occurred before physical deletion began. */
  readonly resumeAccountOperations?: () => void;
  /** An outer lifecycle generation can invalidate this operation after any await. */
  readonly isCurrent?: () => boolean;
  readonly maxDeletePasses?: number;
}

export interface AccountDeletionResult {
  readonly uid: string;
  readonly deletedSyncRecords: number;
  readonly deletedDrafts: number;
  readonly clearedLocalKeys: readonly string[];
}

const ACCOUNT_DELETE_BATCH_SIZE = 450;
const DEFAULT_MAX_DELETE_PASSES = 10;

const getDefaultStorage = (): AccountDeletionStorageLike | null => {
  if (typeof globalThis.localStorage === "undefined") return null;
  return globalThis.localStorage;
};

const encodeKeyPart = (value: string): string => encodeURIComponent(value);

const getCurrentUid = (auth: AccountDeletionAuthGateway): string | null | undefined => {
  if (typeof auth.getCurrentUserUid !== "function") return undefined;
  return auth.getCurrentUserUid();
};

const assertCurrent = (
  options: AccountDeletionOptions,
  phase: string,
): void => {
  if (options.isCurrent && !options.isCurrent()) {
    throw new AccountDeletionError(
      "uid-changed",
      "アカウント操作の対象が変わったため、削除を中止しました",
      { retryable: false },
    );
  }
  const currentUid = getCurrentUid(options.auth);
  if (currentUid !== undefined && currentUid !== options.uid) {
    throw new AccountDeletionError(
      "uid-changed",
      `アカウント操作中に認証状態が変わったため、${phase}を中止しました`,
      { retryable: false },
    );
  }
};

const asAccountError = (
  error: unknown,
  fallbackCode: AccountDeletionErrorCode,
  fallbackMessage: string,
): AccountDeletionError => {
  if (error instanceof AccountDeletionError) return error;
  if (error instanceof AuthSessionError) {
    // AuthSessionError already owns a stable, provider-safe message and never
    // retains the raw Firebase error as a cause.
    return new AccountDeletionError(fallbackCode, error.message, {
      retryable: error.retryable,
    });
  }
  return new AccountDeletionError(fallbackCode, fallbackMessage);
};

const getAuthReauthenticate = (
  auth: AccountDeletionAuthGateway,
): ((expectedUid: string) => Promise<AuthUser>) | null => (
  auth.reauthenticateWithGoogle ?? auth.reauthenticate ?? null
);

const getAuthDelete = (
  auth: AccountDeletionAuthGateway,
): ((expectedUid: string) => Promise<void>) | null => (
  auth.deleteAccount ?? auth.deleteCurrentUser ?? null
);

const getStorageKeys = (
  uid: string,
  deviceId: string | null | undefined,
  storage: AccountDeletionStorageLike,
): readonly string[] => {
  const encodedUid = encodeKeyPart(uid);
  const exactKeys = new Set<string>([
    makeSyncStorageKey(uid),
    makeMigrationStateStorageKey(uid),
  ]);
  if (deviceId) {
    exactKeys.add(makeCloudDraftStorageKey(uid, deviceId));
    exactKeys.add(makeAccountDraftStorageKey(uid, deviceId));
  }

  const prefixes = [
    `${SYNC_STORAGE_KEY_PREFIX}.${encodedUid}.`,
    `${CLOUD_DRAFT_LOCAL_STORAGE_KEY_PREFIX}.${encodedUid}.`,
    `${DRAFT_STORAGE_KEY}.${encodedUid}.`,
  ];
  const allKeys = new Set<string>(exactKeys);
  if (typeof storage.length === "number" && typeof storage.key === "function") {
    const scanned: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key) scanned.push(key);
    }
    for (const key of scanned) {
      if (prefixes.some((prefix) => key === prefix || key.startsWith(prefix))) {
        allKeys.add(key);
      }
    }
  }
  return [...allKeys];
};

const splitChunks = <T,>(values: readonly T[], size: number): readonly T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push([...values.slice(index, index + size)]);
  }
  return chunks;
};

/**
 * Delete an account's cloud data and Firebase Auth identity in a safe order.
 * The Auth SDK call is intentionally last: if any read, batch, verification,
 * or local cleanup fails, the user can retry while the account still exists.
 */
export async function deleteAccount(options: AccountDeletionOptions): Promise<AccountDeletionResult> {
  const {
    uid,
    auth,
    firestore,
    storage = getDefaultStorage(),
  } = options;
  if (!uid) {
    throw new AccountDeletionError("not-authenticated", "ログイン中のアカウントがありません", {
      retryable: false,
    });
  }
  const reauthenticate = getAuthReauthenticate(auth);
  const deleteCurrentUser = getAuthDelete(auth);
  if (!reauthenticate || !deleteCurrentUser || firestore === undefined) {
    throw new AccountDeletionError(
      "unsupported",
      "アカウント削除を利用できる設定がありません",
      { retryable: false },
    );
  }

  const dependencies: AccountDeletionFirestoreDependencies = {
    ...defaultFirestoreDependencies,
    ...options.dependencies,
    ...options.sdk,
  };
  const maxDeletePasses = Math.max(1, Math.floor(options.maxDeletePasses ?? DEFAULT_MAX_DELETE_PASSES));
  let operationSucceeded = false;
  let destructivePhaseStarted = false;
  let deletedSyncRecords = 0;
  let deletedDrafts = 0;
  let clearedLocalKeys: readonly string[] = [];

  const deleteCollection = async (
    path: string,
    label: "syncRecords" | "drafts",
  ): Promise<number> => {
    let deleted = 0;
    for (let pass = 0; pass < maxDeletePasses; pass += 1) {
      assertCurrent(options, `${label}の確認`);
      let collectionReference: unknown;
      let snapshot: AccountDeletionQuerySnapshot;
      try {
        collectionReference = dependencies.collection(firestore, path);
        snapshot = await dependencies.getDocsFromServer(collectionReference);
        assertCurrent(options, `${label}の確認`);
      } catch (error) {
        if (error instanceof AccountDeletionError) throw error;
        const safe = sanitizeFirestoreError(error);
        throw new AccountDeletionError(
          "cloud-read-failed",
          `アカウントデータを読み込めませんでした（${safe.message}）`,
        );
      }
      const documents = Array.isArray(snapshot.docs) ? snapshot.docs : [];
      if (documents.length === 0) return deleted;

      for (const chunk of splitChunks(documents, ACCOUNT_DELETE_BATCH_SIZE)) {
        assertCurrent(options, `${label}の削除`);
        try {
          const batch = dependencies.writeBatch(firestore);
          for (const document of chunk) {
            batch.delete(dependencies.doc(collectionReference, document.id));
          }
          await batch.commit();
          assertCurrent(options, `${label}の削除`);
        } catch (error) {
          if (error instanceof AccountDeletionError) throw error;
          const safe = sanitizeFirestoreError(error);
          throw new AccountDeletionError(
            "cloud-delete-failed",
            `アカウントデータを削除できませんでした（${safe.message}）`,
          );
        }
        deleted += chunk.length;
      }
    }
    throw new AccountDeletionError(
      "cloud-not-empty",
      `アカウントの${label}を削除しきれませんでした。再試行してください`,
    );
  };

  try {
    assertCurrent(options, "削除");
    try {
      const result = await reauthenticate(uid);
      assertCurrent(options, "再認証");
      if (!result || result.uid !== uid) {
        throw new AccountDeletionError(
          "uid-changed",
          "再認証したアカウントが削除対象と一致しません",
          { retryable: false },
        );
      }
    } catch (error) {
      throw asAccountError(
        error,
        "reauthentication-failed",
        "アカウントを再認証できませんでした。もう一度お試しください",
      );
    }

    // Reauthentication may return focus to the page and start an automatic
    // sync. Suspend providers only after the popup succeeds, then await that
    // in-flight work before deleting any document. A cancelled popup leaves
    // the current workspace completely untouched.
    if (options.prepareAccountDeletion) {
      try {
        await options.prepareAccountDeletion();
        assertCurrent(options, "削除");
      } catch (error) {
        throw asAccountError(
          error,
          "cloud-delete-failed",
          "同期処理を停止できなかったため、アカウント削除を中止しました",
        );
      }
    }

    destructivePhaseStarted = true;
    // Revisit both collections after the first pair. This catches a current
    // account write that was already in flight on another tab while the other
    // collection was being cleared. Cross-device deletion cannot be fully
    // atomic in a static client app, so the final Auth deletion remains the
    // boundary that prevents normal future owner writes.
    for (let reconciliationPass = 0; reconciliationPass < 2; reconciliationPass += 1) {
      deletedSyncRecords += await deleteCollection(getSyncCollectionPath(uid), "syncRecords");
      deletedDrafts += await deleteCollection(getCloudDraftCollectionPath(uid), "drafts");
    }
    assertCurrent(options, "削除完了の確認");

    // Physical deletion is acknowledged by the server, and each collection
    // was re-listed until empty above. Do local cleanup only after that point;
    // legacy box/default-example keys are intentionally outside this set.
    if (storage) {
      try {
        const keys = getStorageKeys(uid, options.deviceId, storage);
        for (const key of keys) storage.removeItem(key);
        clearedLocalKeys = keys;
      } catch {
        throw new AccountDeletionError(
          "local-cleanup-failed",
          "ブラウザ内のアカウントデータを削除できませんでした。再試行してください",
        );
      }
    }
    assertCurrent(options, "認証削除");

    try {
      await deleteCurrentUser(uid);
    } catch (error) {
      throw asAccountError(
        error,
        "delete-account-failed",
        "アカウントを削除できませんでした。もう一度お試しください",
      );
    }
    operationSucceeded = true;
    return {
      uid,
      deletedSyncRecords,
      deletedDrafts,
      clearedLocalKeys,
    };
  } catch (error) {
    if (error instanceof AccountDeletionError && destructivePhaseStarted && !error.destructive) {
      throw new AccountDeletionError(error.code, error.message, {
        retryable: error.retryable,
        destructive: true,
      });
    }
    if (destructivePhaseStarted && !(error instanceof AccountDeletionError)) {
      throw new AccountDeletionError(
        "cloud-delete-failed",
        "アカウントデータの削除中に問題が発生しました。再試行してください",
        { destructive: true },
      );
    }
    throw error;
  } finally {
    // A successful delete causes Firebase Auth to emit signed-out. Do not
    // resume a provider in that window; the caller's auth listener owns the
    // namespace transition. Failures leave the session active and retryable.
    if (!operationSucceeded && !destructivePhaseStarted) {
      try {
        options.resumeAccountOperations?.();
      } catch {
        // Never mask the deletion failure with a provider cleanup exception.
      }
    }
  }
}

export const deleteCurrentAccount = deleteAccount;
export const createAccountDeletionService = (options: AccountDeletionOptions) => ({
  deleteAccount: () => deleteAccount(options),
});

export const ACCOUNT_DELETE_MAX_BATCH_SIZE = ACCOUNT_DELETE_BATCH_SIZE;
export const getAccountDeletionStorageKeys = getStorageKeys;
