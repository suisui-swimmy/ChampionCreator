import { describe, expect, it } from "vitest";
import { renderInitialApp } from "./prerender";
import { buildGuideExample, renderGuideExample } from "./guideExample";

describe("search-readable initial HTML", () => {
  it("renders the actual blank workbench with navigation without browser storage or Firebase", () => {
    const html = renderInitialApp();
    expect(html).toContain('class="app-shell"');
    // Links stay readable and navigable, but input typed before React starts
    // must not be silently discarded when the browser app replaces the preview.
    expect(html).toContain('<fieldset disabled="" aria-busy="true"');
    expect(html).toContain("調整対象");
    expect(html).toContain("仮想敵シナリオ");
    expect(html).toContain('href="/guide/"');
    expect(html).toContain("ChampionCreator");
    expect(html).not.toContain("firebaseapp.com");
    expect(html).not.toContain("recaptcha");
  });
  it("generates a legal sample that clears the documented defence, offense and speed conditions", () => {
    const { candidate, offense, speed, defenceForm, offenseForm, speedForm, target } = buildGuideExample();
    expect(candidate.usedStatPointBudget).toBeLessThanOrEqual(66);
    expect(Object.values(candidate.appliedStatPoints).every((sp) => Number.isInteger(sp) && sp >= 0 && sp <= 32)).toBe(true);
    expect(candidate.scenarioResults.every((result) => result.passed && result.survivalProbability >= 0.9)).toBe(true);
    expect(offense.koProbability).toBeGreaterThanOrEqual(0.8);
    expect(candidate.appliedStatPoints.spa).toBe(offense.requiredStatPoints);
    expect(candidate.appliedStatPoints.spe).toBe(speed.requiredStatPoints);
    expect(speed.actualSpeed).toBeGreaterThan(speed.targetSpeed);
    expect([defenceForm.gameType, offenseForm.gameType, speedForm.gameType]).toEqual(["doubles", "doubles", "doubles"]);
    expect([defenceForm.requiredSurvivedHits, defenceForm.repeat]).toEqual([1, 1]);
    expect([target.level, defenceForm.attackerLevel, offenseForm.attackerLevel, speedForm.attackerLevel]).toEqual([50, 50, 50, 50]);
    for (const form of [target, defenceForm, offenseForm, speedForm]) {
      for (const [key, value] of Object.entries(form)) {
        if (/^(?:attacker)?(?:abilityInput|itemInput|teraEnabled|weather|terrain)$/i.test(key)) {
          expect(["", false, "none"]).toContain(value);
        }
      }
    }
    const html = renderGuideExample();
    expect(html).toContain('id="calculation-example"');
    expect(html).toContain(`合計${candidate.usedStatPointBudget} SP`);
    expect(html).toContain("ふいうち");
    expect(html).toContain("サイコキネシス");
  });
});
