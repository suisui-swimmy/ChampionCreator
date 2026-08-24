import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronRightIcon } from "@radix-ui/react-icons";
import { getPublicAssetUrl } from "../ui/publicAssetUrl";

export const allyAbilityLabels = [
  "わざわいのつるぎ",
  "わざわいのたま",
  "わざわいのおふだ",
  "わざわいのうつわ",
  "フラワーギフト",
  "バッテリー",
  "パワースポット",
  "はがねのせいしん",
  "フェアリーオーラ",
  "ダークオーラ",
  "オーラブレイク",
  "プラス",
  "マイナス",
  "フレンドガード",
] as const;

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
      <p>ダブルバトルでは、同じシナリオに味方を追加し、そのポケモンの特性による補正を計算へ含められます。</p>
      <p>ヘッダーを「ダブル」に切り替え、同じシナリオ内の「＋」から味方を追加して、ポケモンと特性を選択してください。</p>
      <p>「わざわいのつるぎ」「フェアリーオーラ」「フレンドガード」などに対応しています。</p>
      <p>対応している味方特性は、次のとおりです。</p>
      <Collapsible.Root className="guide-ability-disclosure">
        <Collapsible.Trigger className="guide-ability-disclosure-trigger" type="button">
          <ChevronRightIcon className="guide-disclosure-chevron" aria-hidden="true" />
          <span>対応している味方特性</span>
        </Collapsible.Trigger>
        <Collapsible.Content className="guide-ability-disclosure-content">
          <ul>
            {allyAbilityLabels.map((ability) => <li key={ability}>{ability}</li>)}
          </ul>
        </Collapsible.Content>
      </Collapsible.Root>
      <img
        className="guide-ally-ability-image"
        src={getPublicAssetUrl("assets/guide/double-battle-ally-abilities.png")}
        width="871"
        height="548"
        loading="lazy"
        decoding="async"
        alt="ダブルバトルの味方特性を設定した例"
      />
    </div>
  );
}
