import { getPublicAssetUrl } from "../ui/publicAssetUrl";

export function GuideAllyAbilityTip() {
  return (
    <div className="guide-tip guide-ally-ability-tip">
      <div className="guide-tip-heading">
        <img
          className="guide-tip-icon"
          src={getPublicAssetUrl("assets/guide/lightbulb.svg")}
          width="24"
          height="24"
          alt=""
          aria-hidden="true"
        />
        <strong>ダブルバトルの味方特性</strong>
      </div>
      <p>耐久・火力どちらも、ルールを「ダブル」にして、攻撃カードの「場の特性」を開きます。「調整対象の味方の特性」と「仮想敵の味方の特性」を選んでください。</p>
      <p>「＋」で追加した攻撃には直前の設定を引き継ぎます。途中で味方が交代・ひんしになる想定なら、その攻撃の設定を変更します。</p>
      <p>対応する特性と計算の条件は、<a href="https://github.com/suisui-swimmy/ChampionCreator#味方特性の対応範囲" target="_blank" rel="noreferrer">README</a>を参照してください。</p>
    </div>
  );
}
