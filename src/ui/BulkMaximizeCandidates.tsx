import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { MaximizeRemainingBulkResult } from "../search/maximizeRemainingBulk";
import { Button } from "./primitives";
import { getPublicAssetUrl } from "./publicAssetUrl";
import "./BulkMaximizeCandidates.css";

type BulkResult = MaximizeRemainingBulkResult;

export const getBulkCandidateKey = (result: BulkResult): string => {
  const { natureCanonicalName, statPoints } = result.candidate;
  return [natureCanonicalName ?? "none", ...["hp", "atk", "def", "spa", "spd", "spe"].map(
    (key) => statPoints[key as keyof typeof statPoints],
  )].join(":");
};

const formatIndex = (value: number): string => Number.isInteger(value) ? String(value) : value.toFixed(1);

/** Rank the complete, already sorted result set before taking a page. */
export const getBulkCandidatePage = (results: BulkResult[], requestedPage: number, pageSize: number) => {
  const pageCount = Math.max(1, Math.ceil(results.length / pageSize));
  const page = Math.max(1, Math.min(requestedPage, pageCount));
  const start = (page - 1) * pageSize;
  let rank = 1;
  const ranked = results.map((result, index) => {
    if (index > 0 && result.score.overallBulk !== results[index - 1].score.overallBulk) rank = index + 1;
    return { result, rank, index };
  });
  return { page, pageCount, start, end: Math.min(start + pageSize, results.length), rows: ranked.slice(start, start + pageSize) };
};

function BulkStats({ result }: { result: BulkResult }) {
  return (
    <dl className="bulk-candidate-stats">
      {([["hp", "H"], ["def", "B"], ["spd", "D"]] as const).map(([key, label]) => (
        <div key={key} className={`bulk-candidate-stat bulk-candidate-stat-${key}`}>
          <dt>{label}</dt>
          <dd><strong>{result.candidate.derivedStats[key]}</strong><span aria-label={`${label} ${result.candidate.statPoints[key]}SP`}>({result.candidate.statPoints[key]})</span></dd>
        </div>
      ))}
    </dl>
  );
}

function BulkCandidateContent({ result, rank, applied, onApply, showScoreLabel = false }: {
  result: BulkResult; rank: number; applied: boolean; onApply: (result: BulkResult) => void; showScoreLabel?: boolean;
}) {
  return (
    <div className="bulk-candidate-layout">
      <div className="bulk-candidate-meta">
        <div className="bulk-candidate-identity"><strong className="bulk-candidate-rank">{rank}位</strong><span>{result.candidate.nature}</span></div>
        <div className="bulk-candidate-score" role="group" aria-label="総合耐久指数">
          {showScoreLabel && <span aria-hidden="true">総合耐久指数</span>}<strong>{formatIndex(result.score.overallBulk)}</strong>
        </div>
      </div>
      <BulkStats result={result} />
      <Button variant="ghost" className="bulk-candidate-apply" onClick={() => onApply(result)}
        aria-label={`${rank}位 ${result.candidate.nature} H${result.candidate.statPoints.hp} B${result.candidate.statPoints.def} D${result.candidate.statPoints.spd}を適用`}>
        {applied ? "適用済み" : "適用"}
      </Button>
    </div>
  );
}

export function BulkCandidateRow(props: { result: BulkResult; rank: number; applied: boolean; onApply: (result: BulkResult) => void }) {
  return (
    <li className="bulk-candidate-row">
      <BulkCandidateContent {...props} />
    </li>
  );
}

function BulkComparisonDialog({ results, appliedKey, onApply, onClose, sourceRef }: {
  results: BulkResult[]; appliedKey: string | null; onApply: (result: BulkResult) => void; onClose: () => void;
  sourceRef: RefObject<HTMLDivElement | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const titleId = useId();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches ? 5 : 20);

  useLayoutEffect(() => {
    const source = sourceRef.current;
    if (!source) return;
    const updateWidth = () => {
      const width = source.getBoundingClientRect().width;
      // Retain the last visible width if a breakpoint temporarily hides the
      // target editor. CSS still constrains the dialog to the viewport.
      if (width > 0) dialogRef.current?.style.setProperty("--bulk-comparison-width", `${width}px`);
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(source);
    return () => observer.disconnect();
  }, [sourceRef]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const change = () => { setPageSize(media.matches ? 5 : 20); setPage(1); };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    // A native modal supplies top-layer rendering and background inertness,
    // including when opened from the mobile target editor sheet.
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      const fallback = [...document.querySelectorAll<HTMLButtonElement>(".bulk-maximize-button, .mobile-target-mini")]
        .find((element) => element.getClientRects().length > 0);
      if (previousFocus?.isConnected && previousFocus.getClientRects().length > 0) previousFocus.focus();
      else fallback?.focus();
    };
  }, []);

  const current = getBulkCandidatePage(results, page, pageSize);
  const changePage = (nextPage: number) => {
    setPage(nextPage);
    listRef.current?.scrollTo({ top: 0 });
  };
  return createPortal(
    <dialog ref={dialogRef} className="bulk-comparison-dialog" aria-labelledby={titleId} aria-modal="true"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = [...event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled])")]
          .filter((element) => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}>
      <header className="bulk-comparison-header">
        <div><h2 id={titleId}>耐久最大化の候補</h2><p>総合耐久指数順 · {results.length}件</p></div>
        <Button size="icon" className="bulk-comparison-close" onClick={onClose} aria-label="候補の比較を閉じる">
          <img src={getPublicAssetUrl("assets/ui/close.svg")} alt="" aria-hidden="true" />
        </Button>
      </header>
      <ol ref={listRef} className="bulk-comparison-list" aria-label="耐久最大化候補一覧" key={`${current.page}-${pageSize}`}>
        {current.rows.map(({ result, rank }) => (
          <BulkCandidateRow key={getBulkCandidateKey(result)} result={result} rank={rank}
            applied={appliedKey === getBulkCandidateKey(result)} onApply={(selected) => { onApply(selected); onClose(); }} />
        ))}
      </ol>
      <nav className="bulk-comparison-pagination" aria-label="耐久最大化候補のページ切り替え">
        <Button size="small" disabled={current.page === 1} onClick={() => changePage(current.page - 1)}>前へ</Button>
        <div role="status"><strong>{current.page} / {current.pageCount}</strong><span>{current.start + 1}–{current.end}件 / {results.length}件</span></div>
        <Button size="small" disabled={current.page === current.pageCount} onClick={() => changePage(current.page + 1)}>次へ</Button>
      </nav>
    </dialog>, document.body,
  );
}

/** Mounted only for a completed request; replacing results resets the comparison view. */
export function BulkMaximizeCandidates({ results, appliedKey, onApply }: {
  results: BulkResult[]; appliedKey: string | null; onApply: (result: BulkResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const result = results[0];
  if (!result) return null;
  return (
    <>
      <div ref={previewRef} className="bulk-maximize-preview bulk-maximize-summary">
        <div className="bulk-maximize-preview-header">
          <strong>耐久最大化候補</strong>
          <Button size="small" onClick={() => setOpen(true)} aria-haspopup="dialog">候補を比較（{results.length}件）</Button>
        </div>
        <BulkCandidateContent result={result} rank={1} applied={appliedKey === getBulkCandidateKey(result)} onApply={onApply} showScoreLabel />
      </div>
      {open && <BulkComparisonDialog results={results} appliedKey={appliedKey} onApply={onApply} onClose={() => setOpen(false)} sourceRef={previewRef} />}
    </>
  );
}
