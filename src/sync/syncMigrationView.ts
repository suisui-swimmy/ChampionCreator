import type { LocalStorageMigrationResult } from "./localStorageMigration";
import type { SyncMigrationMode } from "./SyncMigrationDialog";

export const getSyncMigrationMode = (
  result: LocalStorageMigrationResult,
): SyncMigrationMode | null => {
  if (result.status === "completed") return null;
  if (result.requiresDecision || result.status === "needs-review") return "review";
  if (result.error) return "error";
  return "checking";
};
