import { useMemo } from "react";
import { getBuildDerivedStats } from "../search/bulkScore";
import { buildTargetBuildFromUi, type TargetFormState } from "../ui/defenceSearchUi";
import { findPokemonArtwork } from "../ui/pokemonArtwork";
import { resolveEntityWithCanonicalHint } from "../localization/resolver";
import { getPublicAssetUrl } from "../ui/publicAssetUrl";

const stats = [["hp", "H"], ["atk", "A"], ["def", "B"], ["spa", "C"], ["spd", "D"], ["spe", "S"]] as const;

export const getShareImportSummary = (target: TargetFormState) => {
  const artwork = findPokemonArtwork({ input: target.pokemonInput, canonicalName: target.pokemonCanonicalName });
  const resolved = resolveEntityWithCanonicalHint("pokemon", target.pokemonInput, target.pokemonCanonicalName);
  const name = artwork?.label ?? resolved.displayNameJa ?? target.pokemonInput;
  try {
    return { name, artwork, actualStats: getBuildDerivedStats(buildTargetBuildFromUi(target)) };
  } catch {
    return { name, artwork, actualStats: null };
  }
};

export function ShareImportSummary({ target, scenarioCount }: { target: TargetFormState; scenarioCount: number }) {
  const summary = useMemo(() => getShareImportSummary(target), [target]);
  return <section className="share-import-preview" aria-label="取り込む調整の配分">
    {summary.artwork ? <img className="share-import-artwork" src={summary.artwork.artworkUrl} alt="" width={72} height={72} /> : <span className="share-import-artwork share-import-artwork-placeholder" aria-hidden="true">?</span>}
    <div className="share-import-identity"><strong>{summary.name}</strong><span>/ {scenarioCount}シナリオ</span></div>
    <div className="share-import-stats-grid" role="group" aria-label="HABCDSのSPと実数値">
      {[stats.slice(0, 3), stats.slice(3)].map((group) => <table key={group[0][0]} className="share-import-stats" aria-label={`${group.map(([, label]) => label).join("")}のSPと実数値`}>
        <thead><tr>{group.map(([key, label]) => <th key={key} scope="col"><img className="stat-icon share-import-stat-icon" src={getPublicAssetUrl(`assets/stat-icons/${label}.svg`)} alt={label} /></th>)}</tr></thead>
        <tbody>
          <tr className="share-import-stat-points">{group.map(([key, label]) => <td key={key} aria-label={`${label} ${target.statPoints[key]}SP`}><span>{target.statPoints[key]}</span><small>SP</small></td>)}</tr>
          <tr className="share-import-actual-stats">{group.map(([key, label]) => <td key={key} aria-label={`${label} 実数値 ${summary.actualStats?.[key] ?? "表示できません"}`}>{summary.actualStats?.[key] ?? "—"}</td>)}</tr>
        </tbody>
      </table>)}
    </div>
    {!summary.actualStats ? <p className="share-import-preview-note" role="status">実数値を表示できません。読み込み後に入力内容を確認してください。</p> : null}
  </section>;
}
