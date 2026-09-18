import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/primitives";
import type { ShareStateDocument } from "../ui/shareState";
import { createSharedAdjustmentUrl, SHARE_URL_WARNING_LENGTH } from "./sharedAdjustment";
import { ShareDialogFrame } from "./ShareDialogFrame";

export function ShareDialog({ document, applicationUrl, onClose }: { document: ShareStateDocument; applicationUrl: string; onClose: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const textRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    let active = true;
    createSharedAdjustmentUrl(document, applicationUrl).then((value) => { if (active) setUrl(value); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : "共有URLを作成できませんでした"); });
    return () => { active = false; };
  }, [document, applicationUrl]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setNotice("共有URLをコピーしました"); }
    catch { setNotice("下のURLを選択してコピーしてください"); textRef.current?.focus(); textRef.current?.select(); }
  };
  return <ShareDialogFrame title="この調整を共有" onClose={onClose}>
    <p>今のSP配分とシナリオを共有します。リンクを開く人のログインは不要です。</p>
    <p className="share-muted">リンクを知っている人が内容を閲覧できます。発行後の取り消しはできません。</p>
    {error ? <p role="alert">{error}</p> : !url ? <p role="status">共有URLを作成しています…</p> : <>
      <label className="share-url-label">共有URL <span>{url.length.toLocaleString()}文字</span><textarea ref={textRef} value={url} readOnly rows={3} onFocus={(event) => event.currentTarget.select()} /></label>
      {url.length > SHARE_URL_WARNING_LENGTH ? <p className="share-warning">2,000文字を超えています。Discordの通常メッセージでは送れません。投稿先の文字数制限を確認してください。</p> : null}
      <div className="share-actions"><Button variant="primary" onClick={() => void copy()}>URLをコピー</Button><a className="share-action-link" href={url} target="_blank" rel="noreferrer">共有画面を確認</a></div>
    </>}
    <p role="status" aria-live="polite">{notice}</p>
  </ShareDialogFrame>;
}
