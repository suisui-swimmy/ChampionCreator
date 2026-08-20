import {
  GoogleAuthProvider,
  User,
  UserCredential,
  Auth,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from "firebase/auth";
import { FirebaseClient, ReadyFirebaseClient, getFirebaseClient } from "./firebaseClient";
import {
  AuthErrorListener,
  AuthGateway,
  AuthUser,
  AuthUserListener,
  createUnavailableAuthGateway,
  classifyAuthError,
} from "./authSession";

/** The subset of Firebase Auth needed by this adapter, useful for unit tests. */
export interface FirebaseAuthLike {
  readonly currentUser?: User | null;
}

export interface FirebaseAuthGatewayDependencies {
  readonly onAuthStateChanged: typeof onAuthStateChanged;
  readonly signInWithPopup: typeof signInWithPopup;
  readonly signOut: typeof firebaseSignOut;
  readonly GoogleAuthProvider: typeof GoogleAuthProvider;
}

const defaultDependencies: FirebaseAuthGatewayDependencies = {
  onAuthStateChanged,
  signInWithPopup,
  signOut: firebaseSignOut,
  GoogleAuthProvider,
};

export interface CreateFirebaseAuthGatewayOptions {
  readonly client?: FirebaseClient;
  readonly auth?: Auth;
  readonly dependencies?: Partial<FirebaseAuthGatewayDependencies>;
}

const toNullableString = (value: string | null | undefined): string | null => value ?? null;

export function toAuthUser(user: Pick<User, "uid" | "displayName" | "email" | "photoURL">): AuthUser {
  return {
    uid: user.uid,
    displayName: toNullableString(user.displayName),
    email: toNullableString(user.email),
    photoURL: toNullableString(user.photoURL),
  };
}

const getReadyClient = (
  options: CreateFirebaseAuthGatewayOptions,
): ReadyFirebaseClient | null => {
  if (options.auth) {
    return null;
  }
  const client = options.client ?? getFirebaseClient();
  return client.status === "ready" ? client : null;
};

const getUnavailableGateway = (client: FirebaseClient): AuthGateway => {
  if (client.status === "unavailable") {
    return createUnavailableAuthGateway(
      client.reason === "not-configured" ? "not-configured" : "misconfigured",
    );
  }
  return createUnavailableAuthGateway("misconfigured");
};

/**
 * Firebase-specific auth adapter. The only supported interactive flow is a
 * Google provider with `signInWithPopup`; redirect flows and extra scopes are
 * intentionally not imported or configured here.
 */
export function createFirebaseAuthGateway(
  options: CreateFirebaseAuthGatewayOptions = {},
): AuthGateway {
  const client = options.client;
  const auth = options.auth ?? getReadyClient(options)?.auth;
  if (!auth) {
    return getUnavailableGateway(client ?? getFirebaseClient());
  }

  const dependencies: FirebaseAuthGatewayDependencies = {
    ...defaultDependencies,
    ...options.dependencies,
  };

  return {
    availability: "available",
    subscribe(onUser: AuthUserListener, onError?: AuthErrorListener) {
      return dependencies.onAuthStateChanged(
        auth,
        (user) => onUser(user ? toAuthUser(user) : null),
        (error) => onError?.(classifyAuthError(error, "restore")),
      );
    },
    async signInWithGoogle() {
      try {
        const provider = new dependencies.GoogleAuthProvider();
        const credential: UserCredential = await dependencies.signInWithPopup(auth, provider);
        if (!credential.user) {
          throw new Error("Firebase returned no authenticated user.");
        }
        return toAuthUser(credential.user);
      } catch (error) {
        throw classifyAuthError(error, "sign-in");
      }
    },
    async signOut() {
      try {
        await dependencies.signOut(auth);
      } catch (error) {
        throw classifyAuthError(error, "sign-out");
      }
    },
  };
}

export const createAuthGateway = createFirebaseAuthGateway;
