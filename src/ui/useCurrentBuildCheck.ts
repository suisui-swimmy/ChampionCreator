import { useEffect, useRef, useState } from "react";
import type { CurrentBuildEvaluationResult } from "../search/currentBuildEvaluation";
import { CurrentBuildWorkerClient } from "../worker/currentBuildWorkerClient";
import { buildCurrentBuildEvaluationInput } from "./currentBuildEvaluationUi";
import type { ScenarioFormState, TargetFormState } from "./defenceSearchUi";

export type CurrentBuildCheckState = {
  status: "idle" | "stale" | "running" | "complete" | "error" | "canceled";
  result?: CurrentBuildEvaluationResult;
  error?: string;
  progress?: number;
  evaluatedConditions?: number;
  totalConditions?: number;
};
export const useCurrentBuildCheck = (target: TargetFormState, scenarios: ScenarioFormState[]) => {
  const [state, setState] = useState<CurrentBuildCheckState>({ status: "idle" });
  const client = useRef<CurrentBuildWorkerClient | null>(null);
  const inputKey = JSON.stringify([target, scenarios]);
  const latestInputKey = useRef(inputKey);
  latestInputKey.current = inputKey;
  const checkedInputKey = useRef<string | null>(null);
  const stale = checkedInputKey.current !== null && checkedInputKey.current !== inputKey;
  useEffect(() => {
    if (!stale) return;
    client.current?.cancel();
    checkedInputKey.current = null;
    setState({ status: "stale" });
  }, [inputKey, stale]);
  useEffect(() => () => client.current?.cancel(), []);
  const run = () => {
    client.current ??= new CurrentBuildWorkerClient();
    const requestKey = inputKey;
    checkedInputKey.current = requestKey;
    setState({ status: "running" });
    try {
      const input = buildCurrentBuildEvaluationInput(target, scenarios);
      client.current.start(input, (message) => {
        if (latestInputKey.current !== requestKey) return;
        if (message.type === "progress") {
          setState({ status: "running", progress: message.progress,
            evaluatedConditions: message.evaluatedConditions, totalConditions: message.totalConditions });
        } else if (message.type === "complete") {
          setState({ status: "complete", result: message.result, progress: 1,
            evaluatedConditions: message.result.conditions.length, totalConditions: message.result.conditions.length });
        } else {
          setState((previous) => ({ ...previous, status: "error", error: message.message }));
        }
      });
    } catch {
      setState({ status: "error", error: "確認処理を開始できませんでした。もう一度確認してください。" });
    }
  };
  const cancel = () => {
    client.current?.cancel();
    setState((previous) => ({ ...previous, status: "canceled" }));
  };
  const invalidate = () => {
    client.current?.cancel();
    checkedInputKey.current = null;
    setState((previous) => previous.status === "idle" ? previous : { status: "stale" });
  };
  return { state: stale ? { status: "stale" as const } : state, run, cancel, invalidate };
};
