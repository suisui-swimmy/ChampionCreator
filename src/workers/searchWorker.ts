import type { AdjustmentProject, Result } from "../domain/model";

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
};

export type SearchWorkerOutboundMessage =
  | SearchWorkerProgressMessage
  | SearchWorkerPartialResultMessage
  | SearchWorkerCompleteMessage
  | SearchWorkerErrorMessage;
