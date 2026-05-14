# ChampionCreator

Pokemon Champions 向けの SP 自動調整支援 Web アプリです。

このリポジトリは Milestone -1 として、まずワイヤーフレーム UI と本番実装へ流用するための内部データ雛形を用意しています。現時点の画面に表示される計算結果はすべてダミーデータです。

## 開発コマンド

```bash
npm install
npm run dev
npm run build
npm run preview
```

## 現在の方針

- UI / ドメインモデル / 探索ロジックでは `SP` を正規値として扱う
- SP は各能力 `0..32`、合計 `<= 66`
- `EV` は将来 `@smogon/calc` へ渡すためのアダプタ表現に閉じ込める
- ダメージ計算の主処理は独自実装せず、将来 `@smogon/calc` に委譲する
- ダミーデータは [src/data/wireframeFixture.ts](src/data/wireframeFixture.ts) に集約する
- 本番向け型は [src/domain/model.ts](src/domain/model.ts) に定義する

## アセット

Milestone -1 では、ユーザー提供の Pokemon Legends Z-A のタマゴアイコンをワイヤーフレーム用の静的アセットとして `public/assets/pokemon-icons/` に配置しています。

画像は計算ロジックに依存させず、読み込みに失敗しても主要導線が壊れない構造にしています。

## 対応状況マトリクス

| 項目 | 状態 | ChampionCreator での扱い |
| --- | --- | --- |
| ダメージ乱数 | 対応済み | 将来 `@smogon/calc` の結果を薄いラッパー経由で使う |
| SP ルール | 対応済み | `0..32 SP / 合計 66 SP` を正規モデルにする |
| 使用可能ポケモン・技 | 要確認 | 公式 / Showdown / `@pkmn` 側の対応状況を確認してから本データ化 |
| 連続被弾・定数ダメージ | 仮対応 | 各 hit は calc、シーケンス管理だけアプリ側で扱う |
| Mega / Tera など | 要確認 | 入力欄は確保し、未検証の計算には混ぜない |
