import { evaluateCurrentBuildCondition, summarizeCurrentBuildEvaluation,
  type CurrentBuildConditionResult, type CurrentBuildEvaluationInput, type CurrentBuildEvaluationResult,
} from "../search/currentBuildEvaluation";

export interface CurrentBuildWorkerRequest { type: "start"; requestId: string; input: CurrentBuildEvaluationInput }
export type CurrentBuildWorkerMessage =
  | { type: "progress"; requestId: string; evaluatedConditions: number; totalConditions: number; progress: number }
  | { type: "complete"; requestId: string; result: CurrentBuildEvaluationResult }
  | { type: "error"; requestId: string; message: string };

export const runCurrentBuildWorkerTask = async (
  request: CurrentBuildWorkerRequest,
  emit: (message: CurrentBuildWorkerMessage) => void,
  isCanceled: () => boolean = () => false,
) => {
  try {
    const { input, requestId } = request;
    const conditions: CurrentBuildConditionResult[] = [];
    const totalConditions = input.build && !input.issue ? input.conditions.length : 0;
    const reportProgress = () => emit({ type: "progress", requestId, evaluatedConditions: conditions.length,
      totalConditions, progress: totalConditions ? conditions.length / totalConditions : 0 });
    if (isCanceled()) return;
    reportProgress();
    if (input.build && !input.issue) {
      for (const condition of input.conditions) {
        if (isCanceled()) return;
        conditions.push(evaluateCurrentBuildCondition(input.build, condition));
        reportProgress();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }
    if (!isCanceled()) emit({ type: "complete", requestId, result: summarizeCurrentBuildEvaluation(input, conditions) });
  } catch (error) {
    if (!isCanceled()) emit({ type: "error", requestId: request.requestId, message: error instanceof Error ? error.message : String(error) });
  }
};

if (typeof self !== "undefined" && typeof window === "undefined") {
  self.addEventListener("message", (event: MessageEvent<CurrentBuildWorkerRequest>) => {
    void runCurrentBuildWorkerTask(event.data, (message) => self.postMessage(message));
  });
}
