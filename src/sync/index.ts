export * from "./firebaseConfig";
export * from "./firebaseClient";
export * from "./firebaseAuthGateway";
export * from "./authSession";
export * from "./authSessionContext";
export * from "./syncTypes";
export * from "./syncPayload";
export * from "./syncOutbox";
export {
  createLocalSyncRepository,
  createBrowserLocalSyncRepository,
  createBrowserSyncRepository,
  createMemorySyncRepository,
  createInMemorySyncRepository,
  createEmptySyncState,
  isLocalSyncState,
  parseLocalSyncState,
  serializeLocalSyncState,
  stringifyLocalSyncState,
  SyncRepositoryError as LocalSyncRepositoryError,
  type LocalSyncRepository,
  type LocalSyncRepositoryOptions,
  type MemorySyncRepository,
  type SyncRepositoryErrorCode as LocalSyncRepositoryErrorCode,
  type SyncRepositoryLoadResult as LocalSyncRepositoryLoadResult,
  type SyncRepositorySaveResult as LocalSyncRepositorySaveResult,
  type SyncStorageLike,
} from "./localSyncRepository";
export {
  FirestoreSyncRepository,
  classifyFirestoreError,
  createCloudSyncRepository,
  createFirestoreSyncRepository,
  createSyncDocumentId,
  getSyncCollectionPath,
  getSyncDocumentId,
  makeFirestoreDocumentId,
  makeSyncDocumentId,
  sanitizeFirestoreError,
  sha256Hex,
  type CloudSyncRepository,
  type CreateFirestoreSyncRepositoryOptions,
  type FirestoreSyncDependencies,
  type FirestoreSyncGateway,
  type SyncReadResult,
  type SyncRecordInput,
  type SyncRepositoryError as CloudSyncRepositoryError,
  type SyncRepositoryErrorKind as CloudSyncRepositoryErrorKind,
  type SyncRepositoryIssue,
  type SyncRepositoryIssueCode,
  type SyncWriteResult,
} from "./firestoreSyncRepository";
export * from "./syncCoordinator";
export * from "./syncBoxRepository";
export * from "./SyncBoxProvider";
export * from "./migrationStorage";
export {
  buildMigrationPlan,
  createMigrationPlan,
  planLocalMigration,
  type MigrationDecision as MigrationPlanDecision,
  type MigrationDefaultExampleState,
  type MigrationPlanCounts,
  type MigrationPlanInput,
  type MigrationPlanResult,
  type MigrationPlanSnapshot,
  type MigrationPlanSummary,
} from "./migrationPlan";
export * from "./localStorageMigration";
export * from "./SyncMigrationDialog";
export {
  SyncMigrationGate,
  SyncMigrationReadinessContext,
  getSyncMigrationReadiness,
  useSyncMigrationReadiness,
  type SyncMigrationControllerLike,
  type SyncMigrationControllerFactory,
  type SyncMigrationGateProps,
  type SyncMigrationReadiness,
  type SyncMigrationReadinessStatus,
} from "./SyncMigrationGate";
export * from "./syncMigrationView";
