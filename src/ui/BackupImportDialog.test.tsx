import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { planBoxBackupImport, planEnemyBoxBackupImport } from "./boxBackupImport";
import { BackupImportDialog } from "./BackupImportDialog";

const targetPlans = planBoxBackupImport([], []);
const enemyPlans = planEnemyBoxBackupImport([], []);

const renderDialog = (
  overrides: { scope?: "account" | "device"; busy?: boolean } = {},
): string => renderToStaticMarkup(
  <BackupImportDialog
    kind="target"
    plans={targetPlans}
    scope="account"
    onDecision={() => undefined}
    onCancel={() => undefined}
    {...overrides}
  />,
);

describe("BackupImportDialog", () => {
  it("renders both plan previews with the accessible modal contract", () => {
    const html = renderDialog();

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain("バックアップ取り込みの影響");
    expect(html).toContain(">統合</h3>");
    expect(html).toContain(">全端末を置き換え</h3>");
    expect(html).toContain(">追加</dt>");
    expect(html).toContain(">更新</dt>");
    expect(html).toContain(">削除</dt>");
    expect(html).toContain(">変更なし</dt>");
    expect(html).toContain(">統合</button>");
    expect(html).toContain(">全端末を置き換え</button>");
    expect(html).toContain(">キャンセル</button>");
    expect(html).not.toContain("保存データを処理中のため選択できません。");
  });

  it("uses the device-scoped replacement label exactly", () => {
    const html = renderDialog({ scope: "device" });

    expect(html).toContain(">この端末を置き換え</h3>");
    expect(html).toContain(">この端末を置き換え</button>");
    expect(html).not.toContain("全端末を置き換え");
  });

  it("shows parser warnings before commit and disables destructive replacement", () => {
    const html = renderToStaticMarkup(
      <BackupImportDialog
        kind="target"
        plans={{
          merge: { ...targetPlans.merge, conflictCopyCount: 1, deduplicatedCount: 2 },
          replace: targetPlans.replace,
        }}
        scope="account"
        warnings={["2件の保存スロットを読み込めませんでした"]}
        onDecision={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(html).toContain("バックアップの一部を読み込めませんでした");
    expect(html).toContain("2件の保存スロットを読み込めませんでした");
    expect(html).toContain("読み込めない保存があるため、置き換えは選べません。");
    expect(html).toContain("競合コピー 1件 / 重複除外 2件");
    expect(html.match(/disabled=""/g)).toHaveLength(1);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>全端末を置き換え<\/button>/);
  });

  it("keeps an explicitly empty backup replaceable while warning that all saves will be removed", () => {
    const html = renderToStaticMarkup(
      <BackupImportDialog
        kind="target"
        plans={targetPlans}
        scope="account"
        warnings={["バックアップ内の保存スロットは0件です"]}
        warningsBlockReplace={false}
        onDecision={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(html).toContain("バックアップの内容を確認してください");
    expect(html).toContain("バックアップ内の保存スロットは0件です");
    expect(html).toContain("現在の保存はすべて削除されます");
    expect(html).not.toContain("バックアップの一部を読み込めませんでした");
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>全端末を置き換え<\/button>/);
  });

  it("accepts a virtual-enemy plan without rendering a target column", () => {
    const html = renderToStaticMarkup(
      <BackupImportDialog
        kind="enemy"
        plans={enemyPlans}
        scope="device"
        onDecision={() => undefined}
        onCancel={() => undefined}
      />,
    );

    expect(html).toContain("仮想敵バックアップの読み込み");
    expect(html).not.toContain("調整対象バックアップの読み込み");
    expect(html).toContain(">この端末を置き換え</button>");
  });

  it("disables every decision while busy and exposes the reason", () => {
    const html = renderDialog({ busy: true });

    expect(html).toContain('aria-busy="true"');
    expect(html.match(/disabled=""/g)).toHaveLength(3);
    expect(html).toContain("保存データを処理中のため選択できません。");
  });

  it("keeps storage out of the component while retaining modal behavior hooks", () => {
    const source = readFileSync(new URL("./BackupImportDialog.tsx", import.meta.url), "utf8");

    expect(source).toContain("document.body.style.overflow = \"hidden\"");
    expect(source).toContain("(element as HTMLElement).inert = true");
    expect(source).toContain("keepFocusInside");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
  });
});
