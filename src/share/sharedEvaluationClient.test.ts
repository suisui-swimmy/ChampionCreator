import { afterEach, describe, expect, it, vi } from "vitest";
import { startSharedEvaluation, type SharedEvaluationWorkerLike } from "./sharedEvaluationClient";
import { createProbeDocument, PROBE_CASES } from "./probe/fixtures";

afterEach(() => vi.useRealTimers());
const makeWorker = (): SharedEvaluationWorkerLike => ({ postMessage: vi.fn(), terminate: vi.fn(), onmessage: null, onerror: null });
describe("share worker lifetime", () => {
  it("drops stale IDs and messages after unmount/cancel", () => {
    const worker = makeWorker();
    const complete = vi.fn(); const error = vi.fn();
    const stop = startSharedEvaluation(createProbeDocument(PROBE_CASES[0]), complete, error, () => worker);
    const request = vi.mocked(worker.postMessage).mock.calls[0][0];
    worker.onmessage?.({ data: { type: "complete", requestId: "old", evaluation: {} } } as MessageEvent);
    expect(complete).not.toHaveBeenCalled();
    stop();
    worker.onmessage?.({ data: { type: "complete", requestId: request.requestId, evaluation: {} } } as MessageEvent);
    expect(complete).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it("terminates after completion and reports a bounded timeout", () => {
    vi.useFakeTimers();
    const worker = makeWorker(); const complete = vi.fn(); const error = vi.fn();
    startSharedEvaluation(createProbeDocument(PROBE_CASES[0]), complete, error, () => worker);
    const request = vi.mocked(worker.postMessage).mock.calls[0][0];
    worker.onmessage?.({ data: { type: "complete", requestId: request.requestId, evaluation: { stats: null, conditions: [] } } } as MessageEvent);
    expect(complete).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(15_000);
    expect(error).not.toHaveBeenCalled();
    const second = makeWorker();
    startSharedEvaluation(createProbeDocument(PROBE_CASES[0]), complete, error, () => second);
    vi.advanceTimersByTime(15_000);
    expect(error).toHaveBeenCalledOnce();
    expect(second.terminate).toHaveBeenCalledOnce();
  });
});
