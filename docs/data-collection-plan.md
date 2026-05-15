# Milestone -1 Data Collection Plan

ChampionCreator のデータ収集は、「計算に必要な正規データ」と「UI を便利にする補助データ」と「計算精度に関わる注意情報」を混ぜないことを最優先にする。

以前のように、使えそうなものを全部 1 つの JSON に入れる運用は避ける。

## 結論

先に `@smogon/calc` を導入し、ローカルに入った package の型定義と runtime API を確認してから、本収集へ進む。

理由:

- Pokemon / Move / Field / calculate の受け取れる形を先に確定できる
- Showdown 名・ID を ChampionCreator の内部正規 ID にできる
- 技威力、タイプ相性、乱数ダメージなどを独自データとして持たずに済む
- 不足データだけを `@pkmn/data` / `@pkmn/dex` / 手動オーバーレイで補う判断ができる

ChampionCreator はレギュレーション合法性チェッカーではなく、ユーザーが持ち込んだシナリオを検証する計算サンドボックスとして扱う。
そのため、現行レギュレーションの使用可能ポケモン・技・ギミックを制限するホワイトリストは、必須データにしない。
`@smogon/calc` / Showdown 由来データに存在するものは、原則として全解禁に近い入力候補として扱う。

## 収集するデータ

### 1. 計算エンジン基準データ

用途:

- `@smogon/calc` へ渡すための正規名・正規 ID の確認
- ポケモン、技、特性、持ち物、性格、タイプの入力候補生成
- `@smogon/calc` に存在するもの / 存在しないものの判定

原則:

- 技威力、タイプ相性、乱数ダメージ、補正計算は再実装しない
- アプリが持つのは「検索用・表示用・計算精度確認用」の薄い index に限定する

初期ファイル案:

```text
src/data/generated/calc-species.gen.json
src/data/generated/calc-moves.gen.json
src/data/generated/calc-items.gen.json
src/data/generated/calc-abilities.gen.json
src/data/generated/calc-natures.gen.json
```

### 2. 計算精度オーバーレイ

用途:

- 入力されたシナリオを `@smogon/calc` で信頼して計算できるかを表にする
- Showdown / `@smogon/calc` と Champions の計算仕様差分だけを管理する
- 現行レギュレーションで使えるかどうかは原則として管理しない

初期ファイル案:

```text
src/data/champions/champions-support-matrix.json
```

状態は `src/domain/model.ts` の `SupportStatus` と同じ意味に揃える。

```json
{
  "schemaVersion": 1,
  "dataVersion": "2026-05-15",
  "entries": [
    {
      "id": "mega-tera",
      "label": "Mega / Tera",
      "status": "needs-confirmation",
      "handling": "計算エンジンで表現できる範囲を確認し、未確定仕様は精度ラベルや手入力上書きで扱う"
    }
  ]
}
```

### 3. 日本語表示・検索 index

用途:

- UI で日本語名から検索できるようにする
- 内部では Showdown 名へ解決する
- 表示名・別名・フォーム名の揺れを UI 層に閉じ込める

初期ファイル案:

```text
src/data/generated/localized-search-index.gen.json
```

最小形:

```json
{
  "schemaVersion": 1,
  "dataVersion": "2026-05-15",
  "pokemon": [
    {
      "id": "garchomp",
      "showdownName": "Garchomp",
      "displayNameJa": "ガブリアス",
      "aliasesJa": ["ガブ"],
      "sourceStatus": "supported"
    }
  ],
  "moves": [
    {
      "id": "earthquake",
      "showdownName": "Earthquake",
      "displayNameJa": "じしん",
      "aliasesJa": [],
      "sourceStatus": "supported"
    }
  ]
}
```

### 4. 画像・アイコン manifest

用途:

- 画像ファイルとポケモン ID を結びつける
- 画像がなくても計算導線を壊さない
- 取得元、配置場所、欠損状態を追えるようにする

初期ファイル案:

```text
public/assets/pokemon-icons/
public/assets/official-artwork/
src/data/generated/pokemon-assets.gen.json
```

`public/assets/pokemon-icons/pm0000_00_00_00_0.png` はダミーとして扱う。本データの根拠にしない。

`others/official-artwork/` と `others/official_artwork_japanese_names.csv` は素材候補として使う。
まず manifest と fallback 状況を確認し、`supported` species の画像導線が埋まったら `npm run sync:pokemon-artwork` で `public/assets/official-artwork/` へまとめて同期する。

最小形:

```json
{
  "schemaVersion": 1,
  "dataVersion": "2026-05-15",
  "assets": [
    {
      "pokemonId": "bulbasaur",
      "showdownName": "Bulbasaur",
      "displayNameJa": "フシギダネ",
      "artwork": "/assets/official-artwork/1.png",
      "icon": null,
      "source": "local-other-official-artwork",
      "sourceStatus": "supported"
    }
  ]
}
```

### 5. 手入力・上書き用の空データ

用途:

- データベース未対応でも、実数値や技威力の手入力で検証できるようにする
- 公式 / Showdown 側の対応を待たずに UI の導線を壊さない
- 新シーズンや将来ギミック解禁前の what-if 検討でも使えるようにする

これは「収集データ」ではなく、ドメインモデルと UI 入力として扱う。

`manualOverrides` は `Build` / `Scenario` / `MoveRef` の周辺で扱い、生成データへ混ぜない。

## 収集しないデータ

Milestone -1 では次を集めない。

- 使用率ランキング
- HOME データ
- 対戦環境の自動取得データ
- 実行時 API 前提のデータ
- スクレイピングしないと維持できないデータ
- 独自のタイプ相性表
- 独自のダメージ計算表
- 独自の技補正表
- 現行レギュレーションの使用可能ポケモン・技・ギミックを縛る必須ホワイトリスト

必要になった場合も、まず `@smogon/calc` / `@pkmn` で扱えるか確認する。
レギュレーションプリセットを作る場合は、計算の必須経路ではなく任意の UI 補助として扱う。

## 推奨ディレクトリ

```text
scripts/
  inspect-smogon-calc.mjs
  generate-calc-data.mjs
  generate-localized-search-index.mjs
  generate-pokemon-assets.mjs
  generate-pokemon-options.mjs
  sync-official-artwork.mjs
src/
  data/
    champions/
      champions-support-matrix.json
    generated/
      calc-species.gen.json
      calc-moves.gen.json
      calc-items.gen.json
      calc-abilities.gen.json
      calc-natures.gen.json
      localized-search-index.gen.json
      pokemon-assets.gen.json
public/
  assets/
    pokemon-icons/
    official-artwork/
others/
  official-artwork/
  official_artwork_japanese_names.csv
```

ルール:

- `others/` は素材置き場。アプリが直接 import しない
- `src/data/generated/` はスクリプト生成物。手で直さない
- `src/data/champions/` は人間が確認して管理する計算仕様差分
- `public/assets/` はブラウザから読む画像だけ置く

## `@smogon/calc` 導入後に確認すること

最初に `scripts/inspect-smogon-calc.mjs` を作り、次を確認する。

- package version
- license 表記
- import できる主要 API
- Gen9 の Pokemon / Move / Item / Ability / Nature の一覧取得方法
- `Pokemon` / `Move` / `Field` / `calculate` の最小 smoke test
- 天候、フィールド、壁、急所、ランク補正、複数対象補正を渡す shape
- Tera / Mega など、Champions に関係しそうな仕様の計算表現可否

確認結果で、次を決める。

- `@smogon/calc` だけで足りるデータ
- `@pkmn/data` / `@pkmn/dex` を追加した方がよいデータ
- Champions 側で `needs-confirmation` に置くべき計算仕様
- UI では手入力に逃がすべきデータ

## `@smogon/calc` 由来データ生成

`scripts/generate-calc-data.mjs` は、`@smogon/calc` Gen9 のデータから次の JSON を生成する。

```text
src/data/generated/calc-species.gen.json
src/data/generated/calc-moves.gen.json
src/data/generated/calc-items.gen.json
src/data/generated/calc-abilities.gen.json
src/data/generated/calc-natures.gen.json
src/data/generated/calc-types.gen.json
```

この生成データは入力候補・検索・Showdown 名への解決に使う。
ダメージ計算、タイプ相性、技威力補正、乱数処理の正規ソースは引き続き `@smogon/calc` 本体とし、生成 JSON の値を計算式として再実装しない。

生成 JSON は `schemaVersion`、`dataVersion`、`source`、`kind`、`entries` を持つ。
`generatedAt` のような実行時刻は持たせず、同じ `@smogon/calc` version からは同じ出力になる形を優先する。

species catalog では、`@smogon/calc` に存在するかどうかを `sourceStatus`、ChampionCreator の通常 UI 入力候補として扱うかどうかを `appSupportStatus` で分ける。
Showdown / CAP / original species は `appSupportStatus: "unsupported-temporary"` として default UI から外せるようにし、計算エンジン由来データとしては削除しない。
`Garchomp-Mega-Z` のように ChampionCreator 側で明示的に救う特殊フォームは `project-supported-exception` tag を付けて `supported` のまま扱う。

## 日本語名 index と画像 manifest

`scripts/generate-localized-search-index.mjs` は、calc species catalog と `others/official_artwork_japanese_names.csv` から `src/data/generated/localized-search-index.gen.json` を生成する。
この index は UI 検索用であり、計算データではない。
`appSupportStatus: "unsupported-temporary"` の species は index には残すが、default UI では除外できるようにする。

`scripts/generate-pokemon-assets.mjs` は、同じ CSV と `others/official-artwork/` から `src/data/generated/pokemon-assets.gen.json` を生成する。
manifest には素材元の `sourcePath` と、将来 public 配信用に使う `suggestedPublicPath` を入れる。
`supported` species の画像 fallback が埋まっていることを確認した後は、`scripts/sync-official-artwork.mjs` で `others/official-artwork/` の PNG を `public/assets/official-artwork/` に同期する。

Meowstic や Tatsugiri の Mega など、calc catalog では複数フォームに分かれているが素材側では共有フォームとして扱われるものは、`fallbackFromCalcId` と `sourceStatus: "adapter-temporary"` で明示する。
これは計算値を変える処理ではなく、表示名・画像の共有だけに使う。

`scripts/generate-pokemon-options.mjs` は、UI の通常候補に使う軽量 JSON として `src/data/generated/pokemon-options.gen.json` を生成する。
ここには `appSupportStatus: "supported"` の species だけを入れる。
種族値、特性、体重、詳細な画像 manifest は含めず、UI 表示・検索に必要な `id`、`label`、`showdownName`、`types`、`searchText`、`artwork`、source status だけに絞る。
default UI で使う場合は、この options JSON を優先し、フル catalog は詳細画面・adapter・検証用途に留める。
options JSON は UI 配信用なので minified で出力する。
直対応の entry は source status を省略し、fallback が必要な entry だけ `fallback` を持つ。
現在のワイヤーフレーム UI では、この options JSON を遅延 import し、通常候補の select、調整対象画像、シナリオカードのポケモン画像表示に使う。

## 完了条件

Milestone -1 のデータ収集は、次を満たしたら完了とする。

- `@smogon/calc` の実 API に合わせた生成スクリプト方針が決まっている
- ポケモン・技・特性・持ち物・性格・タイプの入力候補が、Showdown 名へ解決できる
- Champions 固有仕様の計算精度状況が matrix として分かる
- 画像 manifest があり、画像欠損時も UI と計算が壊れない
- 手入力・任意上書きで未対応データを回避できる
- レギュレーション合法性を必須検証しない方針が README / AGENTS から分かる
- README からデータ方針を辿れる
