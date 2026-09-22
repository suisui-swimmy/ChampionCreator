import type { CurrentBuildEvaluationInput } from "../search/currentBuildEvaluation";
import type { CurrentBuildWorkerMessage, CurrentBuildWorkerRequest } from "./currentBuildWorker";

export interface CurrentBuildWorkerLike {
  postMessage(message: CurrentBuildWorkerRequest): void;
  addEventListener(type: "message", listener: (event: MessageEvent<CurrentBuildWorkerMessage>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

/** A fresh worker per check lets cancel interrupt even one expensive HP sequence. */
export class CurrentBuildWorkerClient {
  private worker: CurrentBuildWorkerLike | null = null;
  private requestId: string | null = null;
  constructor(private readonly createWorker: () => CurrentBuildWorkerLike = () =>
    new Worker(new URL("./currentBuildWorker.ts", import.meta.url), { type: "module" })) {}

  start(input: CurrentBuildEvaluationInput, onMessage: (message: CurrentBuildWorkerMessage) => void): string {
    this.cancel();
    const requestId = `current-build-${crypto.randomUUID()}`;
    this.requestId = requestId;
    try {
      const worker = this.createWorker();
      this.worker = worker;
      worker.addEventListener("message", (event) => {
        if (this.requestId !== requestId || event.data.requestId !== requestId) return;
        if (event.data.type !== "progress") this.cancel();
        onMessage(event.data);
      });
      worker.addEventListener("error", () => {
        if (this.requestId !== requestId) return;
        this.cancel();
        onMessage({ type: "error", requestId, message: "確認処理でエラーが発生しました。もう一度確認してください。" });
      });
      worker.postMessage({ type: "start", requestId, input });
    } catch (error) {
      this.cancel();
      throw error;
    }
    return requestId;
  }
  cancel(): void {
    this.requestId = null;
    this.worker?.terminate();
    this.worker = null;
  }
}
