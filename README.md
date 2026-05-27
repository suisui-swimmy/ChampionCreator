# ChampionCreator

ChampionCreator は、Pokemon Champions / Pokemon Showdown 系のダメージ計算に準拠する自動耐久調整ツールです。複数の仮想敵シナリオを同時に満たす `H / B / D` 配分を探し、候補の理由を説明できる静的 Web アプリとして育てます。

M0 では React + Vite + TypeScript の土台と、既存の軽量 UI プロトタイプを移植した作業画面を用意しました。M1 では、ダメージ計算 adapter や探索へ進みすぎず、日本語入力・表示を Showdown canonical name へ解決する localization / resolver layer の最小構成を追加しています。M2 では、UI 入力から独立した domain model layer を追加し、後続の `@smogon/calc` adapter と H/B/D 同時探索が受け取る型の境界を固めています。M3 では、`Build` / `ScenarioHit` / `FieldState` / `SideState` を `@smogon/calc` の `Pokemon` / `Move` / `Field` / `Side` へ変換する薄い adapter layer を追加しました。

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

## M2 domain model layer

M2 の本体実装は `src/domain/model.ts` に置いています。ここでは実ダメージ計算や H/B/D 探索は行わず、UI state、resolver output、計算 adapter / search layer の責務を分けるための型だけを定義します。

- `EntityRef`: resolver の `exact` / `alias` 結果だけを domain model に渡すための参照型。`canonicalName` と `displayNameJa` を別の branded string として扱い、計算側が日本語表示名を canonical name と取り違えにくい形にする
- `Build`: ポケモン、レベル、性格、個体値、努力値、特性、持ち物、テラスタイプを resolver 済みの参照で表す
- `Scenario` / `ScenarioHit`: 仮想敵、技、フィールド、壁、ランク、急所、連続被弾を扱うための被弾シーケンス
- `SurvivalConstraint`: 有効/無効、必要耐久回数、必要生存確率を表す
- `ScenarioEvaluation`: M3 で `@smogon/calc` adapter が返す damage rolls / range / survival rate を載せる器
- `CandidateResult`: M4 の H/B/D 同時探索が返す努力値候補、各シナリオ結果、残り努力値、ボトルネック説明を載せる器

resolver から domain model に進む境界は `toEntityRef(result, kind)` で扱います。`exact` / `alias` 以外、または kind が一致しない結果は `null` になり、`ambiguous` / `not-found` は UI 側で確認や修正へ戻す設計です。

## M3 smogon adapter layer

M3 の本体実装は `src/calc/smogonAdapter.ts` に置いています。adapter は resolver 済みの `EntityRef.canonicalName` だけを `@smogon/calc` に渡し、`displayNameJa` や UI 入力文字列を計算入力として扱いません。

- `toSmogonPokemon(build, boosts)`: domain の `Build` から `@smogon/calc` の `Pokemon` を作る
- `toSmogonMove(hit)`: domain の `ScenarioHit` から `Move` を作る。`critical` は `Move.isCrit` に渡し、`repeat` は M4 のシーケンス評価層で扱う
- `toSmogonField(field, hit)` / `toSmogonSide(side)`: domain の field / side state を `Field` / `Side` に変換する
- `calculateSmogonHit(defenderBuild, hit, fieldState)`: `calculate` を呼び、damage rolls、damage range、description を `ScenarioHitEvaluation` として返す

`src/calc/smogonAdapter.test.ts` では direct `@smogon/calc` 呼び出しと adapter 結果の damage rolls / range / description が一致することを確認しています。M3 では H/B/D 探索本体や生存確率集計は実装せず、M4 から呼びやすい 1 hit 評価の境界だけを作っています。
