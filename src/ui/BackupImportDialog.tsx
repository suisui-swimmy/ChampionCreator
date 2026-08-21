import {
  useEffect,
  useId,
  useRef,
} from "react";
import { Button } from "./primitives";
import type { BoxEntry } from "./boxStorage";
import type { EnemyBoxEntry } from "./enemyBoxStorage";
import type {
  BackupImportImpactCounts,
  BackupImportPlan,
  BackupImportPlanSet,
} from "./boxBackupImport";

export type BackupImportScope = "account" | "device";
export type BackupImportKind = "target" | "enemy";
export type BackupImportDecision = "merge" | "replace";

export interface BackupImportDialogProps {
  readonly kind: BackupImportKind;
  readonly plans: BackupImportPlanSet<BoxEntry> | BackupImportPlanSet<EnemyBoxEntry>;
  readonly scope: BackupImportScope;
  readonly warnings?: readonly string[];
  readonly warningsBlockReplace?: boolean;
  readonly busy?: boolean;
  readonly onDecision: (decision: BackupImportDecision) => void;
  readonly onCancel: () => void;
}

const EMPTY_IMPACT: BackupImportImpactCounts = {
  added: 0,
  updated: 0,
  removed: 0,
  unchanged: 0,
};

const focusableSelector = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

const formatCount = (value: number): string => `${Math.max(0, Math.trunc(value))}件`;

const getImpact = (
  plan: Pick<BackupImportPlan<unknown>, "impact" | "counts">,
): BackupImportImpactCounts => plan.impact ?? plan.counts ?? EMPTY_IMPACT;

const ImpactCounts = ({ counts }: { counts: BackupImportImpactCounts }) => (
  <dl className="sync-migration-counts backup-import-counts">
    <div><dt>追加</dt><dd>{formatCount(counts.added)}</dd></div>
    <div><dt>更新</dt><dd>{formatCount(counts.updated)}</dd></div>
    <div><dt>削除</dt><dd>{formatCount(counts.removed)}</dd></div>
    <div><dt>変更なし</dt><dd>{formatCount(counts.unchanged)}</dd></div>
  </dl>
);

const PlanPreview = ({
  label,
  plan,
  headingId,
}: {
  label: string;
  plan: Pick<BackupImportPlan<unknown>, "impact" | "counts" | "conflictCopyCount" | "deduplicatedCount">;
  headingId: string;
}) => (
  <section className="backup-import-plan" aria-labelledby={headingId}>
    <h3 id={headingId}>{label}</h3>
    <ImpactCounts counts={getImpact(plan)} />
    {plan.conflictCopyCount > 0 || plan.deduplicatedCount > 0 ? (
      <p className="backup-import-plan-note">
        {[
          plan.conflictCopyCount > 0 ? `競合コピー ${formatCount(plan.conflictCopyCount)}` : null,
          plan.deduplicatedCount > 0 ? `重複除外 ${formatCount(plan.deduplicatedCount)}` : null,
        ].filter(Boolean).join(" / ")}
      </p>
    ) : null}
  </section>
);

/**
 * Presents a parsed backup's merge/replace impact before the caller commits it.
 * This component owns no storage or import state.  The focus, inert, and body
 * lock behavior mirrors SyncMigrationDialog so it can be mounted by either
 * the local or account-level backup controller.
 */
export function BackupImportDialog({
  kind,
  plans,
  scope,
  warnings = [],
  warningsBlockReplace = warnings.length > 0,
  busy = false,
  onDecision,
  onCancel,
}: BackupImportDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const busyReasonId = useId();
  const warningId = useId();
  const mergeId = useId();
  const replaceId = useId();
  const isBusy = busy;

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
  }, [isBusy]);

  const replaceLabel = scope === "account"
    ? "全端末を置き換え"
    : "この端末を置き換え";
  const replaceBlocked = warnings.length > 0 && warningsBlockReplace;

  return (
    <div className="sync-migration-overlay backup-import-overlay">
      <div className="sync-migration-backdrop" aria-hidden="true" />
      <section
        ref={dialogRef}
        className="sync-migration-window backup-import-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-live="polite"
        aria-busy={isBusy}
        tabIndex={-1}
      >
        <div className="sync-migration-copy">
          <span className="sync-migration-kicker">
            {kind === "target" ? "調整対象" : "仮想敵"}バックアップの読み込み
          </span>
          <h2 id={titleId}>保存データの取り込み方法を選択</h2>
          <p id={descriptionId} className="sync-migration-description" role="status" aria-live="polite">
            取り込み前に、{kind === "target" ? "調整対象" : "仮想敵"}の変更件数を確認できます。
          </p>
        </div>

        <div className="backup-import-plan-grid" aria-label="バックアップ取り込みの影響">
          <PlanPreview
            label="統合"
            headingId={mergeId}
            plan={plans.merge}
          />
          <PlanPreview
            label={replaceLabel}
            headingId={replaceId}
            plan={plans.replace}
          />
        </div>

        {warnings.length > 0 ? (
          <div id={warningId} className="sync-migration-error backup-import-warning" role="alert">
            <strong>{replaceBlocked
              ? "バックアップの一部を読み込めませんでした"
              : "バックアップの内容を確認してください"}</strong>
            <ul>
              {warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
            <p>{replaceBlocked
              ? "読み込めない保存があるため、置き換えは選べません。統合するか、バックアップを修正してください。"
              : "このバックアップで置き換えると、現在の保存はすべて削除されます。"}</p>
          </div>
        ) : null}

        {isBusy ? (
          <p id={busyReasonId} className="visually-hidden">
            保存データを処理中のため選択できません。
          </p>
        ) : null}
        <div className="sync-migration-actions backup-import-actions" aria-label="バックアップの扱い">
          <Button
            variant="primary"
            disabled={isBusy}
            aria-describedby={isBusy ? busyReasonId : undefined}
            onClick={() => onDecision("merge")}
          >
            統合
          </Button>
          <Button
            variant="ghost"
            disabled={isBusy || replaceBlocked}
            aria-describedby={warnings.length > 0 ? warningId : isBusy ? busyReasonId : undefined}
            onClick={() => onDecision("replace")}
          >
            {replaceLabel}
          </Button>
          <Button
            variant="ghost"
            disabled={isBusy}
            aria-describedby={isBusy ? busyReasonId : undefined}
            onClick={onCancel}
          >
            キャンセル
          </Button>
        </div>
      </section>
    </div>
  );
}
