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

export function BattleAbilitiesEditor({ value, ownerLabel, side, onChange }: {
  value: BattleAbilitiesForm;
  ownerLabel: string;
  side: keyof BattleAbilitiesForm;
  onChange: (value: BattleAbilitiesForm) => void;
}) {
  const label = side === "targetAlly" ? "調整対象の味方の特性" : "仮想敵の味方の特性";
  const names = value[side];
  const legacy = names.length > 1;
  return <div className="battle-abilities-content">
    <SelectField label="味方の特性" ariaLabel={`${ownerLabel} ${label}`}
      value={legacy ? "legacy" : names[0] ?? "none"}
      options={legacy ? [{ value: "legacy", label: `引継ぎ: ${names.map(abilityLabel).join("・")}` }, ...options] : options}
      onChange={(name) => { if (name !== "legacy") onChange({ ...value, [side]: name === "none" ? [] : [name] }); }} />
    {legacy ? <p className="battle-abilities-legacy">旧条件の複数特性を引き継いでいます。選び直すと1つになります。</p> : null}
  </div>;
}
