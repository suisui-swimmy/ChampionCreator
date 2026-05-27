# ChampionCreator

ChampionCreator は、Pokemon Champions / Pokemon Showdown 系のダメージ計算に準拠する自動耐久調整ツールです。複数の仮想敵シナリオを同時に満たす `H / B / D` 配分を探し、候補の理由を説明できる静的 Web アプリとして育てます。

M0 では React + Vite + TypeScript の土台と、既存の軽量 UI プロトタイプを移植した作業画面を用意しました。M1 では、ダメージ計算 adapter や探索へ進みすぎず、日本語入力・表示を Showdown canonical name へ解決する localization / resolver layer の最小構成を追加しています。

## 開発コマンド

```powershell
npm install
npm run dev
npm run generate:localization-seed
npm run validate:localization
npm test
npm run build
```

- `npm run dev`: ローカル開発サーバーを起動する
- `npm run generate:localization-seed`: M1 用の小さな resolver seed catalog を再生成する
- `npm run validate:localization`: generated catalog と manual override の整合性を検証する
- `npm test`: M0 の React 表示スモークテストを実行する
- `npm run build`: TypeScript の型チェック後に Vite の production build を作る

## 方針

- ダメージ計算エンジンは独自実装しない
- 最終的な計算の正は `@smogon/calc` に置く
- 日本語入力や表示は localization / resolver layer で扱い、計算 adapter には resolver 済みの canonical name だけを渡す
- `others/` は参考資料置き場であり、runtime import しない
- 静的 Web アプリとして動く構成を維持する

## M1 localization / resolver layer

M1 の本体実装は `src/localization/` と `src/data/` に置いています。`others/damage-calc-ja-layer` は方針確認用の参考資料で、アプリ本体から runtime import しません。

- `src/data/generated/localized-catalog.gen.json`: resolver 用の生成済み catalog。直接手で直さず、`npm run generate:localization-seed` で再生成する
- `src/data/overrides/ja-aliases.json`: 日本語別名の manual overlay
- `src/data/overrides/ja-label-overrides.json`: 日本語表示名補正の manual overlay
- `src/localization/resolver.ts`: `pokemon` / `move` / `item` / `ability` / `nature` / `type` を kind ごとに解決する薄い resolver
- `scripts/validate-localization.mjs`: generated catalog と overrides の欠損・重複・参照切れを検証する

resolver は `exact` / `alias` / `ambiguous` / `not-found` を返します。`exact` / `alias` のときだけ `canonicalName` を確定し、`ambiguous` は候補を UI や後続層に渡してユーザー確認へ進めます。M1 の catalog は境界を作るための小さな seed で、網羅的なデータ拡張は scripts / generated data / validation を通して増やす方針です。
