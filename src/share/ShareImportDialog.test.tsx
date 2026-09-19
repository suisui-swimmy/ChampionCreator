import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShareImportDialog } from "./ShareImportDialog";
import { createShareTestDocument, SHARE_TEST_CASES } from "./testFixtures/fixtures";

describe("share import presentation", () => {
  it("makes replacement explicit and offers adding a new box record", () => {
    const shared = { document: createShareTestDocument(SHARE_TEST_CASES[0]), provenance: { app: "0.31.3", calc: "test" } };
    const html = renderToStaticMarkup(<ShareImportDialog state={{ status: "ready", shared }} error="" hasWork canImport scopeLabel="このブラウザ" onUse={() => {}} onSave={() => {}} onClose={() => {}} />);
    expect(html).toContain("今の作業中データを置き換えます");
    expect(html).toContain("ボックスに追加");
    expect(html).toContain("キャンセル");
    expect(html).toContain("保存先：このブラウザ");
  });

  it("excludes shared URL payloads from main-page analytics", () => {
    const app = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    expect(app).toContain("page_location: window.location.origin + window.location.pathname");
  });

  it("keeps shared controls keyboard-visible and mobile text inputs readable", () => {
    const css = readFileSync(new URL("./share.css", import.meta.url), "utf8");
    const mobile = css.slice(css.indexOf("@media (max-width: 720px)"), css.indexOf("@media (max-width: 480px)"));
    expect(mobile).toMatch(/\.share-url-label textarea \{[^}]*font-size: var\(--mobile-text-input\)/);
    expect(css).toContain(".share-dialog :is(button,a,textarea):focus-visible");
  });
});
