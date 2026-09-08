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
    const { candidate, candidateCount, offense, speed, defenceForm, offenseForm, speedForm, target } = buildGuideExample();
    expect(candidateCount).toBe(1);
    expect(target.statPoints).toEqual({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
    expect(candidate.appliedStatPoints).toEqual({ hp: 4, atk: 0, def: 27, spa: 10, spd: 0, spe: 25 });
    expect(candidate.usedStatPointBudget).toBeLessThanOrEqual(66);
    expect(Object.values(candidate.appliedStatPoints).every((sp) => Number.isInteger(sp) && sp >= 0 && sp <= 32)).toBe(true);
    expect(candidate.scenarioResults.every((result) => result.passed && result.survivalProbability >= 0.9)).toBe(true);
    expect(candidate.scenarioResults[0].survivalProbability).toBe(0.9375);
    expect(offense.koProbability).toBe(1);
    expect(candidate.appliedStatPoints.spa).toBe(offense.requiredStatPoints);
    expect(candidate.appliedStatPoints.spe).toBe(speed.requiredStatPoints);
    expect([speed.actualSpeed, speed.targetSpeed]).toEqual([145, 143]);
    expect([defenceForm.gameType, offenseForm.gameType, speedForm.gameType]).toEqual(["doubles", "doubles", "doubles"]);
    expect([defenceForm.requiredSurvivedHits, defenceForm.repeat]).toEqual([1, 1]);
    expect([target.level, defenceForm.attackerLevel, offenseForm.attackerLevel, speedForm.attackerLevel]).toEqual([50, 50, 50, 50]);
    expect(target).toMatchObject({ pokemonInput: "メガリザードンY", natureInput: "ひかえめ", abilityInput: "ひでり", itemInput: "リザードナイトＹ" });
    expect(defenceForm).toMatchObject({ attackerPokemonInput: "ガブリアス", attackerNatureInput: "いじっぱり", attackerStatPoints: { atk: 32 }, moveInput: "いわなだれ", minSurvivalProbabilityPercent: 90 });
    expect(offenseForm).toMatchObject({ attackerPokemonInput: "イダイトウ オスのすがた", attackerStatPoints: { hp: 2, spd: 0 }, moveInput: "ソーラービーム", targetKoProbabilityPercent: 100 });
    expect(speedForm).toMatchObject({ attackerPokemonInput: "イダイトウ オスのすがた", attackerNatureInput: "ようき", attackerStatPoints: { spe: 32 }, speedComparison: "outspeed", speedRequiredOffset: 2 });
    const html = renderGuideExample();
    expect(html).toContain('id="calculation-example"');
    expect(html).toContain(`合計${candidate.usedStatPointBudget} SP`);
    expect(html).toContain("ダブルダメージ「いわなだれ」");
    expect(html).toContain("ソーラービーム」で確定1発");
    expect(html).toContain("確定1発（KO率100%）");
    expect(html).toContain("確定抜き+1（相手の実数値+2）");
    expect(html).toContain("条件を満たす配分は1つ");
    expect(html).toContain("H4 / A0 / B27 / C10 / D0 / S25");
    expect(html).toContain("耐える確率は93.75%、倒せる確率は100%");
    expect(html).not.toContain("メガマフォクシー");
    expect(html).not.toContain("追加補正は設定していません");
  });
});
