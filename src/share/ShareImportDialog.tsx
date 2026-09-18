import { Button } from "../ui/primitives";
import { ShareDialogFrame } from "./ShareDialogFrame";
import type { SharedAdjustment } from "./urlShareCodec";

export type SharedImportState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; shared: SharedAdjustment };
export function ShareImportDialog({ state, error, hasWork, canImport, scopeLabel, onUse, onSave, onClose }: {
  state: SharedImportState; error: string; hasWork: boolean; canImport: boolean; scopeLabel: string;
  onUse: () => void; onSave: () => void; onClose: () => void;
}) {
  return <ShareDialogFrame title="共有された調整を取り込む" onClose={onClose}>
    {state.status === "loading" ? <p role="status">共有内容を確認しています…</p> : state.status === "error" ? <p role="alert">{state.message}</p> : <>
      <p>{state.shared.document.target.pokemonInput} / {state.shared.document.scenarios.length}シナリオ</p>
      <p>{hasWork ? "作業に読み込むと、今の作業中データを置き換えます。ボックスに追加すると、作業中データを残せます。" : "作業に読み込むか、新しいボックス保存として追加できます。"}</p>
      <p className="share-muted">保存先：{scopeLabel}</p>
      <div className="share-actions"><Button variant="primary" disabled={!canImport} onClick={onUse}>作業に読み込む</Button><Button disabled={!canImport} onClick={onSave}>ボックスに追加</Button></div>
      {!canImport ? <p role="status">保存先の確認が終わるまでお待ちください。</p> : null}
    </>}
    {error ? <p role="alert">{error}</p> : null}
    <div className="share-actions"><Button onClick={onClose}>キャンセル</Button></div>
  </ShareDialogFrame>;
}
