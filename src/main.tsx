import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AuthSessionProvider } from "./sync/authSessionContext";
import { SyncMigrationGate } from "./sync/SyncMigrationGate";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <AuthSessionProvider>
      <SyncMigrationGate>
        <App />
      </SyncMigrationGate>
    </AuthSessionProvider>
  </StrictMode>,
);
