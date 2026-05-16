# ChampionCreator

Pokemon Champions 向けの SP 自動調整支援 Web アプリです。
ユーザーが想定した「この仮想敵・この条件を満たすにはどの数値が必要か」を、速く再現可能に検証するための計算サンドボックスです。

このリポジトリは Milestone 1 まで完了し、UI から `@smogon/calc` 経由の攻撃シナリオ実評価を確認できる状態です。
技 / 特性 / 持ち物 / 天候 / フィールド / 壁 / 急所 / 範囲技 / ランク補正は `BaseScenario` の組み立て経路へ接続済みで、JSON export / import、URL share、Markdown copy、結果ボードへの現在 SP 実評価反映も入っています。

ただし、候補比較ボードに表示しているのはまだ本格的な自動探索結果ではなく、「現在 UI で指定している SP 配分」を `@smogon/calc` ベースで再評価した結果です。
Milestone 2 では、複数の被ダメージシナリオに対して `H/B/D` を同時に持つ SP 候補を列挙し、合格候補だけを返す耐久探索 MVP を実装します。

## 開発コマンド

```bash
npm install
npm run generate:calc-data
npm run generate:localized-search
npm run generate:pokemon-assets
npm run generate:pokemon-options
npm run generate:battle-options
npm run generate:data
npm run sync:pokemon-artwork
npm run inspect:calc
npm run dev
npm test
npm run build
npm run preview
```

## デプロイ

GitHub Pages は GitHub Actions から `dist/` を公開します。

初回だけ GitHub の repository settings で、`Pages` → `Build and deployment` → `Source` を `GitHub Actions` に設定します。
以後は `main` への push、または Actions の手動実行で `.github/workflows/deploy.yml` が `npm ci`、`npm test`、`npm run build` を実行してから Pages へデプロイします。

## 現在の方針

- UI / ドメインモデル / 探索ロジックでは `SP` を正規値として扱う
- SP は各能力 `0..32`、合計 `<= 66`
- `EV` は `@smogon/calc` へ渡すためのアダプタ表現に閉じ込める
- ダメージ計算の主処理は独自実装せず、`@smogon/calc` に委譲する
- レギュレーション合法性は原則として検証しない
- `@smogon/calc` / Showdown 由来データに存在するものは、全解禁に近いサンドボックス入力候補として扱う
- 初期 UI データは [src/data/wireframeFixture.ts](src/data/wireframeFixture.ts) に集約し、画面上の現在状態から実評価用 project を組み立てる
- 本番向け型は [src/domain/model.ts](src/domain/model.ts) に定義する

## アセット

初期ワイヤーフレームでは、ユーザー提供の Pokemon Legends Z-A のタマゴアイコンを静的アセットとして `public/assets/pokemon-icons/` に配置しています。
また、`others/official-artwork/` の通常画像は `npm run sync:pokemon-artwork` で `public/assets/official-artwork/` に同期し、UI 表示用の `pokemon-options.gen.json` から参照します。

画像は計算ロジックに依存させず、読み込みに失敗しても主要導線が壊れない構造にしています。

## データ収集方針

データ収集と生成物は、[docs/data-collection-plan.md](docs/data-collection-plan.md) の分離ルールに沿って管理します。

`npm run inspect:calc` で実 API と型定義に基づく smoke check を行い、計算エンジン基準データ、計算精度オーバーレイ、日本語検索 index、画像 manifest を分けて管理します。

`npm run generate:data` は、Pokemon options に加えて技 / 特性 / 道具 / 性格 / タイプの UI 検索候補 JSON も生成します。技・特性の日本語名は、ローカルに `../others/pokeranker_SV/data/foreign_*.txt` がある場合だけ取り込みます。

Champions 新特性は候補として表示しますが、`@smogon/calc` 未対応のものは計算要確認として表示し、自動補正には混ぜません。

## 対応状況マトリクス

| 項目 | 状態 | ChampionCreator での扱い |
| --- | --- | --- |
| ダメージ乱数 | 対応済み | `@smogon/calc` の結果を薄いラッパー経由で使う |
| SP ルール | 対応済み | `0..32 SP / 合計 66 SP` を正規モデルにする |
| ポケモン・技・特性・持ち物の入力候補 | 対応済み | `@smogon/calc` / Showdown 由来データに存在するものを原則入力可能にする。レギュ合法性は検証しない |
| 連続被弾・定数ダメージ | 仮対応 | 各 hit は calc、シーケンス管理だけアプリ側で扱う |
| Mega / Tera など | 要確認 | 計算エンジンで表現できる範囲を確認し、未確定仕様は精度ラベルや手入力上書きで扱う |
| Champions 新特性 | 要確認 | `メガソーラー` / `ドラゴンスキン` / `かんつうドリル` / `とびだすハバネロ` は `@smogon/calc@0.11.0` 未対応として [src/data/champions/champions-support-matrix.json](src/data/champions/champions-support-matrix.json) に記録する |
