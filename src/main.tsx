import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthSessionProvider } from "./sync/authSessionContext";
import { CloudDraftProvider } from "./sync/CloudDraftProvider";
import { SyncBoxProvider } from "./sync/SyncBoxProvider";
import { SyncMigrationGate } from "./sync/SyncMigrationGate";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

// Replace the build-time, storage-free preview with the normal browser app.
// Hydrating it would mix a blank server snapshot with this browser's saved forms.
createRoot(rootElement).render(
  <StrictMode>
    <AuthSessionProvider>
      <SyncMigrationGate>
        <CloudDraftProvider>
          <SyncBoxProvider>
            <App />
          </SyncBoxProvider>
        </CloudDraftProvider>
      </SyncMigrationGate>
    </AuthSessionProvider>
  </StrictMode>,
);
