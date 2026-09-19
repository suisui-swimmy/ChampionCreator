import type { ShareStateDocument } from "../../ui/shareState";
import example from "./example.v1.json";

// Frozen test data: app presets and evolving defaults must not rewrite the
// expected contents of existing s1 links. This module is only imported by tests.
export const SHARE_TEST_CASES = [
  { id: "example-v1", label: "調整例", description: "メガリザードンY・耐久／火力／素早さ", count: 3, attacks: 1, noise: 0 },
  { id: "ten-v1", label: "10シナリオ", description: "相手・技・場の条件を変えた試験データ", count: 10, attacks: 1, noise: 0 },
  { id: "twenty-v1", label: "20シナリオ", description: "有効／無効・複数の条件を含む試験データ", count: 20, attacks: 1, noise: 0 },
  { id: "sixty-v1", label: "60攻撃", description: "20シナリオに3攻撃ずつ設定", count: 20, attacks: 3, noise: 0 },
  { id: "long3-v1", label: "長さ試験・約3,000文字", description: "異なる長いラベルを含む試験データ", count: 13, attacks: 1, noise: 100 },
  { id: "long4-v1", label: "長さ試験・約4,000文字", description: "異なる長いラベルを含む試験データ", count: 20, attacks: 1, noise: 100 },
  { id: "long8-v1", label: "長さ試験・約8,000文字", description: "上限を探すための大きな試験データ", count: 51, attacks: 1, noise: 100 },
] as const;

export type ShareTestCase = typeof SHARE_TEST_CASES[number];
const opponents = [
  ["ガブリアス", "Garchomp", "じしん"], ["カイリュー", "Dragonite", "しんそく"],
  ["メガリザードンY", "Charizard-Mega-Y", "ねっぷう"], ["イダイトウ オスのすがた", "Basculegion", "ウェーブタックル"],
  ["ゲンガー", "Gengar", "シャドーボール"], ["メガサーナイト", "Gardevoir-Mega", "ハイパーボイス"],
  ["バンギラス", "Tyranitar", "いわなだれ"], ["カビゴン", "Snorlax", "のしかかり"],
  ["ハッサム", "Scizor", "バレットパンチ"], ["ニンフィア", "Sylveon", "ムーンフォース"],
] as const;

const variedLabel = (index: number, length: number): string => {
  let seed = (index + 1) * 7919;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  return Array.from({ length }, () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return alphabet[(seed >>> 0) % alphabet.length];
  }).join("");
};

export const createShareTestDocument = (fixture: ShareTestCase): ShareStateDocument => {
  const document = structuredClone(example) as ShareStateDocument;
  if (fixture.id === "example-v1") return document;
  document.scenarios = Array.from({ length: fixture.count }, (_,i) => {
    const scenario = structuredClone(document.scenarios[i % 3]);
    scenario.id = `test-s-${i}`;
    scenario.label = fixture.noise ? `試験${i + 1} ${variedLabel(i, fixture.noise)}` : `${opponents[i % 10][0]}への調整${i + 1}`;
    scenario.enabled = i % 7 !== 6;
    scenario.attacks = Array.from({ length: fixture.attacks }, (_, j) => {
      const attack = structuredClone(scenario.attacks[0]);
      const [name, canonical, move] = opponents[(i + j) % 10];
      return {
        ...attack, id: `test-a-${i}-${j}`, label: `攻撃${String.fromCharCode(65 + j)}`,
        attackerPokemonInput: name, attackerPokemonCanonicalName: canonical, moveInput: move,
        attackerStatPoints: { hp: i % 3 * 2, atk: 32, def: i % 2, spa: 0, spd: i % 2, spe: 26 },
        attackerBoosts: { ...attack.attackerBoosts, atk: i % 4 },
        weather: (["none", "sun", "rain", "sand"] as const)[i % 4],
        critical: i % 4 === 0, helpingHand: i % 3 === 0,
        hpEvents: i % 4 === 0 ? [{ id: `test-hp-${i}-${j}`, effectId: "life-orb-recoil", enabled: true }] : [],
      };
    });
    return scenario;
  });
  return document;
};
