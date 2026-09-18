import { useEffect, useRef, useState } from "react";
import { formatAppVersionLabel } from "../../appVersion";
import { Button } from "../../ui/primitives";
import { PROBE_CASES } from "./fixtures";
import { createProbeLink, formatProbeReport, inspectProbeUrl, type ProbeLink, type ProbeResult } from "./probeModel";

export function ProbeResultPanel({ result }: { result: ProbeResult }) {
  return (
    <section className={`probe-result probe-result-${result.status}`} aria-labelledby="probe-result-title" aria-busy={result.status === "checking"}>
      <h2 id="probe-result-title">受信結果</h2>
      <div role="status" aria-live="polite" aria-atomic="true">
        {result.status === "idle" ? <p>検証リンクは未受信です。下のURLをSNSで送り、届いたリンクを開いてください。</p> : null}
        {result.status === "checking" ? <p>共有データを復元・照合しています…</p> : null}
        {result.status === "error" ? <><p className="probe-result-heading">検証失敗</p><p>{result.message}</p><p className="probe-muted">受信URL：{result.urlLength.toLocaleString()}文字</p></> : null}
        {result.status === "success" ? (
          <>
            <p className="probe-result-heading">復元成功・元データと完全一致</p>
            <p>{result.fixture.label} / 受信URL：{result.urlLength.toLocaleString()}文字</p>
            <dl className="probe-summary">
              <div><dt>ポケモン</dt><dd>{result.document.target.pokemonInput}</dd></div>
              <div><dt>シナリオ</dt><dd>{result.document.scenarios.length}件（有効 {result.document.scenarios.filter((s) => s.enabled).length}件）</dd></div>
              <div><dt>攻撃</dt><dd>{result.document.scenarios.reduce((n, s) => n + s.attacks.length, 0)}件</dd></div>
            </dl>
            <div className="probe-stats" aria-label="復元したSP配分">
              {([['hp', 'H'], ['atk', 'A'], ['def', 'B'], ['spa', 'C'], ['spd', 'D'], ['spe', 'S']] as const).map(([key, label]) => (
                <span key={key} className={`probe-stat probe-stat-${key}`}><b>{label}</b> {result.document.target.statPoints[key]}</span>
              ))}
            </div>
            <p className="probe-muted">画面用IDを除く全項目が一致しました。条件の達成状況は、このページでは計算しません。</p>
          </>
        ) : null}
      </div>
    </section>
  );
}

export function ShareProbe() {
  const [href, setHref] = useState(() => typeof window === "undefined" ? "https://example.invalid/share-probe/" : window.location.href);
  const [links, setLinks] = useState<ProbeLink[]>([]);
  const [generationError, setGenerationError] = useState("");
  const [result, setResult] = useState<ProbeResult>({ status: "idle" });
  const [copyText, setCopyText] = useState("");
  const [copyNotice, setCopyNotice] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const changed = () => setHref(window.location.href);
    window.addEventListener("hashchange", changed);
    window.addEventListener("popstate", changed);
    return () => { window.removeEventListener("hashchange", changed); window.removeEventListener("popstate", changed); };
  }, []);

  const pageUrl = href.split(/[?#]/, 1)[0];
  useEffect(() => {
    let active = true;
    setGenerationError("");
    Promise.all(PROBE_CASES.map((fixture) => createProbeLink(pageUrl, fixture)))
      .then((next) => { if (active) setLinks(next); })
      .catch((error: unknown) => { if (active) setGenerationError(error instanceof Error ? error.message : "URLを生成できませんでした"); });
    return () => { active = false; };
  }, [pageUrl]);

  useEffect(() => {
    let active = true;
    setResult({ status: "checking" });
    inspectProbeUrl(href).then((next) => { if (active) setResult(next); });
    return () => { active = false; };
  }, [href]);

  const copy = async (text: string, label: string) => {
    setCopyText(text);
    setCopyNotice("");
    try {
      await navigator.clipboard.writeText(text);
      setCopyNotice(`${label}をコピーしました`);
    } catch {
      setCopyNotice("自動コピーできませんでした。下の文字列を選択してコピーしてください。");
      requestAnimationFrame(() => { textRef.current?.focus(); textRef.current?.select(); });
    }
  };

  const local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(href).hostname);
  return (
    <main className="share-probe">
      <header className="probe-header"><div><p className="probe-brand">ChampionCreator / 検証版1</p><h1>URL共有テスト</h1></div><a className="probe-link" href="../">CC本体へ</a></header>
      <p className="probe-intro">URLをSNSで送って開き、受信結果を確認してください。使うのはサンプルだけです。ボックス・下書き・アカウントには保存しません。</p>
      {local ? <p className="probe-local-note">ローカル確認中です。このURLはスマホのSNSからは開けません。公開後に、このページでURLを作り直してください。</p> : null}
      <ProbeResultPanel result={result} />
      {result.status === "success" || result.status === "error" ? (
        <div className="probe-result-actions">
          <Button onClick={() => void copy(formatProbeReport(result, href, navigator.userAgent), "検証結果")}>検証結果をコピー</Button>
          <a className="probe-link" href={pageUrl}>テスト一覧に戻る</a>
        </div>
      ) : null}
      <section aria-labelledby="probe-links-title">
        <h2 id="probe-links-title">テストURL</h2>
        <p className="probe-muted">まず「調整例」、次に長いURLを試してください。文字数は今のURL全体の実測値です。</p>
        {generationError ? <p role="alert">{generationError}</p> : links.length === 0 ? <p role="status">テストURLを準備しています…</p> : null}
        <div className="probe-cases">
          {links.map((link) => (
            <article className="probe-case" key={link.fixture.id}>
              <div className="probe-case-heading"><h3>{link.fixture.label}</h3><strong>{link.url.length.toLocaleString()}文字</strong></div>
              <p>{link.fixture.description}</p>
              <p className="probe-muted">{link.scenarioCount}シナリオ / {link.attackCount}攻撃</p>
              <div className="probe-case-actions">
                <Button variant="primary" onClick={() => void copy(link.url, `${link.fixture.label}のURL`)} aria-label={`${link.fixture.label}のURLをコピー`}>URLをコピー</Button>
                <a className="probe-link" href={link.url} aria-label={`${link.fixture.label}をこのブラウザで確認`}>このブラウザで確認</a>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="probe-copy" aria-labelledby="probe-copy-title">
        <h2 id="probe-copy-title">コピーする内容</h2>
        <p role="status" aria-live="polite">{copyNotice || "「URLをコピー」または「検証結果をコピー」で、ここにも文字列を表示します。"}</p>
        <textarea ref={textRef} aria-label="コピーする内容" value={copyText} readOnly rows={3} onFocus={(event) => event.currentTarget.select()} />
      </section>
      <details className="probe-help">
        <summary>確認の手順</summary>
        <ol><li>テスト用の投稿やDMに、コピーしたURLを貼り付けて送ります。</li><li>届いたリンクをタップし、「復元成功・元データと完全一致」を確認します。</li><li>スマホでは、アプリ内とSafari／Chromeで開いた場合をそれぞれ試します。</li><li>「検証結果をコピー」で結果を控え、経由したSNSと開き方を追記します。</li></ol>
        <p>下書きへの貼り付けだけでは、送信後の短縮・転送を確認できません。長いURLが失敗しても、短いケースの結果とは分けて記録してください。</p>
      </details>
      <footer className="probe-footer">{formatAppVersionLabel()}</footer>
    </main>
  );
}
