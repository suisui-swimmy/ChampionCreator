import { type ReactNode, useEffect, useState } from "react";
import { Button } from "../ui/primitives";
import { getPublicAssetUrl } from "../ui/publicAssetUrl";
import { useAuthSession } from "./authSessionContext";
import { useOptionalCloudDraft } from "./CloudDraftProvider";
import { useOptionalSyncBox } from "./SyncBoxProvider";
import { useSyncMigrationReadiness } from "./SyncMigrationGate";
import { getStartupReadiness, type StartupReadiness } from "./startupReadiness";
import "./AppStartupGate.css";

export const STARTUP_SLOW_AFTER_MS = 8_000;

export function StartupScreen({ readiness, onRetry, onContinue }: {
  readiness: StartupReadiness;
  onRetry: () => void;
  onContinue: () => void;
}) {
  return (
    <main className="startup-screen" aria-label="ChampionCreatorの起動準備">
      <div className="startup-content">
        <img
          className="startup-brand"
          src={getPublicAssetUrl("assets/brand/championcreator-emblem.svg")}
          alt="ChampionCreator"
          width={96}
          height={96}
        />
        <p className="startup-message" role="status" aria-live="polite">
          {readiness.phase === "loading" ? <span className="startup-spinner" aria-hidden="true" /> : null}
          {readiness.message}
        </p>
        {readiness.phase === "attention" ? (
          <div className="startup-actions">
            <Button onClick={onRetry}>再試行</Button>
            {readiness.canContinue ? (
              <Button variant="primary" onClick={onContinue}>
                このブラウザに保存済みのデータで続ける
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}

/** Mount the workspace once its source is known. Providers keep running above
 * this gate; after entry, background sync can never remove the user's work. */
export function AppStartupGate({ children }: { children: ReactNode }) {
  const { state: auth } = useAuthSession();
  const migration = useSyncMigrationReadiness();
  const box = useOptionalSyncBox();
  const draft = useOptionalCloudDraft();
  const [entered, setEntered] = useState(false);
  const [slow, setSlow] = useState(false);
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  const readiness = getStartupReadiness({ auth, migration, box, draft, online, slow });

  useEffect(() => {
    if (entered) return;
    const timer = globalThis.setTimeout(() => setSlow(true), STARTUP_SLOW_AFTER_MS);
    const updateOnline = () => setOnline(navigator.onLine !== false);
    globalThis.addEventListener("online", updateOnline);
    globalThis.addEventListener("offline", updateOnline);
    return () => {
      globalThis.clearTimeout(timer);
      globalThis.removeEventListener("online", updateOnline);
      globalThis.removeEventListener("offline", updateOnline);
    };
  }, [entered]);

  useEffect(() => {
    if (readiness.phase === "ready") setEntered(true);
  }, [readiness.phase]);

  if (entered) return children;
  return (
    <StartupScreen
      readiness={readiness}
      onRetry={() => globalThis.location.reload()}
      onContinue={() => { if (readiness.canContinue) setEntered(true); }}
    />
  );
}
