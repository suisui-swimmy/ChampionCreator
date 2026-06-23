import type { Build, Scenario } from "../domain/model";
import type { MaximizeRemainingBulkInput } from "../search/maximizeRemainingBulk";
import type {
  DefenceSearchWorkerCancelRequest,
  DefenceSearchWorkerMessage,
  DefenceSearchWorkerProgressMessage,
  DefenceSearchWorkerPartialResultMessage,
  DefenceSearchWorkerCompleteMessage,
  DefenceSearchWorkerErrorMessage,
  DefenceSearchWorkerRunOptions,
  DefenceSearchWorkerStartRequest,
  MaximizeRemainingBulkWorkerCompleteMessage,
  MaximizeRemainingBulkWorkerErrorMessage,
  MaximizeRemainingBulkWorkerProgressMessage,
  MaximizeRemainingBulkWorkerRunOptions,
  MaximizeRemainingBulkWorkerStartRequest,
} from "./defenceSearchWorker";

export interface DefenceSearchWorkerLike {
  postMessage: (message: DefenceSearchWorkerStartRequest | MaximizeRemainingBulkWorkerStartRequest | DefenceSearchWorkerCancelRequest) => void;
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
  onBulkProgress?: (message: MaximizeRemainingBulkWorkerProgressMessage) => void;
  onBulkComplete?: (message: MaximizeRemainingBulkWorkerCompleteMessage) => void;
  onBulkError?: (message: MaximizeRemainingBulkWorkerErrorMessage) => void;
}

export interface StartDefenceSearchWorkerOptions extends DefenceSearchWorkerRunOptions {
  requestId?: string;
  callbacks?: DefenceSearchWorkerClientCallbacks;
}

export interface StartMaximizeRemainingBulkWorkerOptions extends MaximizeRemainingBulkWorkerRunOptions {
  requestId?: string;
  callbacks?: Pick<
    DefenceSearchWorkerClientCallbacks,
    "onBulkProgress" | "onBulkComplete" | "onBulkError"
  >;
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

export const createBulkMaximizeRequestId = (): string => {
  const randomSuffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `bulk-maximize-${randomSuffix}`;
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

    if (message.type === "error") {
      this.activeRequestId = null;
      this.callbacks.onError?.(message);
      return;
    }

    if (message.type === "bulkProgress") {
      this.callbacks.onBulkProgress?.(message);
      return;
    }

    if (message.type === "bulkComplete") {
      this.activeRequestId = null;
      this.callbacks.onBulkComplete?.(message);
      return;
    }

    this.activeRequestId = null;
    this.callbacks.onBulkError?.(message);
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

  maximizeRemainingBulk(
    input: MaximizeRemainingBulkInput,
    options: StartMaximizeRemainingBulkWorkerOptions = {},
  ): ActiveDefenceSearchRequest {
    const { callbacks = {}, requestId = createBulkMaximizeRequestId(), ...runOptions } = options;
    this.activeRequestId = requestId;
    this.callbacks = callbacks;
    this.worker.postMessage({
      type: "maximizeRemainingBulk",
      requestId,
      input,
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
