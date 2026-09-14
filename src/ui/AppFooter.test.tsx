import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { renderInitialApp } from "../seo/prerender";
import { AppFooter } from "./AppFooter";
import { captureFooterStartup } from "./footerStartup";

const paragraphs = [
  "ChampionCreatorは、ポケモンチャンピオンズの耐久・火力・素早さをまとめて調整できる、能力ポイント（SP）の自動配分ツールです。",
  "「この攻撃を耐えたい」「この技で倒したい」「この相手より速くしたい」など、複数の仮想敵に対する条件を同時に満たす配分候補を、合計66SP以内で探せます。",
  "調整対象と仮想敵の条件を入力して「計算開始」。候補ごとの配分・残りSP・ダメージや確率を比較し、選んだ配分を適用できます。配分と入力条件は調整対象ボックスにまとめて保存でき、計算とブラウザ内への保存はログインなしで利用できます。",
  "攻撃技のダメージ計算は、「@smogon/calc」を基盤にしています。チャンピオンズ向けに一部の技データや仕様差への対応を加え、変更内容と参照元を公開しています。",
  "SP配分の探索と、指定した定数ダメージ・回復を含むHPの推移は、ChampionCreator側で処理します。「計算開始」で探す配分候補は、設定した条件を満たすか再評価します。入力条件の反映、定数ダメージ・回復の処理、SP上限の扱いなどを、代表的な条件の自動テストで確認しています。",
  "ChampionCreatorは、入力した条件と対応済みの効果を対象に計算する非公式ツールです。未対応の処理やゲームとの仕様差により、実際のゲーム内の結果と異なる場合があります。詳しい対応範囲と制限は、公開ドキュメントをご確認ください。",
];
const evidence = [
  ["https://github.com/smogon/damage-calc", "@smogon/calc"],
  ["https://github.com/suisui-swimmy/ChampionCreator#damage-calculation-boundary", "変更内容と参照元"],
  ["https://github.com/suisui-swimmy/ChampionCreator#データと検証", "代表的な条件の自動テスト"],
  ["https://github.com/suisui-swimmy/ChampionCreator#制限", "対応範囲と制限"],
];

describe("main footer publication contract", () => {
  it.each(["component", "initial HTML"])("includes the complete approved copy once in %s, even when closed", (surface) => {
    const html = surface === "component"
      ? renderToStaticMarkup(<AppFooter versionLabel="version fixture" usageDate="date fixture" />)
      : renderInitialApp();
    const footer = html.slice(html.indexOf('<footer'));
    const text = footer.replace(/<[^>]*>/g, "");
    let previous = -1;
    for (const paragraph of paragraphs) {
      expect(text.split(paragraph)).toHaveLength(2);
      expect(text.indexOf(paragraph)).toBeGreaterThan(previous);
      previous = text.indexOf(paragraph);
    }
    expect(footer).toContain('<h2 id="app-footer-about-title">ChampionCreatorについて</h2>');
    expect(footer.match(/<h3>/g)).toHaveLength(3);
    expect(footer).not.toContain('<h1');
    expect(footer).toContain('<details class="app-footer-details">');
    for (const [url, label] of evidence) {
      expect(footer).toContain(`href="${url}" target="_blank" rel="noreferrer">${label}</a>`);
    }
    expect(footer.indexOf('</details>')).toBeGreaterThan(footer.indexOf(paragraphs[3].slice(0, 10)));
    if (surface === "initial HTML") {
      expect(html.indexOf('</fieldset>')).toBeLessThan(html.indexOf('<footer'));
      expect(html.slice(html.indexOf('<fieldset'), html.indexOf('</fieldset>'))).toContain('id="runButton"');
      expect(footer).not.toContain('aria-busy');
    }
  });

  it("does not add the main-only explanation or wrapper to the tutorial or static pages", () => {
    const tutorial = renderToStaticMarkup(<App variant="tutorial" />);
    expect(tutorial).not.toContain('app-footer');
    expect(tutorial).not.toContain('app-workspace');
    for (const path of ["../../guide/index.html", "../../privacy/index.html"]) {
      const html = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(html).not.toContain('app-footer--about');
      expect(html).not.toContain('ChampionCreatorについて');
    }
  });

  it("starts open when the user expanded the static preview", () => {
    const html = renderToStaticMarkup(<AppFooter versionLabel="v" usageDate="d" startup={{ open: true, restoreFocus: vi.fn() }} />);
    expect(html).toContain('<details class="app-footer-details" open="">');
  });

  it("uses scoped columns, readable body text and the existing disclosure tiers", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    const mobile = css.slice(css.indexOf("@media (max-width: 720px)"));
    const narrow = css.slice(css.lastIndexOf("@media (max-width: 380px)"));
    expect(css).toContain("--footer-body-size: 14px;");
    expect(css).toMatch(/\.app-footer\.app-footer--about\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\) fit-content\(60%\);/);
    expect(css).toMatch(/\.app-footer--about \.app-footer-about\s*\{[^}]*color: var\(--text\);[^}]*font-size: var\(--footer-body-size\);[^}]*line-height: 1\.7;/);
    expect(css).toMatch(/\.app-footer-details > summary\s*\{[^}]*min-height: var\(--desktop-control-comfort\);/);
    expect(mobile).toMatch(/\.app-footer-details > summary\s*\{[^}]*min-height: var\(--mobile-control-comfort\);/);
    expect(mobile).toMatch(/\.app-footer\.app-footer--about\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
    expect(narrow).toMatch(/\.app-workspace\s*\{[^}]*min-height: calc\(100dvh - 2 \* var\(--narrow-page-gutter\)\);/);
    expect(css).toContain('.app-footer-details > summary::-webkit-details-marker { display: none; }');
    expect(css).toContain('.app-footer-details > summary::marker { content: ""; }');
  });
});

// Small DOM doubles exercise the startup race without adding a DOM dependency.
function startupFixture({ open = true, focused = true } = {}) {
  const oldSummary = {};
  const oldLink = {};
  const focus = vi.fn();
  const listeners = new Map<string, () => void>();
  const doc = {
    body: {}, documentElement: {}, activeElement: focused ? oldLink : {},
    querySelector: vi.fn((): object | null => null),
    addEventListener: vi.fn((name: string, fn: () => void) => listeners.set(name, fn)),
    removeEventListener: vi.fn((name: string) => listeners.delete(name)),
  };
  const root = {
    ownerDocument: doc,
    querySelector: () => ({ querySelectorAll: () => [oldSummary, oldLink], querySelector: () => ({ open }) }),
  };
  const nextFooter = { querySelectorAll: () => [{ focus: vi.fn() }, { focus }] };
  const state = captureFooterStartup(root as unknown as HTMLElement)!;
  doc.activeElement = doc.body;
  return { doc, state, focus, listeners, restore: () => state.restoreFocus(nextFooter as unknown as HTMLElement) };
}

describe("footer startup focus", () => {
  it("captures open state and restores the same link only once, without scrolling", () => {
    const fixture = startupFixture();
    expect(fixture.state.open).toBe(true);
    fixture.restore(); fixture.restore();
    expect(fixture.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(fixture.listeners.size).toBe(0);
  });
  it.each(["focusin", "pointerdown", "keydown"])("does not steal focus after a new %s interaction", (event) => {
    const fixture = startupFixture();
    fixture.listeners.get(event)!();
    fixture.restore();
    expect(fixture.focus).not.toHaveBeenCalled();
    expect(fixture.listeners.size).toBe(0);
  });
  it("does not steal focus from an opening modal, including before its own focus effect", () => {
    const fixture = startupFixture();
    fixture.doc.querySelector.mockReturnValue({});
    fixture.restore();
    expect(fixture.focus).not.toHaveBeenCalled();
  });
  it("does not autofocus on a fresh load", () => {
    const fixture = startupFixture({ open: false, focused: false });
    expect(fixture.state.open).toBe(false);
    fixture.restore();
    expect(fixture.focus).not.toHaveBeenCalled();
    expect(fixture.doc.addEventListener).not.toHaveBeenCalled();
  });
});
