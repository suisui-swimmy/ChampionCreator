import {
  ReactNode,
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createFirebaseAuthGateway } from "./firebaseAuthGateway";
import {
  AuthGateway,
  AuthSession,
  AuthSessionState,
  AuthUser,
  createAuthSession,
} from "./authSession";

export interface AuthSessionContextValue {
  readonly state: AuthSessionState;
  readonly session: AuthSession;
  readonly signInWithGoogle: () => Promise<AuthUser>;
  readonly signOut: () => Promise<void>;
}

export const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export interface AuthSessionProviderProps {
  readonly children: ReactNode;
  /** Optional injection point for tests and future emulator wiring. */
  readonly gateway?: AuthGateway;
}

/**
 * React lifecycle wrapper for the auth session owner. `App` does not need to
 * know whether Firebase is configured; a missing config simply creates an
 * unavailable, no-network session.
 */
export function AuthSessionProvider({
  children,
  gateway,
}: AuthSessionProviderProps) {
  const session = useMemo(
    () => createAuthSession(gateway ?? createFirebaseAuthGateway()),
    [gateway],
  );
  const [state, setState] = useState<AuthSessionState>(() => session.getState());

  useEffect(() => {
    const unsubscribeState = session.subscribe(setState);
    const stop = session.start();
    return () => {
      unsubscribeState();
      stop();
    };
  }, [session]);

  const signInWithGoogle = useCallback(() => session.signInWithGoogle(), [session]);
  const signOut = useCallback(() => session.signOut(), [session]);
  const value = useMemo<AuthSessionContextValue>(
    () => ({ state, session, signInWithGoogle, signOut }),
    [session, signInWithGoogle, signOut, state],
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession(): AuthSessionContextValue {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error("useAuthSession must be used within AuthSessionProvider.");
  }
  return context;
}
