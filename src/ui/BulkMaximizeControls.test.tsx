import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BulkMaximizeControls } from "./BulkMaximizeControls";

const handlers = { onRun: () => undefined, onCancel: () => undefined, onAllowNatureChange: () => undefined };

describe("bulk maximization controls", () => {
  it("renders one directly editable checkbox with the exact label and current state", () => {
    for (const allowNatureChange of [false, true]) {
      const html = renderToStaticMarkup(<BulkMaximizeControls {...handlers} running={false} allowNatureChange={allowNatureChange} />);
      expect(html).toContain('role="group" aria-label="残りSPで耐久最大化"');
      expect(html).toContain('<span>性格変更</span>');
      expect(html.match(/type="checkbox"/g)).toHaveLength(1);
      expect(html.includes('checked=""')).toBe(allowNatureChange);
      expect(html).not.toContain('aria-haspopup');
      expect(html).not.toMatch(/lock(?:-open)?\.svg/);
      expect(html).not.toContain(">中止</button>");
    }
  });

  it("disables only execution while running and retains cancellation and settings", () => {
    const html = renderToStaticMarkup(<BulkMaximizeControls {...handlers} running allowNatureChange />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>計算中\.\.\.<\/button>/);
    expect(html).toContain(">中止</button>");
    expect(html).toContain('<span>性格変更</span>');
    expect(html).toContain('checked=""');
    expect(html.match(/ disabled=""/g)).toHaveLength(1);
  });

  it("announces whether the candidate preview is expanded", () => {
    for (const candidatesVisible of [false, true]) {
      const html = renderToStaticMarkup(<BulkMaximizeControls {...handlers} running={false} allowNatureChange={false} candidatesVisible={candidatesVisible} />);
      expect(html).toContain(`aria-expanded="${candidatesVisible}"`);
    }
  });

  it("keeps primary control targets and readable setting text across the mobile boundary", () => {
    const css = readFileSync(new URL("./BulkMaximizeControls.css", import.meta.url), "utf8");
    const mobileStart = css.indexOf("@media (max-width: 720px)");
    const base = css.slice(0, mobileStart);
    const mobile = css.slice(mobileStart);
    expect(css).not.toContain(".bulk-nature-checkbox:focus-within");
    expect(css).toMatch(/\.bulk-nature-checkbox input:focus-visible\s*\{[^}]*outline: 2px solid var\(--gold\);/);
    expect(base).toMatch(/\.bulk-maximize-control-group > \.ui-button\s*\{[^}]*min-height: var\(--desktop-control-primary\);/);
    expect(base).toMatch(/\.bulk-maximize-control-group > \.bulk-maximize-button\s*\{[^}]*font-size: 14px;/);
    expect(base).toMatch(/\.bulk-nature-checkbox\s*\{[^}]*min-height: var\(--desktop-control-primary\);[^}]*font-size: var\(--desktop-text-control\);/);
    expect(mobile).toMatch(/\.bulk-maximize-control-group > \.ui-button\s*\{[^}]*min-height: var\(--mobile-control-primary\);/);
    expect(mobile).toMatch(/\.bulk-nature-checkbox\s*\{[^}]*min-height: var\(--mobile-control-primary\);[^}]*font-size: var\(--mobile-text-control\);/);
  });
});
