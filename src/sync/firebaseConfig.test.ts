import { describe, expect, it } from "vitest";
import {
  FirebaseEnvironment,
  resolveFirebaseConfig,
} from "./firebaseConfig";

const completeEnvironment: FirebaseEnvironment = {
  DEV: false,
  MODE: "production",
  VITE_FIREBASE_API_KEY: "public-api-key",
  VITE_FIREBASE_AUTH_DOMAIN: "championcreator.example.firebaseapp.com",
  VITE_FIREBASE_PROJECT_ID: "championcreator-example",
  VITE_FIREBASE_STORAGE_BUCKET: "championcreator-example.firebasestorage.app",
  VITE_FIREBASE_MESSAGING_SENDER_ID: "1234567890",
  VITE_FIREBASE_APP_ID: "1:1234567890:web:abcdef",
};

describe("resolveFirebaseConfig", () => {
  it("treats an empty environment as a guest/no-Firebase build", () => {
    const result = resolveFirebaseConfig({ DEV: false, MODE: "production" });

    expect(result).toMatchObject({
      status: "absent",
      config: null,
      missing: [],
      present: [],
    });
  });

  it("reports only missing variable names for a partial configuration", () => {
    const result = resolveFirebaseConfig({
      ...completeEnvironment,
      VITE_FIREBASE_API_KEY: "secret-looking-public-value",
      VITE_FIREBASE_APP_ID: undefined,
    });

    expect(result.status).toBe("misconfigured");
    if (result.status !== "misconfigured") {
      return;
    }
    expect(result.missing).toEqual(["VITE_FIREBASE_APP_ID"]);
    expect(result.present).not.toContain("secret-looking-public-value");
    expect(JSON.stringify(result)).not.toContain("secret-looking-public-value");
  });

  it("trims complete public config and keeps optional values separate", () => {
    const result = resolveFirebaseConfig({
      ...completeEnvironment,
      VITE_FIREBASE_API_KEY: "  public-api-key  ",
      VITE_FIREBASE_MEASUREMENT_ID: " G-FIREBASE  ",
      VITE_FIREBASE_APP_CHECK_SITE_KEY: " app-check-site-key ",
    });

    expect(result.status).toBe("configured");
    if (result.status !== "configured") {
      return;
    }
    expect(result.config.apiKey).toBe("public-api-key");
    expect(result.config.measurementId).toBe("G-FIREBASE");
    expect(result.config.appCheckSiteKey).toBe("app-check-site-key");
  });

  it("enables development emulator defaults only when DEV is true", () => {
    const development = resolveFirebaseConfig({
      ...completeEnvironment,
      DEV: true,
      MODE: "development",
      VITE_FIREBASE_USE_EMULATORS: "true",
    });
    const production = resolveFirebaseConfig({
      ...completeEnvironment,
      DEV: false,
      MODE: "production",
      VITE_FIREBASE_USE_EMULATORS: "true",
    });

    expect(development.status).toBe("configured");
    if (development.status === "configured") {
      expect(development.config.emulators).toEqual({
        auth: { host: "127.0.0.1", port: 9099 },
        firestore: { host: "127.0.0.1", port: 8080 },
      });
    }
    expect(production.status).toBe("configured");
    if (production.status === "configured") {
      expect(production.config.emulators).toBeUndefined();
    }
  });

  it("requires an explicit emulator choice for a configured development build", () => {
    const missingChoice = resolveFirebaseConfig({
      ...completeEnvironment,
      DEV: true,
      MODE: "development",
      VITE_FIREBASE_USE_EMULATORS: undefined,
    });
    const explicitProduction = resolveFirebaseConfig({
      ...completeEnvironment,
      DEV: true,
      MODE: "development",
      VITE_FIREBASE_USE_EMULATORS: "false",
    });

    expect(missingChoice).toMatchObject({
      status: "misconfigured",
      invalid: ["VITE_FIREBASE_USE_EMULATORS"],
    });
    expect(explicitProduction.status).toBe("configured");
    if (explicitProduction.status === "configured") {
      expect(explicitProduction.config.emulators).toBeUndefined();
    }
  });

  it("rejects malformed development emulator endpoints without exposing values", () => {
    const result = resolveFirebaseConfig({
      ...completeEnvironment,
      DEV: true,
      MODE: "development",
      VITE_FIREBASE_USE_EMULATORS: "true",
      VITE_FIREBASE_AUTH_EMULATOR_HOST: "http://not-a-valid-host/path",
    });

    expect(result.status).toBe("misconfigured");
    if (result.status === "misconfigured") {
      expect(result.invalid).toContain("VITE_FIREBASE_AUTH_EMULATOR_HOST");
      expect(JSON.stringify(result)).not.toContain("not-a-valid-host");
    }
  });
});
