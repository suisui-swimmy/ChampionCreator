import { describe, expect, it } from "vitest";
import { createDefaultTargetForm, createDefaultScenarioAttackForm, initializeOffenseScenario, buildOffenseSequenceCondition, buildTargetBuildFromUi, getOffenseMoveUses, getOffenseCumulativeUses, type ScenarioFormState } from "../ui/defenceSearchUi";
import { evaluateOffenseSequence, searchOffenseAllocation, withOffenseStatPoints } from "./offenseSequence";
import { evaluateCurrentOffense } from "./offenseAdjustment";
import { getBuildStatPoints, sumStatPoints } from "../domain/championsStats";
import { toSmogonPokemon } from "../calc/smogonAdapter";
import { parseShareStateDocument, createShareStateDocument } from "../ui/shareState";
import { buildCurrentBuildEvaluationInput } from "../ui/currentBuildEvaluationUi";
import { evaluateCurrentBuild } from "./currentBuildEvaluation";
import { runDefenceSearchWorkerTask, runMaximizeRemainingBulkWorkerTask, type DefenceSearchWorkerMessage } from "../worker/defenceSearchWorker";
import { evaluateCandidate } from "./defenceSearch";
import { maximizeRemainingBulk } from "./maximizeRemainingBulk";
import { encodeSharedAdjustment, decodeSharedAdjustment } from "../share/urlShareCodec";

const zeros = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const fixture = (moves = ["エアスラッシュ", "エアスラッシュ"]) => {
  const target = { ...createDefaultTargetForm(), pokemonInput: "メガリザードンY", pokemonCanonicalName: undefined,
    natureInput: "ひかえめ", abilityInput: "ひでり", itemInput: "リザードナイトＹ", statPoints: { ...zeros, spa: 10 } };
  const scenario = initializeOffenseScenario({ id: "sequence", label: "イダイトウ", enabled: true, adjustmentType: "offense",
    attacks: moves.map((moveInput, index) => ({ ...createDefaultScenarioAttackForm(`hit-${index}`), id: `hit-${index}`, label: `火力調整${String.fromCharCode(65 + index)}`,
      attackerPokemonInput: "イダイトウ オスのすがた", attackerPokemonCanonicalName: undefined,
      attackerNatureInput: "ようき", attackerAbilityInput: "てきおうりょく", attackerItemInput: "しんぴのしずく",
      attackerStatPoints: { ...zeros, hp: 2 }, moveInput, gameType: "doubles", targetKoProbabilityPercent: 50 })) } as ScenarioFormState);
  return { target, scenario, build: buildTargetBuildFromUi(target), condition: buildOffenseSequenceCondition(target, scenario) };
};
const finish = <T>(iterator: Generator<number, T>) => { let step = iterator.next(); while (!step.done) step = iterator.next(); return step.value; };

describe("offense sequences", () => {
  it("evaluates two uses in one card like two single-use cards and derives cumulative uses", () => {
    const repeated = fixture(["エアスラッシュ"]);
    repeated.scenario.attacks[0].offenseMoveUses = 2;
    const condition = buildOffenseSequenceCondition(repeated.target, repeated.scenario);
    const result = evaluateOffenseSequence(repeated.build, condition);
    const separate = fixture();
    const reference = evaluateOffenseSequence(separate.build, separate.condition);
    expect(result.koProbability).toBe(reference.koProbability);
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ moveUses: 2, cumulativeUses: 2, remainingHp: reference.steps[1].remainingHp });
    expect(evaluateCurrentBuild(buildCurrentBuildEvaluationInput(repeated.target, [repeated.scenario])).conditions[0].offense?.koProbability).toBe(reference.koProbability);
    repeated.scenario.attacks.push({ ...repeated.scenario.attacks[0], id: "next", offenseMoveUses: 1 });
    expect(repeated.scenario.attacks.map((attack) => getOffenseCumulativeUses(repeated.scenario, attack.id))).toEqual([2, 3]);
    repeated.scenario.attacks[0].offenseMoveUses = 4;
    expect(getOffenseCumulativeUses(repeated.scenario, "next")).toBe(5);
    repeated.scenario.attacks.shift();
    expect(getOffenseCumulativeUses(repeated.scenario, "next")).toBe(1);
  });
  it("keeps move uses independent of multi-hit counts", () => {
    const repeated = fixture(["タネマシンガン"]);
    repeated.scenario.attacks[0].repeat = 5;
    repeated.scenario.attacks[0].offenseMoveUses = 2;
    const condition = buildOffenseSequenceCondition(repeated.target, repeated.scenario);
    expect(condition.attacks[0]).toMatchObject({ moveUses: 2, moveHits: 5 });
    const result = evaluateOffenseSequence(repeated.build, condition);
    const separate = fixture(["タネマシンガン", "タネマシンガン"]);
    separate.scenario.attacks.forEach((attack) => { attack.repeat = 5; });
    expect(result.koProbability).toBe(evaluateOffenseSequence(separate.build, buildOffenseSequenceCondition(separate.target, separate.scenario)).koProbability);
    expect(result.hitEvaluation.damageRollsByHit).toHaveLength(5);
    expect(result.steps[0].cumulativeUses).toBe(2);
  });
  it("preserves pre-feature move-use semantics and persists the new count through JSON and s4", async () => {
    const { target, scenario } = fixture(["タネマシンガン"]);
    scenario.attacks[0].repeat = 5;
    const legacy = { ...createShareStateDocument(target, [scenario]), schemaVersion: 14 };
    const migrated = parseShareStateDocument(JSON.stringify(legacy));
    expect(getOffenseMoveUses(migrated.scenarios[0].attacks[0])).toBe(1);
    expect(migrated.scenarios[0].attacks[0].repeat).toBe(5);
    scenario.attacks[0].offenseMoveUses = 3;
    const document = createShareStateDocument(target, [scenario]);
    expect(parseShareStateDocument(JSON.stringify(document)).scenarios[0].attacks[0].offenseMoveUses).toBe(3);
    const token = await encodeSharedAdjustment(document, { app: "0.34.0", calc: "test" });
    const decoded = (await decodeSharedAdjustment(token)).document;
    expect(decoded.scenarios[0].attacks[0]).toMatchObject({ repeat: 5, offenseMoveUses: 3 });
  });
  it.each([0, -1, 1.5, 11, "2", null])("rejects an invalid new move-use count %s", (value) => {
    const { target, scenario } = fixture();
    const document = createShareStateDocument(target, [scenario]);
    (document.scenarios[0].attacks[0] as unknown as Record<string, unknown>).offenseMoveUses = value;
    expect(() => parseShareStateDocument(JSON.stringify(document))).toThrow("火力の攻撃回数");
  });
  it("carries one opponent's HP and matches convolution of the two actual Calc rolls", () => {
    const { build, condition } = fixture();
    const single = evaluateCurrentOffense(condition.attacks[0]);
    expect(single.koProbability).toBe(0);
    const hp = toSmogonPokemon(condition.defenderBuild).maxHP();
    const rolls = single.hitEvaluation.damageRolls;
    const expected = rolls.flatMap((a) => rolls.map((b) => a + b >= hp)).filter(Boolean).length / (rolls.length ** 2);
    const result = evaluateOffenseSequence(build, condition);
    expect(result.koProbability).toBe(expected);
    expect(result.koProbability).toBeGreaterThan(0);
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1].remainingHp.max).toBeLessThan(result.steps[0].remainingHp.max);
  });
  it("keeps one-card damage and KO probability compatible and treats 50 as probability", () => {
    const { build, condition } = fixture(["ねっぷう"]);
    expect(evaluateOffenseSequence(build, condition).koProbability).toBe(evaluateCurrentOffense(condition.attacks[0]).koProbability);
    const combined = fixture();
    const probability = evaluateOffenseSequence(combined.build, combined.condition).koProbability;
    expect(evaluateOffenseSequence(combined.build, { ...combined.condition, targetKoProbability: probability }).passed).toBe(true);
    if (probability < 1) expect(evaluateOffenseSequence(combined.build, { ...combined.condition, targetKoProbability: probability + 0.001 }).passed).toBe(false);
  });
  it("finds the exact least-cost mixed A/C allocation against independent exhaustive evaluation", () => {
    const { target, scenario } = fixture(["かみなりパンチ", "エアスラッシュ"]);
    target.statPoints = { ...zeros };
    const build = buildTargetBuildFromUi(target);
    const condition = buildOffenseSequenceCondition(target, scenario);
    const options = [];
    for (let atk = 0; atk <= 32; atk++) for (let spa = 0; spa <= 32; spa++) {
      const points = { ...zeros, atk, spa };
      if (evaluateOffenseSequence(withOffenseStatPoints(build, points), condition).passed) options.push(points);
    }
    options.sort((a, b) => sumStatPoints(a) - sumStatPoints(b) || a.atk - b.atk || a.spa - b.spa);
    const result = finish(searchOffenseAllocation(build, [condition]));
    expect(options.length).toBeGreaterThan(0);
    expect(getBuildStatPoints(result!.build)).toEqual(options[0]);
  }, 20_000);
  it("uses the same row evaluation for current build and worker allocation", async () => {
    const { target, scenario, build, condition } = fixture();
    const check = evaluateCurrentBuild(buildCurrentBuildEvaluationInput(target, [scenario]));
    expect(check.conditions).toHaveLength(1);
    expect(check.conditions[0].offense?.koProbability).toBe(evaluateOffenseSequence(build, condition).koProbability);
    const messages: DefenceSearchWorkerMessage[] = [];
    await runDefenceSearchWorkerTask({ type: "start", requestId: "seq", build, scenarios: [], options: {
      prepareOffenseAllocation: true, standalone: true, offenseConditions: [condition],
    } }, (message) => messages.push(message));
    const completed = messages.find((message) => message.type === "complete");
    expect(completed?.type).toBe("complete");
    if (completed?.type === "complete") expect(completed.offenseResults?.[0].result.sequence?.passed).toBe(true);
  });
  it("re-evaluates field abilities in allocation, final candidates and remaining bulk", async () => {
    const { target, scenario, build } = fixture();
    scenario.attacks[0].battleAbilities = { targetAlly: ["Battery"], opponentAlly: [] };
    scenario.attacks[1].battleAbilities = { targetAlly: [], opponentAlly: ["Friend Guard"] };
    const condition = buildOffenseSequenceCondition(target, scenario);
    const sync = finish(searchOffenseAllocation(build, [condition]));
    expect(sync).not.toBeNull();
    const messages: DefenceSearchWorkerMessage[] = [];
    await runDefenceSearchWorkerTask({ type: "start", requestId: "abilities", build, scenarios: [], options: {
      prepareOffenseAllocation: true, standalone: true, offenseConditions: [condition],
    } }, (message) => messages.push(message));
    const completed = messages.find((message) => message.type === "complete");
    expect(completed?.type === "complete" && completed.offenseResults?.[0].result.sequence?.koProbability)
      .toBe(sync!.evaluations[0].koProbability);
    const candidates = maximizeRemainingBulk({ build: sync!.build, offenseConditions: [condition] }, { maxResults: 1 });
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(evaluateCandidate(sync!.build, [], candidate.candidate.statPoints, { offenseConditions: [condition] }).passed).toBe(true);
    }
  });
  it("stops allocation on cancel without posting completion", async () => {
    const { build, condition } = fixture(); let canceled = false;
    const messages: DefenceSearchWorkerMessage[] = [];
    await runDefenceSearchWorkerTask({ type: "start", requestId: "stop", build, scenarios: [], options: {
      prepareOffenseAllocation: true, standalone: true, offenseConditions: [condition],
    } }, (message) => { messages.push(message); canceled = true; }, () => canceled);
    expect(messages.some((message) => message.type === "complete")).toBe(false);
  });
  it("retains consumed berry state across cards and applies recovery before the next move", () => {
    const { build, condition } = fixture();
    const before = evaluateOffenseSequence(build, condition);
    condition.attacks.forEach((attack, index) => { attack.hpEvents = [{ id: `berry-${index}`, effectId: "sitrus-berry-heal", enabled: true, sequenceContext: "currentMove" }]; });
    const result = evaluateOffenseSequence(build, condition);
    expect(result.koProbability).toBeLessThan(before.koProbability);
    const activations = result.hpEventEvaluations.filter((event) => event.effectId === "sitrus-berry-heal");
    expect(activations.reduce((sum, event) => sum + event.activationProbability, 0)).toBeLessThanOrEqual(1);
  });
  it("recomputes Super Fang from the carried HP and stops after the attacker faints", () => {
    const { target, scenario, build } = fixture(["いかりのまえば", "いかりのまえば"]);
    scenario.offense!.opponent.attackerPokemonInput = "カビゴン";
    scenario.offense!.opponent.attackerAbilityInput = "あついしぼう";
    scenario.offense!.opponent.attackerItemInput = "";
    const condition = buildOffenseSequenceCondition(target, scenario);
    const hp = toSmogonPokemon(condition.defenderBuild).maxHP();
    const result = evaluateOffenseSequence(build, condition);
    expect(result.steps[1].remainingHp).toEqual({ min: Math.ceil(Math.ceil(hp / 2) / 2), max: Math.ceil(Math.ceil(hp / 2) / 2) });
    scenario.attacks[0].moveInput = "いのちがけ";
    scenario.attacks[1].moveInput = "エアスラッシュ";
    const fainted = evaluateOffenseSequence(build, buildOffenseSequenceCondition(target, scenario));
    expect(fainted.steps[1].remainingHp).toEqual(fainted.steps[0].remainingHp);
    expect(fainted.steps[1].hitEvaluation.damageRange.max).toBe(0);
  });
  it("rejects actual candidates and bulk allocations that miss the KO threshold", () => {
    const { build, condition } = fixture(["ねっぷう"]);
    const result = evaluateCandidate(build, [], { hp: 0, def: 0, spd: 0 }, { offenseConditions: [condition] });
    expect(result.passed).toBe(false);
    expect(result.offenseResults?.[0].passed).toBe(false);
    expect(maximizeRemainingBulk({ build, offenseConditions: [condition] }, { maxResults: 1 })).toEqual([]);
  });
  it("supports one use of a multi-hit move and separates missing input from immunity", () => {
    const { target, scenario, build } = fixture(["タネマシンガン"]);
    scenario.attacks[0].repeat = 5;
    const result = evaluateOffenseSequence(build, buildOffenseSequenceCondition(target, scenario));
    expect(result.steps).toHaveLength(1);
    expect(result.hitEvaluation.damageRollsByHit).toHaveLength(5);
    scenario.attacks[0].moveInput = "たいあたり";
    expect(evaluateOffenseSequence(build, buildOffenseSequenceCondition(target, scenario)).koProbability).toBe(0);
    scenario.attacks.push({ ...scenario.attacks[0], id: "blank", moveInput: "" });
    expect(() => buildOffenseSequenceCondition(target, scenario)).toThrow("技を入力");
  });
  it("round-trips the common opponent and per-card rank overrides in s4", async () => {
    const { target, scenario } = fixture();
    scenario.attacks[1].offenseAttackerBoosts = { spa: -2 };
    const document = createShareStateDocument(target, [scenario]);
    const token = await encodeSharedAdjustment(document, { app: "0.33.0", calc: "test" });
    expect(token.startsWith("s4.")).toBe(true);
    const decoded = (await decodeSharedAdjustment(token)).document;
    expect(decoded.scenarios[0].offense).toEqual(scenario.offense);
    expect(decoded.scenarios[0].attacks[1].offenseAttackerBoosts).toEqual({ spa: -2 });
    expect(decoded.scenarios[0].attacks).toHaveLength(2);
  });
  it("checks every offense row together while honoring the fixed A/C/S lower bounds", () => {
    const { build, condition } = fixture();
    const second = { ...condition, id: "second", scenarioId: "second", targetKoProbability: 1 };
    const result = finish(searchOffenseAllocation(build, [condition, second]));
    expect(result?.evaluations).toHaveLength(2);
    expect(result?.evaluations.every((entry) => entry.passed)).toBe(true);
    expect(getBuildStatPoints(result!.build).spa).toBeGreaterThanOrEqual(getBuildStatPoints(build).spa);
    expect(() => finish(searchOffenseAllocation(withOffenseStatPoints(build, { ...zeros, atk: 32, spa: 32, spe: 3 }), [condition]))).toThrow("合計66");
  });
  it("reallocates bulk after raising offensive SP without treating its former defensive SP as an illegal input", async () => {
    const { build, condition } = fixture();
    const current = withOffenseStatPoints(build, { ...zeros, hp: 32, def: 32, spe: 2 });
    const messages: DefenceSearchWorkerMessage[] = [];
    await runMaximizeRemainingBulkWorkerTask({ type: "maximizeRemainingBulk", requestId: "bulk-seq", input: {
      build: current, prepareOffenseAllocation: true, offenseConditions: [{ ...condition, targetKoProbability: 1 }],
    } }, (message) => messages.push(message));
    expect(messages.some((message) => message.type === "bulkError")).toBe(false);
    expect(messages.some((message) => message.type === "bulkComplete")).toBe(true);
  });
  it("preserves old independent constraints, migrates once, and refuses missing new common input", () => {
    const { target, scenario } = fixture();
    const legacy = { schemaVersion: 13, target, scenarios: [{ ...scenario, offense: undefined }] };
    const migrated = parseShareStateDocument(JSON.stringify(legacy));
    expect(migrated.scenarios).toHaveLength(2);
    expect(migrated.scenarios.every((entry) => entry.attacks.length === 1 && entry.offense?.targetKoProbabilityPercent === 50)).toBe(true);
    expect(parseShareStateDocument(JSON.stringify(migrated))).toEqual(migrated);
    const document = createShareStateDocument(target, [scenario]);
    expect(parseShareStateDocument(JSON.stringify(document)).scenarios[0].attacks).toHaveLength(2);
    delete document.scenarios[0].offense;
    expect(() => parseShareStateDocument(JSON.stringify(document))).toThrow("共通仮想敵");
  });
});
