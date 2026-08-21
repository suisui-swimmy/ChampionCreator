import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  SyncMigrationDialog,
  type SyncMigrationDialogProps,
} from "./SyncMigrationDialog";

const summary = {
  deviceTargetCount: 2,
  deviceEnemyCount: 1,
  cloudTargetCount: 3,
  cloudEnemyCount: 4,
  sameCount: 1,
  conflictCount: 2,
};

const renderDialog = (
  overrides: Partial<SyncMigrationDialogProps> = {},
): string => renderToStaticMarkup(
  <SyncMigrationDialog
    mode="review"
    summary={summary}
    canUseDevice
    onDecision={() => undefined}
    onRetry={() => undefined}
    {...overrides}
  />,
);

describe("SyncMigrationDialog", () => {
  it("renders the review choices with accessible dialog state and exact labels", () => {
    const html = renderDialog();

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain(">統合</button>");
    expect(html).toContain(">クラウドを使用</button>");
    expect(html).toContain(">この端末を使用</button>");
    expect(html).toContain(">あとで決める</button>");
    expect(html).toContain("この端末");
    expect(html).toContain("クラウド");
    expect(html).toContain("調整対象");
    expect(html).toContain("仮想敵");
    expect(html).toContain("同じ内容");
    expect(html).toContain("要確認");
    expect(html).toContain("2件");
    expect(html).toContain("4件");
  });

  it("disables device-based choices and exposes the reason when device data is unavailable", () => {
    const html = renderDialog({ canUseDevice: false });

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>統合<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>この端末を使用<\/button>/);
    expect(html).toContain("この端末の保存データを利用できないため選択できません。");
    expect(html).toContain("この端末の保存データを利用できないため、「統合」と「この端末を使用」は選択できません。");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby="[^"]+"[^>]*>この端末を使用<\/button>/);
  });

  it("marks every review choice busy while a decision is being applied", () => {
    const html = renderDialog({ busy: true });

    expect(html).toContain('aria-busy="true"');
    expect(html.match(/disabled=""/g)).toHaveLength(4);
    expect(html).toContain("保存データを処理中のため選択できません。");
  });

  it("shows checking as a live busy state without decision controls", () => {
    const html = renderDialog({ mode: "checking" });

    expect(html).toContain("保存データを確認中");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("確認が終わるまでお待ちください。");
    expect(html).not.toContain(">統合</button>");
    expect(html).not.toContain(">クラウドを使用</button>");
  });

  it("shows the retry action and an assertive error message in error mode", () => {
    const html = renderDialog({
      mode: "error",
      errorMessage: "クラウドの確認に失敗しました。",
    });

    expect(html).toContain("保存データを確認できませんでした");
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain("クラウドの確認に失敗しました。");
    expect(html).toContain(">再試行</button>");
    expect(html).toContain(">あとで決める</button>");
    expect(html).not.toContain(">統合</button>");
  });
});
