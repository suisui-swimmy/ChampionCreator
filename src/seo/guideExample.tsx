import { renderToStaticMarkup } from "react-dom/server";
import tutorialPreset from "../guide/tutorial-preset.json";
import { parseBoxBackupDocument } from "../ui/boxStorage";
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
  const parsed = parseBoxBackupDocument(JSON.stringify(tutorialPreset));
  if (parsed.status !== "success") throw new Error("The guide example backup is invalid.");
  const payload = parsed.entries.find((entry) => entry.id === "default-example-mega-delphox")?.payload;
  if (!payload) throw new Error("The guide tutorial preset is missing.");
  const { target, scenarios } = payload;
  const input = buildIntegratedDefenceSearchInput(target, scenarios);
  const [candidate] = searchDefenceCandidates(input.build, input.scenarios, {
    maxResults: 1, minimumStatPoints: input.minimumStatPoints, searchStatKeys: input.searchStatKeys,
  });
  const offense = calculateOffenseAdjustmentsForCandidateRanking(target, scenarios).find((entry) => entry.result.passed);
  const speed = calculateSpeedAdjustmentsForCandidateRanking(target, scenarios).find((entry) => entry.result.passed);
  const defenceForm = scenarios.find((entry) => entry.adjustmentType === "defence")?.attacks[0];
  const offenseForm = scenarios.find((entry) => entry.adjustmentType === "offense")?.attacks[0];
  const speedForm = scenarios.find((entry) => entry.adjustmentType === "speed")?.attacks[0];
  if (!candidate?.passed || !offense || !speed || !defenceForm || !offenseForm || !speedForm) {
    throw new Error("The guide sample no longer satisfies all three adjustment conditions.");
  }
  return { target, candidate, offense: offense.result, speed: speed.result, defenceForm, offenseForm, speedForm };
}

export function renderGuideExample(): string {
  const { target, candidate, offense, speed, defenceForm, offenseForm, speedForm } = buildGuideExample();
  const spread = statKeys.map((key, index) => `${statLabels[index]}${candidate.appliedStatPoints[key]}`).join(" / ");
  const defence = candidate.scenarioResults[0];
  return renderToStaticMarkup(
    <section className="guide-section" id="calculation-example">
      <p className="guide-section-kicker">CALCULATION EXAMPLE</p>
      <h2>耐久・火力・素早さを同時に満たす計算例</h2>
      <p>上のサンプルでは、レベル{target.level}・{target.natureInput}の{target.pokemonInput}に、次の3条件を設定しています。</p>
      <ul>
        <li><strong>耐久：</strong>{defenceForm.attackerNatureInput}・A{defenceForm.attackerStatPoints.atk}の{defenceForm.attackerPokemonInput}の「{defenceForm.moveInput}」を、{defenceForm.minSurvivalProbabilityPercent}%以上の確率で1回耐える。</li>
        <li><strong>火力：</strong>H{offenseForm.attackerStatPoints.hp}・{offenseForm.attackerNatureInput}の{offenseForm.attackerPokemonInput}を、「{offenseForm.moveInput}」で{offenseForm.targetKoProbabilityPercent}%以上の確率で倒す。</li>
        <li><strong>素早さ：</strong>S{speedForm.attackerStatPoints.spe}・{speedForm.attackerNatureInput}の{speedForm.attackerPokemonInput}より速くする。</li>
      </ul>
      <p>特性・持ち物・テラスタル・天候などの追加補正は設定していません。個体値は31、相手もレベル50、ダブルバトルの条件です。</p>
      <h3>条件を満たす配分の例</h3>
      <p><strong>{spread}</strong>。合計{candidate.usedStatPointBudget} SPで、残りは{candidate.remainingStatPointBudget} SPです。</p>
      <p>この配分の耐える確率は{percent(defence.survivalProbability)}、倒せる確率は{percent(offense.koProbability)}。素早さは{speed.actualSpeed}で、相手の{speed.targetSpeed}を上回ります。</p>
      <p>ここでの「条件を満たす」は、指定した確率を満たすという意味です。毎回耐える・倒せることを要求する場合は100%を指定し、再計算してください。特性・持ち物・相手の配分などを変更すると結果も変わるので、実際に使う条件で確認しましょう。</p>
      <p><a className="guide-inline-action" href="#guide-tutorial-root">この入力で計算を試す</a></p>
    </section>,
  );
}
