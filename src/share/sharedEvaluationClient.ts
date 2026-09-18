import type { SharedEvaluation } from "./evaluateSharedAdjustment";
import type { ShareStateDocument } from "../ui/shareState";

export type SharedEvaluationWorkerLike = Pick<Worker, "postMessage" | "terminate"> & {
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

export const startSharedEvaluation = (
  document: ShareStateDocument,
  onComplete: (evaluation: SharedEvaluation) => void,
  onError: (message: string) => void,
  createWorker: () => SharedEvaluationWorkerLike = () => new Worker(new URL("./sharedEvaluationWorker.ts", import.meta.url), { type: "module" }),
): (() => void) => {
  const requestId = crypto.randomUUID();
  const worker = createWorker();
  let finished = false;
  const stop = () => { if (finished) return; finished = true; clearTimeout(timeout); worker.terminate(); };
  const timeout = setTimeout(() => { if (!finished) { stop(); onError("再評価に時間がかかっています。「この調整を使う」から条件を確認できます。"); } }, 15_000);
  worker.onmessage = (event) => {
    if (finished || event.data.requestId !== requestId) return;
    stop();
    if (event.data.type === "complete") onComplete(event.data.evaluation);
    else onError(event.data.message ?? "再評価できませんでした");
  };
  worker.onerror = () => { if (!finished) { stop(); onError("計算処理を開始できませんでした。ページを開き直してください。"); } };
  try { worker.postMessage({ requestId, document }); }
  catch (error) { stop(); throw error; }
  return stop;
};
