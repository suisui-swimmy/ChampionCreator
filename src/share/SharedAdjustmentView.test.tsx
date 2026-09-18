import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SharedAdjustmentContent } from "./SharedAdjustmentView";
import { ShareImportDialog } from "./ShareImportDialog";
import { createProbeDocument, PROBE_CASES } from "./probe/fixtures";
import { evaluateSharedAdjustment } from "./evaluateSharedAdjustment";

const shared = { document: createProbeDocument(PROBE_CASES[0]), provenance: { app: "0.30.0", calc: "old" } };
describe("shared adjustment presentation", () => {
  it("shows Japanese conditions, selected SP, fixed results, and version differences", () => {
    const html = renderToStaticMarkup(<SharedAdjustmentContent shared={shared} evaluation={evaluateSharedAdjustment(shared.document)} evaluationError="" />);
    expect(html).toContain("メガリザードンY");
    expect(html).toContain("93.75%");
    expect(html).toContain("KO率 100%");
    expect(html).toContain("バージョンが異なります");
    expect(html).toContain("いわなだれ");
    expect(html).not.toContain("Charizard-Mega-Y");
    expect(html).not.toContain('<input');
  });
  it("makes replacement explicit and offers adding a new box record", () => {
    const html = renderToStaticMarkup(<ShareImportDialog state={{ status: "ready", shared }} error="" hasWork canImport scopeLabel="このブラウザ" onUse={() => {}} onSave={() => {}} onClose={() => {}} />);
    expect(html).toContain("今の作業中データを置き換えます");
    expect(html).toContain("ボックスに追加");
    expect(html).toContain("キャンセル");
    expect(html).toContain("保存先：このブラウザ");
  });
  it("keeps public viewing outside account providers and excludes URL payloads from analytics", () => {
    const entry = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
    expect(entry).not.toMatch(/AuthSession|Draft|SyncBox|AppStartup/);
    const html = readFileSync(new URL("../../share/index.html", import.meta.url), "utf8");
    expect(html).not.toMatch(/gtag|googletagmanager/);
    expect(html).toContain('content="noindex"');
    const app = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
    expect(app).toContain("page_location: window.location.origin + window.location.pathname");
  });
  it("uses responsive semantic dimensions and text inputs", () => {
    const css = readFileSync(new URL("./share.css", import.meta.url), "utf8");
    const mobile = css.slice(css.indexOf("@media (max-width: 720px)"));
    expect(css).toMatch(/\.shared-scenario summary \{[^}]*min-height: var\(--desktop-control-comfort\)/);
    expect(mobile).toMatch(/\.share-url-label textarea \{[^}]*font-size: var\(--mobile-text-input\)/);
    expect(css).toContain(":focus-visible");
    const narrow = css.slice(css.indexOf("@media (max-width: 380px)"));
    expect(narrow).toMatch(/\.topbar \{[^}]*grid-template-areas: "description" "brand" "actions"/);
  });
});
