import type { ScenarioAttackFormState, TargetFormState } from "../ui/defenceSearchUi";

// Wire-format defaults, frozen for probe v1 / condition schema 13.
// Never replace these with the app's evolving createDefault* helpers.
export const SHARE_TARGET_V1: TargetFormState = {
  pokemonInput: "メガマフォクシー", natureInput: "おくびょう", abilityInput: "", itemInput: "",
  teraTypeInput: "", teraEnabled: false, dmaxEnabled: false, level: 50, levelMode: "auto",
  statPoints: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
};

export const SHARE_ATTACK_V1: ScenarioAttackFormState = {
  id: "", label: "攻撃A", attackerPokemonInput: "ドドゲザン", attackerNatureInput: "いじっぱり",
  attackerAbilityInput: "", attackerItemInput: "", attackerTeraTypeInput: "",
  attackerTeraEnabled: false, attackerDmaxEnabled: false, attackerStatus: "none", defenderStatus: "none",
  attackerLevel: 50, attackerLevelMode: "auto",
  attackerStatPoints: { hp: 0, atk: 32, def: 0, spa: 32, spd: 0, spe: 0 },
  attackerBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  defenderBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  moveInput: "ふいうち", movePowerMode: "auto", movePowerValue: 0,
  beatUpParticipants: [], hpEvents: [], repeat: 1, requiredSurvivedHits: 1,
  minSurvivalProbabilityPercent: 100, targetKoProbabilityPercent: 100,
  gameType: "singles", weather: "none", terrain: "none", critical: false,
  reflect: false, lightScreen: false, auroraVeil: false, helpingHand: false, friendGuard: false,
  speedTargetMode: "opponent", speedComparison: "outspeed", speedRequiredOffset: 1,
  speedTargetValue: 0, speedTargetStatus: "none", speedTargetItemMultiplier: "auto",
  speedTargetAbilityMultiplier: "auto", speedTargetTailwind: false, speedOpponentTailwind: false,
  speedOrderMode: "normal", speedItemMultiplier: "auto", speedAbilityMultiplier: "auto", tailwind: false,
};

export const SHARE_SCENARIO_V1 = { label: "シナリオ1", enabled: true, adjustmentType: "defence" };
