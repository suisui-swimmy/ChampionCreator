import type { ScenarioFormState, TargetFormState } from "./defenceSearchUi";
import {
  createShareStateDocument,
  parseShareStateDocument,
  type ShareStateDocument,
} from "./shareState";

export const DRAFT_STORAGE_KEY = "championcreator.draft.v1";
export const DRAFT_STORAGE_SCHEMA_VERSION = 1;
export const DRAFT_AUTOSAVE_DELAY_MS = 750;

export type DraftStorageDocument = {
  schemaVersion: typeof DRAFT_STORAGE_SCHEMA_VERSION;
  savedAt: string;
  payload: ShareStateDocument;
};

export type DraftLoadResult =
  | { status: "empty" }
  | { status: "success"; draft: DraftStorageDocument }
  | {
      status: "error";
      reason: "corrupt" | "unavailable";
      message: string;
    };

export type DraftMutationResult =
  | { status: "success"; draft?: DraftStorageDocument }
  | {
      status: "error";
      reason: "quota" | "unavailable";
      message: string;
    };

export type DraftBrowserStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export interface DraftStorageOptions {
  readonly storage?: DraftBrowserStorage | null;
  readonly storageKey?: string;
}

export type DraftStorageTarget = DraftBrowserStorage | DraftStorageOptions;

/**
 * Keep the guest draft at the historical key while giving each authenticated
 * account/device pair an isolated local slot. UID and device ID are escaped
 * but otherwise left untouched so their identity is never silently changed.
 */
export const makeAccountDraftStorageKey = (
  ownerUid: string,
  deviceId: string,
): string => (
  `${DRAFT_STORAGE_KEY}.${encodeURIComponent(ownerUid)}.${encodeURIComponent(deviceId)}`
);

export const createAccountDraftStorageKey = makeAccountDraftStorageKey;
export const getAccountDraftStorageKey = makeAccountDraftStorageKey;

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const resolveBrowserStorage = (
  storage?: DraftBrowserStorage,
): { status: "success"; storage: DraftBrowserStorage } | { status: "empty" } | { status: "error" } => {
  if (storage) {
    return { status: "success", storage };
  }

  if (!("localStorage" in globalThis)) {
    return { status: "empty" };
  }

  try {
    return { status: "success", storage: globalThis.localStorage };
  } catch {
    return { status: "error" };
  }
};

const isDraftBrowserStorage = (value: unknown): value is DraftBrowserStorage => (
  isRecord(value)
  && typeof value.getItem === "function"
  && typeof value.setItem === "function"
  && typeof value.removeItem === "function"
);

const resolveDraftStorageOptions = (
  target?: DraftStorageTarget | null,
): DraftStorageOptions => {
  if (target === null || target === undefined) {
    return { storageKey: DRAFT_STORAGE_KEY };
  }
  if (isDraftBrowserStorage(target)) {
    return { storage: target, storageKey: DRAFT_STORAGE_KEY };
  }
  return {
    ...target,
    storageKey: target.storageKey ?? DRAFT_STORAGE_KEY,
  };
};

const isQuotaExceededError = (error: unknown): boolean => {
  if (!isRecord(error)) {
    return false;
  }

  return error.name === "QuotaExceededError"
    || error.name === "NS_ERROR_DOM_QUOTA_REACHED"
    || error.code === 22
    || error.code === 1014;
};

export const createDraftStorageDocument = (
  target: TargetFormState,
  scenarios: ScenarioFormState[],
  now = new Date(),
): DraftStorageDocument => ({
  schemaVersion: DRAFT_STORAGE_SCHEMA_VERSION,
  savedAt: now.toISOString(),
  payload: createShareStateDocument(target, scenarios),
});

export const stringifyDraftStorageDocument = (
  document: DraftStorageDocument,
): string => `${JSON.stringify(document, null, 2)}\n`;

export const parseDraftStorageDocument = (json: string): DraftStorageDocument => {
  const parsed = JSON.parse(json) as unknown;
  if (!isRecord(parsed) || parsed.schemaVersion !== DRAFT_STORAGE_SCHEMA_VERSION) {
    throw new Error(`対応していない下書きです (schemaVersion ${DRAFT_STORAGE_SCHEMA_VERSION} のみ対応)`);
  }
  if (typeof parsed.savedAt !== "string" || !Number.isFinite(Date.parse(parsed.savedAt))) {
    throw new Error("下書きに不正な savedAt があります");
  }
  if (!("payload" in parsed)) {
    throw new Error("下書きに payload がありません");
  }

  const payload = parseShareStateDocument(JSON.stringify(parsed.payload));
  return {
    schemaVersion: DRAFT_STORAGE_SCHEMA_VERSION,
    savedAt: parsed.savedAt,
    payload,
  };
};

export const createDraftFingerprint = (
  target: TargetFormState,
  scenarios: ScenarioFormState[],
): string => JSON.stringify(createShareStateDocument(target, scenarios));

export const scheduleDraftAutosave = (save: () => void): (() => void) => {
  const timer = globalThis.setTimeout(save, DRAFT_AUTOSAVE_DELAY_MS);
  return () => globalThis.clearTimeout(timer);
};

export const loadDraftFromBrowser = (
  target?: DraftStorageTarget | null,
): DraftLoadResult => {
  const options = resolveDraftStorageOptions(target);
  const resolved = resolveBrowserStorage(options.storage ?? undefined);
  if (resolved.status === "empty") {
    return { status: "empty" };
  }
  if (resolved.status === "error") {
    return {
      status: "error",
      reason: "unavailable",
      message: "ブラウザの保存機能を利用できないため、下書きを確認できませんでした",
    };
  }

  let stored: string | null;
  try {
    stored = resolved.storage.getItem(options.storageKey ?? DRAFT_STORAGE_KEY);
  } catch {
    return {
      status: "error",
      reason: "unavailable",
      message: "ブラウザの保存機能を利用できないため、下書きを確認できませんでした",
    };
  }
  if (stored === null) {
    return { status: "empty" };
  }

  try {
    return { status: "success", draft: parseDraftStorageDocument(stored) };
  } catch (error) {
    return {
      status: "error",
      reason: "corrupt",
      message: error instanceof Error
        ? `前回の下書きを読み込めませんでした: ${error.message}`
        : "前回の下書きを読み込めませんでした",
    };
  }
};

export const saveDraftToBrowser = (
  target: TargetFormState,
  scenarios: ScenarioFormState[],
  options: DraftStorageOptions & { now?: Date } = {},
): DraftMutationResult => {
  const resolved = resolveBrowserStorage(options.storage ?? undefined);
  if (resolved.status !== "success") {
    return {
      status: "error",
      reason: "unavailable",
      message: "下書きを保存できませんでした。ブラウザの保存機能を利用できません",
    };
  }

  const draft = createDraftStorageDocument(target, scenarios, options.now);
  try {
    resolved.storage.setItem(
      options.storageKey ?? DRAFT_STORAGE_KEY,
      stringifyDraftStorageDocument(draft),
    );
    return { status: "success", draft };
  } catch (error) {
    return isQuotaExceededError(error)
      ? {
          status: "error",
          reason: "quota",
          message: "下書きを保存できませんでした。ブラウザの保存容量が不足しています",
        }
      : {
          status: "error",
          reason: "unavailable",
          message: "下書きを保存できませんでした。ブラウザの保存機能を利用できません",
        };
  }
};

export const discardDraftFromBrowser = (
  target?: DraftStorageTarget | null,
): DraftMutationResult => {
  const options = resolveDraftStorageOptions(target);
  const resolved = resolveBrowserStorage(options.storage ?? undefined);
  if (resolved.status === "empty") {
    return { status: "success" };
  }
  if (resolved.status === "error") {
    return {
      status: "error",
      reason: "unavailable",
      message: "下書きを削除できませんでした。ブラウザの保存機能を利用できません",
    };
  }

  try {
    resolved.storage.removeItem(options.storageKey ?? DRAFT_STORAGE_KEY);
    return { status: "success" };
  } catch {
    return {
      status: "error",
      reason: "unavailable",
      message: "下書きを削除できませんでした。ブラウザの保存機能を利用できません",
    };
  }
};
