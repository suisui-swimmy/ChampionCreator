import type { FirebaseApp } from "firebase/app";
import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import { describe, expect, it, vi } from "vitest";
import {
  FirebaseSdkDependencies,
  createFirebaseClient,
} from "./firebaseClient";
import { FirebaseEnvironment, resolveFirebaseConfig } from "./firebaseConfig";

const environment: FirebaseEnvironment = {
  DEV: false,
  MODE: "production",
  VITE_FIREBASE_API_KEY: "public-api-key",
  VITE_FIREBASE_AUTH_DOMAIN: "championcreator.example.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "championcreator-example",
  VITE_FIREBASE_STORAGE_BUCKET: "championcreator-example.firebasestorage.app",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "1234567890",
  VITE_FIREBASE_APP_ID: "1:1234567890:web:abcdef",
};

const makeDependencies = (): {
  dependencies: FirebaseSdkDependencies;
  initializeApp: ReturnType<typeof vi.fn>;
  getAuth: ReturnType<typeof vi.fn>;
  getFirestore: ReturnType<typeof vi.fn>;
  connectAuthEmulator: ReturnType<typeof vi.fn>;
  connectFirestoreEmulator: ReturnType<typeof vi.fn>;
  initializeAppCheck: ReturnType<typeof vi.fn>;
  Provider: new (siteKey: string) => { readonly siteKey: string };
  order: string[];
} => {
  const app = { name: "[DEFAULT]" } as FirebaseApp;
  const auth = {} as Auth;
  const firestore = {} as Firestore;
  const order: string[] = [];
  const Provider = class {
    constructor(readonly siteKey: string) {}
  };
  const initializeApp = vi.fn(() => {
    order.push("initializeApp");
    return app;
  });
  const getAuth = vi.fn(() => {
    order.push("getAuth");
    return auth;
  });
  const getFirestore = vi.fn(() => {
    order.push("getFirestore");
    return firestore;
  });
  const connectAuthEmulator = vi.fn();
  const connectFirestoreEmulator = vi.fn();
  const initializeAppCheck = vi.fn(() => {
    order.push("initializeAppCheck");
    return {} as never;
  });

  return {
    dependencies: {
      initializeApp,
      getApps: vi.fn(() => []),
      getAuth,
      getFirestore,
      connectAuthEmulator,
      connectFirestoreEmulator,
      initializeAppCheck,
      ReCaptchaEnterpriseProvider: Provider as never,
    },
    initializeApp,
    getAuth,
    getFirestore,
    connectAuthEmulator,
    connectFirestoreEmulator,
    initializeAppCheck,
    Provider,
    order,
  };
};

describe("createFirebaseClient", () => {
  it("does not initialize Firebase for an absent config", () => {
    const initializeApp = vi.fn();
    const result = createFirebaseClient({
      resolution: resolveFirebaseConfig({ DEV: false, MODE: "production" }),
      dependencies: { initializeApp: initializeApp as never },
    });

    expect(result).toMatchObject({ status: "unavailable", reason: "not-configured" });
    expect(initializeApp).not.toHaveBeenCalled();
  });

  it("does not initialize Firebase for a partial config", () => {
    const initializeApp = vi.fn();
    const result = createFirebaseClient({
      resolution: resolveFirebaseConfig({
        ...environment,
        VITE_FIREBASE_APP_ID: undefined,
      }),
      dependencies: { initializeApp: initializeApp as never },
    });

    expect(result).toMatchObject({
      status: "unavailable",
      reason: "misconfigured",
      missing: ["VITE_FIREBASE_APP_ID"],
    });
    expect(initializeApp).not.toHaveBeenCalled();
  });

  it("rejects a same-name Firebase app from a different project", () => {
    const fakes = makeDependencies();
    const dependencies: FirebaseSdkDependencies = {
      ...fakes.dependencies,
      getApps: vi.fn(() => [{
        name: "championcreator-sync",
        options: {
          apiKey: "another-public-key",
          authDomain: "another-project.firebaseapp.com",
          projectId: "another-project",
          appId: "1:999:web:other",
        },
      } as FirebaseApp]),
    };

    const result = createFirebaseClient({
      resolution: resolveFirebaseConfig(environment),
      dependencies,
    });

    expect(result).toMatchObject({ status: "error", reason: "initialization-failed" });
    expect(fakes.getAuth).not.toHaveBeenCalled();
    expect(fakes.getFirestore).not.toHaveBeenCalled();
  });

  it("initializes optional production App Check with the Enterprise provider", () => {
    const fakes = makeDependencies();
    const result = createFirebaseClient({
      resolution: resolveFirebaseConfig({
        ...environment,
        VITE_FIREBASE_APP_CHECK_SITE_KEY: "enterprise-site-key",
      }),
      dependencies: fakes.dependencies,
    });

    expect(result.status).toBe("ready");
    expect(fakes.initializeApp).toHaveBeenCalledTimes(1);
    expect(fakes.initializeAppCheck).toHaveBeenCalledTimes(1);
    expect(fakes.order.indexOf("initializeAppCheck")).toBeLessThan(fakes.order.indexOf("getAuth"));
    expect(fakes.initializeAppCheck.mock.calls[0][1]).toMatchObject({
      isTokenAutoRefreshEnabled: true,
    });
    const provider = fakes.initializeAppCheck.mock.calls[0][1].provider as { siteKey: string };
    expect(provider.siteKey).toBe("enterprise-site-key");
    if (result.status === "ready") {
      expect(result.appCheckStatus).toBe("initialized");
      expect(result.emulatorStatus).toBe("disabled");
    }
  });

  it("connects only to development emulators and disables App Check there", () => {
    const fakes = makeDependencies();
    const result = createFirebaseClient({
      resolution: resolveFirebaseConfig({
        ...environment,
        DEV: true,
        MODE: "development",
        VITE_FIREBASE_USE_EMULATORS: "true",
        VITE_FIREBASE_APP_CHECK_SITE_KEY: "must-not-initialize-in-dev",
      }),
      dependencies: fakes.dependencies,
    });

    expect(fakes.connectAuthEmulator).toHaveBeenCalledWith(
      expect.anything(),
      "http://127.0.0.1:9099",
      { disableWarnings: true },
    );
    expect(fakes.connectFirestoreEmulator).toHaveBeenCalledWith(
      expect.anything(),
      "127.0.0.1",
      8080,
    );
    expect(fakes.initializeAppCheck).not.toHaveBeenCalled();
    if (result.status === "ready") {
      expect(result.emulatorStatus).toBe("connected");
      expect(result.appCheckStatus).toBe("disabled");
    }
  });

  it("distinguishes an emulator connection failure from app initialization", () => {
    const fakes = makeDependencies();
    fakes.connectAuthEmulator.mockImplementation(() => {
      throw new Error("emulator unavailable");
    });

    const result = createFirebaseClient({
      resolution: resolveFirebaseConfig({
        ...environment,
        DEV: true,
        MODE: "development",
        VITE_FIREBASE_USE_EMULATORS: "true",
      }),
      dependencies: fakes.dependencies,
    });

    expect(result).toMatchObject({
      status: "error",
      reason: "emulator-connection-failed",
    });
  });
});
