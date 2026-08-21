import { describe, expect, it, vi } from "vitest";
import { makeAccountDraftStorageKey } from "../ui/draftStorage";
import { makeCloudDraftStorageKey } from "./cloudDraftLocalRepository";
import {
  AccountDeletionError,
  deleteAccount,
  getAccountDeletionStorageKeys,
  type AccountDeletionAuthGateway,
  type AccountDeletionFirestoreDependencies,
  type AccountDeletionStorageLike,
} from "./accountDeletion";
import { makeMigrationStateStorageKey } from "./migrationStorage";
import { makeSyncStorageKey } from "./syncTypes";
import { AuthSessionError } from "./authSession";

const uid = "user-123";

class MemoryStorage implements AccountDeletionStorageLike {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  set(key: string, value = "data"): void {
    this.values.set(key, value);
  }

  has(key: string): boolean {
    return this.values.has(key);
  }
}

interface FakeCloud {
  readonly docs: Map<string, string[]>;
  readonly dependencies: AccountDeletionFirestoreDependencies;
  readonly commitSizes: number[];
  failCommit: boolean;
}

const createFakeCloud = (): FakeCloud => {
  const docs = new Map<string, string[]>([
    ["users/user-123/syncRecords", ["valid", "malformed"]],
    ["users/user-123/drafts", ["device-a", "device-b"]],
  ]);
  const commitSizes: number[] = [];
  let pending: string[] = [];
  const dependencies: AccountDeletionFirestoreDependencies = {
    collection: (_firestore, path) => ({ path }),
    doc: (collection, id) => ({
      id,
      path: `${(collection as { path: string }).path}/${id}`,
    }),
    getDocsFromServer: async (collection) => ({
      docs: (docs.get((collection as { path: string }).path) ?? []).map((id) => ({ id })),
    }),
    writeBatch: () => ({
      delete: (reference) => {
        pending.push(reference.id ?? "");
      },
      commit: async () => {
        commitSizes.push(pending.length);
        const current = pending;
        pending = [];
        for (const path of docs.keys()) {
          docs.set(path, (docs.get(path) ?? []).filter((id) => !current.includes(id)));
        }
      },
    }),
  };
  return { docs, dependencies, commitSizes, failCommit: false };
};

const createAuth = (events: string[]): AccountDeletionAuthGateway & { currentUid: string } => {
  const auth = {
    currentUid: uid,
    getCurrentUserUid: () => auth.currentUid,
    reauthenticateWithGoogle: vi.fn(async (expectedUid: string) => {
      events.push(`reauth:${expectedUid}`);
      return { uid: expectedUid, displayName: null, email: null, photoURL: null };
    }),
    deleteAccount: vi.fn(async (expectedUid: string) => {
      events.push(`delete-user:${expectedUid}`);
    }),
  };
  return auth;
};

describe("account deletion service", () => {
  it("reauthenticates, deletes raw cloud records in <=450 batches, clears UID keys, then deletes Auth", async () => {
    const events: string[] = [];
    const auth = createAuth(events);
    const cloud = createFakeCloud();
    const storage = new MemoryStorage();
    const keys = [
      makeSyncStorageKey(uid),
      makeCloudDraftStorageKey(uid, "device-a"),
      makeAccountDraftStorageKey(uid, "device-a"),
      makeMigrationStateStorageKey(uid),
      "championcreator.box.v1",
      "championcreator.enemy-box.v1",
    ];
    keys.forEach((key) => storage.set(key));
    const prepare = vi.fn(async () => {
      events.push("prepare");
    });
    const resume = vi.fn(() => events.push("resume"));
    const originalRemove = storage.removeItem.bind(storage);
    vi.spyOn(storage, "removeItem").mockImplementation((key) => {
      events.push(`clear:${key}`);
      originalRemove(key);
    });

    const result = await deleteAccount({
      uid,
      auth,
      firestore: {},
      dependencies: cloud.dependencies,
      storage,
      deviceId: "device-a",
      prepareAccountDeletion: prepare,
      resumeAccountOperations: resume,
    });

    expect(result.uid).toBe(uid);
    expect(cloud.docs.get("users/user-123/syncRecords")).toEqual([]);
    expect(cloud.docs.get("users/user-123/drafts")).toEqual([]);
    expect(cloud.commitSizes.every((size) => size <= 450)).toBe(true);
    expect(events[0]).toBe("reauth:user-123");
    expect(events[1]).toBe("prepare");
    expect(events.at(-1)).toBe("delete-user:user-123");
    expect(events.some((event) => event === "resume")).toBe(false);
    expect(storage.has("championcreator.box.v1")).toBe(true);
    expect(storage.has("championcreator.enemy-box.v1")).toBe(true);
    expect(auth.deleteAccount).toHaveBeenCalledTimes(1);
  });

  it("deletes more than 450 records in multiple batches and removes malformed rows too", async () => {
    const events: string[] = [];
    const auth = createAuth(events);
    const cloud = createFakeCloud();
    cloud.docs.set(
      "users/user-123/syncRecords",
      Array.from({ length: 901 }, (_, index) => `record-${index}`),
    );

    await deleteAccount({
      uid,
      auth,
      firestore: {},
      dependencies: cloud.dependencies,
      storage: null,
    });

    expect(cloud.commitSizes).toContain(450);
    expect(cloud.commitSizes).toContain(1);
    expect(cloud.docs.get("users/user-123/syncRecords")).toEqual([]);
  });

  it("never calls deleteUser or resumes mutations after physical cloud deletion starts", async () => {
    const events: string[] = [];
    const auth = createAuth(events);
    const cloud = createFakeCloud();
    const commit = vi.fn(async () => {
      throw { code: "permission-denied" };
    });
    const failingDependencies: AccountDeletionFirestoreDependencies = {
      ...cloud.dependencies,
      writeBatch: () => ({
      delete: () => undefined,
      commit,
      }),
    };
    const resume = vi.fn();

    await expect(deleteAccount({
      uid,
      auth,
      firestore: {},
      dependencies: failingDependencies,
      storage: null,
      resumeAccountOperations: resume,
    })).rejects.toMatchObject({
      code: "cloud-delete-failed",
      destructive: true,
    } satisfies Partial<AccountDeletionError>);
    expect(auth.deleteAccount).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it("retries safely after a failed cloud delete without deleting Auth early", async () => {
    const events: string[] = [];
    const auth = createAuth(events);
    const cloud = createFakeCloud();
    const originalWriteBatch = cloud.dependencies.writeBatch;
    let failOnce = true;
    const flakyDependencies: AccountDeletionFirestoreDependencies = {
      ...cloud.dependencies,
      writeBatch: (firestore) => {
        const batch = originalWriteBatch(firestore);
        return {
          delete: (reference) => batch.delete(reference),
          commit: async () => {
            if (failOnce) {
              failOnce = false;
              throw { code: "unavailable" };
            }
            return batch.commit();
          },
        };
      },
    };

    await expect(deleteAccount({
      uid,
      auth,
      firestore: {},
      dependencies: flakyDependencies,
      storage: null,
    })).rejects.toMatchObject({ code: "cloud-delete-failed" });
    expect(auth.deleteAccount).not.toHaveBeenCalled();

    await expect(deleteAccount({
      uid,
      auth,
      firestore: {},
      dependencies: cloud.dependencies,
      storage: null,
    })).resolves.toMatchObject({ uid });
    expect(cloud.docs.get("users/user-123/syncRecords")).toEqual([]);
    expect(cloud.docs.get("users/user-123/drafts")).toEqual([]);
    expect(auth.deleteAccount).toHaveBeenCalledTimes(1);
  });

  it("leaves providers and cloud untouched when the reauthentication popup is cancelled", async () => {
    const cloud = createFakeCloud();
    const prepare = vi.fn(async () => undefined);
    const deleteCurrentUser = vi.fn(async () => undefined);
    const auth: AccountDeletionAuthGateway = {
      getCurrentUserUid: () => uid,
      reauthenticateWithGoogle: vi.fn(async () => {
        throw new AuthSessionError("popup-closed", "reauthenticate");
      }),
      deleteAccount: deleteCurrentUser,
    };
    const read = vi.spyOn(cloud.dependencies, "getDocsFromServer");

    await expect(deleteAccount({
      uid,
      auth,
      firestore: {},
      dependencies: cloud.dependencies,
      storage: null,
      prepareAccountDeletion: prepare,
    })).rejects.toMatchObject({ code: "reauthentication-failed" });
    expect(prepare).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(deleteCurrentUser).not.toHaveBeenCalled();
  });

  it("keeps mutations suspended when only Auth deletion fails, then retries from empty cloud", async () => {
    const cloud = createFakeCloud();
    const storage = new MemoryStorage();
    storage.set(makeSyncStorageKey(uid));
    const resume = vi.fn();
    const deleteCurrentUser = vi.fn()
      .mockRejectedValueOnce({ code: "auth/network-request-failed" })
      .mockResolvedValueOnce(undefined);
    const auth: AccountDeletionAuthGateway = {
      getCurrentUserUid: () => uid,
      reauthenticateWithGoogle: vi.fn(async () => ({
        uid,
        displayName: null,
        email: null,
        photoURL: null,
      })),
      deleteAccount: deleteCurrentUser,
    };

    await expect(deleteAccount({
      uid,
      auth,
      firestore: {},
      dependencies: cloud.dependencies,
      storage,
      resumeAccountOperations: resume,
    })).rejects.toMatchObject({ code: "delete-account-failed", destructive: true });
    expect(resume).not.toHaveBeenCalled();
    expect(storage.has(makeSyncStorageKey(uid))).toBe(false);
    expect(cloud.docs.get("users/user-123/syncRecords")).toEqual([]);
    expect(cloud.docs.get("users/user-123/drafts")).toEqual([]);

    await expect(deleteAccount({
      uid,
      auth,
      firestore: {},
      dependencies: cloud.dependencies,
      storage,
      resumeAccountOperations: resume,
    })).resolves.toMatchObject({ uid });
    expect(deleteCurrentUser).toHaveBeenCalledTimes(2);
  });

  it("keeps Auth and mutations intact when UID-local cleanup fails after cloud deletion", async () => {
    const events: string[] = [];
    const auth = createAuth(events);
    const cloud = createFakeCloud();
    const resume = vi.fn();
    const storage: AccountDeletionStorageLike = {
      length: 1,
      key: () => makeSyncStorageKey(uid),
      removeItem: () => {
        throw new Error("quota marker that must not escape");
      },
    };

    await expect(deleteAccount({
      uid,
      auth,
      firestore: {},
      dependencies: cloud.dependencies,
      storage,
      resumeAccountOperations: resume,
    })).rejects.toMatchObject({
      code: "local-cleanup-failed",
      destructive: true,
      message: "ブラウザ内のアカウントデータを削除できませんでした。再試行してください",
    });
    expect(auth.deleteAccount).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it("rechecks the UID after local cleanup before deleting Auth", async () => {
    let currentUid = uid;
    const deleteCurrentUser = vi.fn(async () => undefined);
    const auth: AccountDeletionAuthGateway = {
      getCurrentUserUid: () => currentUid,
      reauthenticateWithGoogle: vi.fn(async () => ({
        uid,
        displayName: null,
        email: null,
        photoURL: null,
      })),
      deleteAccount: deleteCurrentUser,
    };
    const cloud = createFakeCloud();
    const storage: AccountDeletionStorageLike = {
      removeItem: () => {
        currentUid = "other-user";
      },
    };

    await expect(deleteAccount({
      uid,
      auth,
      firestore: {},
      dependencies: cloud.dependencies,
      storage,
    })).rejects.toMatchObject({ code: "uid-changed", destructive: true });
    expect(deleteCurrentUser).not.toHaveBeenCalled();
  });

  it("aborts on a UID switch after reauthentication before touching cloud data", async () => {
    const events: string[] = [];
    let currentUid = uid;
    const deleteCurrentUser = vi.fn(async () => undefined);
    const auth: AccountDeletionAuthGateway = {
      getCurrentUserUid: () => currentUid,
      reauthenticateWithGoogle: vi.fn(async (expectedUid: string) => {
        currentUid = "other-user";
        return { uid: expectedUid, displayName: null, email: null, photoURL: null };
      }),
      deleteAccount: deleteCurrentUser,
    };
    const cloud = createFakeCloud();
    const read = vi.spyOn(cloud.dependencies, "getDocsFromServer");

    await expect(deleteAccount({
      uid,
      auth,
      firestore: {},
      dependencies: cloud.dependencies,
      storage: null,
    })).rejects.toMatchObject({ code: "uid-changed" });
    expect(read).not.toHaveBeenCalled();
    expect(deleteCurrentUser).not.toHaveBeenCalled();
  });

  it("only derives UID-scoped keys and never includes legacy guest boxes", () => {
    const storage = new MemoryStorage();
    storage.set(makeSyncStorageKey(uid));
    storage.set(makeSyncStorageKey("user-1234"));
    storage.set(makeMigrationStateStorageKey(uid));
    storage.set(makeMigrationStateStorageKey("user-1234"));
    storage.set("championcreator.box.v1");

    const keys = getAccountDeletionStorageKeys(uid, "device-a", storage);
    expect(keys).toContain(makeSyncStorageKey(uid));
    expect(keys).not.toContain(makeSyncStorageKey("user-1234"));
    expect(keys).toContain(makeMigrationStateStorageKey(uid));
    expect(keys).not.toContain(makeMigrationStateStorageKey("user-1234"));
    expect(keys).not.toContain("championcreator.box.v1");
  });
});
