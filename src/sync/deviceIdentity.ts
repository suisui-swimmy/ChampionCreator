/**
 * A device identity is intentionally small and opaque. It is used to keep
 * simultaneous cloud drafts from different devices separate; it is not an
 * account identifier and must not contain a user name or user-agent string.
 */

export const DEVICE_ID_STORAGE_KEY = "championcreator.device.v1";
export const DEVICE_STORAGE_KEY = DEVICE_ID_STORAGE_KEY;
export const DEVICE_ID_SCHEMA_VERSION = 1 as const;
export type DeviceIdSchemaVersion = typeof DEVICE_ID_SCHEMA_VERSION;

export interface DeviceIdentity {
  readonly deviceId: string;
  readonly deviceLabel: string;
}

export interface DeviceIdentityStorageDocument extends DeviceIdentity {
  readonly schemaVersion: DeviceIdSchemaVersion;
}

export interface DeviceIdentityStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface DeviceLabelSource {
  readonly platform?: unknown;
  readonly userAgent?: unknown;
  readonly userAgentData?: {
    readonly platform?: unknown;
    readonly brands?: readonly { readonly brand?: unknown }[];
  } | null;
}

export interface CreateDeviceIdentityOptions {
  readonly deviceLabel?: string;
  readonly source?: DeviceLabelSource;
  readonly randomUUID?: () => string;
}

export type DeviceIdentityLoadResult =
  | { readonly status: "empty" }
  | { readonly status: "success"; readonly identity: DeviceIdentity }
  | {
      readonly status: "error";
      readonly reason: "corrupt" | "unavailable";
      readonly message: string;
    };

export type DeviceIdentityMutationResult =
  | { readonly status: "success"; readonly identity: DeviceIdentity }
  | {
      readonly status: "error";
      readonly reason: "corrupt" | "quota" | "unavailable";
      readonly message: string;
    };

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const isNonEmptyString = (value: unknown): value is string => (
  typeof value === "string" && value.length > 0
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isOpaqueUuid = (value: unknown): value is string => (
  typeof value === "string" && UUID_PATTERN.test(value)
);

const isSafeLabel = (value: unknown): value is string => (
  typeof value === "string"
  && value.length > 0
  && value.length <= 80
  && !/[\u0000-\u001f\u007f]/u.test(value)
);

const safeLabel = (value: string): string => {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
  return normalized.slice(0, 80) || "この端末";
};

const asText = (value: unknown): string => typeof value === "string" ? value : "";

const detectPlatform = (source: DeviceLabelSource): string => {
  const platform = asText(source.userAgentData?.platform || source.platform).toLowerCase();
  const userAgent = asText(source.userAgent).toLowerCase();

  if (platform.includes("android") || userAgent.includes("android")) {
    return "Android";
  }
  if (platform.includes("iphone") || platform.includes("ipad") || /iphone|ipad|ipod/u.test(userAgent)) {
    return "iOS";
  }
  if (platform.includes("win") || userAgent.includes("windows")) {
    return "Windows";
  }
  if (platform.includes("mac") || userAgent.includes("mac os")) {
    return "macOS";
  }
  if (platform.includes("cros") || userAgent.includes("cros")) {
    return "ChromeOS";
  }
  if (platform.includes("linux") || userAgent.includes("linux")) {
    return "Linux";
  }
  return "Unknown platform";
};

const detectBrowser = (source: DeviceLabelSource): string => {
  const userAgent = asText(source.userAgent).toLowerCase();
  const brands = source.userAgentData?.brands
    ?.map((brand) => asText(brand.brand).toLowerCase())
    .join(" ") ?? "";
  const browserText = `${userAgent} ${brands}`;

  if (browserText.includes("edg")) {
    return "Edge";
  }
  if (browserText.includes("opr") || browserText.includes("opera")) {
    return "Opera";
  }
  if (browserText.includes("firefox")) {
    return "Firefox";
  }
  if (browserText.includes("samsungbrowser")) {
    return "Samsung Internet";
  }
  if (browserText.includes("chrome") || browserText.includes("chromium")) {
    return "Chrome";
  }
  if (browserText.includes("safari")) {
    return "Safari";
  }
  return "Unknown browser";
};

const getGlobalDeviceLabelSource = (): DeviceLabelSource => {
  if (typeof globalThis === "undefined" || !("navigator" in globalThis)) {
    return {};
  }
  try {
    const navigatorValue = globalThis.navigator as unknown as DeviceLabelSource;
    return navigatorValue;
  } catch {
    return {};
  }
};

/** Returns an intentionally coarse platform/browser label, never raw UA data. */
export const getSafeDeviceLabel = (source = getGlobalDeviceLabelSource()): string => (
  safeLabel(`${detectPlatform(source)} / ${detectBrowser(source)}`)
);

export const createDeviceLabel = getSafeDeviceLabel;
export const getDefaultDeviceLabel = getSafeDeviceLabel;

const fallbackUuid = (): string => {
  const cryptoValue = typeof globalThis !== "undefined" && "crypto" in globalThis
    ? globalThis.crypto
    : undefined;
  if (cryptoValue?.getRandomValues) {
    const bytes = new Uint8Array(16);
    cryptoValue.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // This path is only for runtimes without Web Crypto (for example a very
  // small test shim). It still creates an opaque UUID-shaped value and is
  // replaced by crypto.randomUUID in supported browsers.
  const randomHex = (length: number): string => Array.from(
    { length },
    () => Math.floor(Math.random() * 16).toString(16),
  ).join("");
  return `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${randomHex(3)}-${randomHex(12)}`;
};

export const generateOpaqueDeviceId = (randomUUID?: () => string): string => {
  const candidate = randomUUID?.()
    ?? (typeof globalThis !== "undefined" && "crypto" in globalThis && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : fallbackUuid());
  if (!isOpaqueUuid(candidate)) {
    throw new Error("端末IDの生成結果がUUIDではありません");
  }
  return candidate;
};

export const createDeviceIdentity = (
  options: CreateDeviceIdentityOptions = {},
): DeviceIdentity => ({
  deviceId: generateOpaqueDeviceId(options.randomUUID),
  deviceLabel: safeLabel(options.deviceLabel ?? getSafeDeviceLabel(options.source)),
});

const corrupt = (message: string): Error => new Error(message);

export const parseDeviceIdentityDocument = (raw: string): DeviceIdentityStorageDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw corrupt("端末識別情報のJSONを読み込めません");
  }
  if (!isRecord(parsed)
    || parsed.schemaVersion !== DEVICE_ID_SCHEMA_VERSION
    || !isOpaqueUuid(parsed.deviceId)
    || !isSafeLabel(parsed.deviceLabel)) {
    throw corrupt(`対応していない端末識別情報です (schemaVersion ${DEVICE_ID_SCHEMA_VERSION} のみ対応)`);
  }
  return {
    schemaVersion: DEVICE_ID_SCHEMA_VERSION,
    deviceId: parsed.deviceId,
    deviceLabel: parsed.deviceLabel,
  };
};

export const stringifyDeviceIdentityDocument = (
  identity: DeviceIdentity,
): string => {
  if (!isOpaqueUuid(identity.deviceId) || !isSafeLabel(identity.deviceLabel)) {
    throw corrupt("端末識別情報が不正です");
  }
  return JSON.stringify({
    schemaVersion: DEVICE_ID_SCHEMA_VERSION,
    deviceId: identity.deviceId,
    deviceLabel: identity.deviceLabel,
  });
};

const isQuotaExceededError = (error: unknown): boolean => (
  isRecord(error)
  && (error.name === "QuotaExceededError"
    || error.name === "NS_ERROR_DOM_QUOTA_REACHED"
    || error.code === 22
    || error.code === 1014)
);

const resolveStorage = (
  storage?: DeviceIdentityStorageLike | null,
): DeviceIdentityStorageLike | null => {
  if (storage !== undefined) {
    return storage;
  }
  if (typeof globalThis === "undefined" || !("localStorage" in globalThis)) {
    return null;
  }
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

export const loadDeviceIdentity = (
  storage?: DeviceIdentityStorageLike | null,
): DeviceIdentityLoadResult => {
  const resolved = resolveStorage(storage);
  if (!resolved) {
    return {
      status: "error",
      reason: "unavailable",
      message: "端末識別情報を読み込めません。ブラウザの保存機能を利用できません",
    };
  }

  let raw: string | null;
  try {
    raw = resolved.getItem(DEVICE_ID_STORAGE_KEY);
  } catch {
    return {
      status: "error",
      reason: "unavailable",
      message: "端末識別情報を読み込めません。ブラウザの保存機能を利用できません",
    };
  }
  if (raw === null) {
    return { status: "empty" };
  }
  try {
    const document = parseDeviceIdentityDocument(raw);
    return {
      status: "success",
      identity: { deviceId: document.deviceId, deviceLabel: document.deviceLabel },
    };
  } catch (error) {
    return {
      status: "error",
      reason: "corrupt",
      message: error instanceof Error
        ? `端末識別情報を読み込めません: ${error.message}`
        : "端末識別情報を読み込めません",
    };
  }
};

export const saveDeviceIdentity = (
  identity: DeviceIdentity,
  storage?: DeviceIdentityStorageLike | null,
): DeviceIdentityMutationResult => {
  const resolved = resolveStorage(storage);
  if (!resolved) {
    return {
      status: "error",
      reason: "unavailable",
      message: "端末識別情報を保存できません。ブラウザの保存機能を利用できません",
    };
  }

  let serialized: string;
  try {
    serialized = stringifyDeviceIdentityDocument(identity);
  } catch (error) {
    return {
      status: "error",
      reason: "corrupt",
      message: error instanceof Error ? error.message : "端末識別情報が不正です",
    };
  }
  try {
    resolved.setItem(DEVICE_ID_STORAGE_KEY, serialized);
  } catch (error) {
    return isQuotaExceededError(error)
      ? {
          status: "error",
          reason: "quota",
          message: "端末識別情報を保存できません。ブラウザの保存容量が不足しています",
        }
      : {
          status: "error",
          reason: "unavailable",
          message: "端末識別情報を保存できません。ブラウザの保存機能を利用できません",
        };
  }
  return { status: "success", identity };
};

/** Load the persisted identity, creating it once when this browser is empty. */
export const loadOrCreateDeviceIdentity = (
  storage?: DeviceIdentityStorageLike | null,
  options: CreateDeviceIdentityOptions = {},
): DeviceIdentityMutationResult => {
  const loaded = loadDeviceIdentity(storage);
  if (loaded.status === "success") {
    return loaded;
  }
  if (loaded.status === "error") {
    return loaded;
  }
  return saveDeviceIdentity(createDeviceIdentity(options), storage);
};

export const resolveDeviceIdentity = loadOrCreateDeviceIdentity;
export const getDeviceIdentity = loadOrCreateDeviceIdentity;
