import { SearchProgress } from "./primitives";
import type { CurrentBuildCheckState } from "./useCurrentBuildCheck";

export interface CalculationProgressProps {
  search: { status: string; progress: number; searchedCandidates: number; totalCandidates: number };
  current: CurrentBuildCheckState;
  view: "candidates" | "current";
  onCancelSearch: () => void;
  onCancelCurrent: () => void;
}

export function CalculationProgress({ search, current, view, onCancelSearch, onCancelCurrent }: CalculationProgressProps) {
  // An active task owns the progress/cancel control even if the result tab changes.
  const showCurrent = current.status === "running" || (search.status !== "running" && view === "current");
  return <SearchProgress
    progress={showCurrent ? current.progress ?? 0 : search.progress}
    searchedCandidates={showCurrent ? current.evaluatedConditions ?? 0 : search.searchedCandidates}
    totalCandidates={showCurrent ? current.totalConditions ?? 0 : search.totalCandidates}
    label={showCurrent ? "配分確認の進捗" : "探索進捗"}
    canCancel={search.status === "running" || current.status === "running"}
    onCancel={current.status === "running" ? onCancelCurrent : onCancelSearch}
  />;
}
