import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { App } from "./App";

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
