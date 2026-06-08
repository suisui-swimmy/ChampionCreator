import type { Build, CandidateResult, Scenario, StatTable } from "../domain/model";
import {
  countDefenceEvCandidates,
  evaluateCandidate,
  finalizeDefenceSearchResults,
  iterateDefenceEvCandidates,
  meetsMinimumStatPointRequirements,
  type DefenceSearchOptions,
} from "../search/defenceSearch";

export interface DefenceSearchWorkerRunOptions {
  maxResults?: number;
  minimumStatPoints?: Partial<StatTable>;
  progressInterval?: number;
  partialResultInterval?: number;
  yieldEvery?: number;
}

export interface DefenceSearchWorkerStartRequest {
  type: "start";
  requestId: string;
  build: Build;
  scenarios: Scenario[];
  options?: DefenceSearchWorkerRunOptions;
}

export interface DefenceSearchWorkerCancelRequest {
  type: "cancel";
  requestId: string;
}

export type DefenceSearchWorkerRequest =
  | DefenceSearchWorkerStartRequest
  | DefenceSearchWorkerCancelRequest;

export interface DefenceSearchWorkerProgressMessage {
  type: "progress";
  requestId: string;
  searchedCandidates: number;
  totalCandidates: number;
  progress: number;
}

export interface DefenceSearchWorkerPartialResultMessage {
  type: "partialResult";
  requestId: string;
  candidates: CandidateResult[];
}

export interface DefenceSearchWorkerCompleteMessage {
  type: "complete";
  requestId: string;
  candidates: CandidateResult[];
}

export interface DefenceSearchWorkerErrorMessage {
  type: "error";
  requestId: string;
  message: string;
}

export type DefenceSearchWorkerMessage =
  | DefenceSearchWorkerProgressMessage
  | DefenceSearchWorkerPartialResultMessage
  | DefenceSearchWorkerCompleteMessage
  | DefenceSearchWorkerErrorMessage;

export type DefenceSearchWorkerEmit = (message: DefenceSearchWorkerMessage) => void;
export type DefenceSearchWorkerCancelCheck = (requestId: string) => boolean;

const DEFAULT_PROGRESS_INTERVAL = 250;
const DEFAULT_PARTIAL_RESULT_INTERVAL = 1;
const DEFAULT_YIELD_EVERY = 250;
const DEFAULT_MAX_RESULTS = 20;

const yieldToWorker = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
};

export const runDefenceSearchWorkerTask = async (
  request: DefenceSearchWorkerStartRequest,
  emit: DefenceSearchWorkerEmit,
  isCanceled: DefenceSearchWorkerCancelCheck = () => false,
): Promise<void> => {
  const { requestId, build, scenarios } = request;
  const options = request.options ?? {};
  const maxResults = Math.max(0, Math.trunc(options.maxResults ?? DEFAULT_MAX_RESULTS));
  const progressInterval = Math.max(1, Math.trunc(options.progressInterval ?? DEFAULT_PROGRESS_INTERVAL));
  const partialResultInterval = Math.max(1, Math.trunc(options.partialResultInterval ?? DEFAULT_PARTIAL_RESULT_INTERVAL));
  const yieldEvery = Math.max(1, Math.trunc(options.yieldEvery ?? DEFAULT_YIELD_EVERY));
  const searchOptions: DefenceSearchOptions = {
    maxResults,
    minimumStatPoints: options.minimumStatPoints,
  };

  try {
    const totalCandidates = countDefenceEvCandidates(build);
    if (maxResults <= 0) {
      emit({
        type: "complete",
        requestId,
        candidates: [],
      });
      return;
    }

    const passingResults: CandidateResult[] = [];
    let searchedCandidates = 0;
    let partialResultCount = 0;
    let acceptedDefenceBudgetCeiling: number | null = null;

    for (const candidate of iterateDefenceEvCandidates(build)) {
      if (isCanceled(requestId)) {
        return;
      }

      const defenceBudget = candidate.hp + candidate.def + candidate.spd;
      if (acceptedDefenceBudgetCeiling !== null && defenceBudget > acceptedDefenceBudgetCeiling) {
        break;
      }

      searchedCandidates += 1;

      if (!meetsMinimumStatPointRequirements(candidate, options.minimumStatPoints)) {
        if (
          searchedCandidates === 1
          || searchedCandidates % progressInterval === 0
          || searchedCandidates === totalCandidates
        ) {
          if (isCanceled(requestId)) {
            return;
          }

          emit({
            type: "progress",
            requestId,
            searchedCandidates,
            totalCandidates,
            progress: totalCandidates === 0 ? 1 : searchedCandidates / totalCandidates,
          });
        }

        if (searchedCandidates % yieldEvery === 0) {
          await yieldToWorker();
        }
        continue;
      }

      const result = evaluateCandidate(build, scenarios, candidate, searchOptions);

      if (result.passed) {
        passingResults.push(result);
        partialResultCount += 1;
        if (passingResults.length >= maxResults && acceptedDefenceBudgetCeiling === null) {
          acceptedDefenceBudgetCeiling = defenceBudget;
        }

        if (partialResultCount % partialResultInterval === 0 && !isCanceled(requestId)) {
          emit({
            type: "partialResult",
            requestId,
            candidates: finalizeDefenceSearchResults(build, scenarios, passingResults, searchOptions),
          });
        }
      }

      if (searchedCandidates === 1 || searchedCandidates % progressInterval === 0 || searchedCandidates === totalCandidates) {
        if (isCanceled(requestId)) {
          return;
        }

        emit({
          type: "progress",
          requestId,
          searchedCandidates,
          totalCandidates,
          progress: totalCandidates === 0 ? 1 : searchedCandidates / totalCandidates,
        });
      }

      if (searchedCandidates % yieldEvery === 0) {
        await yieldToWorker();
      }
    }

    if (isCanceled(requestId)) {
      return;
    }

    emit({
      type: "complete",
      requestId,
      candidates: finalizeDefenceSearchResults(build, scenarios, passingResults, searchOptions),
    });
  } catch (error) {
    if (!isCanceled(requestId)) {
      emit({
        type: "error",
        requestId,
        message: toErrorMessage(error),
      });
    }
  }
};

const canceledRequestIds = new Set<string>();

const bindWorker = (): void => {
  const scope = self as unknown as {
    postMessage: (message: DefenceSearchWorkerMessage) => void;
    addEventListener: (
      type: "message",
      listener: (event: MessageEvent<DefenceSearchWorkerRequest>) => void,
    ) => void;
  };

  scope.addEventListener("message", (event) => {
    const message = event.data;

    if (message.type === "cancel") {
      canceledRequestIds.add(message.requestId);
      return;
    }

    canceledRequestIds.delete(message.requestId);
    void runDefenceSearchWorkerTask(
      message,
      (workerMessage) => scope.postMessage(workerMessage),
      (requestId) => canceledRequestIds.has(requestId),
    );
  });
};

if (typeof self !== "undefined" && typeof window === "undefined") {
  bindWorker();
}
