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
      <p>「わざわいのつるぎ」「フェアリーオーラ」「フレンドガード」などは、ダブルバトルを選択し、同じシナリオ内にその特性を持つポケモンを追加すると反映できます。</p>
      <Collapsible.Root className="guide-ability-disclosure">
        <Collapsible.Trigger className="guide-ability-disclosure-trigger" type="button">
          <ChevronRightIcon className="guide-disclosure-chevron" aria-hidden="true" />
          <span>対象の特性</span>
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
        alt="ダブルバトルのシナリオで、味方ポケモンの特性とダブルルールを設定した例"
      />
    </div>
  );
}
