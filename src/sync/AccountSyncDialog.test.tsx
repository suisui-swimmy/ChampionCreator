import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AccountSyncDialog,
  type AccountSyncDialogProps,
} from "./AccountSyncDialog";

const renderDialog = (
  overrides: Partial<AccountSyncDialogProps> = {},
): string => renderToStaticMarkup(
  <AccountSyncDialog
    mode="signed-in"
    user={{ displayName: "テストユーザー", email: "user@example.test" }}
    status="同期済み"
    onSync={() => undefined}
    onOpenDrafts={() => undefined}
    onExport={() => undefined}
    onDeleteAccount={() => undefined}
    {...overrides}
  />,
);

describe("AccountSyncDialog", () => {
  it("uses the shared close icon in the dialog's top-right control", () => {
    const html = renderDialog({ onClose: () => undefined });
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    const mobileStart = css.indexOf("@media (max-width: 720px)");
    const mobileCss = css.slice(mobileStart);

    expect(html).toMatch(/class="[^"]*account-sync-close-button[^"]*"[^>]*aria-label="アカウント画面を閉じる"/);
    expect(html).toMatch(/class="account-sync-close-icon" src="[^"]*assets\/ui\/close\.svg" alt="" aria-hidden="true"/);
    expect(html).not.toContain(">×</button>");
    expect(css).toMatch(/\.account-sync-window \.account-sync-close-button\s*\{[^}]*position:\s*absolute;[^}]*top:\s*20px;[^}]*right:\s*20px;[^}]*width:\s*var\(--desktop-control-standard\);[^}]*height:\s*var\(--desktop-control-standard\);[^}]*padding:\s*0;[^}]*font-size:\s*0;[^}]*line-height:\s*0;/s);
    expect(css).toMatch(/\.account-sync-close-icon\s*\{[^}]*display:\s*block;[^}]*width:\s*var\(--desktop-icon-standard\);[^}]*height:\s*var\(--desktop-icon-standard\);/s);
    expect(mobileCss).toMatch(/\.account-sync-window \.account-sync-close-button\s*\{[^}]*top:\s*16px;[^}]*right:\s*16px;[^}]*width:\s*var\(--mobile-control-standard\);[^}]*height:\s*var\(--mobile-control-standard\);/s);
    expect(mobileCss).toMatch(/\.account-sync-close-icon\s*\{[^}]*width:\s*var\(--mobile-icon-standard\);[^}]*height:\s*var\(--mobile-icon-standard\);/s);
  });

  it("explains the signed-out Google login data and permissions without user-facing jargon", () => {
    const html = renderToStaticMarkup(
      <AccountSyncDialog mode="signed-out" onSignIn={() => undefined} />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain(">Googleでログイン</button>");
    expect(html).toContain("表示名・メールアドレス・プロフィール画像");
    expect(html).toContain("アカウントを区別するためのID");
    expect(html).toContain("Google Driveのファイル、連絡先、Gmailのメール本文を見る権限は求めません");
    expect(html).not.toContain("追加scope");
    expect(html).toContain("ブラウザだけのデータはアカウントの保存領域と分けて管理されます");
    expect(html).toContain('href="/privacy/"');
  });

  it("renders the exact sync status plus manual sync, drafts, and export actions", () => {
    const html = renderDialog({
      status: "未同期",
      statusMessage: "未送信の変更が1件あります。",
      draftsCount: 2,
    });

    expect(html).toContain('data-sync-status="未同期"');
    expect(html).toContain(">未同期</p>");
    expect(html).toContain(">今すぐ同期</button>");
    expect(html).toContain(">下書きを表示（2件）</button>");
    expect(html).toContain(">アカウントデータを書き出す</button>");
    expect(html).toContain("未送信の変更が1件あります。");
  });

  it("maps provider status keys to the exact Japanese account labels", () => {
    const html = renderDialog({ status: "conflict" });

    expect(html).toContain('data-sync-status="競合あり"');
    expect(html).toContain(">競合あり</p>");
  });

  it("shows migration retry and all conflict resolution choices", () => {
    const onRetry = vi.fn();
    const onAction = vi.fn();
    const html = renderDialog({
      migration: {
        status: "error",
        message: "保存データの確認に失敗しました。",
        onRetry,
      },
      conflicts: {
        count: 3,
        message: "3件の保存 slot を確認してください。",
        onAction,
      },
    });

    expect(html).toContain("初回統合");
    expect(html).toContain("保存データの確認に失敗しました。");
    expect(html).toContain(">移行を再試行</button>");
    expect(html).toContain(">競合あり（3件）</h3>");
    expect(html).toContain(">両方残す</button>");
    expect(html).toContain(">このブラウザを使用</button>");
    expect(html).toContain(">クラウドを使用</button>");
  });

  it("renders pending logout as an explicit confirmation", () => {
    const html = renderDialog({ logoutPending: true, pendingCount: 3 });

    expect(html).toContain("ログアウトしますか？");
    expect(html).toContain("未同期の変更が3件あります");
    expect(html).toContain(">ログアウトを確定</button>");
    expect(html).toContain(">キャンセル</button>");
    expect(html).not.toContain(">ログアウト</button>");
  });

  it("renders two-stage typed deletion with the reauth, cloud, auth order and retry state", () => {
    const html = renderDialog({
      deletion: {
        stage: "error",
        message: "クラウドデータを削除できませんでした。",
        onRetry: () => undefined,
      },
    });

    expect(html).toContain("アカウントを完全に削除しますか？");
    expect(html).toContain("再認証（Google）→クラウドデータ削除→認証アカウント削除");
    expect(html).toContain("途中で失敗した場合は認証アカウントを削除せず");
    expect(html).toContain("確認のため「削除」と入力してください");
    expect(html).toContain('type="text"');
    expect(html).toContain("クラウドデータを削除できませんでした。");
    expect(html).toContain(">削除を再試行</button>");
  });

  it("keeps a destructive failure locked to retry without a misleading cancel action", () => {
    const html = renderDialog({
      deletion: {
        stage: "error",
        message: "クラウド削除後に認証アカウントを削除できませんでした。",
        onRetry: () => undefined,
        canCancel: false,
      },
    });

    expect(html).toContain(">削除を再試行</button>");
    expect(html).not.toContain(">キャンセル</button>");
  });

  it("keeps the account error visible and marks busy state for assistive technology", () => {
    const html = renderDialog({
      busy: true,
      errorMessage: "認証サービスへ接続できませんでした。",
    });

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="alert"');
    expect(html).toContain("認証サービスへ接続できませんでした。");
  });

  it("contains modal isolation, focus restoration, focus trap, and Escape behavior", () => {
    const source = readFileSync(new URL("./AccountSyncDialog.tsx", import.meta.url), "utf8");

    expect(source).toContain('document.body.style.overflow = "hidden"');
    expect(source).toContain("(element as HTMLElement).inert = true");
    expect(source).toContain('element.setAttribute("aria-hidden", "true")');
    expect(source).toContain("previouslyFocusedRef.current?.focus()");
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain("keepFocusInside");
    expect(source).toContain("deletionInputRef.current?.focus()");
    expect(source).toContain("deletionStatusRef.current?.focus()");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
  });
});
