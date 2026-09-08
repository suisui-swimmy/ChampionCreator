import { useId, useState } from "react";
import { TypeChip } from "./TypeChip";
import { Button, SelectField, UiPopover } from "./primitives";
import { getPublicAssetUrl } from "./publicAssetUrl";
import {
  addedPokemonTypeOptions,
  createPokemonTypeOverride,
  getPokemonBaseTypes,
  getPokemonTypeLabel,
  getPokemonTypeSelectionValue,
  pokemonTypeOptions,
  resolvePokemonTypeOverride,
  updatePokemonTypeOverride,
  type PokemonTypeOverrideForm,
} from "./pokemonTypes";

type Props = {
  ownerLabel: string;
  pokemonInput: string;
  pokemonCanonicalName?: string;
  value?: PokemonTypeOverrideForm;
  teraEnabled: boolean;
  onChange: (value: PokemonTypeOverrideForm | undefined) => void;
};

export function PokemonTypeField({ ownerLabel, pokemonInput, pokemonCanonicalName, value, teraEnabled, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const descriptionId = useId();
  const baseTypes = getPokemonBaseTypes(pokemonInput, pokemonCanonicalName);
  const locked = value === undefined;
  let customTypes: ReturnType<typeof resolvePokemonTypeOverride>;
  let error: string | undefined;
  try {
    customTypes = resolvePokemonTypeOverride(value);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "タイプ指定が不正です";
  }
  const types = customTypes?.types.map((type) => type.canonicalName) ?? (locked ? baseTypes : []);
  const addedType = customTypes?.addedType?.canonicalName;
  const displayedTypes = [...types, ...(addedType ? [addedType] : [])];
  const typeLabel = displayedTypes.map(getPokemonTypeLabel).join("・");
  const unlock = () => {
    const next = createPokemonTypeOverride(pokemonInput, pokemonCanonicalName);
    if (next) {
      onChange(next);
      setOpen(true);
    }
  };
  const reset = () => { onChange(undefined); setOpen(false); };
  const edit = (field: keyof PokemonTypeOverrideForm, next: string) => {
    if (value) onChange(updatePokemonTypeOverride(value, field, next === "none" ? "" : next));
  };
  const normalOptions = pokemonTypeOptions.map((option) => ({
    value: option.value,
    label: <TypeChip canonicalName={option.canonicalName} label={option.displayNameJa} />,
  }));
  const selectedValue = (input: string | undefined) => {
    if (!input) return "none";
    return getPokemonTypeSelectionValue(input);
  };

  return (
    <UiPopover.Root open={open} onOpenChange={setOpen}>
      <UiPopover.Anchor asChild>
        <div className={`pokemon-type-field${locked ? "" : " is-manual"}${error ? " is-invalid" : ""}`}>
          <UiPopover.Trigger asChild>
            <button
              className="pokemon-type-summary"
              type="button"
              disabled={locked && !baseTypes.length}
              aria-label={`${ownerLabel}の通常タイプ: ${typeLabel || "未選択"}。${locked ? "自動設定を確認" : "手動設定を編集"}${addedType && teraEnabled ? "。追加タイプはテラスタル中無効" : ""}`}
            >
              {displayedTypes.length ? displayedTypes.map((type, index) => (
                <span
                  className={`pokemon-type-icon-slot${index === types.length ? " is-added" : ""}${index === types.length && teraEnabled ? " is-inactive" : ""}`}
                  key={type}
                  data-type={type}
                >
                  <img className="pokemon-type-icon" src={getPublicAssetUrl(`assets/types/${type.toLowerCase()}.png`)} alt="" aria-hidden="true" width="20" height="20" />
                  {index === types.length ? <span className="pokemon-type-added-marker" aria-hidden="true" /> : null}
                </span>
              )) : <span>{error ? "タイプ未解決" : "タイプ"}</span>}
            </button>
          </UiPopover.Trigger>
          <button
            className="pokemon-type-lock"
            type="button"
            disabled={locked && !baseTypes.length}
            aria-label={locked ? `${ownerLabel}のタイプのロックを解除` : `${ownerLabel}のタイプを自動設定に戻してロック`}
            onClick={locked ? unlock : reset}
          >
            <img src={getPublicAssetUrl(`assets/ui/${locked ? "lock" : "lock-open"}.svg`)} alt="" aria-hidden="true" width="16" height="16" />
          </button>
        </div>
      </UiPopover.Anchor>
      <UiPopover.Portal>
        <UiPopover.Content className="pokemon-type-popover" side="bottom" align="end" sideOffset={6} collisionPadding={8} aria-label={`${ownerLabel}の通常タイプ`} aria-describedby={descriptionId}>
          <div className="pokemon-type-popover-heading"><strong>通常タイプ</strong><UiPopover.Close asChild><Button size="icon" aria-label="タイプ設定を閉じる"><img src={getPublicAssetUrl("assets/ui/close.svg")} alt="" width="20" height="20" /></Button></UiPopover.Close></div>
          <p className="pokemon-type-note" id={descriptionId}>{locked ? "ポケモン・フォームに合わせて自動設定します。" : "変更後のタイプを指定します。技の成功・失敗は自動判定しません。"}</p>
          {error ? <p className="pokemon-type-error" role="alert">{error}</p> : null}
          {locked ? <div className="pokemon-type-full-chips">{baseTypes.map((type) => <TypeChip key={type} canonicalName={type} label={getPokemonTypeLabel(type)} />)}</div> : (
            <div className="pokemon-type-edit-fields">
              <SelectField contentClassName="pokemon-type-select-content" label="タイプ1" value={selectedValue(value.type1Input)} options={normalOptions} onChange={(next) => edit("type1Input", next)} />
              <SelectField contentClassName="pokemon-type-select-content" label="タイプ2" value={selectedValue(value.type2Input)} options={[{ value: "none", label: "なし" }, ...normalOptions]} onChange={(next) => edit("type2Input", next)} />
              <SelectField contentClassName="pokemon-type-select-content" className="pokemon-type-addition" label="追加タイプ" value={selectedValue(value.addedTypeInput)} options={[{ value: "none", label: "なし" }, ...addedPokemonTypeOptions.filter((option) => !types.includes(option.canonicalName)).map((option) => ({ value: option.value, label: <TypeChip canonicalName={option.canonicalName} label={option.displayNameJa} /> }))]} onChange={(next) => edit("addedTypeInput", next)} />
              {teraEnabled ? <p className="pokemon-type-note">テラスタル中は追加タイプを計算に使いません。指定は保持されます。</p> : null}
            </div>
          )}
          <div className="pokemon-type-actions"><Button onClick={locked ? unlock : reset} disabled={locked && !baseTypes.length}>{locked ? "ロックを解除" : "元のタイプに戻す"}</Button><UiPopover.Close asChild><Button>完了</Button></UiPopover.Close></div>
        </UiPopover.Content>
      </UiPopover.Portal>
    </UiPopover.Root>
  );
}
