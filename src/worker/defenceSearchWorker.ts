import { searchOffenseAllocation, offenseSequenceResult, type OffenseAllocation, type OffenseSequenceCondition } from "../search/offenseSequence";
import type { OffenseScenarioResult } from "../ui/defenceSearchUi";
import type { Build, CandidateResult, DefenceSearchStatKey, Scenario, StatTable } from "../domain/model";
import type { SpeedScenarioCondition } from "../domain/speed";
import {
  compareFailureCandidateResults,
  countDefenceEvCandidates,
  evaluateCandidate,
  finalizeDefenceSearchResults,
  iterateDefenceEvCandidates,
  meetsMinimumStatPointRequirements,
  type DefenceSearchOptions,
} from "../search/defenceSearch";
import {
  countMaximizeRemainingBulkCandidates,
  maximizeRemainingBulk,
  type MaximizeRemainingBulkInput,
  type MaximizeRemainingBulkResult,
} from "../search/maximizeRemainingBulk";

export interface DefenceSearchWorkerRunOptions {
  maxResults?: number | null;
  partialResultLimit?: number;
  minimumStatPoints?: Partial<StatTable>;
  searchStatKeys?: DefenceSearchStatKey[];
  speedConditions?: SpeedScenarioCondition[];
  offenseConditions?: OffenseSequenceCondition[];
  prepareOffenseAllocation?: boolean;
  standalone?: boolean;
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

export interface MaximizeRemainingBulkWorkerRunOptions {
  maxResults?: number;
}

export interface MaximizeRemainingBulkWorkerStartRequest {
  type: "maximizeRemainingBulk";
  requestId: string;
  input: MaximizeRemainingBulkInput;
  options?: MaximizeRemainingBulkWorkerRunOptions;
}

export type DefenceSearchWorkerRequest =
  | DefenceSearchWorkerStartRequest
  | MaximizeRemainingBulkWorkerStartRequest
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
  passingCandidateCount: number;
}

export interface DefenceSearchWorkerCompleteMessage {
  type: "complete";
  requestId: string;
  candidates: CandidateResult[];
  passingCandidateCount: number;
  strictestFailureLabel?: string | null;
  offenseResults?: OffenseScenarioResult[];
}

export interface DefenceSearchWorkerErrorMessage {
  type: "error";
  requestId: string;
  message: string;
}

export interface MaximizeRemainingBulkWorkerProgressMessage {
  type: "bulkProgress";
  requestId: string;
  searchedCandidates: number;
  totalCandidates: number;
  progress: number;
}

export interface MaximizeRemainingBulkWorkerCompleteMessage {
  type: "bulkComplete";
  requestId: string;
  result: MaximizeRemainingBulkResult | null;
  results: MaximizeRemainingBulkResult[];
  searchedCandidates: number;
  totalCandidates: number;
}

export interface MaximizeRemainingBulkWorkerErrorMessage {
  type: "bulkError";
  requestId: string;
  message: string;
}

export type DefenceSearchWorkerMessage =
  | DefenceSearchWorkerProgressMessage
  | DefenceSearchWorkerPartialResultMessage
  | DefenceSearchWorkerCompleteMessage
  | DefenceSearchWorkerErrorMessage
  | MaximizeRemainingBulkWorkerProgressMessage
  | MaximizeRemainingBulkWorkerCompleteMessage
  | MaximizeRemainingBulkWorkerErrorMessage;

export type DefenceSearchWorkerEmit = (message: DefenceSearchWorkerMessage) => void;
export type DefenceSearchWorkerCancelCheck = (requestId: string) => boolean;

const DEFAULT_PROGRESS_INTERVAL = 250;
const DEFAULT_PARTIAL_RESULT_INTERVAL = 1;
const DEFAULT_YIELD_EVERY = 250;
const DEFAULT_MAX_RESULTS = 20;
const DEFAULT_PARTIAL_RESULT_LIMIT = 20;

const yieldToWorker = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const toErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
};

const prepareAllocation = async (
  build: Build, conditions: OffenseSequenceCondition[], speeds: SpeedScenarioCondition[], requestId: string,
  emit: DefenceSearchWorkerEmit, isCanceled: DefenceSearchWorkerCancelCheck,
): Promise<OffenseAllocation | null> => {
  const iterator = searchOffenseAllocation(build, conditions, speeds);
  let next = iterator.next();
  let evaluated = 0;
  while (!next.done) {
    if (isCanceled(requestId)) return null;
    evaluated = next.value;
    if (next.value === 1 || next.value % 32 === 0) {
      emit({ type: "progress", requestId, searchedCandidates: next.value, totalCandidates: 0, progress: 0 });
      await yieldToWorker();
      if (isCanceled(requestId)) return null;
    }
    next = iterator.next();
  }
  if (!isCanceled(requestId)) emit({ type: "progress", requestId, searchedCandidates: evaluated, totalCandidates: evaluated, progress: 0 });
  return next.value;
};

export const runDefenceSearchWorkerTask = async (
  request: DefenceSearchWorkerStartRequest,
  emit: DefenceSearchWorkerEmit,
  isCanceled: DefenceSearchWorkerCancelCheck = () => false,
): Promise<void> => {
  const { requestId, scenarios } = request;
  let build = request.build;
  const options = request.options ?? {};
  const maxResults = options.maxResults === undefined
    ? DEFAULT_MAX_RESULTS
    : options.maxResults === null
      ? null
      : Math.max(0, Math.trunc(options.maxResults));
  const partialResultLimit = Math.max(0, Math.trunc(options.partialResultLimit ?? DEFAULT_PARTIAL_RESULT_LIMIT));
  const progressInterval = Math.max(1, Math.trunc(options.progressInterval ?? DEFAULT_PROGRESS_INTERVAL));
  const partialResultInterval = Math.max(1, Math.trunc(options.partialResultInterval ?? DEFAULT_PARTIAL_RESULT_INTERVAL));
  const yieldEvery = Math.max(1, Math.trunc(options.yieldEvery ?? DEFAULT_YIELD_EVERY));
  const searchOptions: DefenceSearchOptions = {
    maxResults,
    minimumStatPoints: options.minimumStatPoints,
    searchStatKeys: options.searchStatKeys,
    speedConditions: options.speedConditions,
    offenseConditions: options.offenseConditions,
  };

  try {
    let offenseResults: OffenseScenarioResult[] | undefined;
    if (options.prepareOffenseAllocation) {
      const allocation = await prepareAllocation(build, options.offenseConditions ?? [], options.speedConditions ?? [], requestId, emit, isCanceled);
      if (isCanceled(requestId)) return;
      if (!allocation) throw new Error("火力・素早さ条件を同時に満たす合法な配分がありません");
      build = allocation.build;
      searchOptions.minimumStatPoints = allocation.minimumStatPoints;
      searchOptions.searchStatKeys = [...new Set([...(options.searchStatKeys ?? []),
        ...(["hp", "def", "spd"] as const).filter((key) => (allocation.minimumStatPoints[key] ?? 0) > 0)])];
      offenseResults = allocation.evaluations.map((evaluation, index) => ({
        id: evaluation.scenarioId, scenarioId: evaluation.scenarioId, scenarioLabel: evaluation.scenarioLabel,
        attackId: options.offenseConditions![index].attacks[0].id, attackLabel: "連続攻撃",
        result: offenseSequenceResult(evaluation, build),
      }));
      if (options.standalone) {
        emit({ type: "complete", requestId, candidates: [], passingCandidateCount: 0, offenseResults });
        return;
      }
    }
    const totalCandidates = countDefenceEvCandidates(build, searchOptions);
    if (maxResults !== null && maxResults <= 0) {
      emit({
        type: "complete",
        requestId,
        candidates: [],
        passingCandidateCount: 0,
        strictestFailureLabel: null,
      });
      return;
    }

    const passingResults: CandidateResult[] = [];
    let closestFailedResult: CandidateResult | null = null;
    let searchedCandidates = 0;
    let partialResultCount = 0;
    let acceptedDefenceBudgetCeiling: number | null = null;

    for (const candidate of iterateDefenceEvCandidates(build, searchOptions)) {
      if (isCanceled(requestId)) {
        return;
      }

      const defenceBudget = candidate.hp + candidate.def + candidate.spd;
      if (acceptedDefenceBudgetCeiling !== null && defenceBudget > acceptedDefenceBudgetCeiling) {
        break;
      }

      searchedCandidates += 1;

      if (!meetsMinimumStatPointRequirements(candidate, searchOptions.minimumStatPoints)) {
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
        if (
          maxResults !== null
          && passingResults.length >= maxResults
          && acceptedDefenceBudgetCeiling === null
        ) {
          acceptedDefenceBudgetCeiling = defenceBudget;
        }

        if (partialResultCount % partialResultInterval === 0 && !isCanceled(requestId)) {
          emit({
            type: "partialResult",
            requestId,
            candidates: finalizeDefenceSearchResults(build, scenarios, passingResults, {
              ...searchOptions,
              maxResults: partialResultLimit,
            }),
            passingCandidateCount: passingResults.length,
          });
        }
      } else if (
        closestFailedResult === null
        || compareFailureCandidateResults(result, closestFailedResult) < 0
      ) {
        closestFailedResult = result;
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

    const finalCandidates = finalizeDefenceSearchResults(build, scenarios, passingResults, searchOptions);
    emit({
      type: "complete",
      requestId,
      candidates: finalCandidates,
      passingCandidateCount: finalCandidates.length,
      offenseResults,
      strictestFailureLabel: finalCandidates.length === 0 ? closestFailedResult?.bottleneckLabel ?? null : null,
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

export const runMaximizeRemainingBulkWorkerTask = async (
  request: MaximizeRemainingBulkWorkerStartRequest,
  emit: DefenceSearchWorkerEmit,
  isCanceled: DefenceSearchWorkerCancelCheck = () => false,
): Promise<void> => {
  const { requestId } = request;
  let input = request.input;
  const maxResults = Math.max(1, Math.trunc(request.options?.maxResults ?? 1));

  try {
    if (input.prepareOffenseAllocation) {
      const allocation = await prepareAllocation(input.build, input.offenseConditions ?? [], input.speedConditions ?? [], requestId,
        (message) => emit(message.type === "progress" ? { ...message, type: "bulkProgress" } : message), isCanceled);
      if (isCanceled(requestId)) return;
      if (!allocation) throw new Error("火力・素早さ条件を同時に満たす合法な配分がありません");
      input = { ...input, minimumStatPoints: allocation.minimumStatPoints,
        currentBuild: input.build, build: allocation.build };
    }
    const totalCandidates = countMaximizeRemainingBulkCandidates(input);
    emit({
      type: "bulkProgress",
      requestId,
      searchedCandidates: 0,
      totalCandidates,
      progress: totalCandidates === 0 ? 1 : 0,
    });

    if (isCanceled(requestId)) {
      return;
    }

    const results = maximizeRemainingBulk(input, { maxResults });
    if (isCanceled(requestId)) {
      return;
    }

    emit({
      type: "bulkProgress",
      requestId,
      searchedCandidates: totalCandidates,
      totalCandidates,
      progress: 1,
    });
    emit({
      type: "bulkComplete",
      requestId,
      result: results[0] ?? null,
      results,
      searchedCandidates: totalCandidates,
      totalCandidates,
    });
  } catch (error) {
    if (!isCanceled(requestId)) {
      emit({
        type: "bulkError",
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
    if (message.type === "maximizeRemainingBulk") {
      void runMaximizeRemainingBulkWorkerTask(
        message,
        (workerMessage) => scope.postMessage(workerMessage),
        (requestId) => canceledRequestIds.has(requestId),
      );
      return;
    }

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
