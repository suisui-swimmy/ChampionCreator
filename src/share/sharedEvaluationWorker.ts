import { evaluateSharedAdjustment, sharedCalculationError } from "./evaluateSharedAdjustment";
import type { ShareStateDocument } from "../ui/shareState";

self.onmessage = (event: MessageEvent<{ requestId: string; document: ShareStateDocument }>) => {
  try {
    self.postMessage({ type: "complete", requestId: event.data.requestId, evaluation: evaluateSharedAdjustment(event.data.document) });
  } catch (error) {
    self.postMessage({ type: "error", requestId: event.data.requestId, message: sharedCalculationError(error) });
  }
};
