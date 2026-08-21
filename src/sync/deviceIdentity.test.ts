import { describe, expect, it } from "vitest";
import {
  DEVICE_ID_STORAGE_KEY,
  createDeviceIdentity,
  getSafeDeviceLabel,
  loadDeviceIdentity,
  loadOrCreateDeviceIdentity,
  parseDeviceIdentityDocument,
  saveDeviceIdentity,
  type DeviceIdentityStorageLike,
} from "./deviceIdentity";

const createMemoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  const writes: Array<[string, string]> = [];
  const storage: DeviceIdentityStorageLike = {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      writes.push([key, value]);
      values.set(key, value);
    },
  };
  return { storage, values, writes };
};

const DEVICE_ID = "123e4567-e89b-42d3-a456-426614174000";

describe("deviceIdentity", () => {
  it("creates an opaque UUID and coarse platform/browser label", () => {
    const identity = createDeviceIdentity({
      randomUUID: () => DEVICE_ID,
      source: {
        platform: "Win32",
        userAgent: "Mozilla/5.0 Windows NT 10.0 AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36",
      },
    });

    expect(identity).toEqual({
      deviceId: DEVICE_ID,
      deviceLabel: "Windows / Chrome",
    });
    expect(identity.deviceLabel).not.toContain("Mozilla");
    expect(identity.deviceLabel).not.toContain("Windows NT");
  });

  it("persists one identity at the dedicated key and reuses it", () => {
    const memory = createMemoryStorage();
    const first = loadOrCreateDeviceIdentity(memory.storage, {
      randomUUID: () => DEVICE_ID,
      deviceLabel: "Laptop",
    });
    const second = loadOrCreateDeviceIdentity(memory.storage, {
      randomUUID: () => "223e4567-e89b-42d3-a456-426614174000",
      deviceLabel: "Another device",
    });

    expect(first).toEqual({
      status: "success",
      identity: { deviceId: DEVICE_ID, deviceLabel: "Laptop" },
    });
    expect(second).toEqual(first);
    expect(memory.writes).toHaveLength(1);
    expect(memory.writes[0]?.[0]).toBe(DEVICE_ID_STORAGE_KEY);
    expect(parseDeviceIdentityDocument(memory.values.get(DEVICE_ID_STORAGE_KEY) ?? "")).toMatchObject({
      deviceId: DEVICE_ID,
      deviceLabel: "Laptop",
    });
  });

  it("reports corrupt data without silently replacing the persisted identity", () => {
    const memory = createMemoryStorage({
      [DEVICE_ID_STORAGE_KEY]: JSON.stringify({
        schemaVersion: 999,
        deviceId: DEVICE_ID,
        deviceLabel: "Laptop",
      }),
    });

    expect(loadDeviceIdentity(memory.storage)).toMatchObject({
      status: "error",
      reason: "corrupt",
    });
    expect(memory.writes).toHaveLength(0);
  });

  it("distinguishes unavailable and quota failures", () => {
    expect(loadDeviceIdentity(null)).toMatchObject({
      status: "error",
      reason: "unavailable",
    });
    const quotaStorage: DeviceIdentityStorageLike = {
      getItem: () => null,
      setItem: () => {
        throw Object.assign(new Error("full"), { name: "QuotaExceededError" });
      },
    };
    expect(saveDeviceIdentity({ deviceId: DEVICE_ID, deviceLabel: "Laptop" }, quotaStorage))
      .toMatchObject({ status: "error", reason: "quota" });
  });

  it("falls back to a safe label when browser information is unavailable", () => {
    const label = getSafeDeviceLabel({
      platform: "",
      userAgent: "",
    });
    expect(label).toBe("Unknown platform / Unknown browser");
    expect(label).not.toMatch(/[\u0000-\u001f\u007f]/u);
  });
});

