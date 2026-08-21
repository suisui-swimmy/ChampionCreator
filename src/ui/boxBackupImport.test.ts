import { describe, expect, it } from "vitest";
import {
  createBoxEntryFromState,
  type BoxEntry,
} from "./boxStorage";
import {
  createDefaultScenarioForms,
  createDefaultTargetForm,
} from "./defenceSearchUi";
import {
  createEnemyBoxEntryFromScenarios,
  type EnemyBoxEntry,
} from "./enemyBoxStorage";
import {
  planBoxBackupImport,
  planBoxBackupMerge,
  planBoxBackupReplace,
  planEnemyBoxBackupImport,
  planEnemyBoxBackupMerge,
  planEnemyBoxBackupReplace,
} from "./boxBackupImport";

const targetEntry = (id: string, pokemonInput = "メガマフォクシー"): BoxEntry => (
  createBoxEntryFromState(
    { ...createDefaultTargetForm(), pokemonInput },
    createDefaultScenarioForms(),
    { id, now: "2026-08-21T00:00:00.000Z" },
  )
);

const enemyEntry = (id: string, moveInput = "じしん"): EnemyBoxEntry => {
  const scenarios = createDefaultScenarioForms().map((scenario, scenarioIndex) => scenarioIndex === 0
    ? {
        ...scenario,
        attacks: scenario.attacks.map((attack, attackIndex) => attackIndex === 0
          ? { ...attack, moveInput }
          : attack),
      }
    : scenario);
  return createEnemyBoxEntryFromScenarios(scenarios, {
    id,
    now: "2026-08-21T00:00:00.000Z",
  });
};

describe("boxBackupImport", () => {
  it("merges target entries without overwriting conflicts and is retry-safe", () => {
    const current = [targetEntry("same"), targetEntry("keep", "メガゲンガー")];
    const importedSame = targetEntry("same");
    const importedNew = targetEntry("new", "ハバタクカミ");
    const importedConflict = targetEntry("same", "サーフゴー");

    const first = planBoxBackupMerge(current, [importedSame, importedNew, importedConflict]);

    expect(first.entries).toHaveLength(4);
    expect(first.entries[0]).toEqual(current[0]);
    expect(first.entries[1]).toEqual(current[1]);
    expect(first.entries[2]).toEqual(importedNew);
    expect(first.entries.find((entry) => entry.id !== "same" && entry.id.includes("backup-copy")))
      .toMatchObject({
        name: importedConflict.name,
        payload: importedConflict.payload,
      });
    expect(first.impact).toEqual({ added: 2, updated: 0, removed: 0, unchanged: 2 });
    expect(first.deduplicatedCount).toBe(1);
    expect(first.conflictCopyCount).toBe(1);

    const retried = planBoxBackupMerge(first.entries, [importedSame, importedNew, importedConflict]);
    expect(retried.entries).toEqual(first.entries);
    expect(retried.impact).toEqual({ added: 0, updated: 0, removed: 0, unchanged: 4 });
    expect(retried.conflictCopyCount).toBe(0);
  });

  it("keeps same-content entries under distinct new ids while deduping exact ids", () => {
    const current = [targetEntry("current")];
    const first = targetEntry("first", "ハバタクカミ");
    const second = { ...first, id: "second" };

    const result = planBoxBackupMerge(current, [first, second, first]);

    expect(result.entries.map((entry) => entry.id)).toEqual(["current", "first", "second"]);
    expect(result.deduplicatedCount).toBe(1);
  });

  it("does not mistake an ordinary different-id entry for a prior conflict copy", () => {
    const importedConflict = targetEntry("same", "サーフゴー");
    const current = [
      targetEntry("same"),
      { ...importedConflict, id: "ordinary-copy" },
    ];

    const result = planBoxBackupMerge(current, [importedConflict]);

    expect(result.conflictCopyCount).toBe(1);
    expect(result.entries).toHaveLength(3);
  });

  it("replaces target entries and makes duplicate incoming ids unique", () => {
    const current = [targetEntry("unchanged"), targetEntry("updated"), targetEntry("removed")];
    const unchanged = targetEntry("unchanged");
    const updated = targetEntry("updated", "メガゲンガー");
    const conflict = targetEntry("updated", "サーフゴー");
    const added = targetEntry("added", "ハバタクカミ");

    const result = planBoxBackupReplace(current, [
      unchanged,
      updated,
      conflict,
      added,
      { ...added },
    ]);

    expect(result.entries).toHaveLength(4);
    expect(result.entries.filter((entry) => entry.id === "updated")).toHaveLength(1);
    expect(result.entries.filter((entry) => entry.id.startsWith("updated-backup-copy"))).toHaveLength(1);
    expect(result.entries.filter((entry) => entry.id === "added")).toHaveLength(1);
    expect(result.impact).toEqual({ added: 2, updated: 1, removed: 1, unchanged: 1 });
    expect(result.deduplicatedCount).toBe(1);
    expect(result.conflictCopyCount).toBe(1);

    const retried = planBoxBackupReplace(result.entries, [
      unchanged,
      updated,
      conflict,
      added,
      { ...added },
    ]);
    expect(retried.entries).toEqual(result.entries);
    expect(retried.impact).toEqual({ added: 0, updated: 0, removed: 0, unchanged: 4 });
    expect(retried.deduplicatedCount).toBe(1);
    expect(retried.conflictCopyCount).toBe(0);
  });

  it("keeps enemy-box plans separate from target-box plans", () => {
    const current = [enemyEntry("enemy-current")];
    const imported = enemyEntry("enemy-import", "れいとうビーム");

    const merge = planEnemyBoxBackupMerge(current, [imported]);
    const replace = planEnemyBoxBackupReplace(current, [imported]);
    const plans = planEnemyBoxBackupImport(current, [imported]);

    expect(merge.entries).toEqual([current[0], imported]);
    expect(replace.entries).toEqual([imported]);
    expect(plans.merge.entries).toEqual(merge.entries);
    expect(plans.replace.entries).toEqual(replace.entries);
    expect(merge.entries[1]?.payload).not.toHaveProperty("target");
  });

  it("exposes both target plans for a preview without changing either input", () => {
    const current = [targetEntry("current")];
    const imported = [targetEntry("imported")];
    const plans = planBoxBackupImport(current, imported);

    expect(plans.merge.mode).toBe("merge");
    expect(plans.replace.mode).toBe("replace");
    expect(plans.merge.entries).toEqual([...current, ...imported]);
    expect(plans.replace.entries).toEqual(imported);
    expect(current).toHaveLength(1);
    expect(imported).toHaveLength(1);
  });
});
