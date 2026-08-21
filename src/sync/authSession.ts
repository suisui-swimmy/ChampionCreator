export type AuthGatewayAvailability = "available" | "not-configured" | "misconfigured";

export interface AuthUser {
  readonly uid: string;
  readonly displayName: string | null;
  readonly email: string | null;
  readonly photoURL: string | null;
}

export type AuthErrorCode =
  | "not-configured"
  | "misconfigured"
  | "popup-blocked"
  | "popup-closed"
  | "cancelled"
  | "network"
  | "permission-denied"
  | "provider-disabled"
  | "unauthorized-domain"
  | "user-disabled"
  | "too-many-requests"
  | "requires-recent-login"
  | "invalid-credential"
  | "account-exists-with-different-credential"
  | "emulator"
  | "unknown";

export type AuthOperation =
  | "restore"
  | "sign-in"
  | "sign-out"
  | "reauthenticate"
  | "delete-account";

const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  "not-configured": "Firebase 認証は設定されていません。",
  misconfigured: "Firebase 認証の設定が不完全です。",
  "popup-blocked": "Google ログインのポップアップがブロックされました。",
  "popup-closed": "Google ログインのポップアップが閉じられました。",
  cancelled: "Google ログインはキャンセルされました。",
  network: "認証サービスへ接続できませんでした。",
  "permission-denied": "認証サービスへの権限がありません。",
  "provider-disabled": "Google ログインは現在利用できません。",
  "unauthorized-domain": "このドメインでは Google ログインを利用できません。",
  "user-disabled": "このアカウントは無効になっています。",
  "too-many-requests": "試行回数が多すぎます。時間をおいて再試行してください。",
  "requires-recent-login": "安全のため、もう一度ログインしてください。",
  "invalid-credential": "ログイン情報を確認できませんでした。",
  "account-exists-with-different-credential": "別のログイン方法で登録されたアカウントです。",
  // Reauthentication and account deletion deliberately reuse the same
  // provider-safe wording as their interactive popup operation.
  emulator: "認証エミュレーターへ接続できませんでした。",
  unknown: "認証処理に失敗しました。",
};

export class AuthSessionError extends Error {
  readonly code: AuthErrorCode;
  readonly operation: AuthOperation;
  readonly retryable: boolean;

  constructor(
    code: AuthErrorCode,
    operation: AuthOperation,
    options: { readonly retryable?: boolean } = {},
  ) {
    super(AUTH_ERROR_MESSAGES[code]);
    this.name = "AuthSessionError";
    this.code = code;
    this.operation = operation;
    this.retryable = options.retryable ?? isRetryableAuthError(code);
  }
}

const getUnknownCode = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code.toLowerCase() : undefined;
};

export function isRetryableAuthError(code: AuthErrorCode): boolean {
  return new Set<AuthErrorCode>([
    "network",
    "popup-blocked",
    "popup-closed",
    "too-many-requests",
    "emulator",
    "unknown",
  ]).has(code);
}

/** Convert Firebase/provider errors into a stable app-owned error contract. */
export function classifyAuthError(
  error: unknown,
  operation: AuthOperation,
): AuthSessionError {
  if (error instanceof AuthSessionError) {
    return error.operation === operation
      ? error
      : new AuthSessionError(error.code, operation, {
          retryable: error.retryable,
        });
  }

  const providerCode = getUnknownCode(error);
  const code: AuthErrorCode =
    providerCode === "auth/popup-blocked"
      ? "popup-blocked"
      : providerCode === "auth/popup-closed-by-user"
        ? "popup-closed"
        : providerCode === "auth/cancelled-popup-request"
          ? "cancelled"
          : providerCode === "auth/network-request-failed"
            ? "network"
            : providerCode === "auth/operation-not-allowed"
              ? "provider-disabled"
              : providerCode === "auth/unauthorized-domain"
                ? "unauthorized-domain"
                : providerCode === "auth/user-disabled"
                  ? "user-disabled"
                  : providerCode === "auth/too-many-requests"
                    ? "too-many-requests"
                    : providerCode === "auth/requires-recent-login"
                      ? "requires-recent-login"
                      : providerCode === "auth/invalid-credential"
                        ? "invalid-credential"
                        : providerCode === "auth/account-exists-with-different-credential"
                          ? "account-exists-with-different-credential"
                          : providerCode === "permission-denied" || providerCode === "firestore/permission-denied"
                            ? "permission-denied"
                            : providerCode === "auth/emulator-config-failed"
                              ? "emulator"
                              : providerCode === "sync/not-configured"
                                ? "not-configured"
                                : providerCode === "sync/misconfigured"
                                  ? "misconfigured"
                                  : "unknown";

  // Do not retain the provider error as `cause`: Firebase errors can carry
  // credentials, tokens, or response payloads that must never reach session
  // state, React context, logs, or serialized diagnostics.
  return new AuthSessionError(code, operation);
}

export type AuthSessionStatus =
  | "unavailable"
  | "loading"
  | "signed-out"
  | "signing-in"
  | "signed-in"
  | "signing-out"
  | "error";

export interface AuthSessionState {
  readonly status: AuthSessionStatus;
  readonly availability: AuthGatewayAvailability;
  readonly user: AuthUser | null;
  readonly error: AuthSessionError | null;
}

export type AuthStateListener = (state: AuthSessionState) => void;
export type AuthUserListener = (user: AuthUser | null) => void;
export type AuthErrorListener = (error: AuthSessionError) => void;
export type Unsubscribe = () => void;

export interface AuthGateway {
  readonly availability: AuthGatewayAvailability;
  subscribe(
    onUser: AuthUserListener,
    onError?: AuthErrorListener,
  ): Unsubscribe;
  signInWithGoogle(): Promise<AuthUser>;
  signOut(): Promise<void>;
  /** Optional until an app opts into the SYNC-M6 account controls. */
  reauthenticateWithGoogle?(expectedUid: string): Promise<AuthUser>;
  deleteAccount?(expectedUid: string): Promise<void>;
  /** Kept separate from Firebase User so callers can detect UID switches. */
  getCurrentUserUid?(): string | null;
}

const unavailableErrorCode = (
  availability: Exclude<AuthGatewayAvailability, "available">,
): AuthErrorCode => availability;

/** A no-network gateway used for a normal Firebase-free guest build. */
export function createUnavailableAuthGateway(
  availability: Exclude<AuthGatewayAvailability, "available"> = "not-configured",
): AuthGateway {
  return {
    availability,
    subscribe: () => () => undefined,
    signInWithGoogle: async () => {
      throw new AuthSessionError(unavailableErrorCode(availability), "sign-in");
    },
    signOut: async () => {
      throw new AuthSessionError(unavailableErrorCode(availability), "sign-out");
    },
    reauthenticateWithGoogle: async () => {
      throw new AuthSessionError(unavailableErrorCode(availability), "reauthenticate");
    },
    deleteAccount: async () => {
      throw new AuthSessionError(unavailableErrorCode(availability), "delete-account");
    },
    getCurrentUserUid: () => null,
  };
}

const getInitialState = (gateway: AuthGateway): AuthSessionState => {
  if (gateway.availability !== "available") {
    return {
      status: "unavailable",
      availability: gateway.availability,
      user: null,
      error: null,
    };
  }

  return {
    status: "loading",
    availability: "available",
    user: null,
    error: null,
  };
};

/**
 * Owns the auth lifecycle independently of React. It is intentionally small:
 * box/draft repositories and the application UI can subscribe to this state
 * later without embedding Firebase provider details in `App`.
 */
export interface AuthSession {
  getState(): AuthSessionState;
  subscribe(listener: AuthStateListener): Unsubscribe;
  start(): Unsubscribe;
  signInWithGoogle(): Promise<AuthUser>;
  signOut(): Promise<void>;
  reauthenticateWithGoogle(expectedUid?: string): Promise<AuthUser>;
  deleteAccount(expectedUid?: string): Promise<void>;
  getCurrentUserUid(): string | null;
}

class AuthSessionController implements AuthSession {
  private state: AuthSessionState;
  private readonly listeners = new Set<AuthStateListener>();
  private gatewayUnsubscribe: Unsubscribe | null = null;
  private started = false;
  private operationId = 0;

  constructor(private readonly gateway: AuthGateway) {
    this.state = getInitialState(gateway);
  }

  getState(): AuthSessionState {
    return this.state;
  }

  subscribe(listener: AuthStateListener): Unsubscribe {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): Unsubscribe {
    if (this.started) {
      return () => undefined;
    }

    this.started = true;
    if (this.gateway.availability === "available") {
      try {
        this.gatewayUnsubscribe = this.gateway.subscribe(
          (user) => {
            // The provider listener is authoritative. Invalidate any slower
            // sign-in/sign-out/reauth/delete Promise so it cannot overwrite a
            // newer UID (or signed-out) callback after an account switch.
            this.operationId += 1;
            this.setState(
              user
                ? {
                    status: "signed-in",
                    availability: "available",
                    user,
                    error: null,
                  }
                : {
                    status: "signed-out",
                    availability: "available",
                    user: null,
                    error: null,
                  },
            );
          },
          (error) => {
            this.operationId += 1;
            this.setState({
              status: "error",
              availability: "available",
              user: this.state.user,
              error: classifyAuthError(error, "restore"),
            });
          },
        );
      } catch (error) {
        this.operationId += 1;
        this.setState({
          status: "error",
          availability: "available",
          user: null,
          error: classifyAuthError(error, "restore"),
        });
      }
    }

    return () => {
      this.gatewayUnsubscribe?.();
      this.gatewayUnsubscribe = null;
      this.started = false;
    };
  }

  async signInWithGoogle(): Promise<AuthUser> {
    if (this.gateway.availability !== "available") {
      const error = new AuthSessionError(unavailableErrorCode(this.gateway.availability), "sign-in");
      this.setState({
        status: "unavailable",
        availability: this.gateway.availability,
        user: null,
        error: null,
      });
      throw error;
    }

    const operationId = ++this.operationId;
    this.setState({
      status: "signing-in",
      availability: "available",
      user: this.state.user,
      error: null,
    });

    try {
      const user = await this.gateway.signInWithGoogle();
      if (operationId === this.operationId) {
        this.setState({
          status: "signed-in",
          availability: "available",
          user,
          error: null,
        });
      }
      return user;
    } catch (error) {
      const classified = classifyAuthError(error, "sign-in");
      if (operationId === this.operationId) {
        this.setState({
          status: "error",
          availability: "available",
          user: this.state.user,
          error: classified,
        });
      }
      throw classified;
    }
  }

  async signOut(): Promise<void> {
    if (this.gateway.availability !== "available") {
      throw new AuthSessionError(unavailableErrorCode(this.gateway.availability), "sign-out");
    }

    const previousUser = this.state.user;
    if (!previousUser && this.state.status === "signed-out") {
      return;
    }

    const operationId = ++this.operationId;
    this.setState({
      status: "signing-out",
      availability: "available",
      user: previousUser,
      error: null,
    });

    try {
      await this.gateway.signOut();
      if (operationId === this.operationId) {
        this.setState({
          status: "signed-out",
          availability: "available",
          user: null,
          error: null,
        });
      }
    } catch (error) {
      const classified = classifyAuthError(error, "sign-out");
      if (operationId === this.operationId) {
        // Keep the prior user. A failed sign-out must never silently turn a
        // still-authenticated session into a guest session.
        this.setState({
          status: "error",
          availability: "available",
          user: previousUser,
          error: classified,
        });
      }
      throw classified;
    }
  }

  getCurrentUserUid(): string | null {
    return this.gateway.getCurrentUserUid?.() ?? this.state.user?.uid ?? null;
  }

  async reauthenticateWithGoogle(expectedUid = this.getCurrentUserUid() ?? ""): Promise<AuthUser> {
    if (this.gateway.availability !== "available") {
      const error = new AuthSessionError(
        unavailableErrorCode(this.gateway.availability),
        "reauthenticate",
      );
      throw error;
    }
    if (!expectedUid || this.getCurrentUserUid() !== expectedUid) {
      const error = new AuthSessionError("invalid-credential", "reauthenticate", {
        retryable: false,
      });
      this.setState({
        status: "error",
        availability: "available",
        user: this.state.user,
        error,
      });
      throw error;
    }
    const operationId = ++this.operationId;
    try {
      if (!this.gateway.reauthenticateWithGoogle) {
        throw new AuthSessionError("misconfigured", "reauthenticate", { retryable: false });
      }
      const user = await this.gateway.reauthenticateWithGoogle(expectedUid);
      if (user.uid !== expectedUid) {
        throw new AuthSessionError("invalid-credential", "reauthenticate", {
          retryable: false,
        });
      }
      if (operationId === this.operationId) {
        this.setState({
          status: "signed-in",
          availability: "available",
          user,
          error: null,
        });
      }
      return user;
    } catch (error) {
      const classified = classifyAuthError(error, "reauthenticate");
      if (operationId === this.operationId) {
        this.setState({
          status: "error",
          availability: "available",
          user: this.state.user,
          error: classified,
        });
      }
      throw classified;
    }
  }

  async deleteAccount(expectedUid = this.getCurrentUserUid() ?? ""): Promise<void> {
    if (this.gateway.availability !== "available") {
      const error = new AuthSessionError(
        unavailableErrorCode(this.gateway.availability),
        "delete-account",
      );
      throw error;
    }
    if (!expectedUid || this.getCurrentUserUid() !== expectedUid) {
      const error = new AuthSessionError("invalid-credential", "delete-account", {
        retryable: false,
      });
      this.setState({
        status: "error",
        availability: "available",
        user: this.state.user,
        error,
      });
      throw error;
    }
    const operationId = ++this.operationId;
    try {
      if (!this.gateway.deleteAccount) {
        throw new AuthSessionError("misconfigured", "delete-account", { retryable: false });
      }
      await this.gateway.deleteAccount(expectedUid);
      // Firebase emits null through onAuthStateChanged after deleteUser. The
      // immediate state transition keeps non-Firebase test/emulator gateways
      // safe too; no signOut call is made here.
      if (operationId === this.operationId) {
        this.setState({
          status: "signed-out",
          availability: "available",
          user: null,
          error: null,
        });
      }
    } catch (error) {
      const classified = classifyAuthError(error, "delete-account");
      if (operationId === this.operationId) {
        this.setState({
          status: "error",
          availability: "available",
          user: this.state.user,
          error: classified,
        });
      }
      throw classified;
    }
  }

  private setState(nextState: AuthSessionState): void {
    this.state = nextState;
    this.listeners.forEach((listener) => listener(this.state));
  }
}

export function createAuthSession(gateway: AuthGateway): AuthSession {
  return new AuthSessionController(gateway);
}
