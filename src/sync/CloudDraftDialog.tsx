import {
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Button } from "../ui/primitives";
import type { CloudDraftRecord } from "./cloudDraftTypes";

/** The part of a draft payload that is needed by the list summary. */
interface CloudDraftPayloadSummarySource {
  /** Cloud drafts store the versioned DraftStorageDocument as this outer value. */
  readonly payload?: CloudDraftPayloadSummarySource;
  readonly schemaVersion?: unknown;
  readonly savedAt?: unknown;
  readonly target?: {
    readonly pokemonInput?: unknown;
  };
  readonly targetForm?: {
    readonly pokemonInput?: unknown;
  };
  readonly scenarios?: readonly unknown[];
  readonly scenarioForms?: readonly unknown[];
}

export interface CloudDraftSummary {
  readonly deviceId: string;
  readonly deviceLabel: string;
  /** The user-facing Japanese date/time string. */
  readonly updatedAt: string;
  readonly targetPokemon: string;
  readonly scenarioCount: number;
}

export interface CloudDraftDialogProps {
  /** Active cloud draft records. Their payload is the JSON string from the sync layer. */
  readonly records: readonly CloudDraftRecord[];
  /** The device whose local draft is currently being edited. */
  readonly currentDeviceId: string;
  readonly busy?: boolean;
  readonly statusMessage?: string | null;
  readonly errorMessage?: string | null;
  /** Hide or disable operations while the controller is offline or not ready. */
  readonly canRestore?: boolean | ((record: CloudDraftRecord) => boolean);
  readonly canDelete?: boolean | ((record: CloudDraftRecord) => boolean);
  /** Defaults to true so current-device rows have the same explicit actions as other rows. */
  readonly allowCurrentDeviceActions?: boolean;
  readonly onRefresh: () => void;
  readonly onRestore: (record: CloudDraftRecord) => void;
  readonly onDelete: (record: CloudDraftRecord) => void;
  readonly onClose: () => void;
}

type CloudDraftRecordWithOptionalLifecycle = CloudDraftRecord & {
  readonly active?: unknown;
  readonly deletedAt?: unknown;
  readonly tombstone?: unknown;
};

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const getPayloadSummarySource = (payload: string): CloudDraftPayloadSummarySource => {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (!isRecord(parsed)) {
      return {};
    }
    const source = parsed as CloudDraftPayloadSummarySource;
    // The cloud-draft contract stores a serialized DraftStorageDocument. The
    // direct shape is accepted as a compatibility convenience for callers
    // using an already-unwrapped ShareStateDocument.
    if (isRecord(source.payload)) {
      return source.payload as CloudDraftPayloadSummarySource;
    }
    return source;
  } catch {
    // The repository normally gives this component validated records. Keeping
    // the summary total here makes a transient bad response non-fatal to the
    // dialog and lets the caller surface its own repository error.
    return {};
  }
};

const formatUpdatedAt = (updatedAt: string): string => {
  const date = new Date(updatedAt);
  if (!Number.isFinite(date.getTime())) {
    return "日時不明";
  }
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

/**
 * Produce the small, display-only summary used by each row.
 *
 * This function deliberately parses the serialized cloud payload without
 * mutating it or attempting a restore. The sync repository remains the owner
 * of validation and the caller remains the owner of the resulting payload.
 */
export const summarizeCloudDraftRecord = (
  record: CloudDraftRecord,
): CloudDraftSummary => {
  const payload = getPayloadSummarySource(record.payload);
  const targetSource = payload.target ?? payload.targetForm;
  const targetPokemon = typeof targetSource?.pokemonInput === "string"
    ? targetSource.pokemonInput.trim() || "未入力"
    : "未入力";
  const scenarios = payload.scenarios ?? payload.scenarioForms;
  return {
    deviceId: record.deviceId,
    deviceLabel: record.deviceLabel,
    updatedAt: formatUpdatedAt(record.updatedAt),
    targetPokemon,
    scenarioCount: Array.isArray(scenarios) ? scenarios.length : 0,
  };
};

/** Alias for callers that use the list-oriented name. */
export const getCloudDraftSummary = summarizeCloudDraftRecord;

const isActiveRecord = (record: CloudDraftRecord): boolean => {
  const candidate = record as CloudDraftRecordWithOptionalLifecycle;
  return candidate.active !== false
    && candidate.tombstone !== true
    && candidate.deletedAt == null;
};

const canUseAction = (
  rule: boolean | ((record: CloudDraftRecord) => boolean) | undefined,
  record: CloudDraftRecord,
): boolean => {
  if (typeof rule === "function") {
    return rule(record);
  }
  return rule ?? true;
};

const getRecordKey = (record: CloudDraftRecord): string => (
  `${record.deviceId}:${record.updatedAt}:${record.payload}`
);

interface CloudDraftRowProps {
  readonly record: CloudDraftRecord;
  readonly current: boolean;
  readonly busy: boolean;
  readonly allowCurrentDeviceActions: boolean;
  readonly canRestore: boolean;
  readonly canDelete: boolean;
  readonly onRestore: (record: CloudDraftRecord) => void;
  readonly onDelete: (record: CloudDraftRecord) => void;
  readonly pendingDeleteKey: string | null;
  readonly onRequestDelete: (record: CloudDraftRecord) => void;
  readonly onCancelDelete: () => void;
}

const CloudDraftRow = ({
  record,
  current,
  busy,
  allowCurrentDeviceActions,
  canRestore,
  canDelete,
  onRestore,
  onDelete,
  pendingDeleteKey,
  onRequestDelete,
  onCancelDelete,
}: CloudDraftRowProps) => {
  const summary = summarizeCloudDraftRecord(record);
  const recordKey = getRecordKey(record);
  const isPendingDelete = pendingDeleteKey === recordKey;
  const actionsAllowed = !current || allowCurrentDeviceActions;
  const restoreDisabled = busy || !actionsAllowed || !canRestore;
  const deleteDisabled = busy || !actionsAllowed || !canDelete;
  const rowLabel = `${summary.deviceLabel}の下書き`;
  const detailsId = `cloud-draft-details-${record.deviceId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return (
    <article className="cloud-draft-row" data-device-id={record.deviceId}>
      <div className="cloud-draft-row-copy">
        <h4 className="cloud-draft-device-label">
          {summary.deviceLabel}
          {current ? <span className="cloud-draft-current-badge">このブラウザ</span> : null}
        </h4>
        <dl id={detailsId} className="cloud-draft-summary" aria-label={`${rowLabel}の概要`}>
          <div><dt>更新日時</dt><dd>{summary.updatedAt}</dd></div>
          <div><dt>調整対象</dt><dd>{summary.targetPokemon}</dd></div>
          <div><dt>シナリオ</dt><dd>{summary.scenarioCount}件</dd></div>
        </dl>
      </div>
      <div className="cloud-draft-row-actions" aria-label={`${rowLabel}の操作`}>
        <Button
          variant="primary"
          disabled={restoreDisabled}
          aria-label={`復元: ${rowLabel}`}
          aria-describedby={detailsId}
          onClick={() => onRestore(record)}
        >
          復元
        </Button>
        <Button
          variant="danger"
          disabled={deleteDisabled}
          aria-label={`削除: ${rowLabel}`}
          aria-describedby={detailsId}
          aria-expanded={isPendingDelete}
          onClick={() => onRequestDelete(record)}
        >
          削除
        </Button>
      </div>
      {isPendingDelete ? (
        <div className="cloud-draft-delete-confirm" role="alert" aria-live="assertive">
          <p>この下書きを削除しますか？</p>
          <div className="cloud-draft-delete-confirm-actions">
            <Button
              variant="danger"
              disabled={busy}
              aria-label={`削除を確定: ${rowLabel}`}
              onClick={() => onDelete(record)}
            >
              削除を確定
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              aria-label={`削除をキャンセル: ${rowLabel}`}
              onClick={onCancelDelete}
            >
              キャンセル
            </Button>
          </div>
        </div>
      ) : null}
    </article>
  );
};

/**
 * Cross-device draft picker. It only emits restore/delete intent; mounting it
 * never changes the current work automatically.
 */
export function CloudDraftDialog({
  records,
  currentDeviceId,
  busy = false,
  statusMessage,
  errorMessage,
  canRestore,
  canDelete,
  allowCurrentDeviceActions = true,
  onRefresh,
  onRestore,
  onDelete,
  onClose,
}: CloudDraftDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [pendingDeleteKey, setPendingDeleteKey] = useState<string | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const statusId = useId();

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return undefined;
    }

    const overlay = dialog.closest<HTMLElement>(".cloud-draft-overlay");
    const siblings = overlay?.parentElement
      ? Array.from(overlay.parentElement.children).filter((element) => element !== overlay)
      : [];
    const previousSiblingState = siblings.map((element) => ({
      element,
      inert: (element as HTMLElement).inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    for (const element of siblings) {
      (element as HTMLElement).inert = true;
      element.setAttribute("aria-hidden", "true");
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
      for (const previous of previousSiblingState) {
        (previous.element as HTMLElement).inert = previous.inert;
        if (previous.ariaHidden === null) {
          previous.element.removeAttribute("aria-hidden");
        } else {
          previous.element.setAttribute("aria-hidden", previous.ariaHidden);
        }
      }
      previouslyFocusedRef.current?.focus();
      previouslyFocusedRef.current = null;
    };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return undefined;
    }

    const initialFocusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    (initialFocusable[0] ?? dialog).focus();

    const keepFocusInside = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    dialog.addEventListener("keydown", keepFocusInside);
    return () => dialog.removeEventListener("keydown", keepFocusInside);
  }, []);

  const activeRecords = records.filter(isActiveRecord);
  const currentRecords = activeRecords.filter((record) => record.deviceId === currentDeviceId);
  const otherRecords = activeRecords.filter((record) => record.deviceId !== currentDeviceId);
  const isActionAllowed = (
    record: CloudDraftRecord,
    rule: boolean | ((record: CloudDraftRecord) => boolean) | undefined,
  ): boolean => canUseAction(rule, record);

  const requestDelete = (record: CloudDraftRecord) => {
    const recordKey = getRecordKey(record);
    if (pendingDeleteKey === recordKey) {
      onDelete(record);
      setPendingDeleteKey(null);
      return;
    }
    setPendingDeleteKey(recordKey);
  };

  return (
    <div className="cloud-draft-overlay">
      <div className="cloud-draft-backdrop" aria-hidden="true" />
      <section
        ref={dialogRef}
        className="cloud-draft-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-live="polite"
        aria-busy={busy}
        tabIndex={-1}
      >
        <div className="cloud-draft-header">
          <div className="cloud-draft-copy">
            <span className="cloud-draft-kicker">ブラウザ別クラウド保存</span>
            <h2 id={titleId}>作業中の下書き</h2>
            <p id={descriptionId} className="cloud-draft-description">
              復元する下書きを選んでください。表示しただけでは現在の入力を変更しません。
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="下書き一覧を閉じる"
            onClick={onClose}
          >
            ×
          </Button>
        </div>

        {errorMessage ? (
          <p className="cloud-draft-error" role="alert" aria-live="assertive">
            {errorMessage}
          </p>
        ) : null}
        {statusMessage ? (
          <p id={statusId} className="cloud-draft-status" role="status" aria-live="polite">
            {statusMessage}
          </p>
        ) : null}

        <div className="cloud-draft-toolbar">
          <Button
            variant="ghost"
            disabled={busy}
            onClick={onRefresh}
          >
            更新
          </Button>
        </div>

        <section className="cloud-draft-section" aria-labelledby={`${titleId}-current`}>
          <h3 id={`${titleId}-current`}>このブラウザ</h3>
          {currentRecords.length > 0 ? currentRecords.map((record) => (
            <CloudDraftRow
              key={getRecordKey(record)}
              record={record}
              current
              busy={busy}
              allowCurrentDeviceActions={allowCurrentDeviceActions}
              canRestore={isActionAllowed(record, canRestore)}
              canDelete={isActionAllowed(record, canDelete)}
              onRestore={onRestore}
              onDelete={onDelete}
              pendingDeleteKey={pendingDeleteKey}
              onRequestDelete={requestDelete}
              onCancelDelete={() => setPendingDeleteKey(null)}
            />
          )) : (
            <p className="cloud-draft-empty">このブラウザの下書きはありません。</p>
          )}
        </section>

        <section className="cloud-draft-section" aria-labelledby={`${titleId}-other`}>
          <h3 id={`${titleId}-other`}>他のブラウザ</h3>
          {otherRecords.length > 0 ? otherRecords.map((record) => (
            <CloudDraftRow
              key={getRecordKey(record)}
              record={record}
              current={false}
              busy={busy}
              allowCurrentDeviceActions={allowCurrentDeviceActions}
              canRestore={isActionAllowed(record, canRestore)}
              canDelete={isActionAllowed(record, canDelete)}
              onRestore={onRestore}
              onDelete={onDelete}
              pendingDeleteKey={pendingDeleteKey}
              onRequestDelete={requestDelete}
              onCancelDelete={() => setPendingDeleteKey(null)}
            />
          )) : (
            <p className="cloud-draft-empty">他のブラウザの下書きはありません。</p>
          )}
        </section>

        <div className="cloud-draft-footer">
          <Button variant="ghost" onClick={onClose}>閉じる</Button>
        </div>
      </section>
    </div>
  );
}
