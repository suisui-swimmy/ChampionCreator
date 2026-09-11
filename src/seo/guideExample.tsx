import { renderToStaticMarkup } from "react-dom/server";
import { createAdjustmentTutorialState } from "../ui/adjustmentExample";
import {
  buildIntegratedDefenceSearchInput,
  calculateOffenseAdjustmentsForCandidateRanking,
  calculateSpeedAdjustmentsForCandidateRanking,
} from "../ui/defenceSearchUi";
import { searchDefenceCandidates } from "../search/defenceSearch";

const statKeys = ["hp", "atk", "def", "spa", "spd", "spe"] as const;
const statLabels = ["H", "A", "B", "C", "D", "S"];
const percent = (probability: number): string => `${Number((probability * 100).toFixed(2))}%`;

export function buildGuideExample() {
  const { target, scenarios } = createAdjustmentTutorialState();
  const input = buildIntegratedDefenceSearchInput(target, scenarios);
  const candidates = searchDefenceCandidates(input.build, input.scenarios, {
    maxResults: null, minimumStatPoints: input.minimumStatPoints, searchStatKeys: input.searchStatKeys,
  });
  if (candidates.length !== 1) throw new Error("The guide sample must produce exactly one candidate.");
  const [candidate] = candidates;
  const appliedTarget = { ...target, statPoints: candidate.appliedStatPoints };
  const offense = calculateOffenseAdjustmentsForCandidateRanking(appliedTarget, scenarios).find((entry) => entry.result.passed);
  const speed = calculateSpeedAdjustmentsForCandidateRanking(appliedTarget, scenarios).find((entry) => entry.result.passed);
  const defenceForm = scenarios.find((entry) => entry.adjustmentType === "defence")?.attacks[0];
  const offenseForm = scenarios.find((entry) => entry.adjustmentType === "offense")?.attacks[0];
  const speedForm = scenarios.find((entry) => entry.adjustmentType === "speed")?.attacks[0];
  if (!candidate?.passed || !offense || !speed || speed.result.actualSpeed === null || !defenceForm || !offenseForm || !speedForm) {
    throw new Error("The guide sample no longer satisfies all three adjustment conditions.");
  }
  return {
    target, candidate, candidateCount: candidates.length, offense: offense.result,
    speed: { ...speed.result, actualSpeed: speed.result.actualSpeed },
    defenceForm, offenseForm, speedForm,
  };
}

export function renderGuideExample(): string {
  const { target, candidate, offense, speed, defenceForm, offenseForm, speedForm } = buildGuideExample();
  const spread = statKeys.map((key, index) => `${statLabels[index]}${candidate.appliedStatPoints[key]}`).join(" / ");
  const defence = candidate.scenarioResults[0];
  return renderToStaticMarkup(
    <section className="guide-section" id="calculation-example">
      <p className="guide-section-kicker">CALCULATION EXAMPLE</p>
      <h2>計算例と結果の読み方</h2>
      <p>上のサンプルでは、レベル{target.level}・{target.natureInput}の{target.pokemonInput}に、次の3条件を設定しています。</p>
      <ul>
        <li><strong>耐久：</strong>{defenceForm.attackerNatureInput}・A{defenceForm.attackerStatPoints.atk}の{defenceForm.attackerPokemonInput}のダブルダメージ「{defenceForm.moveInput}」を、{defenceForm.minSurvivalProbabilityPercent}%以上の確率で1回耐える。</li>
        <li><strong>火力：</strong>H{offenseForm.attackerStatPoints.hp}の{offenseForm.attackerPokemonInput}を、「{offenseForm.moveInput}」で確定1発（KO率{offenseForm.targetKoProbabilityPercent}%）。</li>
        <li><strong>素早さ：</strong>{speedForm.attackerNatureInput}・S{speedForm.attackerStatPoints.spe}の{speedForm.attackerPokemonInput}を確定抜き+{speedForm.speedRequiredOffset - 1}（相手の実数値+{speedForm.speedRequiredOffset}）。</li>
      </ul>
      <p>条件を満たす配分は1つで、<strong>{spread}</strong>です。合計{candidate.usedStatPointBudget} SPで、残りは{candidate.remainingStatPointBudget} SPです。</p>
      <p>この配分の耐える確率は{percent(defence.survivalProbability)}、倒せる確率は{percent(offense.koProbability)}。素早さは{speed.actualSpeed}で、相手の{speed.targetSpeed}より{speed.actualSpeed - speed.targetSpeed}高くなります。</p>
      <p>耐久条件の90%以上を満たしていますが、必ず耐えるわけではありません。「PASS」は設定した条件を満たしたことを表します。</p>
      <p>サンプルで候補を適用すると、この配分になります。自分で使うときは、入力条件も確認してください。</p>
      <p><a className="guide-inline-action" href="#guide-tutorial-root">この入力で計算を試す</a></p>
    </section>,
  );
}
