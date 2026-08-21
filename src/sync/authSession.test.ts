import { describe, expect, it, vi } from "vitest";
import {
  AuthGateway,
  AuthSessionError,
  AuthUser,
  createAuthSession,
  createUnavailableAuthGateway,
} from "./authSession";

const user: AuthUser = {
  uid: "user-123",
  displayName: "Test User",
  email: "test@example.com",
  photoURL: null,
};

const makeGateway = () => {
  let onUser: ((nextUser: AuthUser | null) => void) | undefined;
  let onError: ((error: AuthSessionError) => void) | undefined;
  const signInWithGoogle = vi.fn(async () => user);
  const signOut = vi.fn(async () => undefined);
  const reauthenticateWithGoogle = vi.fn(async () => user);
  const deleteAccount = vi.fn(async () => undefined);
  const subscribe = vi.fn(
    (
      nextUser: (nextUser: AuthUser | null) => void,
      error?: (error: AuthSessionError) => void,
    ) => {
      onUser = nextUser;
      onError = error;
      return () => undefined;
    },
  );
  const gateway: AuthGateway = {
    availability: "available",
    subscribe,
    signInWithGoogle,
    signOut,
    reauthenticateWithGoogle,
    deleteAccount,
  };
  return {
    gateway,
    subscribe,
    signInWithGoogle,
    signOut,
    reauthenticateWithGoogle,
    deleteAccount,
    emitUser: (nextUser: AuthUser | null) => onUser?.(nextUser),
    emitError: (error: AuthSessionError) => onError?.(error),
  };
};

describe("AuthSession", () => {
  it("starts in loading state and restores signed-out/signed-in state", () => {
    const fakes = makeGateway();
    const session = createAuthSession(fakes.gateway);
    const observed: string[] = [];
    session.subscribe((state) => observed.push(state.status));

    expect(session.getState()).toMatchObject({ status: "loading", user: null, error: null });
    const stop = session.start();
    expect(fakes.subscribe).toHaveBeenCalledTimes(1);
    fakes.emitUser(null);
    fakes.emitUser(user);

    expect(session.getState()).toMatchObject({ status: "signed-in", user });
    expect(observed).toEqual(["loading", "signed-out", "signed-in"]);
    stop();
  });

  it("does not subscribe twice when start is called repeatedly", () => {
    const fakes = makeGateway();
    const session = createAuthSession(fakes.gateway);

    const stop = session.start();
    session.start();

    expect(fakes.subscribe).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does not let a stale auth Promise overwrite a newer provider UID callback", async () => {
    const fakes = makeGateway();
    let resolveSignIn: ((value: AuthUser) => void) | undefined;
    fakes.signInWithGoogle.mockImplementation(() => new Promise<AuthUser>((resolve) => {
      resolveSignIn = resolve;
    }));
    const session = createAuthSession(fakes.gateway);
    session.start();
    const pending = session.signInWithGoogle();
    const newerUser: AuthUser = { ...user, uid: "user-new", email: "new@example.com" };

    fakes.emitUser(newerUser);
    resolveSignIn?.(user);
    await pending;

    expect(session.getState()).toMatchObject({ status: "signed-in", user: newerUser });
  });

  it("uses the gateway current UID for destructive-operation checks", () => {
    const fakes = makeGateway();
    let actualUid = user.uid;
    const session = createAuthSession({
      ...fakes.gateway,
      getCurrentUserUid: () => actualUid,
    });
    session.start();
    fakes.emitUser(user);

    actualUid = "user-switched-before-listener";
    expect(session.getCurrentUserUid()).toBe("user-switched-before-listener");
  });

  it("classifies sign-in failures and exposes the error state", async () => {
    const fakes = makeGateway();
    fakes.signInWithGoogle.mockRejectedValue({ code: "auth/popup-closed-by-user" });
    const session = createAuthSession(fakes.gateway);
    session.start();

    await expect(session.signInWithGoogle()).rejects.toMatchObject({
      code: "popup-closed",
      operation: "sign-in",
    });
    expect(session.getState()).toMatchObject({
      status: "error",
      user: null,
      error: { code: "popup-closed", operation: "sign-in" },
    });
  });

  it("does not retain raw provider errors or credential markers in session state", async () => {
    const fakes = makeGateway();
    fakes.signInWithGoogle.mockRejectedValue({
      code: "auth/invalid-credential",
      credential: "raw-credential-marker",
      accessToken: "raw-token-marker",
    });
    const session = createAuthSession(fakes.gateway);
    session.start();

    await expect(session.signInWithGoogle()).rejects.toMatchObject({ code: "invalid-credential" });
    expect(session.getState().error).not.toHaveProperty("cause");
    expect(JSON.stringify(session.getState())).not.toContain("raw-credential-marker");
    expect(JSON.stringify(session.getState())).not.toContain("raw-token-marker");
  });

  it("retains the authenticated user when sign-out fails", async () => {
    const fakes = makeGateway();
    fakes.signOut.mockRejectedValue({ code: "auth/network-request-failed" });
    const session = createAuthSession(fakes.gateway);
    session.start();
    fakes.emitUser(user);

    await expect(session.signOut()).rejects.toMatchObject({
      code: "network",
      operation: "sign-out",
    });
    expect(session.getState()).toMatchObject({
      status: "error",
      user,
      error: { code: "network", operation: "sign-out" },
    });
  });

  it("moves to signed-out only after sign-out succeeds", async () => {
    const fakes = makeGateway();
    const session = createAuthSession(fakes.gateway);
    session.start();
    fakes.emitUser(user);

    await expect(session.signOut()).resolves.toBeUndefined();
    expect(session.getState()).toMatchObject({ status: "signed-out", user: null, error: null });
  });

  it("keeps reauthentication and account deletion app-owned", async () => {
    const fakes = makeGateway();
    const session = createAuthSession(fakes.gateway);
    session.start();
    fakes.emitUser(user);

    await expect(session.reauthenticateWithGoogle()).resolves.toEqual(user);
    expect(fakes.reauthenticateWithGoogle).toHaveBeenCalledWith("user-123");
    await expect(session.deleteAccount()).resolves.toBeUndefined();
    expect(fakes.deleteAccount).toHaveBeenCalledWith("user-123");
    expect(session.getState()).toMatchObject({ status: "signed-out", user: null });
  });

  it("does not call account deletion when reauthentication changes UID", async () => {
    const fakes = makeGateway();
    fakes.reauthenticateWithGoogle.mockResolvedValue({ ...user, uid: "other-user" });
    const session = createAuthSession(fakes.gateway);
    session.start();
    fakes.emitUser(user);

    await expect(session.reauthenticateWithGoogle()).rejects.toMatchObject({
      code: "invalid-credential",
      operation: "reauthenticate",
    });
    expect(fakes.deleteAccount).not.toHaveBeenCalled();
  });

  it("keeps a configured-but-not-available build fully offline", async () => {
    const gateway = createUnavailableAuthGateway("not-configured");
    const session = createAuthSession(gateway);

    expect(session.getState()).toMatchObject({
      status: "unavailable",
      availability: "not-configured",
      user: null,
      error: null,
    });
    const stop = session.start();
    expect(() => stop()).not.toThrow();
    await expect(session.signInWithGoogle()).rejects.toMatchObject({
      code: "not-configured",
      operation: "sign-in",
    });
    expect(session.getState().status).toBe("unavailable");
  });

  it("retains the current user when an auth restore callback reports an error", () => {
    const fakes = makeGateway();
    const session = createAuthSession(fakes.gateway);
    session.start();
    fakes.emitUser(user);
    fakes.emitError(new AuthSessionError("network", "restore"));

    expect(session.getState()).toMatchObject({
      status: "error",
      user,
      error: { code: "network", operation: "restore" },
    });
  });
});
