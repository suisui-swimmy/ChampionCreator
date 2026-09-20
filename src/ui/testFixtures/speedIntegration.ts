import {
  createDefaultScenarioAttackForm,
  createDefaultTargetForm,
  type ScenarioFormState,
} from "../defenceSearchUi";

/** The reported S11 / actual 81 versus Farigiraf 80 reproduction. */
export const createTrickRoomFixture = (spe = 11) => {
  const zero = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const target = {
    ...createDefaultTargetForm(),
    pokemonInput: "ドドゲザン", natureInput: "いじっぱり",
    abilityInput: "まけんき", itemInput: "ヨプのみ",
    statPoints: { ...zero, spe },
  };
  const defence = {
    ...createDefaultScenarioAttackForm("def-a", "耐久調整A"),
    attackerPokemonInput: "オオニューラ", attackerNatureInput: "ようき",
    attackerAbilityInput: "かるわざ", attackerItemInput: "サイコシード",
    attackerStatPoints: { ...zero, atk: 32 }, moveInput: "インファイト",
    gameType: "doubles" as const,
  };
  const speed = {
    ...createDefaultScenarioAttackForm("speed-a", "素早さ調整A"),
    attackerPokemonInput: "リキキリン", attackerNatureInput: "ずぶとい",
    attackerAbilityInput: "テイルアーマー", attackerItemInput: "オボンのみ",
    attackerStatPoints: { ...zero }, gameType: "doubles" as const,
    speedOrderMode: "trick-room" as const,
  };
  const scenarios: ScenarioFormState[] = [
    { id: "defence", label: "シナリオ1", enabled: true, adjustmentType: "defence", attacks: [defence] },
    { id: "speed", label: "シナリオ2", enabled: true, adjustmentType: "speed", attacks: [speed] },
  ];
  return { target, scenarios, speed };
};
