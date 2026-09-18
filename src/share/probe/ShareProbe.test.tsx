import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProbeResultPanel, ShareProbe } from "./ShareProbe";
import { createProbeDocument, PROBE_CASES } from "./fixtures";

describe("ShareProbe page", () => {
  it("distinguishes no incoming link, success, and corrupt incoming data", () => {
    const idle = renderToStaticMarkup(<ProbeResultPanel result={{ status: "idle" }} />);
    expect(idle).toContain("検証リンクは未受信です");
    expect(idle).not.toContain("完全一致");
    const error = renderToStaticMarkup(<ProbeResultPanel result={{ status: "error", message: "共有データが届いていません", urlLength: 42 }} />);
    expect(error).toContain("検証失敗");
    expect(error).not.toContain("復元成功");
    const success = renderToStaticMarkup(<ProbeResultPanel result={{ status: "success", fixture: PROBE_CASES[0], document: createProbeDocument(PROBE_CASES[0]), urlLength: 800, tokenLength: 700 }} />);
    expect(success).toContain("復元成功・元データと完全一致");
    expect(success).toContain("メガリザードンY");
    expect(success).toContain('aria-label="復元したSP配分"');
    expect(success).toContain('aria-live="polite"');
  });

  it("renders a standalone page with accessible copy fallback", () => {
    const html = renderToStaticMarkup(<ShareProbe />);
    expect(html).toContain("URL共有テスト");
    expect(html).toContain('aria-label="コピーする内容"');
    expect(html).toContain("確認の手順");
    const entry = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
    expect(entry).not.toMatch(/import .*?(Auth|Draft|Sync|AppStartup)/);
    const page = readFileSync(new URL("../../../share-probe/index.html", import.meta.url), "utf8");
    expect(page).toContain('name="robots" content="noindex, nofollow"');
    expect(page).not.toMatch(/gtag|googletagmanager/);
  });

  it("uses role-sized controls and mobile input text", () => {
    const css = readFileSync(new URL("./shareProbe.css", import.meta.url), "utf8");
    const mobileStart = css.indexOf("@media (max-width: 720px)");
    expect(css.slice(0, mobileStart)).toMatch(/\.probe-case-actions > \.ui-button \{[^}]*min-height: var\(--desktop-control-primary\)/);
    expect(css.slice(mobileStart)).toMatch(/\.probe-case-actions > \.ui-button \{[^}]*min-height: var\(--mobile-control-primary\)/);
    expect(css.slice(mobileStart)).toMatch(/\.probe-copy textarea \{[^}]*font-size: var\(--mobile-text-input\)/);
    expect(css).toContain(":focus-visible");
  });
});
