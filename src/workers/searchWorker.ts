import type { AdjustmentProject, Constraint, DefenceConstraint, Result } from "../domain/model";
import {
  SearchDefenceCancelledError,
  searchDefenceAsync,
  type SearchDefenceProgress,
} from "../search/searchDefence";

export type SearchWorkerStartMessage = {
  type: "start";
  requestId: string;
  project: AdjustmentProject;
};

export type SearchWorkerCancelMessage = {
  type: "cancel";
  requestId: string;
};

export type SearchWorkerInboundMessage =
  | SearchWorkerStartMessage
  | SearchWorkerCancelMessage;

export type SearchWorkerProgressMessage = {
  type: "progress";
  requestId: string;
  evaluatedCandidates: number;
  acceptedCandidates: number;
  phase: SearchDefenceProgress["phase"];
};

export type SearchWorkerPartialResultMessage = {
  type: "partialResult";
  requestId: string;
  results: Result[];
};

export type SearchWorkerCompleteMessage = {
  type: "complete";
  requestId: string;
  results: Result[];
};

export type SearchWorkerErrorMessage = {
  type: "error";
  requestId: string;
  message: string;
  cancelled?: boolean;
};

export type SearchWorkerOutboundMessage =
  | SearchWorkerProgressMessage
  | SearchWorkerPartialResultMessage
  | SearchWorkerCompleteMessage
  | SearchWorkerErrorMessage;

type WorkerLike = {
  postMessage: (message: SearchWorkerOutboundMessage) => void;
  addEventListener: (
    type: "message",
    listener: (event: MessageEvent<SearchWorkerInboundMessage>) => void,
  ) => void;
};

const workerSelf = self as unknown as WorkerLike;
const activeRequests = new Map<string, { cancelled: boolean }>();

const isDefenceConstraint = (constraint: Constraint): constraint is DefenceConstraint =>
  constraint.type === "survive";

const postProgress = (requestId: string, progress: SearchDefenceProgress): void => {
  workerSelf.postMessage({
    type: "progress",
    requestId,
    phase: progress.phase,
    evaluatedCandidates: progress.evaluatedCandidates,
    acceptedCandidates: progress.acceptedCandidates,
  });
};

const runSearch = async (message: SearchWorkerStartMessage): Promise<void> => {
  const requestState = { cancelled: false };
  activeRequests.set(message.requestId, requestState);

  try {
    const results = await searchDefenceAsync({
      target: message.project.target,
      scenarios: message.project.scenarios,
      constraints: message.project.constraints.filter(isDefenceConstraint),
      budget: message.project.searchBudget,
      maxResults: 8,
      isCancelled: () => requestState.cancelled,
      onProgress: (progress) => postProgress(message.requestId, progress),
      onPartialResult: (results) => {
        workerSelf.postMessage({
          type: "partialResult",
          requestId: message.requestId,
          results,
        });
      },
    });

    workerSelf.postMessage({
      type: "complete",
      requestId: message.requestId,
      results,
    });
  } catch (error) {
    workerSelf.postMessage({
      type: "error",
      requestId: message.requestId,
      message: error instanceof Error ? error.message : "Defence search failed",
      cancelled: error instanceof SearchDefenceCancelledError,
    });
  } finally {
    activeRequests.delete(message.requestId);
  }
};

workerSelf.addEventListener("message", (event) => {
  const message = event.data;

  if (message.type === "cancel") {
    const request = activeRequests.get(message.requestId);
    if (request) {
      request.cancelled = true;
    }
    return;
  }

  void runSearch(message);
});
