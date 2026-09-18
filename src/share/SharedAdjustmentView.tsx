import { useEffect, useState } from "react";
import { appVersionInfo, formatAppVersionLabel } from "../appVersion";
import { resolveEntityWithCanonicalHint } from "../localization/resolver";
import type { EntityKind } from "../data/localizationTypes";
import type { ScenarioAttackFormState, ScenarioFormState, TargetFormState } from "../ui/defenceSearchUi";
import type { StatTable } from "../domain/model";
import { getHpEventRuleDefinition } from "../calc/hpEventRules";
import { findPokemonArtwork } from "../ui/pokemonArtwork";
import { getPublicAssetUrl } from "../ui/publicAssetUrl";
import { getShareImportHref, readSharedAdjustmentHash } from "./sharedAdjustment";
import type { SharedAdjustment } from "./urlShareCodec";
import type { SharedEvaluation } from "./evaluateSharedAdjustment";
import { startSharedEvaluation } from "./sharedEvaluationClient";

const statNames = [["hp", "H"], ["atk", "A"], ["def", "B"], ["spa", "C"], ["spd", "D"], ["spe", "S"]] as const;
const types = { defence: "耐久", offense: "火力", speed: "素早さ" };
const statusLabels = { none: "なし", brn: "やけど", psn: "どく", tox: "もうどく", par: "まひ", slp: "ねむり", frz: "こおり" };
const weatherLabels = { none: "なし", sun: "晴れ", rain: "雨", sand: "砂", snow: "雪" };
const terrainLabels = { none: "なし", electric: "エレキ", grassy: "グラス", misty: "ミスト", psychic: "サイコ" };
const display = (kind: EntityKind, input: string, hint?: string): string => {
  if (!input) return "なし";
  return resolveEntityWithCanonicalHint(kind, input, hint).displayNameJa ?? input;
};
const spText = (stats: StatTable): string => statNames.map(([key, name]) => `${name}${stats[key]}`).join(" / ");
const boostText = (boosts: Partial<StatTable>): string => statNames.filter(([key]) => boosts[key]).map(([key, name]) => `${name}${boosts[key]! > 0 ? "+" : ""}${boosts[key]}`).join(" / ") || "なし";

function SharedTarget({ target, stats }: { target: TargetFormState; stats?: StatTable | null }) {
  const artwork = findPokemonArtwork({ input: target.pokemonInput, canonicalName: target.pokemonCanonicalName });
  return <section className="shared-target" aria-label="共有された配分">
    <div className="shared-target-heading">{artwork ? <img src={artwork.artworkUrl} alt="" width={72} height={72} /> : null}<div><h1>{display("pokemon", target.pokemonInput, target.pokemonCanonicalName)}</h1><p>Lv.{target.level} / {display("nature", target.natureInput)}</p><p>{display("ability", target.abilityInput)} / {display("item", target.itemInput)}</p></div></div>
    <dl className="shared-stat-grid">{statNames.map(([key, name]) => <div key={key}><dt style={{ color: `var(--${key})` }}>{name}</dt><dd>{target.statPoints[key]}<span>SP</span></dd><dd className="shared-actual-stat">{stats?.[key] ?? "—"}</dd></div>)}</dl>
    <p className="share-muted">使用SP {Object.values(target.statPoints).reduce((sum, n) => sum + n, 0)} / 66・下段は実数値</p>
    {target.teraEnabled ? <p>テラスタイプ：{display("type", target.teraTypeInput)}</p> : null}
    {target.dmaxEnabled ? <p>ダイマックスあり</p> : null}
    {target.typeOverride ? <p>通常タイプ：{[target.typeOverride.type1Input, target.typeOverride.type2Input].filter(Boolean).map((name) => display("type", name)).join(" / ")}{target.typeOverride.addedTypeInput ? `・追加 ${display("type", target.typeOverride.addedTypeInput)}` : ""}</p> : null}
    {Object.values(target.boosts).some(Boolean) ? <p>ランク：{boostText(target.boosts)}</p> : null}
  </section>;
}

function AttackDetails({ attack, scenario }: { attack: ScenarioAttackFormState; scenario: ScenarioFormState }) {
  const flags = ([['critical', '急所'], ['reflect', 'リフレクター'], ['lightScreen', 'ひかりのかべ'], ['auroraVeil', 'オーロラベール'], ['helpingHand', 'てだすけ'], ['friendGuard', 'フレンドガード']] as const).filter(([key]) => attack[key]).map(([, label]) => label);
  return <div className="shared-attack">
    <h3>{attack.label}：{scenario.adjustmentType === "speed" ? "素早さ条件" : display("move", attack.moveInput) === "なし" ? "技が未入力" : display("move", attack.moveInput)}</h3>
    <p>{scenario.adjustmentType === "speed" && attack.speedTargetMode === "manual" ? `任意S値 ${attack.speedTargetValue}` : `${display("pokemon", attack.attackerPokemonInput, attack.attackerPokemonCanonicalName)} / Lv.${attack.attackerLevel} / ${display("nature", attack.attackerNatureInput)}`}</p>
    {!(scenario.adjustmentType === "speed" && attack.speedTargetMode === "manual") ? <><p>{display("ability", attack.attackerAbilityInput)} / {display("item", attack.attackerItemInput)}</p><p className="share-muted">相手SP：{spText(attack.attackerStatPoints)}</p></> : null}
    <p>{attack.gameType === "doubles" ? "ダブル" : "シングル"} / 天候：{weatherLabels[attack.weather]} / フィールド：{terrainLabels[attack.terrain]}</p>
    {scenario.adjustmentType === "defence" ? <p>{attack.repeat}回の攻撃 / {attack.requiredSurvivedHits}回耐える / 必要生存率 {attack.minSurvivalProbabilityPercent}%</p> : null}
    {scenario.adjustmentType === "offense" ? <p>必要KO率 {attack.targetKoProbabilityPercent}%</p> : null}
    {scenario.adjustmentType === "speed" ? <>
      <p>{attack.speedOrderMode === "trick-room" ? "トリックルーム" : "通常の行動順"} / {attack.speedComparison === "tie" ? "同速以上" : "抜く"}{attack.speedTargetMode !== "manual" ? ` / 実数値差 ${attack.speedRequiredOffset}` : ""}</p>
      <p>こちら：{statusLabels[attack.speedTargetStatus]} / おいかぜ{attack.speedTargetTailwind ? "あり" : "なし"} / 道具倍率 {attack.speedTargetItemMultiplier === "auto" ? "自動" : attack.speedTargetItemMultiplier} / 特性倍率 {attack.speedTargetAbilityMultiplier === "auto" ? "自動" : attack.speedTargetAbilityMultiplier}</p>
      {attack.speedTargetMode !== "manual" ? <p>相手：{statusLabels[attack.attackerStatus]} / おいかぜ{attack.speedOpponentTailwind ? "あり" : "なし"} / 道具倍率 {attack.speedItemMultiplier === "auto" ? "自動" : attack.speedItemMultiplier} / 特性倍率 {attack.speedAbilityMultiplier === "auto" ? "自動" : attack.speedAbilityMultiplier}</p> : null}
    </> : <>
      {attack.attackerStatus !== "none" || attack.defenderStatus !== "none" ? <p>仮想敵：{statusLabels[attack.attackerStatus]} / 調整対象：{statusLabels[attack.defenderStatus]}</p> : null}
      {flags.length ? <p>{flags.join(" / ")}</p> : null}
      {attack.movePowerMode !== "auto" ? <p>技の威力：{attack.movePowerValue}（{attack.movePowerMode === "manual" ? "任意指定" : "条件指定"}）</p> : null}
    </>}
    {Object.values(attack.attackerBoosts).some(Boolean) ? <p>相手ランク：{boostText(attack.attackerBoosts)}</p> : null}
    {Object.values(attack.defenderBoosts).some(Boolean) ? <p>調整対象の攻撃別ランク：{boostText(attack.defenderBoosts)}</p> : null}
    {attack.attackerTeraEnabled ? <p>相手テラスタイプ：{display("type", attack.attackerTeraTypeInput)}</p> : null}
    {attack.attackerDmaxEnabled ? <p>相手ダイマックスあり</p> : null}
    {attack.attackerTypeOverride ? <p>相手通常タイプ：{[attack.attackerTypeOverride.type1Input, attack.attackerTypeOverride.type2Input].filter(Boolean).map((name) => display("type", name)).join(" / ")}{attack.attackerTypeOverride.addedTypeInput ? `・追加 ${display("type", attack.attackerTypeOverride.addedTypeInput)}` : ""}</p> : null}
    {attack.beatUpParticipants.length ? <ol aria-label="ふくろだたきの参加順">{attack.beatUpParticipants.map((slot) => <li key={slot.id}>{slot.source === "attacker" ? "使用者" : display("pokemon", slot.pokemonInput)} / 威力 {slot.powerMode === "auto" ? "自動" : slot.powerValue}</li>)}</ol> : null}
    {attack.hpEvents.length ? <ol aria-label="HP効果">{attack.hpEvents.map((event) => <li key={event.id}>{getHpEventRuleDefinition(event.effectId)?.label ?? "未対応のHP効果"}{event.toxicStage !== undefined ? `（${event.toxicStage}段階）` : ""}{event.spikesLayers !== undefined ? `（${event.spikesLayers}層）` : ""}{event.enabled ? "" : "・無効"}</li>)}</ol> : null}
  </div>;
}

export function SharedAdjustmentContent({ shared, evaluation, evaluationError }: { shared: SharedAdjustment; evaluation: SharedEvaluation | null; evaluationError: string }) {
  return <>
    <SharedTarget target={shared.document.target} stats={evaluation?.stats} />
    <p className="share-muted">このSP配分での現在の計算結果です。</p>
    {shared.provenance.calc !== appVersionInfo.smogonCalcVersion || shared.provenance.app !== appVersionInfo.appVersion ? <p className="share-warning">共有時とアプリのバージョンが異なります。計算結果が共有時と変わる場合があります。</p> : null}
    {evaluationError || evaluation?.targetError ? <p role="alert">{evaluationError || evaluation?.targetError}</p> : !evaluation ? <p role="status">条件を再評価しています…</p> : null}
    <section className="shared-scenarios" aria-label="共有されたシナリオ">
      {shared.document.scenarios.length === 0 ? <p>シナリオはありません。</p> : shared.document.scenarios.map((scenario) => {
        const results = evaluation?.conditions.filter((result) => result.scenarioId === scenario.id) ?? [];
        const state = !scenario.enabled ? "disabled" : results.some((r) => r.state === "error") ? "error" : results.some((r) => r.state === "fail") ? "fail" : results.length ? "pass" : "pending";
        return <details key={scenario.id} className={`shared-scenario shared-scenario-${state}`}>
          <summary><span>{types[scenario.adjustmentType]}・{scenario.label}</span><strong className={`shared-status shared-status-${state}`}>{({ disabled: "無効", error: "計算できません", fail: "未達", pass: "条件を満たす", pending: "確認中" })[state]}</strong></summary>
          <div className="shared-scenario-body">{results.map((result, i) => <p className={`shared-evaluation shared-status-${result.state}`} key={i}>{result.attackId ? `${scenario.attacks.find((a) => a.id === result.attackId)?.label ?? "条件"}：` : ""}{result.text}</p>)}{scenario.attacks.map((attack) => <AttackDetails key={attack.id} attack={attack} scenario={scenario} />)}</div>
        </details>;
      })}
    </section>
  </>;
}

export function SharedAdjustmentView() {
  const [href, setHref] = useState(() => window.location.href);
  const [shared, setShared] = useState<SharedAdjustment | null>(null);
  const [error, setError] = useState("");
  const [evaluation, setEvaluation] = useState<SharedEvaluation | null>(null);
  const [evaluationError, setEvaluationError] = useState("");
  useEffect(() => { const changed = () => setHref(window.location.href); window.addEventListener("hashchange", changed); window.addEventListener("popstate", changed); return () => { window.removeEventListener("hashchange", changed); window.removeEventListener("popstate", changed); }; }, []);
  useEffect(() => {
    let active = true;
    let stop: (() => void) | undefined;
    setShared(null); setError(""); setEvaluation(null); setEvaluationError("");
    readSharedAdjustmentHash(new URL(href).hash).then((next) => {
      if (!active) return;
      setShared(next);
      try { stop = startSharedEvaluation(next.document, (value) => { if (active) setEvaluation(value); }, (message) => { if (active) setEvaluationError(message); }); }
      catch { setEvaluationError("計算処理を開始できませんでした。「この調整を使う」から確認できます。"); }
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "共有データを読み込めませんでした"); });
    return () => { active = false; stop?.(); };
  }, [href]);
  return <main className="shared-page">
    <header className="shared-page-header"><a href="../" aria-label="ChampionCreatorを開く"><img src={getPublicAssetUrl("assets/brand/championcreator-title.svg")} alt="ChampionCreator" /></a><span>共有された調整</span></header>
    {error ? <section role="alert" className="shared-target"><h1>共有内容を読み込めません</h1><p>{error}</p><a className="share-action-link" href="../">CCを開く</a></section> : !shared ? <p role="status">共有内容を読み込んでいます…</p> : <>
      <SharedAdjustmentContent shared={shared} evaluation={evaluation} evaluationError={evaluationError} />
      <div className="shared-import-actions"><a className="share-use-link" href={getShareImportHref(href)}>この調整を使う</a><p className="share-muted">読み込み先は次の画面で選べます。</p></div>
      {shared.provenance.app !== appVersionInfo.appVersion || shared.provenance.calc !== appVersionInfo.smogonCalcVersion ? <p className="share-muted shared-provenance">共有時 app v{shared.provenance.app} / calc {shared.provenance.calc}</p> : null}
    </>}
    <footer className="shared-footer">{formatAppVersionLabel()}</footer>
  </main>;
}
