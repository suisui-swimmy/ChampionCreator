import type { MoveCategory, StatKey, SupportStatus, VersionedPayload } from "../domain/model";

export type UiOptionKind =
  | "pokemon-options"
  | "move-options"
  | "ability-options"
  | "item-options"
  | "nature-options"
  | "type-options";

export type BattleTypeName =
  | "Bug"
  | "Dark"
  | "Dragon"
  | "Electric"
  | "Fairy"
  | "Fighting"
  | "Fire"
  | "Flying"
  | "Ghost"
  | "Grass"
  | "Ground"
  | "Ice"
  | "Normal"
  | "Poison"
  | "Psychic"
  | "Rock"
  | "Steel"
  | "Stellar"
  | "Water"
  | "???";

export interface UiOptionFallback {
  from?: string;
  reason: string;
  nameSourceStatus?: SupportStatus;
  assetSourceStatus?: SupportStatus;
}

export interface UiOptionBase {
  id: string;
  label: string;
  showdownName: string;
  searchText: string;
  sourceStatus?: SupportStatus;
  fallback?: UiOptionFallback;
  tags?: string[];
}

export interface UiOptionPayload<TKind extends UiOptionKind, TEntry extends UiOptionBase>
  extends VersionedPayload {
  source: Record<string, string | number | boolean>;
  generatedBy: string;
  kind: TKind;
  entries: TEntry[];
  summary: Record<string, number | string | boolean>;
}

export interface PokemonOptionEntry extends UiOptionBase {
  types: BattleTypeName[];
  artwork?: string;
}

export type MoveOptionTag =
  | "contact"
  | "critical"
  | "drain"
  | "fixed-damage"
  | "max-move"
  | "multi-hit"
  | "priority"
  | "recoil"
  | "spread"
  | "status"
  | "z-move";

export interface MoveOptionEntry extends UiOptionBase {
  type: BattleTypeName;
  category: MoveCategory;
  basePower?: number;
  priority?: number;
  target?: string;
  tags?: MoveOptionTag[];
  overrideOffensiveStat?: StatKey;
  overrideDefensiveStat?: StatKey;
}

export type AbilityOptionTag =
  | "damage-modifier"
  | "field-modifier"
  | "form-change"
  | "immunity"
  | "manual-review"
  | "stat-modifier"
  | "weather-modifier";

export interface AbilityOptionEntry extends UiOptionBase {
  tags?: AbilityOptionTag[];
}

export type ItemOptionTag =
  | "berry"
  | "choice"
  | "damage-modifier"
  | "eviolite-like"
  | "form-change"
  | "mega-stone"
  | "manual-review"
  | "plate"
  | "stat-modifier"
  | "type-boost";

export interface ItemOptionEntry extends UiOptionBase {
  tags?: ItemOptionTag[];
  megaStone?: {
    baseSpecies: string;
    megaSpecies: string;
  };
  naturalGift?: {
    type: BattleTypeName;
    basePower: number;
  };
}

export interface NatureOptionEntry extends UiOptionBase {
  plus?: StatKey;
  minus?: StatKey;
}

export interface TypeOptionEntry extends UiOptionBase {
  type: BattleTypeName;
  color: string;
}

export type PokemonOptionsPayload = UiOptionPayload<"pokemon-options", PokemonOptionEntry>;
export type MoveOptionsPayload = UiOptionPayload<"move-options", MoveOptionEntry>;
export type AbilityOptionsPayload = UiOptionPayload<"ability-options", AbilityOptionEntry>;
export type ItemOptionsPayload = UiOptionPayload<"item-options", ItemOptionEntry>;
export type NatureOptionsPayload = UiOptionPayload<"nature-options", NatureOptionEntry>;
export type TypeOptionsPayload = UiOptionPayload<"type-options", TypeOptionEntry>;
