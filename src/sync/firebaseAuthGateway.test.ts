import type { Auth, User, UserCredential } from "firebase/auth";
import { describe, expect, it, vi } from "vitest";
import {
  FirebaseAuthGatewayDependencies,
  createFirebaseAuthGateway,
} from "./firebaseAuthGateway";

const auth = {} as Auth;
const firebaseUser = {
  uid: "user-123",
  displayName: "Test User",
  email: "test@example.com",
  photoURL: "https://example.com/user.png",
} as User;

const makeDependencies = () => {
  let onUser: ((user: User | null) => void) | undefined;
  let onError: ((error: unknown) => void) | undefined;
  const Provider = class {
    readonly providerId = "google.com";
  };
  const signInWithPopup = vi.fn(async () => ({ user: firebaseUser }) as UserCredential);
  const signOut = vi.fn(async () => undefined);
  const onAuthStateChanged = vi.fn(
    (_auth: Auth, next: (user: User | null) => void, error?: (error: unknown) => void) => {
      onUser = next;
      onError = error;
      return () => undefined;
    },
  );
  const dependencies: FirebaseAuthGatewayDependencies = {
    onAuthStateChanged: onAuthStateChanged as never,
    signInWithPopup: signInWithPopup as never,
    signOut: signOut as never,
    GoogleAuthProvider: Provider as never,
  };
  return {
    dependencies,
    onAuthStateChanged,
    signInWithPopup,
    signOut,
    emitUser: (user: User | null) => onUser?.(user),
    emitError: (error: unknown) => onError?.(error),
  };
};

describe("createFirebaseAuthGateway", () => {
  it("restores and maps Firebase users through onAuthStateChanged", () => {
    const fakes = makeDependencies();
    const gateway = createFirebaseAuthGateway({ auth, dependencies: fakes.dependencies });
    const onUser = vi.fn();
    const onError = vi.fn();

    gateway.subscribe(onUser, onError);
    expect(fakes.onAuthStateChanged).toHaveBeenCalledTimes(1);
    fakes.emitUser(firebaseUser);
    fakes.emitUser(null);

    expect(onUser).toHaveBeenNthCalledWith(1, {
      uid: "user-123",
      displayName: "Test User",
      email: "test@example.com",
      photoURL: "https://example.com/user.png",
    });
    expect(onUser).toHaveBeenNthCalledWith(2, null);
    expect(onError).not.toHaveBeenCalled();
  });

  it("uses a Google popup provider without redirect or extra scopes", async () => {
    const fakes = makeDependencies();
    const gateway = createFirebaseAuthGateway({ auth, dependencies: fakes.dependencies });

    await expect(gateway.signInWithGoogle()).resolves.toMatchObject({ uid: "user-123" });
    expect(fakes.signInWithPopup).toHaveBeenCalledTimes(1);
    const [, provider] = fakes.signInWithPopup.mock.calls[0] as unknown as [
      Auth,
      { providerId: string },
    ];
    expect(provider.providerId).toBe("google.com");
  });

  it("classifies popup failures with a stable app-owned code", async () => {
    const fakes = makeDependencies();
    fakes.signInWithPopup.mockRejectedValue({ code: "auth/popup-blocked" });
    const gateway = createFirebaseAuthGateway({ auth, dependencies: fakes.dependencies });

    await expect(gateway.signInWithGoogle()).rejects.toMatchObject({
      name: "AuthSessionError",
      code: "popup-blocked",
      operation: "sign-in",
    });
  });

  it("keeps sign-out errors visible to the session owner", async () => {
    const fakes = makeDependencies();
    fakes.signOut.mockRejectedValue({ code: "auth/network-request-failed" });
    const gateway = createFirebaseAuthGateway({ auth, dependencies: fakes.dependencies });

    await expect(gateway.signOut()).rejects.toMatchObject({
      name: "AuthSessionError",
      code: "network",
      operation: "sign-out",
    });
  });

  it("returns an unavailable gateway when Firebase client setup is absent", async () => {
    const gateway = createFirebaseAuthGateway({
      client: {
        status: "unavailable",
        reason: "not-configured",
        configStatus: "absent",
        missing: [],
        invalid: [],
        isDevelopment: false,
      },
    });

    expect(gateway.availability).toBe("not-configured");
    await expect(gateway.signInWithGoogle()).rejects.toMatchObject({ code: "not-configured" });
  });
});
