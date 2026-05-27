import type { Build, Scenario } from "../domain/model";
import type {
  DefenceSearchWorkerCancelRequest,
  DefenceSearchWorkerMessage,
  DefenceSearchWorkerProgressMessage,
  DefenceSearchWorkerPartialResultMessage,
  DefenceSearchWorkerCompleteMessage,
  DefenceSearchWorkerErrorMessage,
  DefenceSearchWorkerRunOptions,
  DefenceSearchWorkerStartRequest,
} from "./defenceSearchWorker";

export interface DefenceSearchWorkerLike {
  postMessage: (message: DefenceSearchWorkerStartRequest | DefenceSearchWorkerCancelRequest) => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<DefenceSearchWorkerMessage>) => void,
  ) => void;
  removeEventListener: (
    type: "message",
    listener: (event: MessageEvent<DefenceSearchWorkerMessage>) => void,
  ) => void;
  terminate?: () => void;
}

export interface DefenceSearchWorkerClientCallbacks {
  onProgress?: (message: DefenceSearchWorkerProgressMessage) => void;
  onPartialResult?: (message: DefenceSearchWorkerPartialResultMessage) => void;
  onComplete?: (message: DefenceSearchWorkerCompleteMessage) => void;
  onError?: (message: DefenceSearchWorkerErrorMessage) => void;
}

export interface StartDefenceSearchWorkerOptions extends DefenceSearchWorkerRunOptions {
  requestId?: string;
  callbacks?: DefenceSearchWorkerClientCallbacks;
}

export interface ActiveDefenceSearchRequest {
  requestId: string;
  cancel: () => void;
}

export const createDefenceSearchRequestId = (): string => {
  const randomSuffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `defence-search-${randomSuffix}`;
};

export const isCurrentWorkerMessage = (
  message: DefenceSearchWorkerMessage,
  activeRequestId: string | null | undefined,
): boolean => Boolean(activeRequestId && message.requestId === activeRequestId);

export const createDefaultDefenceSearchWorker = (): Worker =>
  new Worker(new URL("./defenceSearchWorker.ts", import.meta.url), { type: "module" });

export class DefenceSearchWorkerClient {
  private activeRequestId: string | null = null;
  private callbacks: DefenceSearchWorkerClientCallbacks = {};

  private readonly handleMessage = (event: MessageEvent<DefenceSearchWorkerMessage>): void => {
    const message = event.data;
    if (!isCurrentWorkerMessage(message, this.activeRequestId)) {
      return;
    }

    if (message.type === "progress") {
      this.callbacks.onProgress?.(message);
      return;
    }

    if (message.type === "partialResult") {
      this.callbacks.onPartialResult?.(message);
      return;
    }

    if (message.type === "complete") {
      this.activeRequestId = null;
      this.callbacks.onComplete?.(message);
      return;
    }

    this.activeRequestId = null;
    this.callbacks.onError?.(message);
  };

  constructor(private readonly worker: DefenceSearchWorkerLike = createDefaultDefenceSearchWorker()) {
    this.worker.addEventListener("message", this.handleMessage);
  }

  start(
    build: Build,
    scenarios: Scenario[],
    options: StartDefenceSearchWorkerOptions = {},
  ): ActiveDefenceSearchRequest {
    const { callbacks = {}, requestId = createDefenceSearchRequestId(), ...runOptions } = options;
    this.activeRequestId = requestId;
    this.callbacks = callbacks;
    this.worker.postMessage({
      type: "start",
      requestId,
      build,
      scenarios,
      options: runOptions,
    });

    return {
      requestId,
      cancel: () => this.cancel(requestId),
    };
  }

  cancel(requestId = this.activeRequestId): void {
    if (!requestId) {
      return;
    }

    if (this.activeRequestId === requestId) {
      this.activeRequestId = null;
    }

    this.worker.postMessage({ type: "cancel", requestId });
  }

  dispose(): void {
    this.worker.removeEventListener("message", this.handleMessage);
    this.worker.terminate?.();
  }
}
