import { ChevronRightIcon } from "@radix-ui/react-icons";
import { battleAbilityCanonicalNames } from "../domain/allyAbilitySupport";
import { toEntityRef } from "../domain/model";
import { resolveEntity } from "../localization/resolver";
import { SelectField } from "./primitives";
import type { BattleAbilitiesForm } from "./battleAbilities";

const abilityLabel = (name: string) => toEntityRef(resolveEntity("ability", name), "ability")?.displayNameJa ?? name;
const options = [
  { value: "none", label: "なし" },
  ...battleAbilityCanonicalNames.map((name) => ({ value: name, label: abilityLabel(name) })),
];

export function BattleAbilitiesEditor({ value, ownerLabel, onChange }: {
  value: BattleAbilitiesForm;
  ownerLabel: string;
  onChange: (value: BattleAbilitiesForm) => void;
}) {
  const count = value.targetAlly.length + value.opponentAlly.length;
  return <details className="attack-advanced-settings battle-abilities-settings">
    <summary><ChevronRightIcon className="disclosure-chevron" aria-hidden="true" /><span>場の特性</span><span className="active-adjustment-empty">{count ? `設定${count}件` : "なし"}</span></summary>
    <div className="attack-advanced-content battle-abilities-content">
      {(["targetAlly", "opponentAlly"] as const).map((side) => {
        const label = side === "targetAlly" ? "調整対象の味方の特性" : "仮想敵の味方の特性";
        const names = value[side];
        const legacy = names.length > 1;
        return <div key={side}>
          <SelectField label={label} ariaLabel={`${ownerLabel} ${label}`}
            value={legacy ? "legacy" : names[0] ?? "none"}
            options={legacy ? [{ value: "legacy", label: `引継ぎ: ${names.map(abilityLabel).join("・")}` }, ...options] : options}
            onChange={(name) => { if (name !== "legacy") onChange({ ...value, [side]: name === "none" ? [] : [name] }); }} />
          {legacy ? <p className="battle-abilities-legacy">旧条件の複数特性を引き継いでいます。選び直すと1つになります。</p> : null}
        </div>;
      })}
    </div>
  </details>;
}
