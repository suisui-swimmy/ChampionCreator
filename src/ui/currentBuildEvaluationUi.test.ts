import { describe, expect, it } from "vitest";
import { calculateSmogonHit } from "../calc/smogonAdapter";
import { evaluateCurrentBuild } from "../search/currentBuildEvaluation";
import { buildOffenseHit } from "../search/offenseAdjustment";
import { createAdjustmentExampleState } from "./adjustmentExample";
import { buildCurrentBuildEvaluationInput } from "./currentBuildEvaluationUi";
import { createDefaultScenarioAttackForm, createDefaultTargetForm, type ScenarioFormState } from "./defenceSearchUi";
import { createTrickRoomFixture } from "./testFixtures/speedIntegration";

const zero = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const checkExample = () => {
  const { target, scenarios } = createAdjustmentExampleState();
  return { target, scenarios, run: () => evaluateCurrentBuild(buildCurrentBuildEvaluationInput(target, scenarios)) };
};

describe("current allocation evaluation", () => {
  it("checks all three kinds with the exact saved allocation and leaves every input unchanged", () => {
    const { target, scenarios, run } = checkExample();
    const before = JSON.stringify({ target, scenarios });
    const result = run();
    expect(result.conditions.map((row) => row.kind)).toEqual(["defence", "offense", "speed"]);
    expect(result.status, JSON.stringify(result.conditions.map(({ status, message }) => ({ status, message })))).toBe("pass");
    expect(result.build?.statPoints).toEqual(target.statPoints);
    expect(result.build?.nature?.displayNameJa).toBe(target.natureInput);
    expect(JSON.stringify({ target, scenarios })).toBe(before);
  });

  it("reports the manually reduced offense as FAIL instead of using the proposed minimum line", () => {
    const { target, scenarios, run } = checkExample();
    target.statPoints.spa = 0;
    const input = buildCurrentBuildEvaluationInput(target, scenarios);
    const condition = input.conditions.find((row) => row.kind === "offense");
    if (!condition || condition.issue || condition.kind !== "offense") throw new Error("Missing offense input");
    const direct = calculateSmogonHit(condition.input.defenderBuild, buildOffenseHit(condition.input.attackerBuild, condition.input), condition.input.field);
    const result = run();
    expect(result.conditions.find((row) => row.kind === "offense")?.offense?.hitEvaluation.damageRolls).toEqual(direct.damageRolls);
    expect(result.conditions.find((row) => row.kind === "offense")?.status).toBe("fail");
    expect(target.statPoints.spa).toBe(0);
  });

  it.each([[9, "pass", 79], [10, "fail", 80], [11, "fail", 81]])("checks trick room S%s without reducing S", (spe, status, actualSpeed) => {
    const { target, scenarios } = createTrickRoomFixture(spe as number);
    const result = evaluateCurrentBuild(buildCurrentBuildEvaluationInput(target, scenarios.slice(1)));
    expect(result.conditions[0]).toMatchObject({ status, speed: { statPoints: spe, actualSpeed, requiredSpeed: 79 } });
    expect(target.statPoints.spe).toBe(spe);
  });

  it("handles manual S and an allowed tie using the current speed", () => {
    const { target, scenarios, speed } = createTrickRoomFixture(10);
    scenarios[1].attacks[0].speedOrderMode = "normal";
    speed.speedTargetMode = "manual";
    speed.speedTargetValue = 80;
    const result = evaluateCurrentBuild(buildCurrentBuildEvaluationInput(target, scenarios.slice(1)));
    expect(result.conditions[0]).toMatchObject({ status: "pass", speed: { actualSpeed: 80, requiredSpeed: 80, relation: "tie" } });
  });

  it("keeps valid results when another enabled condition is incomplete or unresolved", () => {
    const { target, scenarios, run } = checkExample();
    scenarios[1].attacks[0].moveInput = "";
    scenarios[2].attacks[0].attackerPokemonInput = "存在しないポケモン";
    delete scenarios[2].attacks[0].attackerPokemonCanonicalName;
    const result = run();
    expect(result.status).toBe("blocked");
    expect(result.conditions.map((row) => row.status)).toEqual(["pass", "incomplete", "unresolved"]);
    expect(JSON.stringify(result)).not.toContain("canonical name");
    expect(target.statPoints).toBeDefined();
  });

  it("does not drop an empty attack added inside an enabled defense scenario", () => {
    const { scenarios, run } = checkExample();
    scenarios[0].attacks.push({ ...createDefaultScenarioAttackForm("empty", "未入力"), moveInput: "" });
    expect(run().conditions[0].status).toBe("incomplete");
  });

  it("requires an attack when a card has an ally ability but no move", () => {
    const { scenarios, run } = checkExample();
    scenarios[0].attacks.push({ ...createDefaultScenarioAttackForm("ally", "味方"), moveInput: "", attackerAbilityInput: "パワースポット" });
    expect(run().conditions[0].status).toBe("incomplete");
  });

  it("excludes disabled scenarios and never calls no conditions a pass", () => {
    const { scenarios, run } = checkExample();
    scenarios.forEach((scenario) => { scenario.enabled = false; });
    expect(run()).toMatchObject({ status: "empty", conditions: [] });
  });

  it.each([
    { ...zero, hp: 33 }, { ...zero, hp: -1 }, { ...zero, hp: NaN },
    { ...zero, hp: 32, def: 32, spd: 3 }, { ...zero, hp: 1.5 },
  ])("rejects an illegal current allocation without normalizing it", (statPoints) => {
    const { target, run } = checkExample();
    target.statPoints = statPoints;
    expect(run()).toMatchObject({ status: "blocked", issue: { status: "invalid" }, conditions: [] });
    expect(target.statPoints).toEqual(statPoints);
  });

  it("retains fractional probability thresholds without rounding down", () => {
    const { target, scenarios } = createAdjustmentExampleState();
    scenarios[0].attacks[0].minSurvivalProbabilityPercent = 90.5;
    scenarios[1].offense!.targetKoProbabilityPercent = 99.5;
    const result = evaluateCurrentBuild(buildCurrentBuildEvaluationInput(target, scenarios));
    expect(result.conditions[0].defence?.minSurvivalProbability).toBe(0.905);
    expect(result.conditions[1].offense?.targetKoProbability).toBe(0.995);
  });

  it.each(["テラバースト", "ボディプレス", "イカサマ", "ちきゅうなげ"])("evaluates %s once with all current stats and matches direct Calc", (moveInput) => {
    const target = { ...createDefaultTargetForm(), pokemonInput: "ミュウ", pokemonCanonicalName: undefined,
      natureInput: "ずぶとい", abilityInput: "シンクロ", itemInput: "", statPoints: { ...zero, atk: 3, def: 25, spa: 10 },
      teraEnabled: moveInput === "テラバースト", teraTypeInput: "くさ" };
    const attack = { ...createDefaultScenarioAttackForm(), attackerPokemonInput: "カビゴン", attackerPokemonCanonicalName: undefined,
      attackerNatureInput: "いじっぱり", attackerAbilityInput: "あついしぼう", attackerItemInput: "",
      attackerStatPoints: { ...zero, hp: 10, atk: 20 }, moveInput };
    const scenarios: ScenarioFormState[] = [{ id: "off", label: "火力", adjustmentType: "offense", enabled: true, attacks: [attack] }];
    const input = buildCurrentBuildEvaluationInput(target, scenarios);
    const row = input.conditions[0];
    if (row.issue || row.kind !== "offense") throw new Error("No input");
    const direct = calculateSmogonHit(row.input.defenderBuild, buildOffenseHit(row.input.attackerBuild, row.input), row.input.field);
    const before = JSON.stringify(input);
    const result = evaluateCurrentBuild(input);
    expect(result.conditions).toHaveLength(1);
    expect(result.conditions[0].offense?.hitEvaluation).toEqual(direct);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("distinguishes explicitly unsupported mechanics from an ordinary failed condition", () => {
    const { target, scenarios } = createAdjustmentExampleState();
    const input = buildCurrentBuildEvaluationInput(target, scenarios);
    const row = input.conditions[1];
    if (row.issue || row.kind !== "offense") throw new Error("No offense");
    row.input.move = { ...row.input.move, sourceStatus: "unsupported-temporary" };
    expect(evaluateCurrentBuild(input).conditions[1].status).toBe("unsupported");
  });
});
