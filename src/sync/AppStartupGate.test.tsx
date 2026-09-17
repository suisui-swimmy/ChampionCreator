import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppStartupGate, StartupScreen } from "./AppStartupGate";
import { AuthSessionContext } from "./authSessionContext";
import { getStartupReadiness, type StartupSnapshot } from "./startupReadiness";

const snapshot = (): StartupSnapshot => ({
  auth: {
    status: "signed-in", availability: "available", error: null,
    user: { uid: "account-a", displayName: null, email: null, photoURL: null },
  },
  migration: { status: "ready", ownerUid: "account-a" },
  box: { ownerUid: "account-a", isAvailable: true, initialSyncSettled: false, lastSyncError: null },
  draft: { ownerUid: "account-a", isAvailable: true, initialSyncSettled: false, lastError: null },
  online: true,
  slow: false,
});

describe("startup preparation", () => {
  it.each(["loading", "signing-in", "error"] as const)(
    "does not expose guest storage or a local escape while auth is %s", (status) => {
      const input = snapshot();
      const result = getStartupReadiness({ ...input, auth: { ...input.auth, status, user: null }, slow: true });
      expect(result.phase).toBe("attention");
      expect(result.canContinue).toBe(false);
    },
  );
  it.each(["signed-out", "unavailable"] as const)("lets %s use local storage without waiting for cloud", (status) => {
    const input = snapshot();
    expect(getStartupReadiness({ ...input, auth: { ...input.auth, status, user: null } }).phase).toBe("ready");
  });
  it("requires both initial reads, even when local caches are available", () => {
    const input = snapshot();
    expect(getStartupReadiness(input).phase).toBe("loading");
    expect(getStartupReadiness({ ...input, box: { ...input.box!, initialSyncSettled: true } }).phase).toBe("loading");
    expect(getStartupReadiness({ ...input, draft: { ...input.draft!, initialSyncSettled: true } }).phase).toBe("loading");
    expect(getStartupReadiness({
      ...input,
      box: { ...input.box!, initialSyncSettled: true },
      draft: { ...input.draft!, initialSyncSettled: true },
    }).phase).toBe("ready");
  });
  it("offers same-account local continuation after a slow read without claiming sync success", () => {
    expect(getStartupReadiness(snapshot()).canContinue).toBe(false);
    expect(getStartupReadiness({ ...snapshot(), slow: true })).toMatchObject({ phase: "attention", canContinue: true });
  });
  it.each(["box", "draft"] as const)("rejects a stale or missing %s owner", (kind) => {
    const input = snapshot();
    expect(getStartupReadiness({ ...input, [kind]: { ...input[kind], ownerUid: "account-b" }, slow: true }).canContinue).toBe(false);
    expect(getStartupReadiness({ ...input, [kind]: null, slow: true }).canContinue).toBe(false);
  });
  it.each(["box", "draft"] as const)("does not disguise unavailable %s data as an empty valid cache", (kind) => {
    const input = snapshot();
    expect(getStartupReadiness({ ...input, [kind]: { ...input[kind], isAvailable: false } }))
      .toMatchObject({ phase: "attention", canContinue: false });
  });
  it("keeps a network failure actionable after both initial requests settle", () => {
    const input = snapshot();
    expect(getStartupReadiness({
      ...input,
      box: { ...input.box!, initialSyncSettled: true, lastSyncError: "接続できませんでした" },
      draft: { ...input.draft!, initialSyncSettled: true },
    })).toMatchObject({ phase: "attention", canContinue: true, message: "接続できませんでした" });
  });
  it("offers local continuation immediately offline", () => {
    expect(getStartupReadiness({ ...snapshot(), online: false })).toMatchObject({ phase: "attention", canContinue: true });
  });
  it.each(["review", "error"] as const)("leaves migration %s to its existing dialog", (status) => {
    expect(getStartupReadiness({ ...snapshot(), migration: { status, ownerUid: "account-a" }, slow: true }))
      .toMatchObject({ phase: "migration", canContinue: false });
  });
  it("waits for the matching migration but honors explicit deferral", () => {
    expect(getStartupReadiness({ ...snapshot(), migration: { status: "ready", ownerUid: "account-b" }, slow: true }).canContinue).toBe(false);
    expect(getStartupReadiness({ ...snapshot(), migration: { status: "checking", ownerUid: "account-a" }, slow: true }).canContinue).toBe(false);
    expect(getStartupReadiness({ ...snapshot(), migration: { status: "deferred", ownerUid: "account-a" } }).phase).toBe("ready");
  });
  it("does not mount the workspace or read guest drafts before auth is known", () => {
    let mounted = false;
    function WorkspaceProbe() { mounted = true; return <button>ボックスを開く</button>; }
    const auth = { ...snapshot().auth, status: "loading", user: null };
    const html = renderToStaticMarkup(
      <AuthSessionContext.Provider value={{ state: auth } as never}>
        <AppStartupGate><WorkspaceProbe /></AppStartupGate>
      </AuthSessionContext.Provider>,
    );
    expect(mounted).toBe(false);
    expect(html).toContain("データを読み込んでいます…");
    expect(html).not.toContain("ボックスを開く");
    expect(html).not.toContain("下書きを復元");
  });
  it("exposes exact recovery actions only on the applicable screen", () => {
    const render = (input: StartupSnapshot) => renderToStaticMarkup(
      <StartupScreen readiness={getStartupReadiness(input)} onRetry={() => {}} onContinue={() => {}} />,
    );
    const loading = render(snapshot());
    expect(loading).toContain('role="status"');
    expect(loading).not.toContain("<button");
    const slow = render({ ...snapshot(), slow: true });
    expect(slow).toContain("再試行");
    expect(slow).toContain("このブラウザに保存済みのデータで続ける");
    expect(slow).not.toContain('tabindex="-1"');
    expect(slow).not.toContain('aria-modal="true"');
  });
  it("uses primary-size controls, wrapping, and reduced-motion support", () => {
    const css = readFileSync(new URL("./AppStartupGate.css", import.meta.url), "utf8");
    const actions = css.match(/\.startup-actions \.ui-button \{([^}]+)\}/)?.[1];
    expect(actions).toContain("min-height: var(--desktop-control-primary)");
    expect(actions).toContain("white-space: normal");
    const mobile = css.slice(css.indexOf("@media (max-width: 720px)"), css.indexOf("@media (prefers-reduced-motion"));
    expect(mobile).toContain("min-height: var(--mobile-control-primary)");
    expect(css).toContain(".startup-spinner { animation: none; }");
  });
});
