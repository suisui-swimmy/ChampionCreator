# ChampionCreator

Pokemon Champions 向けの SP 自動調整支援 Web アプリです。
ユーザーが想定した「この仮想敵・この条件を満たすにはどの数値が必要か」を、速く再現可能に検証するための計算サンドボックスです。

このリポジトリは Milestone -1 として、まずワイヤーフレーム UI と本番実装へ流用するための内部データ雛形を用意しています。現時点の画面に表示される計算結果はすべてダミーデータです。

## 開発コマンド

```bash
npm install
npm run generate:calc-data
npm run generate:localized-search
npm run generate:pokemon-assets
npm run inspect:calc
npm run dev
npm run build
npm run preview
```

## 現在の方針

- UI / ドメインモデル / 探索ロジックでは `SP` を正規値として扱う
- SP は各能力 `0..32`、合計 `<= 66`
- `EV` は `@smogon/calc` へ渡すためのアダプタ表現に閉じ込める
- ダメージ計算の主処理は独自実装せず、`@smogon/calc` に委譲する
- レギュレーション合法性は原則として検証しない
- `@smogon/calc` / Showdown 由来データに存在するものは、全解禁に近いサンドボックス入力候補として扱う
- ダミーデータは [src/data/wireframeFixture.ts](src/data/wireframeFixture.ts) に集約する
- 本番向け型は [src/domain/model.ts](src/domain/model.ts) に定義する

## アセット

Milestone -1 では、ユーザー提供の Pokemon Legends Z-A のタマゴアイコンをワイヤーフレーム用の静的アセットとして `public/assets/pokemon-icons/` に配置しています。

画像は計算ロジックに依存させず、読み込みに失敗しても主要導線が壊れない構造にしています。

## データ収集方針

Milestone -1 の本データ収集は、先に [docs/data-collection-plan.md](docs/data-collection-plan.md) の分離ルールに沿って進めます。

`npm run inspect:calc` で実 API と型定義に基づく smoke check を行い、計算エンジン基準データ、計算精度オーバーレイ、日本語検索 index、画像 manifest を分けて管理します。

## 対応状況マトリクス

| 項目 | 状態 | ChampionCreator での扱い |
| --- | --- | --- |
| ダメージ乱数 | 対応済み | `@smogon/calc` の結果を薄いラッパー経由で使う |
| SP ルール | 対応済み | `0..32 SP / 合計 66 SP` を正規モデルにする |
| ポケモン・技・特性・持ち物の入力候補 | 対応済み | `@smogon/calc` / Showdown 由来データに存在するものを原則入力可能にする。レギュ合法性は検証しない |
| 連続被弾・定数ダメージ | 仮対応 | 各 hit は calc、シーケンス管理だけアプリ側で扱う |
| Mega / Tera など | 要確認 | 計算エンジンで表現できる範囲を確認し、未確定仕様は精度ラベルや手入力上書きで扱う |
