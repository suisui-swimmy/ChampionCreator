import { useEffect, useRef, useState } from "react";
import { ChevronRightIcon } from "@radix-ui/react-icons";
import { getPublicAssetUrl } from "./publicAssetUrl";
import type { FooterStartupState } from "./footerStartup";

export function AppFooter({ versionLabel, usageDate, startup }: {
  versionLabel: string;
  usageDate: string;
  startup?: FooterStartupState;
}) {
  const footerRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(startup?.open ?? false);
  useEffect(() => {
    if (!startup) return;
    const frame = requestAnimationFrame(() => {
      if (footerRef.current) startup.restoreFocus(footerRef.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [startup]);
  return (
    <footer ref={footerRef} className="app-footer app-footer--about" aria-label="サイトフッター">
      <section className="app-footer-about" aria-labelledby="app-footer-about-title">
        <h2 id="app-footer-about-title">ChampionCreatorについて</h2>
        <p>ChampionCreatorは、ポケモンチャンピオンズの耐久・火力・素早さをまとめて調整できる、能力ポイント（SP）の自動配分ツールです。</p>
        <p>「この攻撃を耐えたい」「この技で倒したい」「この相手より速くしたい」など、複数の仮想敵に対する条件を同時に満たす配分候補を、合計66SP以内で探せます。</p>
        <p>調整対象と仮想敵の条件を入力して「配分を探索」。候補ごとの配分・残りSP・ダメージや確率を比較し、選んだ配分を適用できます。配分と入力条件は調整対象ボックスにまとめて保存でき、計算とブラウザ内への保存はログインなしで利用できます。</p>
        <details className="app-footer-details" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
          <summary><ChevronRightIcon aria-hidden="true" />計算方法と検証について</summary>
          <div className="app-footer-explanation">
            <h3>計算の基盤</h3>
            <p>攻撃技のダメージ計算は、「<a href="https://github.com/smogon/damage-calc" target="_blank" rel="noreferrer">@smogon/calc</a>」を基盤にしています。チャンピオンズ向けに一部の技データや仕様差への対応を加え、<a href="https://github.com/suisui-swimmy/ChampionCreator#damage-calculation-boundary" target="_blank" rel="noreferrer">変更内容と参照元</a>を公開しています。</p>
            <h3>ChampionCreatorの処理と検証</h3>
            <p>SP配分の探索と、指定した定数ダメージ・回復を含むHPの推移は、ChampionCreator側で処理します。「配分を探索」で探す配分候補は、設定した条件を満たすか再評価します。入力条件の反映、定数ダメージ・回復の処理、SP上限の扱いなどを、<a href="https://github.com/suisui-swimmy/ChampionCreator#データと検証" target="_blank" rel="noreferrer">代表的な条件の自動テスト</a>で確認しています。</p>
            <h3>対応範囲と制限</h3>
            <p>ChampionCreatorは、入力した条件と対応済みの効果を対象に計算する非公式ツールです。未対応の処理やゲームとの仕様差により、実際のゲーム内の結果と異なる場合があります。詳しい<a href="https://github.com/suisui-swimmy/ChampionCreator#制限" target="_blank" rel="noreferrer">対応範囲と制限</a>は、公開ドキュメントをご確認ください。</p>
          </div>
        </details>
      </section>
      <section className="app-footer-resources" aria-labelledby="app-footer-resources-title">
        <h2 id="app-footer-resources-title">リンク・サポート</h2>
        <nav className="app-footer-links app-footer-page-links" aria-label="ページリンク">
          <span className="app-footer-link-item">
            <a className="app-footer-contact" href="/" aria-current="page">アプリ</a>
          </span>
          <span className="app-footer-link-item">
            <a className="app-footer-contact" href="/guide/">使い方ガイド</a>
          </span>
          <span className="app-footer-link-item">
            <a className="app-footer-contact" href="/privacy/">プライバシー</a>
          </span>
        </nav>
        <nav className="app-footer-links app-footer-support-links" aria-label="サポート・関連リンク">
          <span className="app-footer-link-item">
            <a
              className="app-footer-contact"
              href="https://docs.google.com/forms/d/e/1FAIpQLSdTUyrAmTwrcarMfMt56RrcwH_g4r4WhowW0i60HDK5BflylQ/viewform?usp=header"
              target="_blank"
              rel="noreferrer"
            >
              不具合報告
            </a>
          </span>
          <span className="app-footer-link-item">
            <a
              className="app-footer-contact"
              href="https://x.com/peixe0307"
              target="_blank"
              rel="noreferrer"
              aria-label="お問い合わせ: X @peixe0307"
            >
              <span>お問い合わせ</span>
              <img src={getPublicAssetUrl("assets/social/x-logo.svg")} alt="X" />
            </a>
          </span>
          <span className="app-footer-link-item">
            <a
              className="app-footer-contact app-footer-icon-link"
              href="https://github.com/suisui-swimmy/ChampionCreator"
              target="_blank"
              rel="noreferrer"
              aria-label="ChampionCreator GitHub リポジトリ"
            >
              <img src={getPublicAssetUrl("assets/social/github-invertocat-white.svg")} alt="" />
            </a>
          </span>
        </nav>
        <div className="app-footer-source">
          <span className="app-footer-link-item">
            <a
              className="app-footer-source-link"
              href="https://championsbattledata.com/"
              target="_blank"
              rel="noreferrer"
            >
              使用率データ提供元: Pokemon Champions Battle Data
            </a>
          </span>
          <span className="app-footer-link-item">
            <span className="app-footer-source-date">
              データ更新日: {usageDate}
            </span>
          </span>
        </div>
      </section>
      <div className="app-footer-meta">
        <div className="app-footer-copy">
          <span>© 2026 suisui-swimmy</span>
          <span>
            本ツールは非公式のファンツールであり、画像、名称などに関する著作権は 任天堂 / クリーチャーズ / ゲームフリーク に帰属します
          </span>
        </div>
        <p className="app-footer-version">{versionLabel}</p>
      </div>
    </footer>
  );
}
