export * from "./firebaseConfig";
export * from "./firebaseClient";
export * from "./firebaseAuthGateway";
export * from "./authSession";
export * from "./authSessionContext";
export * from "./accountDeletion";
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
export * from "./cloudDraftTypes";
export * from "./deviceIdentity";
export {
  CLOUD_DRAFT_LOCAL_STORAGE_KEY_PREFIX,
  createBrowserCloudDraftLocalRepository,
  createBrowserLocalCloudDraftRepository,
  createCloudDraftLocalRepository,
  createCloudDraftStorageKey,
  createEmptyCloudDraftState,
  createInMemoryCloudDraftLocalRepository,
  createLocalCloudDraftRepository,
  createMemoryCloudDraftLocalRepository,
  getCloudDraftStorageKey,
  isCloudDraftLocalState,
  makeCloudDraftLocalStorageKey,
  makeCloudDraftStorageKey,
  parseCloudDraftEnvelope,
  parseCloudDraftLocalState,
  parseCloudDraftMutation,
  parseCloudDraftRecord,
  serializeCloudDraftLocalState,
  stringifyCloudDraftLocalState,
  CloudDraftRepositoryError as LocalCloudDraftRepositoryError,
  type CloudDraftLocalRepository,
  type CloudDraftLocalRepositoryOptions,
  type CloudDraftRepositoryErrorCode as LocalCloudDraftRepositoryErrorCode,
  type CloudDraftRepositoryLoadResult as LocalCloudDraftRepositoryLoadResult,
  type CloudDraftRepositorySaveResult as LocalCloudDraftRepositorySaveResult,
  type CloudDraftStorageLike,
  type LocalCloudDraftRepository,
  type MemoryCloudDraftLocalRepository,
} from "./cloudDraftLocalRepository";
export {
  CLOUD_DRAFT_DEVICE_ID_MAX_BYTES,
  CLOUD_DRAFT_DEVICE_LABEL_MAX_BYTES,
  CLOUD_DRAFT_MUTATION_ID_MAX_BYTES,
  CLOUD_DRAFT_PAYLOAD_MAX_BYTES,
  FirestoreCloudDraftRepository,
  classifyFirestoreCloudDraftError,
  createCloudDraftRepository,
  createFirestoreCloudDraftRepository,
  createFirestoreDraftRepository,
  getCloudDraftCollectionPath,
  getFirestoreCloudDraftCollectionPath,
  sanitizeFirestoreCloudDraftError,
  type CloudDraftReadResult,
  type CloudDraftRecordInput,
  type CloudDraftRepository as RemoteCloudDraftRepository,
  type CloudDraftRepositoryError as RemoteCloudDraftRepositoryError,
  type CloudDraftRepositoryErrorKind as RemoteCloudDraftRepositoryErrorKind,
  type CloudDraftRepositoryIssue,
  type CloudDraftRepositoryIssueCode,
  type CloudDraftWriteInput,
  type CloudDraftWriteResult,
  type CreateFirestoreCloudDraftRepositoryOptions,
  type FirestoreCloudDraftDependencies,
  type FirestoreCloudDraftGateway,
  type FirestoreCloudDraftTransactionLike,
} from "./firestoreCloudDraftRepository";
export * from "./cloudDraftCoordinator";
export * from "./CloudDraftProvider";
export * from "./CloudDraftDialog";
export * from "./AccountSyncDialog";
export * from "./accountSyncStatus";
export * from "./accountDataExport";
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
