import { describe, expect, it } from "vitest";
import type { EntityKind } from "../data/localizationTypes";
import type { Build, EntityRef, FieldState, Scenario, ScenarioHit, SideState, StatTable } from "../domain/model";
import { toEntityRef } from "../domain/model";
import { resolveEntity } from "../localization/resolver";
import { searchDefenceCandidates } from "../search/defenceSearch";
import {
  DefenceSearchWorkerClient,
  isCurrentWorkerMessage,
  type DefenceSearchWorkerLike,
} from "./defenceSearchWorkerClient";
import {
  runDefenceSearchWorkerTask,
  type DefenceSearchWorkerMessage,
  type DefenceSearchWorkerRequest,
} from "./defenceSearchWorker";

const mustResolve = <K extends EntityKind>(kind: K, input: string): EntityRef<K> => {
  const ref = toEntityRef(resolveEntity(kind, input), kind);
  if (!ref) {
    throw new Error(`Expected ${kind}:${input} to resolve`);
  }
  return ref;
};

const defaultIvs: StatTable = {
  hp: 31,
  atk: 31,
  def: 31,
  spa: 31,
  spd: 31,
  spe: 31,
};

const zeroEvs: StatTable = {
  hp: 0,
  atk: 0,
  def: 0,
  spa: 0,
  spd: 0,
  spe: 0,
};

const emptySide: SideState = {
  reflect: false,
  lightScreen: false,
  auroraVeil: false,
  helpingHand: false,
};

const emptyField: FieldState = {
  gameType: "singles",
  weather: "none",
  terrain: "none",
};

const makeBuild = (
  id: string,
  pokemonInput: string,
  evs: StatTable = zeroEvs,
  level = 50,
  natureInput?: string,
): Build => ({
  id,
  pokemon: mustResolve("pokemon", pokemonInput),
  level,
  nature: natureInput ? mustResolve("nature", natureInput) : undefined,
  ivs: defaultIvs,
  evs,
});

const makeHit = (
  id: string,
  attacker: Build,
  moveInput: string,
  repeat = 1,
): ScenarioHit => ({
  id,
  attacker,
  move: mustResolve("move", moveInput),
  repeat,
  critical: false,
  attackerBoosts: {},
  defenderBoosts: {},
  attackerSide: emptySide,
  defenderSide: emptySide,
});

const makeScenario = (
  id: string,
  hits: ScenarioHit[],
  requiredSurvivedHits: number,
  minSurvivalProbability: number,
): Scenario => ({
  id,
  label: id,
  enabled: true,
  hits,
  field: emptyField,
  constraint: {
    enabled: true,
    requiredSurvivedHits,
    minSurvivalProbability,
  },
});

class FakeWorker implements DefenceSearchWorkerLike {
  sentMessages: DefenceSearchWorkerRequest[] = [];
  private listener: ((event: MessageEvent<DefenceSearchWorkerMessage>) => void) | null = null;

  postMessage(message: DefenceSearchWorkerRequest): void {
    this.sentMessages.push(message);
  }

  addEventListener(
    _type: "message",
    listener: (event: MessageEvent<DefenceSearchWorkerMessage>) => void,
  ): void {
    this.listener = listener;
  }

  removeEventListener(): void {
    this.listener = null;
  }

  emit(message: DefenceSearchWorkerMessage): void {
    this.listener?.({ data: message } as MessageEvent<DefenceSearchWorkerMessage>);
  }
}

describe("runDefenceSearchWorkerTask", () => {
  it("emits progress, partialResult, and complete messages with M4 search-compatible candidates", async () => {
    const defender = makeBuild("target", "カイリュー", { ...zeroEvs, atk: 252, spa: 252 });
    const attacker = makeBuild("attacker", "ピカチュウ", { ...zeroEvs, spa: 252 }, 1, "ひかえめ");
    const scenarios = [
      makeScenario("special", [makeHit("thunderbolt", attacker, "10まんボルト")], 1, 1),
    ];
    const messages: DefenceSearchWorkerMessage[] = [];

    await runDefenceSearchWorkerTask(
      {
        type: "start",
        requestId: "request-a",
        build: defender,
        scenarios,
        options: { maxResults: 1, progressInterval: 1, partialResultInterval: 1, yieldEvery: 1 },
      },
      (message) => messages.push(message),
    );

    const complete = messages.find((message) => message.type === "complete");
    const partial = messages.find((message) => message.type === "partialResult");

    expect(messages.some((message) => message.type === "progress")).toBe(true);
    expect(messages.some((message) => message.type === "partialResult")).toBe(true);
    expect(Math.max(
      ...messages
        .filter((message) => message.type === "progress")
        .map((message) => message.type === "progress" ? message.searchedCandidates : 0),
    )).toBeLessThan(10);
    expect(complete).toBeDefined();
    expect(complete?.type === "complete" ? complete.candidates : []).toEqual(
      searchDefenceCandidates(defender, scenarios, { maxResults: 1 }),
    );
    expect(partial?.type === "partialResult" ? partial.passingCandidateCount : 0).toBeGreaterThan(0);
    expect(complete?.type === "complete" ? complete.passingCandidateCount : 0).toBe(1);
    expect(complete?.type === "complete" ? complete.candidates[0].scenarioResults[0].hitEvaluations[0].description : "")
      .toContain("Thunderbolt");
  });

  it("keeps partial results capped while completing with every passing candidate", async () => {
    const defender = makeBuild("target", "カイリュー", { ...zeroEvs, atk: 252, spa: 252 });
    const attacker = makeBuild("attacker", "ピチュー", zeroEvs, 1);
    const scenarios = [
      makeScenario("easy", [makeHit("quick-attack", attacker, "でんこうせっか")], 1, 1),
    ];
    const messages: DefenceSearchWorkerMessage[] = [];

    await runDefenceSearchWorkerTask(
      {
        type: "start",
        requestId: "request-all",
        build: defender,
        scenarios,
        options: { maxResults: null, partialResultLimit: 2, progressInterval: 1, partialResultInterval: 1, yieldEvery: 1 },
      },
      (message) => messages.push(message),
    );

    const partials = messages.filter((message) => message.type === "partialResult");
    const complete = messages.find((message) => message.type === "complete");
    const allCandidates = searchDefenceCandidates(defender, scenarios, { maxResults: null });

    expect(partials.length).toBeGreaterThan(0);
    expect(partials.every((message) => message.type === "partialResult" && message.candidates.length <= 2)).toBe(true);
    expect(Math.max(...partials.map((message) => message.type === "partialResult" ? message.passingCandidateCount : 0)))
      .toBeGreaterThan(2);
    expect(complete?.type === "complete" ? complete.candidates : []).toEqual(allCandidates);
    expect(complete?.type === "complete" ? complete.passingCandidateCount : 0).toBe(allCandidates.length);
  });

  it("uses requested defence search stats for progress totals and final candidates", async () => {
    const defender = makeBuild("target", "カイリュー", { ...zeroEvs, atk: 252, spa: 252 });
    const attacker = makeBuild("attacker", "ピチュー", zeroEvs, 1);
    const scenarios = [
      makeScenario("easy", [makeHit("quick-attack", attacker, "でんこうせっか")], 1, 1),
    ];
    const messages: DefenceSearchWorkerMessage[] = [];

    await runDefenceSearchWorkerTask(
      {
        type: "start",
        requestId: "request-hb",
        build: defender,
        scenarios,
        options: {
          maxResults: null,
          searchStatKeys: ["hp", "def"],
          progressInterval: 1,
          partialResultInterval: 1,
          yieldEvery: 1,
        },
      },
      (message) => messages.push(message),
    );

    const progressMessages = messages.filter((message) => message.type === "progress");
    const complete = messages.find((message) => message.type === "complete");
    const expectedCandidates = searchDefenceCandidates(defender, scenarios, {
      maxResults: null,
      searchStatKeys: ["hp", "def"],
    });

    expect(progressMessages.every((message) => message.type === "progress" && message.totalCandidates === 6)).toBe(true);
    expect(complete?.type === "complete" ? complete.candidates : []).toEqual(expectedCandidates);
    expect(complete?.type === "complete" ? complete.candidates.every((candidate) => candidate.appliedStatPoints.spd === 0) : false)
      .toBe(true);
  });

  it("includes the closest failed candidate bottleneck when no candidates pass", async () => {
    const defender = makeBuild("target", "カイリュー", { ...zeroEvs, atk: 252, spa: 252 });
    const attacker = makeBuild("attacker", "ピカチュウ", { ...zeroEvs, spa: 252 }, 1, "ひかえめ");
    const scenarios = [
      makeScenario("missing", [makeHit("thunderbolt", attacker, "10まんボルト")], 2, 1),
    ];
    const messages: DefenceSearchWorkerMessage[] = [];

    await runDefenceSearchWorkerTask(
      {
        type: "start",
        requestId: "request-empty",
        build: defender,
        scenarios,
        options: { maxResults: 1, progressInterval: 1, yieldEvery: 1 },
      },
      (message) => messages.push(message),
    );

    const complete = messages.find((message) => message.type === "complete");

    expect(complete?.type === "complete" ? complete.candidates : []).toEqual([]);
    expect(complete?.type === "complete" ? complete.passingCandidateCount : -1).toBe(0);
    expect(complete?.type === "complete" ? complete.strictestFailureLabel : null).toBe("missing missing hits");
  });

  it("emits error messages with a readable reason", async () => {
    const messages: DefenceSearchWorkerMessage[] = [];

    await runDefenceSearchWorkerTask(
      {
        type: "start",
        requestId: "request-error",
        build: null as unknown as Build,
        scenarios: [],
      },
      (message) => messages.push(message),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "error",
      requestId: "request-error",
    });
    expect(messages[0].type === "error" ? messages[0].message : "").toContain("Cannot read");
  });

  it("stops cooperatively after cancellation without emitting partialResult or complete", async () => {
    const defender = makeBuild("target", "カイリュー", { ...zeroEvs, atk: 252, spa: 252 });
    const attacker = makeBuild("attacker", "ガブリアス", { ...zeroEvs, atk: 252 }, 50, "ようき");
    const scenarios = [
      makeScenario("hard", [makeHit("outrage", attacker, "げきりん")], 1, 1),
    ];
    const messages: DefenceSearchWorkerMessage[] = [];
    let canceled = false;

    await runDefenceSearchWorkerTask(
      {
        type: "start",
        requestId: "request-cancel",
        build: defender,
        scenarios,
        options: { maxResults: 1, progressInterval: 1, yieldEvery: 1 },
      },
      (message) => {
        messages.push(message);
        if (message.type === "progress") {
          canceled = true;
        }
      },
      () => canceled,
    );

    expect(messages.some((message) => message.type === "progress")).toBe(true);
    expect(messages.some((message) => message.type === "partialResult")).toBe(false);
    expect(messages.some((message) => message.type === "complete")).toBe(false);
  });
});

describe("DefenceSearchWorkerClient", () => {
  it("discards messages whose requestId does not match the active request", () => {
    expect(isCurrentWorkerMessage({ type: "complete", requestId: "old", candidates: [], passingCandidateCount: 0 }, "current")).toBe(false);
    expect(isCurrentWorkerMessage({ type: "complete", requestId: "current", candidates: [], passingCandidateCount: 0 }, "current")).toBe(true);
  });

  it("posts start and cancel messages and does not adopt canceled request results", () => {
    const worker = new FakeWorker();
    const progressMessages: DefenceSearchWorkerMessage[] = [];
    const completeMessages: DefenceSearchWorkerMessage[] = [];
    const client = new DefenceSearchWorkerClient(worker);
    const defender = makeBuild("target", "カイリュー", { ...zeroEvs, atk: 252, spa: 252 });

    const activeRequest = client.start(defender, [], {
      requestId: "request-client",
      callbacks: {
        onProgress: (message) => progressMessages.push(message),
        onComplete: (message) => completeMessages.push(message),
      },
    });

    worker.emit({
      type: "progress",
      requestId: "other-request",
      searchedCandidates: 1,
      totalCandidates: 4,
      progress: 0.25,
    });
    worker.emit({
      type: "progress",
      requestId: "request-client",
      searchedCandidates: 1,
      totalCandidates: 4,
      progress: 0.25,
    });
    activeRequest.cancel();
    worker.emit({ type: "complete", requestId: "request-client", candidates: [], passingCandidateCount: 0 });

    expect(worker.sentMessages[0]).toMatchObject({ type: "start", requestId: "request-client" });
    expect(worker.sentMessages[1]).toEqual({ type: "cancel", requestId: "request-client" });
    expect(progressMessages).toHaveLength(1);
    expect(completeMessages).toHaveLength(0);

    client.dispose();
  });
});
