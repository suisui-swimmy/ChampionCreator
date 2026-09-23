import { describe, expect, it, vi } from "vitest";
import { createAdjustmentExampleState } from "../ui/adjustmentExample";
import { buildCurrentBuildEvaluationInput } from "../ui/currentBuildEvaluationUi";
import { evaluateCurrentBuild } from "../search/currentBuildEvaluation";
import { runCurrentBuildWorkerTask, type CurrentBuildWorkerMessage, type CurrentBuildWorkerRequest } from "./currentBuildWorker";
import { CurrentBuildWorkerClient, type CurrentBuildWorkerLike } from "./currentBuildWorkerClient";

const makeInput = () => {
  const { target, scenarios } = createAdjustmentExampleState();
  return buildCurrentBuildEvaluationInput(target, scenarios);
};
class FakeWorker implements CurrentBuildWorkerLike {
  postMessage = vi.fn<(message: CurrentBuildWorkerRequest) => void>();
  terminate = vi.fn();
  message?: (event: MessageEvent<CurrentBuildWorkerMessage>) => void;
  error?: (event: ErrorEvent) => void;
  addEventListener(type: "message", listener: (event: MessageEvent<CurrentBuildWorkerMessage>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: "message" | "error", listener: ((event: MessageEvent<CurrentBuildWorkerMessage>) => void) | ((event: ErrorEvent) => void)) {
    if (type === "message") this.message = listener as typeof this.message;
    else this.error = listener as typeof this.error;
  }
  complete(result = evaluateCurrentBuild(makeInput()), requestId = this.postMessage.mock.calls[0][0].requestId) {
    this.message?.({ data: { type: "complete", requestId, result } } as MessageEvent<CurrentBuildWorkerMessage>);
  }
}
describe("current build Worker", () => {
  it("matches synchronous evaluation without modifying the request", async () => {
    const input = makeInput();
    const before = JSON.stringify(input);
    const messages: CurrentBuildWorkerMessage[] = [];
    await runCurrentBuildWorkerTask({ type: "start", requestId: "fixed", input }, (message) => messages.push(message));
    expect(messages.at(-1)).toEqual({ type: "complete", requestId: "fixed", result: evaluateCurrentBuild(input) });
    expect(messages.filter((message) => message.type === "progress")).toEqual([0, 1, 2, 3].map((evaluatedConditions) => ({
      type: "progress", requestId: "fixed", evaluatedConditions, totalConditions: 3, progress: evaluatedConditions / 3,
    })));
    expect(JSON.stringify(input)).toBe(before);
  });
  it("preserves explicit abilities on both sides and per-attack changes through structured Worker messages", async () => {
    const { target, scenarios } = createAdjustmentExampleState();
    for (const scenario of scenarios.filter((row) => row.adjustmentType !== "speed")) {
      scenario.attacks[0].gameType = "doubles";
      scenario.attacks[0].battleAbilities = { targetAlly: ["Battery"], opponentAlly: ["Friend Guard"] };
      scenario.attacks.push({ ...structuredClone(scenario.attacks[0]), id: `${scenario.id}-next`,
        battleAbilities: { targetAlly: ["Power Spot"], opponentAlly: ["Flower Gift"] }, weather: "sun" });
    }
    const input = buildCurrentBuildEvaluationInput(target, scenarios);
    const messages: CurrentBuildWorkerMessage[] = [];
    await runCurrentBuildWorkerTask({ type: "start", requestId: "abilities", input: structuredClone(input) }, (message) => messages.push(message));
    expect(messages.at(-1)).toEqual({ type: "complete", requestId: "abilities", result: evaluateCurrentBuild(input) });
    expect(evaluateCurrentBuild(input).conditions.some((row) => row.status === "incomplete" || row.status === "unsupported")).toBe(false);
  });
  it("does not publish completion after cancellation between conditions", async () => {
    let checks = 0;
    const emit = vi.fn();
    await runCurrentBuildWorkerTask({ type: "start", requestId: "cancel", input: makeInput() }, emit, () => ++checks > 2);
    expect(emit.mock.calls.map(([message]) => message.type)).toEqual(["progress", "progress"]);
    expect(emit.mock.calls.map(([message]) => message.evaluatedConditions)).toEqual([0, 1]);
  });
  it("terminates canceled workers and ignores late and stale messages", () => {
    const workers: FakeWorker[] = [];
    const client = new CurrentBuildWorkerClient(() => { const worker = new FakeWorker(); workers.push(worker); return worker; });
    const first = vi.fn();
    const second = vi.fn();
    const oldId = client.start(makeInput(), first);
    client.start(makeInput(), second);
    expect(workers[0].terminate).toHaveBeenCalledOnce();
    workers[0].complete();
    workers[1].complete(undefined, oldId);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    workers[1].complete();
    expect(second).toHaveBeenCalledOnce();
    expect(workers[1].terminate).toHaveBeenCalledOnce();
    workers[1].complete();
    expect(second).toHaveBeenCalledOnce();
  });
  it("handles worker startup errors, execution errors and explicit cancellation", () => {
    const worker = new FakeWorker();
    const client = new CurrentBuildWorkerClient(() => worker);
    const callback = vi.fn();
    client.start(makeInput(), callback);
    worker.error?.({} as ErrorEvent);
    expect(callback.mock.calls[0][0].type).toBe("error");
    expect(worker.terminate).toHaveBeenCalledOnce();
    callback.mockClear();
    client.start(makeInput(), callback);
    client.cancel();
    worker.complete();
    expect(callback).not.toHaveBeenCalled();
    const failed = new CurrentBuildWorkerClient(() => { throw new Error("unavailable"); });
    expect(() => failed.start(makeInput(), callback)).toThrow("unavailable");
  });
  it("keeps the worker alive for progress and ignores progress after cancel", () => {
    const worker = new FakeWorker();
    const client = new CurrentBuildWorkerClient(() => worker);
    const callback = vi.fn();
    const requestId = client.start(makeInput(), callback);
    const event = { data: { type: "progress", requestId, evaluatedConditions: 1, totalConditions: 3, progress: 1 / 3 } } as MessageEvent<CurrentBuildWorkerMessage>;
    worker.message?.(event);
    expect(callback).toHaveBeenCalledOnce();
    expect(worker.terminate).not.toHaveBeenCalled();
    client.cancel();
    worker.message?.(event);
    worker.complete();
    expect(callback).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
