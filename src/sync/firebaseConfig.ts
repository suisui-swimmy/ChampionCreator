import type { FirebaseOptions } from "firebase/app";

/**
 * The small, public part of the Firebase web configuration that the client
 * needs.  These values are not secrets, but keeping them behind this module
 * makes it harder to accidentally pass server credentials to the browser.
 */
export interface FirebaseClientConfig extends FirebaseOptions {
  readonly appCheckSiteKey?: string;
  readonly emulators?: FirebaseEmulatorConfig;
  readonly isDevelopment: boolean;
}

export type FirebaseConfig = FirebaseClientConfig;

export interface FirebaseEmulatorEndpoint {
  readonly host: string;
  readonly port: number;
}

export interface FirebaseEmulatorConfig {
  readonly auth: FirebaseEmulatorEndpoint;
  readonly firestore: FirebaseEmulatorEndpoint;
}

export type FirebaseConfigStatus = "absent" | "misconfigured" | "configured";

export const FIREBASE_REQUIRED_ENV_KEYS = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_APP_ID",
] as const;

export type FirebaseRequiredEnvKey = (typeof FIREBASE_REQUIRED_ENV_KEYS)[number];

export interface FirebaseEnvironment {
  readonly DEV?: boolean;
  readonly MODE?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
  readonly VITE_FIREBASE_APP_CHECK_SITE_KEY?: string;
  readonly VITE_FIREBASE_USE_EMULATORS?: string;
  readonly VITE_FIREBASE_AUTH_EMULATOR_HOST?: string;
  readonly VITE_FIREBASE_FIRESTORE_EMULATOR_HOST?: string;
}

export interface FirebaseConfigAbsent {
  readonly status: "absent";
  readonly config: null;
  readonly missing: readonly [];
  readonly present: readonly [];
  readonly isDevelopment: boolean;
}

export interface FirebaseConfigMisconfigured {
  readonly status: "misconfigured";
  readonly config: null;
  /** Only environment variable names are retained; values are never exposed. */
  readonly missing: readonly string[];
  readonly present: readonly string[];
  readonly invalid: readonly string[];
  readonly isDevelopment: boolean;
}

export interface FirebaseConfigConfigured {
  readonly status: "configured";
  readonly config: FirebaseClientConfig;
  readonly missing: readonly [];
  readonly present: readonly string[];
  readonly isDevelopment: boolean;
}

export type FirebaseConfigResolution =
  | FirebaseConfigAbsent
  | FirebaseConfigMisconfigured
  | FirebaseConfigConfigured;

const getDefaultEnvironment = (): FirebaseEnvironment => {
  // Read an explicit allowlist instead of returning `import.meta.env` as an
  // object. Vite expands a whole-object access with every `VITE_*` value,
  // which could accidentally bundle an unrelated secret-like variable.
  return {
    DEV: import.meta.env.DEV,
    MODE: import.meta.env.MODE,
    VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
    VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
    VITE_FIREBASE_MEASUREMENT_ID: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
    VITE_FIREBASE_APP_CHECK_SITE_KEY: import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY,
    VITE_FIREBASE_USE_EMULATORS: import.meta.env.VITE_FIREBASE_USE_EMULATORS,
    VITE_FIREBASE_AUTH_EMULATOR_HOST: import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST,
    VITE_FIREBASE_FIRESTORE_EMULATOR_HOST:
      import.meta.env.VITE_FIREBASE_FIRESTORE_EMULATOR_HOST,
  };
};

const trimEnvironmentValue = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

const parsePort = (value: string | undefined, fallback: number): number | null => {
  if (!value) {
    return fallback;
  }

  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
};

const parseEmulatorEndpoint = (
  rawValue: string | undefined,
  fallbackHost: string,
  fallbackPort: number,
): FirebaseEmulatorEndpoint | null => {
  const raw = trimEnvironmentValue(rawValue);
  if (!raw) {
    return { host: fallbackHost, port: fallbackPort };
  }

  try {
    const url = raw.includes("://") ? new URL(raw) : new URL(`http://${raw}`);
    const host = url.hostname.trim();
    const port = parsePort(url.port || undefined, fallbackPort);
    if (!host || port === null || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }
    return { host, port };
  } catch {
    return null;
  }
};

const isDevelopmentEnvironment = (environment: FirebaseEnvironment): boolean =>
  environment.DEV === true;

/**
 * Resolve Firebase's public browser configuration without initializing any
 * Firebase SDK.  An empty environment is deliberately different from a
 * partially-filled environment: the former is the normal guest/local-first
 * build, while the latter is an operator configuration error.
 */
export function resolveFirebaseConfig(
  environment: FirebaseEnvironment = getDefaultEnvironment(),
): FirebaseConfigResolution {
  const isDevelopment = isDevelopmentEnvironment(environment);
  const requiredValues = FIREBASE_REQUIRED_ENV_KEYS.map((key) => [
    key,
    trimEnvironmentValue(environment[key]),
  ] as const);
  const present = requiredValues.filter(([, value]) => value !== undefined).map(([key]) => key);
  const missing = requiredValues.filter(([, value]) => value === undefined).map(([key]) => key);

  if (present.length === 0) {
    return {
      status: "absent",
      config: null,
      missing: [],
      present: [],
      isDevelopment,
    };
  }

  const invalid: string[] = [];
  const emulatorPreference = trimEnvironmentValue(environment.VITE_FIREBASE_USE_EMULATORS);
  if (
    isDevelopment
    && emulatorPreference !== "true"
    && emulatorPreference !== "false"
  ) {
    invalid.push("VITE_FIREBASE_USE_EMULATORS");
  }
  const useEmulators = isDevelopment && emulatorPreference === "true";
  const authEmulator = useEmulators
    ? parseEmulatorEndpoint(
        environment.VITE_FIREBASE_AUTH_EMULATOR_HOST,
        "127.0.0.1",
        9_099,
      )
    : undefined;
  const firestoreEmulator = useEmulators
    ? parseEmulatorEndpoint(
        environment.VITE_FIREBASE_FIRESTORE_EMULATOR_HOST,
        "127.0.0.1",
        8_080,
      )
    : undefined;

  if (useEmulators && (!authEmulator || !firestoreEmulator)) {
    if (!authEmulator) {
      invalid.push("VITE_FIREBASE_AUTH_EMULATOR_HOST");
    }
    if (!firestoreEmulator) {
      invalid.push("VITE_FIREBASE_FIRESTORE_EMULATOR_HOST");
    }
  }

  if (missing.length > 0 || invalid.length > 0) {
    return {
      status: "misconfigured",
      config: null,
      missing,
      present,
      invalid,
      isDevelopment,
    };
  }

  const emulators = useEmulators
    ? {
        auth: authEmulator!,
        firestore: firestoreEmulator!,
      }
    : undefined;

  const config: FirebaseClientConfig = {
    apiKey: trimEnvironmentValue(environment.VITE_FIREBASE_API_KEY)!,
    authDomain: trimEnvironmentValue(environment.VITE_FIREBASE_AUTH_DOMAIN)!,
    projectId: trimEnvironmentValue(environment.VITE_FIREBASE_PROJECT_ID)!,
    appId: trimEnvironmentValue(environment.VITE_FIREBASE_APP_ID)!,
    storageBucket: trimEnvironmentValue(environment.VITE_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: trimEnvironmentValue(environment.VITE_FIREBASE_MESSAGING_SENDER_ID),
    measurementId: trimEnvironmentValue(environment.VITE_FIREBASE_MEASUREMENT_ID),
    appCheckSiteKey: trimEnvironmentValue(environment.VITE_FIREBASE_APP_CHECK_SITE_KEY),
    emulators,
    isDevelopment,
  };

  return {
    status: "configured",
    config,
    missing: [],
    present,
    isDevelopment,
  };
}

export const readFirebaseConfig = resolveFirebaseConfig;
export const getFirebaseConfig = resolveFirebaseConfig;
