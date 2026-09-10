import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { formatLocalizedDamageDescription, ResultsPanel } from "../App";
import { calculateSmogonHit } from "../calc/smogonAdapter";
import type { EntityKind } from "../data/localizationTypes";
import { statPointTableToSmogonEvs } from "../domain/championsStats";
import { toEntityRef, type Build, type CandidateResult, type ScenarioHit } from "../domain/model";
import { resolveEntity } from "../localization/resolver";
import { createDefaultScenarioForms } from "./defenceSearchUi";

const ref = <K extends EntityKind>(kind: K, name: string) => {
  const entity = toEntityRef(resolveEntity(kind, name), kind);
  if (!entity) throw new Error(`Unresolved fixture: ${kind}:${name}`);
  return entity;
};
const zeroPoints = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
const makeBuild = (name: string, points: Partial<Build["evs"]> = {}, nature = "まじめ"): Build => ({
  id: name,
  pokemon: ref("pokemon", name),
  level: 50,
  nature: ref("nature", nature),
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  statPoints: { ...zeroPoints, ...points },
  evs: statPointTableToSmogonEvs({ ...zeroPoints, ...points }),
});
const attacker = makeBuild("メガリザードンY", { spa: 32 }, "ひかえめ");
const defender = makeBuild("ガブリアス", { hp: 20, spd: 12 }, "ようき");
const side = { reflect: false, lightScreen: false, auroraVeil: false, helpingHand: false };
const field = { gameType: "doubles", weather: "none", terrain: "none" } as const;
const calculate = (move: string, target = defender, changes: Partial<ScenarioHit> = {}) => calculateSmogonHit(
  target,
  {
    id: "hit",
    attacker,
    move: ref("move", move),
    repeat: 1,
    critical: false,
    attackerBoosts: {},
    defenderBoosts: {},
    attackerSide: side,
    defenderSide: side,
    ...changes,
  },
  field,
);
const format = (result: ReturnType<typeof calculate>) => formatLocalizedDamageDescription(result.description!);

describe("damage description stat display", () => {
  it("formats the two reported Heat Wave descriptions exactly without changing damage", () => {
    const lucario = makeBuild("メガルカリオZ", { hp: 20, def: 29, spe: 12 }, "おくびょう");
    lucario.ability = ref("ability", "はどうのぼうご");
    const first = calculate("ねっぷう", lucario, { defenderBoosts: { spd: 1 } });
    const second = calculate("ねっぷう", makeBuild("ガブリアス", {}, "ようき"), { attackerBoosts: { spa: 1 } });
    const before = structuredClone([first, second]);
    expect(format(first)).toBe("C32+ メガリザードンY ねっぷう → H20 / D0（Dランク+1） メガルカリオZ : 138-164 (83.6-99.3%) / 確定2発");
    expect(format(second)).toBe("C32+（Cランク+1） メガリザードンY ねっぷう → H0 / D0 ガブリアス : 66-78 (36-42.6%) / 確定3発");
    expect([first, second]).toEqual(before);
    expect(first.damageRange).toMatchObject({ min: 138, max: 164 });
    expect(second.damageRange).toMatchObject({ min: 66, max: 78 });
  });

  it.each([-6, -1, 0, 1, 6])("keeps physical and special investments separate from rank %s on either side", (rank) => {
    const suffix = (stat: string) => rank ? `（${stat}ランク${rank > 0 ? "+" : ""}${rank}）` : "";
    for (const [attackRank, defendRank] of [[rank, 0], [0, rank], [rank, rank]]) {
      const special = format(calculate("ねっぷう", defender, {
        attackerBoosts: { spa: attackRank }, defenderBoosts: { spd: defendRank },
      }));
      expect(special).toContain(`C32+${attackRank ? suffix("C") : ""} メガリザードンY`);
      expect(special).toContain(`H20 / D12${defendRank ? suffix("D") : ""} ガブリアス`);
      const physical = format(calculate("じしん", defender, {
        attacker: makeBuild("ガブリアス", { atk: 32 }, "いじっぱり"),
        attackerBoosts: { atk: attackRank }, defenderBoosts: { def: defendRank },
      }));
      expect(physical).toContain(`A32+${attackRank ? suffix("A") : ""} ガブリアス`);
      expect(physical).toContain(`H20 / B0${defendRank ? suffix("B") : ""} ガブリアス`);
    }
  });

  it.each([[50, 100], [100, 50], [73, 50], [75, 75], [5, 5], [50, 50], [100, 100]])(
    "converts investments at levels %s and %s with and without rank changes", (attackerLevel, defenderLevel) => {
      for (const rank of [0, 1]) {
        const result = calculate("ねっぷう", { ...defender, level: defenderLevel }, {
          attacker: { ...attacker, level: attackerLevel },
          attackerBoosts: { spa: rank }, defenderBoosts: { spd: rank },
        });
        const text = format(result);
        expect(text).toContain("C32+");
        expect(text).toContain("H20 / D12");
        expect(text).not.toMatch(/\b(?:252|156|92) [HABCDS]\b/);
        if (result.description!.includes("Lvl")) expect(text).toContain("Lv.");
        expect(text).not.toContain("Lvl");
      }
    },
  );

  it.each([
    "ちきゅうなげ", "ナイトヘッド", "りゅうのいかり", "ソニックブーム", "いのちがけ",
    "しぜんのいかり", "いかりのまえば", "カタストロフィ", "ガーディアン・デ・アローラ",
  ])("formats HP-only investment for %s without inventing attack or defence stats", (move) => {
    const text = format(calculate(move));
    expect(text).toContain(`メガリザードンY ${move} → H20 ガブリアス : `);
    expect(text).not.toMatch(/\b(?:C32|D12|156 H)\b/);
  });

  it.each(["メテオビーム", "エレクトロビーム"])("retains the engine's automatic boost for %s", (move) => {
    const text = format(calculate(move, makeBuild("カビゴン", { hp: 20, spd: 12 })));
    expect(text).toContain(`C32+（Cランク+1） メガリザードンY ${move} → H20 / D12 カビゴン`);
  });

  it("labels Body Press's B rank and Foul Play's defender-owned A investment and rank", () => {
    expect(format(calculate("ボディプレス", defender, {
      attacker: makeBuild("アーマーガア", { def: 32 }, "わんぱく"), attackerBoosts: { def: 2 },
    }))).toContain("B32+（Bランク+2） アーマーガア ボディプレス");
    for (const rank of [0, 2, -1]) {
      const text = format(calculate("イカサマ", makeBuild("ガブリアス", { hp: 12, atk: 20 }, "いじっぱり"), {
        attacker: makeBuild("ヤミラミ"), defenderBoosts: { atk: rank },
      }));
      const rankLabel = rank ? `・Aランク${rank > 0 ? "+" : ""}${rank}` : "";
      expect(text).toContain(`ヤミラミ イカサマ（受け側A20+${rankLabel}参照） → H12 / B0 ガブリアス`);
      expect(text).not.toContain("A20+ ヤミラミ");
    }
  });

  it("does not invent ranks ignored by a critical hit or Unaware", () => {
    const ignored = [
      calculate("ねっぷう", defender, { critical: true, attackerBoosts: { spa: -1 }, defenderBoosts: { spd: 1 } }),
      calculate("ねっぷう", { ...defender, ability: ref("ability", "てんねん") }, { attackerBoosts: { spa: 1 } }),
      calculate("ねっぷう", defender, { attacker: { ...attacker, ability: ref("ability", "てんねん") }, defenderBoosts: { spd: 1 } }),
    ];
    for (const result of ignored) {
      expect(format(result)).toContain("C32+");
      expect(format(result)).not.toContain("ランク");
    }
  });

  it("preserves colons in entity names and unknown result annotations", () => {
    const target = makeBuild("タイプ：ヌル", { hp: 20, spd: 12 });
    for (const rank of [0, 1]) {
      const result = calculate("ねっぷう", target, { defenderBoosts: { spd: rank } });
      const text = format(result);
      expect(text).toContain(`H20 / D12${rank ? "（Dランク+1）" : ""} タイプ：ヌル : `);
      expect(text).not.toContain("Type");
    }
    expect(format(calculate("すてみタックル", defender, { attacker: target }))).toContain("タイプ：ヌル すてみタックル");
    const unknown = "252 SpA Mew Psychic vs. 156 HP / 92 SpD Type: Null: 50-60 (20 - 24%) -- guaranteed 4HKO after future effect: unknown";
    expect(formatLocalizedDamageDescription(unknown)).toBe("C32 ミュウ サイコキネシス → H20 / D12 タイプ：ヌル : 50-60 (20-24%) -- guaranteed 4HKO after future effect: unknown");
  });

  it("keeps level, IV, move power and damage numbers out of SP conversion", () => {
    expect(formatLocalizedDamageDescription("+1 Lvl 73 252- SpA 0 IVs Mew Psychic (90 BP) vs. +2 Lvl 50 156 HP 0 IVs / 92+ SpD 0 IVs Type: Null: 156-252 (50 - 80%) -- guaranteed 2HKO"))
      .toBe("Lv.73 C32-（Cランク+1）（個体値0） ミュウ サイコキネシス (威力90) → Lv.50 H20（個体値0） / D12+（Dランク+2）（個体値0） タイプ：ヌル : 156-252 (50-80%) / 確定2発");
    expect(format(calculate("かみなり"))).toBe("メガリザードンY かみなり → ガブリアス : 0-0 (0-0%)");
  });

  it.each(["default", "mobile-inline"] as const)("uses the same corrected text in defence and offense candidate details (%s)", (displayMode) => {
    const hit = calculate("ねっぷう", defender, { attackerBoosts: { spa: 1 }, defenderBoosts: { spd: 1 } });
    const candidate: CandidateResult = {
      id: "candidate", rank: 1, candidate: { hp: 20, def: 0, spd: 12 },
      bulkScore: { overallBulk: 1, physicalBulk: 1, specialBulk: 1 },
      appliedStatPoints: { ...zeroPoints, hp: 20, spd: 12 }, appliedEvs: defender.evs,
      usedStatPointBudget: 32, remainingStatPointBudget: 34, usedEvBudget: 248, remainingEvBudget: 262,
      passed: true, bottleneckLabel: "シナリオ1",
      scenarioResults: [{
        scenarioId: "defence", passed: true, survivalProbability: 1, requiredSurvivedHits: 1,
        minSurvivalProbability: 1, bottleneckLabel: "シナリオ1", hitEvaluations: [hit],
      }],
    };
    const [scenario] = createDefaultScenarioForms();
    const html = renderToStaticMarkup(<ResultsPanel
      candidates={[candidate]} selectedCandidateId="candidate" appliedCandidateId={null}
      scenarios={[{ ...scenario, id: "defence" }]} speedResults={[]}
      offenseResults={[{
        id: "offense", scenarioId: "offense", scenarioLabel: "火力", attackId: "hit", attackLabel: "火力",
        result: {
          id: "line", status: "pass", passed: true, label: "Cライン", owner: "attacker", stat: "spa",
          role: "damage", canApply: false, requiredStatPoints: 32, actualStat: 232,
          koProbability: 1, targetKoProbability: 1, hpEventEvaluations: [], reason: "PASS",
          damageRange: hit.damageRange, description: hit.description, movePower: hit.movePower,
        },
      }]}
      strictestFailureLabel={null} targetLabel="ガブリアス" resultAlertMessage={null}
      status="complete" onSelectCandidate={() => undefined} onApplyCandidate={() => undefined}
      {...(displayMode === "mobile-inline" ? { displayMode } : {})}
    />);
    const text = "威力 95 / C32+（Cランク+1） メガリザードンY ねっぷう → H20 / D12（Dランク+1） ガブリアス";
    expect(html.split(text)).toHaveLength(3);
  });
});
