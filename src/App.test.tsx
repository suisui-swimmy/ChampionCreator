import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App, clampTargetStatPointChange } from "./App";

describe("App", () => {
  it("renders the M0 workbench sections", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("ChampionCreator");
    expect(html).toContain("調整対象");
    expect(html).toContain("仮想敵シナリオ");
    expect(html).toContain("シナリオを追加");
    expect(html).toContain("候補一覧");
    expect(html).toContain("選択候補詳細");
  });

  it("renders exact 32-cell SP allocation sliders", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-valuemax="32"');
    expect(html).toContain('aria-label="H SP配分"');
    expect(html).toContain('class="sp-cell-bar hp"');
  });

  it("caps target SP edits at the total 66 budget", () => {
    expect(clampTargetStatPointChange({
      hp: 10,
      atk: 20,
      def: 20,
      spa: 0,
      spd: 0,
      spe: 0,
    }, "hp", 32)).toBe(26);

    expect(clampTargetStatPointChange({
      hp: 26,
      atk: 20,
      def: 20,
      spa: 0,
      spd: 0,
      spe: 0,
    }, "atk", 5)).toBe(5);
  });

  it("wires resolver-backed datalist candidates to free-text entity fields", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('<datalist id="entity-options-pokemon-');
    expect(html).toContain('value="ピカチュウ"');
    expect(html).toContain('value="カイリュー"');
    expect(html).not.toContain('value="Dragonite"');
    expect(html).not.toContain('label="Dragonite"');
    expect(html).toContain('list="entity-options-pokemon');
    expect(html).toContain('list="entity-options-move');
    expect(html).toContain('list="entity-options-nature');
    expect(html).toContain('list="entity-options-ability');
    expect(html).toContain('list="entity-options-item');
    expect(html).toContain('aria-label="テラスタル"');
    expect(html).toContain('aria-label="攻撃テラ"');
    expect(html).toContain("tera-off.svg");
    expect(html).toContain("mega-off.svg");
    expect(html).toContain("dmax-off.svg");
  });
});
