import {
  FirebaseApp,
  FirebaseOptions,
  getApps,
  initializeApp,
} from "firebase/app";
import {
  Auth,
  connectAuthEmulator,
  getAuth,
} from "firebase/auth";
import {
  Firestore,
  connectFirestoreEmulator,
  getFirestore,
} from "firebase/firestore";
import {
  AppCheck,
  ReCaptchaEnterpriseProvider,
  initializeAppCheck,
} from "firebase/app-check";
import {
  FirebaseConfigResolution,
  FirebaseClientConfig,
  resolveFirebaseConfig,
} from "./firebaseConfig";

export type FirebaseClientUnavailableReason = "not-configured" | "misconfigured";

export type FirebaseClientErrorReason = "initialization-failed" | "emulator-connection-failed";

export interface ReadyFirebaseClient {
  readonly status: "ready";
  readonly app: FirebaseApp;
  readonly auth: Auth;
  readonly firestore: Firestore;
  readonly config: FirebaseClientConfig;
  readonly appCheck: AppCheck | null;
  readonly appCheckStatus: "disabled" | "initialized" | "failed";
  readonly emulatorStatus: "disabled" | "connected" | "failed";
}

export interface UnavailableFirebaseClient {
  readonly status: "unavailable";
  readonly reason: FirebaseClientUnavailableReason;
  readonly configStatus: "absent" | "misconfigured";
  /** Environment variable names only. Values are intentionally not retained. */
  readonly missing: readonly string[];
  readonly invalid: readonly string[];
  readonly isDevelopment: boolean;
}

export interface FailedFirebaseClient {
  readonly status: "error";
  readonly reason: FirebaseClientErrorReason;
  readonly configStatus: "configured";
  readonly isDevelopment: boolean;
}

export type FirebaseClient =
  | ReadyFirebaseClient
  | UnavailableFirebaseClient
  | FailedFirebaseClient;

export interface FirebaseSdkDependencies {
  readonly initializeApp: (options: FirebaseOptions, name?: string) => FirebaseApp;
  readonly getApps: () => readonly FirebaseApp[];
  readonly getAuth: (app?: FirebaseApp) => Auth;
  readonly getFirestore: (app?: FirebaseApp) => Firestore;
  readonly connectAuthEmulator: typeof connectAuthEmulator;
  readonly connectFirestoreEmulator: typeof connectFirestoreEmulator;
  readonly initializeAppCheck: typeof initializeAppCheck;
  readonly ReCaptchaEnterpriseProvider: typeof ReCaptchaEnterpriseProvider;
}

const defaultDependencies: FirebaseSdkDependencies = {
  initializeApp,
  getApps,
  getAuth,
  getFirestore,
  connectAuthEmulator,
  connectFirestoreEmulator,
  initializeAppCheck,
  ReCaptchaEnterpriseProvider,
};

export interface CreateFirebaseClientOptions {
  readonly resolution?: FirebaseConfigResolution;
  readonly dependencies?: Partial<FirebaseSdkDependencies>;
  readonly appName?: string;
}

const connectedAuthEmulators = new WeakSet<object>();
const connectedFirestoreEmulators = new WeakSet<object>();

export const FIREBASE_APP_NAME = "championcreator-sync";

const isReadyResolution = (
  resolution: FirebaseConfigResolution,
): resolution is Extract<FirebaseConfigResolution, { status: "configured" }> =>
  resolution.status === "configured";

const getUnavailableClient = (
  resolution: Exclude<FirebaseConfigResolution, { status: "configured" }>,
): UnavailableFirebaseClient => ({
  status: "unavailable",
  reason: resolution.status === "absent" ? "not-configured" : "misconfigured",
  configStatus: resolution.status,
  missing: [...resolution.missing],
  invalid: resolution.status === "misconfigured" ? [...resolution.invalid] : [],
  isDevelopment: resolution.isDevelopment,
});

const getFirebaseApp = (
  config: FirebaseClientConfig,
  dependencies: FirebaseSdkDependencies,
  appName: string,
): FirebaseApp => {
  const {
    appCheckSiteKey: _appCheckSiteKey,
    emulators: _emulators,
    isDevelopment: _isDevelopment,
    ...firebaseOptions
  } = config;
  const apps = dependencies.getApps();
  const existing = apps.find((candidate) => candidate.name === appName);
  if (existing) {
    const optionKeys = [
      "apiKey",
      "authDomain",
      "projectId",
      "appId",
      "storageBucket",
      "messagingSenderId",
      "measurementId",
    ] as const satisfies readonly (keyof FirebaseOptions)[];
    const matchesConfig = optionKeys.every(
      (key) => existing.options[key] === firebaseOptions[key],
    );
    if (!matchesConfig) {
      throw new Error("Firebase app configuration mismatch.");
    }
    return existing;
  }

  return dependencies.initializeApp(firebaseOptions, appName);
};

const createAppCheck = (
  app: FirebaseApp,
  config: FirebaseClientConfig,
  dependencies: FirebaseSdkDependencies,
): Pick<ReadyFirebaseClient, "appCheck" | "appCheckStatus"> => {
  // App Check is deliberately opt-in and production-only. Emulator traffic
  // must remain usable without a reCAPTCHA token, and a missing site key must
  // not create any App Check traffic.
  if (config.isDevelopment || !config.appCheckSiteKey) {
    return { appCheck: null, appCheckStatus: "disabled" };
  }

  try {
    const provider = new dependencies.ReCaptchaEnterpriseProvider(config.appCheckSiteKey);
    const appCheck = dependencies.initializeAppCheck(app, {
      provider,
      isTokenAutoRefreshEnabled: true,
    });
    return { appCheck, appCheckStatus: "initialized" };
  } catch {
    // Firebase Auth/Firestore remain usable when optional App Check setup is
    // unavailable. The status is explicit so a future sync UI can surface it
    // without exposing the configuration value or SDK error text.
    return { appCheck: null, appCheckStatus: "failed" };
  }
};

const connectEmulators = (
  auth: Auth,
  firestore: Firestore,
  config: FirebaseClientConfig,
  dependencies: FirebaseSdkDependencies,
): "disabled" | "connected" => {
  if (!config.emulators || !config.isDevelopment) {
    return "disabled";
  }

  if (!connectedAuthEmulators.has(auth as unknown as object)) {
    dependencies.connectAuthEmulator(
      auth,
      `http://${config.emulators.auth.host}:${config.emulators.auth.port}`,
      { disableWarnings: true },
    );
    connectedAuthEmulators.add(auth as unknown as object);
  }

  if (!connectedFirestoreEmulators.has(firestore as unknown as object)) {
    dependencies.connectFirestoreEmulator(
      firestore,
      config.emulators.firestore.host,
      config.emulators.firestore.port,
    );
    connectedFirestoreEmulators.add(firestore as unknown as object);
  }

  return "connected";
};

/**
 * Initialize the browser Firebase client only for a complete public config.
 * This function is intentionally explicit; importing the sync package never
 * initializes Firebase by itself.
 */
export function createFirebaseClient(
  options: CreateFirebaseClientOptions = {},
): FirebaseClient {
  const resolution = options.resolution ?? resolveFirebaseConfig();
  if (!isReadyResolution(resolution)) {
    return getUnavailableClient(resolution);
  }

  const dependencies: FirebaseSdkDependencies = {
    ...defaultDependencies,
    ...options.dependencies,
  };

  try {
    const app = getFirebaseApp(
      resolution.config,
      dependencies,
      options.appName ?? FIREBASE_APP_NAME,
    );
    const appCheck = createAppCheck(app, resolution.config, dependencies);
    const auth = dependencies.getAuth(app);
    const firestore = dependencies.getFirestore(app);
    let emulatorStatus: ReadyFirebaseClient["emulatorStatus"];
    try {
      emulatorStatus = connectEmulators(auth, firestore, resolution.config, dependencies);
    } catch {
      return {
        status: "error",
        reason: "emulator-connection-failed",
        configStatus: "configured",
        isDevelopment: resolution.isDevelopment,
      };
    }

    return {
      status: "ready",
      app,
      auth,
      firestore,
      config: resolution.config,
      ...appCheck,
      emulatorStatus,
    };
  } catch {
    return {
      status: "error",
      reason: "initialization-failed",
      configStatus: "configured",
      isDevelopment: resolution.isDevelopment,
    };
  }
}

let cachedClient: FirebaseClient | undefined;

/** Return the process-local client singleton used by the app entry point. */
export function getFirebaseClient(): FirebaseClient {
  cachedClient ??= createFirebaseClient();
  return cachedClient;
}

/** Test/HMR escape hatch; it never deletes a Firebase app or local data. */
export function resetFirebaseClientForTests(): void {
  cachedClient = undefined;
}
