import {
  useEffect,
  useId,
  useRef,
} from "react";
import { Button } from "../ui/primitives";

export type SyncMigrationMode = "checking" | "review" | "error";

export type SyncMigrationDecision = "merge" | "cloud" | "device" | "later";

export interface SyncMigrationSummary {
  /** Counts already present on this device before the migration starts. */
  readonly deviceTargetCount?: number;
  readonly deviceEnemyCount?: number;
  /** Counts discovered in the authenticated account's cloud namespace. */
  readonly cloudTargetCount?: number;
  readonly cloudEnemyCount?: number;
  /** Number of entries whose id and payload are identical on both sides. */
  readonly sameCount: number;
  /** Number of entries sharing an id but carrying different payloads. */
  readonly conflictCount: number;
  /** Nested aliases make the prop convenient for domain-shaped callers. */
  readonly device?: {
    readonly target: number;
    readonly enemy: number;
  };
  readonly cloud?: {
    readonly target: number;
    readonly enemy: number;
  };
}

export interface SyncMigrationDialogProps {
  readonly mode: SyncMigrationMode;
  readonly summary: SyncMigrationSummary;
  readonly busy?: boolean;
  readonly errorMessage?: string | null;
  readonly canUseDevice: boolean;
  readonly onDecision: (decision: SyncMigrationDecision) => void;
  readonly onRetry: () => void;
}

const getCount = (
  summary: SyncMigrationSummary,
  side: "device" | "cloud",
  kind: "target" | "enemy",
): number => {
  const directKey = `${side}${kind === "target" ? "Target" : "Enemy"}Count` as const;
  const directValue = summary[directKey];
  if (typeof directValue === "number" && Number.isFinite(directValue)) {
    return Math.max(0, Math.trunc(directValue));
  }

  const nestedValue = summary[side]?.[kind];
  return typeof nestedValue === "number" && Number.isFinite(nestedValue)
    ? Math.max(0, Math.trunc(nestedValue))
    : 0;
};

const formatCount = (value: number): string => `${value}件`;

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

/**
 * The one-time localStorage migration decision surface.
 *
 * This component deliberately owns no storage, auth, or migration state. It
 * only presents the decision and reports it to the caller, so it can be
 * mounted by the future migration controller without coupling that controller
 * to App or the existing box handlers.
 */
export function SyncMigrationDialog({
  mode,
  summary,
  busy = false,
  errorMessage,
  canUseDevice,
  onDecision,
  onRetry,
}: SyncMigrationDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const statusId = useId();
  const deviceDisabledReasonId = useId();
  const busyReasonId = useId();
  const isBusy = busy || mode === "checking";

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

    const overlay = dialog.closest<HTMLElement>(".sync-migration-overlay");
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

    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector));
    (focusable[0] ?? dialog).focus();

    const keepFocusInside = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab") {
        return;
      }
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
  }, [canUseDevice, isBusy, mode]);

  const title = mode === "checking"
    ? "保存データを確認中"
    : mode === "error"
      ? "保存データを確認できませんでした"
      : "保存データの統合方法を選択";
  const description = mode === "checking"
    ? "この端末とクラウドの保存データを確認しています。"
    : mode === "error"
      ? "保存データの確認に失敗しました。再試行してください。"
      : "この端末の保存データとクラウドの保存データをどう扱うか選んでください。";
  const deviceDisabledReason = !canUseDevice
    ? "この端末の保存データを利用できないため選択できません。"
    : isBusy
      ? "保存データを処理中のため選択できません。"
      : null;
  const disabledReasonId = deviceDisabledReason
    ? (!canUseDevice ? deviceDisabledReasonId : busyReasonId)
    : undefined;
  const disabledReason = deviceDisabledReason ?? "保存データを処理中のため選択できません。";

  const targetDeviceCount = getCount(summary, "device", "target");
  const enemyDeviceCount = getCount(summary, "device", "enemy");
  const targetCloudCount = getCount(summary, "cloud", "target");
  const enemyCloudCount = getCount(summary, "cloud", "enemy");

  return (
    <div className="sync-migration-overlay">
      <div className="sync-migration-backdrop" aria-hidden="true" />
      <section
        ref={dialogRef}
        className="sync-migration-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-live="polite"
        aria-busy={isBusy}
        tabIndex={-1}
      >
        <div className="sync-migration-copy">
          <span className="sync-migration-kicker">アカウント保存の初回確認</span>
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId} className="sync-migration-description" role="status" aria-live="polite">
            {description}
          </p>
          {mode === "error" && errorMessage ? (
            <p className="sync-migration-error" role="alert" aria-live="assertive">
              {errorMessage}
            </p>
          ) : null}
        </div>

        <div className="sync-migration-summary" aria-label="保存データの件数">
          <section className="sync-migration-summary-side" aria-labelledby={`${statusId}-device`}>
            <h3 id={`${statusId}-device`}>この端末</h3>
            <dl className="sync-migration-counts">
              <div><dt>調整対象</dt><dd>{formatCount(targetDeviceCount)}</dd></div>
              <div><dt>仮想敵</dt><dd>{formatCount(enemyDeviceCount)}</dd></div>
            </dl>
          </section>
          <section className="sync-migration-summary-side" aria-labelledby={`${statusId}-cloud`}>
            <h3 id={`${statusId}-cloud`}>クラウド</h3>
            <dl className="sync-migration-counts">
              <div><dt>調整対象</dt><dd>{formatCount(targetCloudCount)}</dd></div>
              <div><dt>仮想敵</dt><dd>{formatCount(enemyCloudCount)}</dd></div>
            </dl>
          </section>
          <dl className="sync-migration-comparison">
            <div><dt>同じ内容</dt><dd>{formatCount(Math.max(0, Math.trunc(summary.sameCount)))}</dd></div>
            <div><dt>要確認</dt><dd>{formatCount(Math.max(0, Math.trunc(summary.conflictCount)))}</dd></div>
          </dl>
        </div>

        {mode === "review" ? (
          <>
            <p id={busyReasonId} className="visually-hidden">
              {disabledReason}
            </p>
            {!canUseDevice ? (
              <p id={deviceDisabledReasonId} className="sync-migration-disabled-note" role="note">
                この端末の保存データを利用できないため、「統合」と「この端末を使用」は選択できません。
              </p>
            ) : null}
            <div className="sync-migration-actions" aria-label="保存データの扱い">
              <Button
                variant="primary"
                disabled={isBusy || !canUseDevice}
                aria-describedby={!canUseDevice ? deviceDisabledReasonId : isBusy ? busyReasonId : undefined}
                onClick={() => onDecision("merge")}
              >
                統合
              </Button>
              <Button
                variant="ghost"
                disabled={isBusy}
                aria-describedby={isBusy ? busyReasonId : undefined}
                onClick={() => onDecision("cloud")}
              >
                クラウドを使用
              </Button>
              <Button
                variant="ghost"
                disabled={isBusy || !canUseDevice}
                aria-describedby={disabledReasonId}
                onClick={() => onDecision("device")}
              >
                この端末を使用
              </Button>
              <Button
                variant="ghost"
                disabled={isBusy}
                aria-describedby={isBusy ? busyReasonId : undefined}
                onClick={() => onDecision("later")}
              >
                あとで決める
              </Button>
            </div>
          </>
        ) : null}

        {mode === "checking" ? (
          <p className="sync-migration-checking" role="status" aria-live="polite">
            確認が終わるまでお待ちください。
          </p>
        ) : null}

        {mode === "error" ? (
          <div className="sync-migration-actions sync-migration-error-actions" aria-label="移行エラーの操作">
            <Button
              variant="primary"
              disabled={isBusy}
              onClick={onRetry}
            >
              再試行
            </Button>
            <Button
              variant="ghost"
              disabled={isBusy}
              onClick={() => onDecision("later")}
            >
              あとで決める
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
