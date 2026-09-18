import { describe, expect, it } from "vitest";
import { evaluateSharedAdjustment } from "./evaluateSharedAdjustment";
import { createProbeDocument, PROBE_CASES } from "./probe/fixtures";
import { buildDefenceSearchInput, buildOffenseAdjustmentInput, buildSpeedAdjustmentInput, createOffenseAdjustmentFormFromScenarioAttack } from "../ui/defenceSearchUi";
import { evaluateScenario } from "../search/defenceSearch";
import { buildOffenseHit, evaluateCurrentOffense } from "../search/offenseAdjustment";
import { calculateSmogonHit } from "../calc/smogonAdapter";
import { calculateSpeedAdjustment, evaluateCurrentSpeed } from "../search/speedAdjustment";

describe("fixed-allocation share evaluation", () => {
  it("passes the real example at its exact selected SP without changing the document", () => {
    const document = createProbeDocument(PROBE_CASES[0]);
    const original = JSON.stringify(document);
    const result = evaluateSharedAdjustment(document);
    expect(result.conditions.map((row) => row.state)).toEqual(["pass", "pass", "pass"]);
    expect(result.conditions[0].text).toContain("93.75%");
    expect(result.conditions[1].text).toContain("KO率 100%");
    expect(result.conditions[2].text).toContain("こちらのS 145");
    expect(JSON.stringify(document)).toBe(original);
  });

  it("does not optimize insufficient C or S allocations into a passing result", () => {
    const document = createProbeDocument(PROBE_CASES[0]);
    document.target.statPoints.spa = 0;
    document.target.statPoints.spe = 24;
    const result = evaluateSharedAdjustment(document);
    expect(result.conditions.map((row) => row.state)).toEqual(["pass", "fail", "fail"]);
    const speed = buildSpeedAdjustmentInput(document.target, document.scenarios[2].attacks[0]);
    expect(evaluateCurrentSpeed(speed).passed).toBe(false);
    expect(calculateSpeedAdjustment(speed).passed).toBe(true);
  });

  it("uses direct Calc rolls for fixed offense evaluation", () => {
    const document = createProbeDocument(PROBE_CASES[0]);
    const input = buildOffenseAdjustmentInput(document.target, createOffenseAdjustmentFormFromScenarioAttack(document.scenarios[1].attacks[0]));
    const result = evaluateCurrentOffense(input);
    expect(result.hitEvaluation.damageRolls).toEqual(calculateSmogonHit(input.defenderBuild, buildOffenseHit(input.attackerBuild, input), input.field).damageRolls);
  });

  it("preserves sequential attacks and HP events through the existing defense evaluator", () => {
    const document = createProbeDocument(PROBE_CASES[0]);
    const scenario = document.scenarios[0];
    scenario.attacks[0].hpEvents = [{ id: "hazard", effectId: "stealth-rock-damage", enabled: true }];
    scenario.attacks.push({ ...structuredClone(scenario.attacks[0]), id: "second", label: "攻撃B", hpEvents: [], requiredSurvivedHits: 2 });
    const input = buildDefenceSearchInput(document.target, [scenario]);
    const expected = evaluateScenario(input.build, input.scenarios[0]);
    expect(evaluateSharedAdjustment(document).conditions[0].state).toBe(expected.passed ? "pass" : "fail");
    expect(expected.hpEventEvaluations?.length).toBeGreaterThan(0);
  });

  it("keeps disabled conditions disabled and reports incomplete conditions as errors", () => {
    const document = createProbeDocument(PROBE_CASES[0]);
    document.scenarios[0].enabled = false;
    document.scenarios[1].attacks[0].moveInput = "";
    expect(evaluateSharedAdjustment(document).conditions.map((row) => row.state)).toEqual(["disabled", "error", "pass"]);
  });
});
