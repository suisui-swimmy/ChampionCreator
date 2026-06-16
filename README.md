<img src="readme-images/logo.png" alt="ChampionCreator">

# ChampionCreator

ChampionCreator は、Pokemon Champions / Pokemon Showdown 系のダメージ計算に準拠しながら、複数の仮想敵条件を同時に満たす能力ポイント配分を探索する静的 Web アプリです。
耐久調整、火力ライン、素早さラインを同じ作業画面で扱い、条件を満たす候補の SP 配分、使用SP、残りSP、最厳条件、ダメージ詳細を比較できます。

公開URL: <https://suisui-swimmy.github.io/ChampionCreator/>

Wiki: <https://github.com/suisui-swimmy/ChampionCreator/wiki>

## 実装機能

- 複数の仮想敵シナリオを同時に満たす `H / B / D` 耐久配分を探索する
- 1つのシナリオ内で複数攻撃を順番に受ける条件を評価する
- 必要耐久回数と必要生存率を満たす候補だけを返す
- 調整対象が仮想敵を倒すための `A / C` 火力ラインを探索する
- 任意の相手や実数値を抜くための `S` ラインを探索する
- `A / C / S` の必要SPを固定条件として、耐久候補の SP 予算へ統合する
- 候補ごとの最厳条件を表示し、どの条件がボトルネックかを確認できるようにする

## 技術仕様

### Runtime / build

- Frontend: React 19 + TypeScript + Vite
- Test runner: Vitest
- Hosting: GitHub Pages を想定した静的配信
- Browser storage: ボックス機能は localStorage ベース
- PWA: Web App Manifest に対応。Service Worker によるオフラインキャッシュは未実装

### Damage calculation boundary

- ダメージ計算エンジンは `@smogon/calc` に依存します
- 現在の直接依存は `@smogon/calc@^0.11.0` です
- 計算世代は `Generations.get(9)` を使用します
- `src/calc/smogonAdapter.ts` が `Pokemon` / `Move` / `Field` / `Side` への変換境界です
- アプリ側では独自のダメージ計算式、独自のタイプ相性、独自の乱数分布を主計算として実装しません
- 最終候補の合否判定は、resolver 済み canonical name を `@smogon/calc` に渡して再評価します
- 公式画像、タイプ色、日本語表示名は UI 表示用であり、計算結果には影響しません

### Japanese localization layer

ChampionCreator は、日本語入力・表示と Showdown canonical name を分離します。

- 日本語名、別名、検索用文字列は `src/localization/` で解決します
- resolver の入力種別は Pokemon / Move / Item / Ability / Nature / Type を分けて扱います
- resolver は `exact` / `alias` / `ambiguous` / `not-found` を返し、曖昧さや欠損を握りつぶしません
- 計算 adapter には日本語入力を直接渡さず、Showdown canonical name だけを渡します
- 生成済みデータは `src/data/generated/*.gen.json`、手動補正は `src/data/overrides/` に置きます

日本語レイヤーの設計は `@suisui-swimmy/damage-calc-ja-layer` の方針をベースにしています。`@suisui-swimmy/damage-calc-ja-layer` は開発時の参考実装であり、ChampionCreator 本体はそこへ runtime import しません。必要な resolver、データ、adapter 方針だけを本体側へ移しています。

### Search model

- `H / B / D` は1つの候補として同時探索します
- `A / C / S` は入力済みSP、火力ライン、素早さラインを固定条件として扱います
- 探索対象は Pokemon Champions の Stat Points / SP です
- 探索は Web Worker で実行し、UI 側は requestId で古い結果を破棄します
- 候補は使用SP、残りSP、最厳条件への余裕などで順位付けします
- 上位候補は最終的に全シナリオで再評価します

## SP モデル

Pokemon Champions の Stat Points / SP を探索単位にしています。

- 各能力は `0..32 SP`
- 6能力合計は `66 SP` まで
- `0 SP` は `0 EV` として扱います
- `1 SP` 以上は `4 + (SP - 1) * 8 EV` へ変換します
- `32 SP` は `252 EV` です
- `@smogon/calc` へ渡す直前に、実数値が一致する Showdown EV 相当へ変換します

## データと検証

主なデータ:

- `src/data/generated/pokemon-options.gen.json`
- `src/data/generated/move-options.gen.json`
- `src/data/generated/item-options.gen.json`
- `src/data/generated/ability-options.gen.json`
- `src/data/generated/nature-options.gen.json`
- `src/data/generated/type-options.gen.json`
- `src/data/generated/pokemon-abilities.gen.json`
- `src/data/overrides/ja-aliases.json`
- `src/data/overrides/ja-label-overrides.json`

生成済み JSON は直接編集せず、必要な補正は scripts または overrides 側で扱います。

`npm run check` は次をまとめて確認します。

- 日本語データ validation
- ポケモン別特性データ validation
- 画像アセット validation
- unit tests
- production build

## 使い方

1. 公開URLを開く
2. 調整対象のポケモン、性格、特性、持ち物、現在SPなどを入力する
3. 仮想敵シナリオに相手、技、攻撃側条件、必要耐久回数、生存率などを入力する
4. 必要ならシナリオを `耐久調整` / `火力調整` / `素早さ調整` に切り替える
5. `計算開始` を押す
6. 候補一覧から配分、残りSP、最厳条件、詳細ダメージを確認する
7. 使いたい候補の `適用` で調整対象へ反映する

詳しい入力項目、ボックス機能、火力ライン、素早さラインの説明は Wiki を参照してください。

## ブラウザ内保存

ボックス機能で、現在の調整対象、シナリオ、火力ライン、素早さラインなどの入力条件をブラウザ内に保存できます。

保存データは同じブラウザ内の保存領域を使います。別端末、別ブラウザ、ブラウザデータ削除後には引き継がれません。

ボックス画面の `バックアップを書き出す` / `バックアップを読み込む` から、保存済みボックスを JSON ファイルとして退避・復元できます。読み込み時は現在の保存済みボックスをバックアップ内容で置き換えます。

## 制限

- 本ツールは非公式のファンツールです。ゲーム内の結果と完全に一致することは保証しません
- Pokemon Champions と Showdown の仕様差、未対応データ、特殊処理により、実際のゲーム内結果と異なる可能性があります
- 一部のフォーム違い、技、特性、持ち物は未対応または仮対応の場合があります
- `@smogon/calc` に存在しないデータは、原則として計算の正として扱いません
- 条件が複雑なほど探索に時間がかかります
- 重要な調整は実機でも確認してください

## 開発

Node.js 22 系を想定しています。

```powershell
npm install
npm run dev
```

主な確認コマンド:

```powershell
npm test
npm run build
npm run check
```

個別確認:

```powershell
npm run validate:localization
npm run validate:pokemon-abilities
npm run validate:artwork-assets
npm run typecheck
```

## ライセンス・権利表記

このリポジトリは MIT License の下で公開されています。

ただし、ゲーム内の画像やポケモンの名称などに関する著作権は、任天堂 / クリーチャーズ / ゲームフリークに帰属しており、本ライセンスの適用対象外です。

本リポジトリは非公式のファンプロジェクトであり、任天堂 / クリーチャーズ / ゲームフリークとは一切関係がありません。
