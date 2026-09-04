# ChampionCreator AGENTS

## この文書の役割

ChampionCreator(CC) は M0〜M9 の初期開発マイルストーンを完了し、現在は完成済みアプリへの機能追加、不具合修正、データ更新、UI 改善、公開運用が中心。

この文書は、過去の実装手順を再現するロードマップではなく、今後の変更でも守る設計境界と作業ルールを定義する。

- 現在の実装状況は、対象コード、対象テスト、`README.md`、`package.json` を確認して判断する
- 現在地と直近の引き継ぎは `PROGRESS.md`、過去の詳細履歴は必要な場合だけ `PROGRESS.archive/` を参照する
- 完了した Firebase 同期の実装・実施記録は、月別履歴とは別の `PROGRESS.archive/SYNC-MILESTONES.md` を参照する
- 完了済みマイルストーンを未着手タスクとして再開しない
- 将来候補は、ユーザーが依頼した範囲または明示された課題だけを扱う
- この文書と現行実装が矛盾する場合は、勝手に片方へ寄せず、実装経路と影響を確認してから修正する

## 現在のプロジェクト目的

ChampionCreator は、Pokemon Champions / Pokemon Showdown 系の計算に準拠しながら、複数の仮想敵条件を同時に扱うブラウザ完結型の調整ツール。

現在の主な機能:

- 複数シナリオを同時に満たす `H / B / D` 耐久配分の探索
- 指定 KO 確率を満たす `A / C` 火力ラインの算出
- 仮想敵や実数値を基準にした `S` ラインの算出
- 直接攻撃と、明示した定数ダメージ・回復を順番どおりに扱う HP シーケンス評価
- `A / C / S` の固定 SP を含めた合法な能力ポイント配分の評価
- 全合格候補のページネーション、並び替え、候補適用
- 調整対象ボックス、仮想敵ボックス、バックアップ入出力
- Google 認証を使う任意のボックス同期、ブラウザ別クラウド下書き、アカウント管理
- デスクトップとモバイルに対応した作業画面
- 公開ガイドと静的ホスティング

このツールの本質は、耐久指数や火力指数を独自式で近似することではない。指定条件を正しい計算境界で評価し、合法な配分と、その候補が通る理由を説明できる状態を保つこと。

## 作業開始時の確認

毎回リポジトリ全体を読む必要はない。次の順で、依頼に関係する範囲だけ確認する。

1. `AGENTS.md`
2. `PROGRESS.md` の `Current Snapshot` と最新数件。過去項目が必要な場合だけ `PROGRESS.archive/` を検索する
3. 対象の実装ファイルと対応テスト
4. コマンド、依存、バージョンに関係する場合は `package.json`
5. ユーザー向け仕様に関係する場合は `README.md` と `guide/`
6. 必要な場合だけ `docs/`、`scripts/`、`.github/workflows/`

`others/` は参考資料置き場であり、通常の修正で毎回読む対象ではない。次の場合だけ必要な資料を選んで参照する。

- localization / resolver の設計境界を変更する
- `@smogon/calc` adapter の設計を変更する
- 初期仕様の意図を確認しないと現行コードだけでは判断できない

本体は `others/` なしで動く状態を維持し、runtime import しない。

## 最重要の設計境界

### 1. 直接ダメージ計算の基盤は `@smogon/calc`

`@smogon/calc` を、直接攻撃のダメージロール、タイプ相性、ランク補正、乱数分布、補正順、丸め処理などを評価する基盤エンジンとする。直接ダメージの最終結果は、次のいずれかの監査済み経路で確定する。

- upstream native: 固定した upstream commit の `@smogon/calc` が直接対応する
- exact alias: 表示・保存上の canonical name を維持しつつ、戦闘中の挙動が完全に同一と確認した既存 mechanics へ計算時だけ投影する
- CC compatibility patch: 固定した upstream full SHA に対し、再現可能な fork commit または patch queue と回帰テストを適用した `@smogon/calc` build を使う

ポケモン・フォーム・技・特性・持ち物の存在、フォームとの組み合わせ、ゲーム内の実装状況、表示名・別名、使用率の参照元は、`@smogon/calc` のデータ更新を待つ必要はない。権威ある出典と対象version / 確認日を記録したゲームデータまたは明示された仕様を、source data・override・generator・validation の境界で先行反映できる。種族値・タイプ・威力・効果など計算へ影響するmetadataは、監査済みCalc経路が実際にその値を消費するまで`calculation-supported`としない。metadata の対応可否と、mechanics / calculation の対応可否は分けて扱う。

新規 mechanics を既存 mechanics と完全に同一と証明できない場合は、近い特性や技へ代用しない。表示や入力候補だけを先行対応する場合も、効果なしとして黙って計算せず、`計算未対応`または既存の待機表示を返す。公式仕様、適用順、丸め、無効化条件まで確認できる場合は、アプリ外側でdamage配列を後補正せず、上記CC compatibility patchとしてCalc内部の適用境界へ実装する。

禁止:

- 独自のダメージ計算式を主計算として実装する
- 独自のタイプ相性、乱数分布、ランク補正で最終結果を決める
- `@smogon/calc` の返したdamage配列へ、アプリ側で倍率や丸めを後付けして候補の合否を上書きする
- 効果が似ているだけの技・特性を exact alias として扱う
- `node_modules`、既存tarball、生成済みvendor内容を手作業で改変する
- upstream native と CC compatibility patch を二重適用する
- mechanics未対応のcanonicalを効果なしや無関係な既存効果として黙って計算する
- UI 表示用の日本語名や画像を計算条件として使う

許可:

- domain model を `@smogon/calc` の `Pokemon` / `Move` / `Field` / `Side` へ変換する薄い adapter
- 出典・対象version / 確認日・validatorを持つ確認済みmetadataをsource data・override・generatorから更新し、既存のCalc対応canonicalを明示的に渡す
- 効果の完全一致を根拠と回帰テストで固定した、限定的なengine alias
- upstreamへ提出可能で、対象full SHA・根拠・active / inactiveテスト・sunset条件を持つ再現可能なCC compatibility patch
- 複数攻撃と HP イベントを順番に処理する管理層
- 探索の事前フィルタ、候補列挙の絞り込み、キャッシュ、バッチ化
- `@smogon/calc` の結果を日本語 UI 向けに整形する表示層

対応状態は最低でも `metadata-supported` / `engine-supported` / `calculation-supported` を区別する。最終候補は、同じ監査済みCalc経路で必ず再評価し、不合格候補や未対応mechanicsを無効果として通した候補を返さない。

現在の主な境界:

- `src/calc/smogonAdapter.ts`: canonical name から直接ダメージを計算する adapter
- `src/calc/hpEventRules.ts`: 選択式 HP イベントのルール
- `src/calc/simulateHpSequence.ts`: 直接ダメージと HP イベントの順序付き評価
- `src/calc/moveHpMechanics.ts`: 現在 HP に依存する技などの判定

`@smogon/calc` の更新調査では、npm の公開バージョンだけで判断しない。repo 内の `.agents/skills/audit-smogon-calc-upstream/SKILL.md` に従い、現在の pin と upstream 最新コミットの差分、runtime 影響、metadata / exact alias / CC compatibility patch の対応状況、native化したpatchの撤去可否、採用方法を確認する。audit-only依頼では実装や依存更新を行わない。

### 2. 日本語表示と Showdown canonical name を混ぜない

日本語入力、別名、検索、表示は localization layer の責務。calc / search layer には resolver 済みの Showdown canonical name だけを渡す。

- resolver は `exact` / `alias` / `ambiguous` / `not-found` を区別する
- `exact` / `alias` だけを canonical name として計算層へ渡す
- `ambiguous` / `not-found` を自動補完で握りつぶさず、UI へ返す
- Pokemon / Move / Item / Ability / Nature / Type の種別を混ぜない
- canonical name を通常の日本語 UI に露出させない

現在の主な境界:

- `src/localization/`: normalize、resolver、表示名ルール
- `src/data/generated/`: scripts から生成される catalog
- `src/data/overrides/`: 手動補正の正規配置
- `scripts/`: 生成と validation

生成済み JSON を直接編集しない。必要な変更は生成 script、source data、override、validation のいずれかで行い、再生成後の差分を確認する。

### 3. domain model と UI state を混ぜない

UI 入力をそのまま calc / search へ渡さず、`src/domain/` と UI 変換層で正規化する。

維持する主な概念:

- `Build`: ポケモン、レベル、性格、個体値、SP、特性、持ち物、テラスタイプなど
- `Scenario`: 仮想敵と戦闘条件
- `ScenarioHit`: 順番を持つ攻撃条件
- `SurvivalConstraint`: 必要耐久回数と必要生存率
- `ScenarioEvaluation`: damage rolls、致死率、生存率、HP イベント内訳
- `CandidateResult`: SP 候補、各シナリオ結果、残り SP、ボトルネック

新しい条件を追加するときは、UI だけに値を足さず、domain、serialization、search / calc、Worker、表示、テストのどこまで影響するかを先に追う。

### 4. `H / B / D` は1候補として同時探索する

`HB` と `HD` を別々に解いて後から合成しない。1つの `H / B / D` 候補を、有効な全シナリオへ直接評価する。

SP 制約:

- 各能力は `0..32 SP`
- 6能力合計は `66 SP` まで
- `A / C / S` など固定済み SP も予算に含める
- `0 SP => 0 EV`
- `1 SP => 4 EV`
- 以降は `+8 EV`
- `32 SP => 252 EV`
- `@smogon/calc` へ渡す直前に、実数値が一致する Showdown EV 相当へ変換する

探索高速化で候補を絞る場合も、最終合否と最終並び順の意味を変えない。物理・特殊・可変参照技など、条件に関係する耐久軸の判定は既存 helper と回帰テストを使う。

現在の主な境界:

- `src/search/defenceSearch.ts`: H/B/D 候補列挙と全シナリオ評価
- `src/search/offenseAdjustment.ts`: A/C 火力ライン
- `src/search/speedAdjustment.ts`: S ライン
- `src/search/maximizeRemainingBulk.ts`: 残り SP の耐久配分
- `src/ui/defenceSearchUi.ts`: UI 入力と探索結果の統合

### 5. HP イベントは直接ダメージと分離する

定数ダメージ、回復、反動などを `@smogon/calc` の直接ダメージへ混ぜない。アプリ側は、明示された効果を順番付き HP イベントとして評価する。

- 個々の直接攻撃ロールは `@smogon/calc` から取得する
- タイプ相性や地面判定が必要な HP イベントでは、利用可能な世代データと既存 helper を使う
- 発動順、対象、頻度、消費済み状態を domain と評価結果に明示する
- 新しい HP イベントは、単発、複数回、連続技、無効化特性、境界 HP のテストを追加する
- 完全な対戦シミュレータへ暗黙に拡張しない

未対応範囲や簡略化は `README.md` の制限へ明記し、実装済みのように見せない。

### 6. 探索は Worker 境界を維持する

重い探索は Web Worker で実行し、UI thread を固めない。

維持する契約:

- `start`
- `progress`
- `partialResult`
- `complete`
- `error`
- `cancel`
- `requestId` による古い結果の破棄

入力変更、ボックス読み込み、再計算、画面破棄の後に、古い request の結果を新しい state へ混ぜない。全件探索では、途中プレビュー件数と最終合格候補数を区別する。

現在の主な境界:

- `src/worker/defenceSearchWorker.ts`
- `src/worker/defenceSearchWorkerClient.ts`
- `src/worker/defenceSearchWorker.test.ts`

### 7. 保存データは互換性と失敗経路を持つ

ChampionCreator は GitHub Pages の静的フロントを維持し、guest / local-first の browser storage と JSON backup を常に利用できるようにする。Google ログインを選んだ場合だけ、承認済みの Firebase Authentication / Cloud Firestore / App Check 境界でアカウント同期を行う。

- 保存形式には `schemaVersion` を持たせる
- schema 変更では migration または明確な非対応エラーを用意する
- 必須項目欠落、unknown schema、破損 JSON、resolver 未解決、SP 超過を区別する
- 読み込めない値を黙って正常値へ置き換えない
- 保存対象は入力条件を正とし、古い計算結果を唯一の正にしない
- 調整対象ボックス、仮想敵ボックス、作業中下書きを別の保存・同期領域として扱い、計算結果、候補一覧、Worker state、使用率データ、チュートリアル state は保存・同期しない
- local / cloud / backup の payload は既存 parser で validation / migration し、invalid / unknown future schema を空データとして扱わない。1件の破損 remote record で他の保存内容を空にしない
- guest / local-first、offline 中の local 操作、JSON backup を同期障害でも維持し、logout / account switch で guest namespace と UID namespace を混在させない
- 同期の競合・削除でデータを黙って失わず、削除の tombstone と未送信変更を保持し、競合は解決可能な状態またはコピーとして残す
- Google 認証は本人確認に限定し、Drive / 連絡先などの追加権限を要求しない。Firebase Admin credential、service account key、Google OAuth client secret を browser bundle、repository、Pages artifact に含めない
- 同期データの owner UID、kind、schema、許可 field、payload size は Security Rules でも検証し、未認証・別 UID の read / write を拒否する
- 白紙初期状態と、削除できるサンプルの one-time seed を壊さない
- ユーザーが削除したサンプルを起動時に復活させない
- 読み込み時は進行中 Worker と表示中結果を安全に破棄する

現在の主な境界:

- `src/ui/shareState.ts`
- `src/ui/boxStorage.ts`
- `src/ui/enemyBoxStorage.ts`
- `src/sync/`

似た serialization 形式を増やす前に、既存 share / box schema を再利用できるか確認する。

## UI とガイドの方針

### 作業画面

既存の「黒金を基調にした、シンプルで密度のある調整ツール」を維持する。

- 派手なランディングページ、大きいヒーロー、過剰なカード装飾へ寄せない
- デスクトップでは調整対象、シナリオ、候補、詳細を比較しやすい作業台を保つ
- モバイルでは overview と下シートを使い、入力、候補、詳細、ボックスへ段階的に移動できる状態を保つ
- 主要操作を hover 専用にしない
- タップ、フォーカス、キーボードでも操作できるようにする
- テキスト、入力値、ボタン、popover、dialog を画面外へはみ出させない
- 候補一覧は全件を同時に DOM 描画せず、既存の20件ページネーションを維持する
- 状態色、SP色、タイプ色は意味のある用途だけに使う

色や余白の正は `src/styles.css` の CSS variables と既存 semantic class。新しい箇所へ同じ Hex を重複して増やさない。特に能力色は `--hp` / `--atk` / `--def` / `--spa` / `--spd` / `--spe` を使う。

既存 UI 部品は `src/ui/primitives.tsx` と既存 Radix UI 構成を優先し、似た独自部品を増やしすぎない。

### UIサイズ体系

No.349 / No.350で確立した役割別サイズ体系を、新規UIと既存UIの拡張にも継承する。36pxは通常操作の基準であり、全要素を画一的に36pxへ揃える規則ではない。

- サイズの正は`src/styles.css`の`--mobile-*` / `--desktop-*` control・icon・text variablesとする。新規UIへ同じ`32px` / `36px` / `40px` / `44px`をリテラルで増やさず、既存primitiveまたは文脈classから参照する
- `compact`: 入力欄内のlock、stepper、候補展開など密度が必要な操作。幅32px以上、icon 16pxとし、mobileでは高さ36px、non-mobileの密集欄内では32x32pxを許可する。non-mobileの入力欄自体は高さ32px・文字13pxを基準とする
- `standard`: 通常の独立した操作。36x36pxを基本とし、iconは18〜20px、操作文字は13px。header / toolbarの既存契約は36x36px、SVG / mask 20x20px、主要クラスタgap 8pxを維持する
- `primary`: 計算、保存、読込など結果や保存状態を確定する主要操作。高さ40px以上、文字14pxを基本とする
- `comfort`: 目次、メニュー、disclosureなど縦に余裕のある開閉行。高さ44px以上、文字13〜14pxを基本とする
- 攻撃追加、シナリオ追加、候補行、ボックスカードなど、カード全体が十分な操作領域を持つ既存の大型操作は専用寸法を維持する。内部の表示要素まで36pxへ拡大しない

文字サイズは、本体見出し15px、通常操作・カード名13px、押せる補助文12px以上、非操作メタ情報11pxを基準とする。モバイルの編集可能なtext input / selectはiOSの自動zoomを避けるため16px以上を維持する。guide / privacyは本文14px、lead 15px、ナビ13px、footer 12px、tips / flow / table本文12px以上を基準とする。

- WCAG 2.2 AAの24x24 CSS pxを絶対下限とするが、新規の通常操作は原則standard以上を選ぶ。見た目のtrack、bar、iconを小さく保つ場合も、実ヒット領域は役割tierまで拡張する
- 透明なヒット領域を使う場合は、隣接操作やシナリオ分岐と重ねず、誤操作しないことを実測する
- 720px以下をmobile、721px以上をnon-mobileのサイズ境界とする。1180px / 1181pxはworkbenchのレイアウト・密度境界であり、操作領域を旧小型寸法へ戻す境界として使わない
- `max-width: 380px`ではpadding、gap、列幅だけを圧縮し、操作領域、操作文字、入力文字を再縮小しない。意図的なrail / table以外の横scrollを増やさない
- 実操作を`tabIndex={-1}`で通常のTab順から外さない。roving focusやdialogの初期focusなど、明示したfocus管理上の理由がある場合だけ例外とし、focus-visible / focus-withinを必ず確認する
- 新規UIのテストは、役割tierとCSS variablesの契約をassertする。広い`[\s\S]*?`や重複した36px正規表現で偶然passさせず、該当media blockとsemantic classを限定して検証する

### 表示文言

- ユーザーが指定した日本語文字列、記号、表記、順序をそのまま確認する
- 近い言い換えでテストや確認を済ませない
- named bug は同じ意味カテゴリ全体を確認し、名前付き1件だけの例外処理で済ませない
- エラーは、入力不足、resolver 未解決、計算未対応、保存形式不正、Worker error を区別する
- UI で表示する計算説明は、calc 由来の値とアプリ側 HP イベントを区別する

### 公開ガイド

`guide/` はアプリ本体とは別の利用導線であり、一般ユーザー向けの使い方ガイドとする。操作方法や画面上の挙動を、専門知識を前提としない自然な日本語で分かりやすく説明し、表示仕様とバージョンは本体と整合させる。

- 内部構造、実装境界、データ形式、開発・運用手順など、小難しい技術的な仕様説明は `README.md` に記載する
- ユーザーの使い方、画面表示、計算結果、対応機能、制限に影響する内容は、`README.md` と `guide/` で基本的に同期する
- リファクタリング、内部処理、テスト、生成・検証手順など、ユーザーの使い方や目に見える挙動へ影響しない変更は `guide/` に記載しない
- 実装されていない機能をガイドへ先行記載しない
- exact text、画像寸法、公開 asset path、アンカー、PC / モバイル表示を確認する
- 画像や generated asset を差し替える場合は、元ファイル、公開ファイル、build 出力の関係を確認する
- SEO、canonical、sitemap、公開 URL は、repository layout だけでなく実際の HTTP 応答で確認する

## 変更種別ごとの進め方

### 計算・探索の機能追加

1. domain model と現在の owner を特定する
2. canonical name までの resolver 経路を確認する
3. direct damage と HP event のどちらの責務か分ける
4. search と Worker message への影響を確認する
5. direct `@smogon/calc` parity または代表回帰テストを追加する
6. 最終候補の再評価と不合格除外を確認する
7. UI の説明と `README.md` の対応・制限を同期する

### 不具合修正

1. ユーザーの exact な入力、文言、画面幅、手順、ログを再現条件として固定する
2. UI、resolver、domain、calc、search、Worker、storage のどの段階で壊れたか分ける
3. owning layer を最小差分で直す
4. named case と同じカテゴリの正常系・境界値を回帰テストへ含める
5. 見た目の修正では、DOM と実表示の両方を確認する

### データ更新

1. generated file の生成元を特定する
2. script または override を変更する
3. 再生成する
4. validation を実行する
5. 意図しない大量差分、重複、ambiguous、canonical 欠損を確認する

### 保存形式の変更

1. 現行 schema と全 load / save / export / import 経路を確認する
2. schema version、migration、fallback、error 表示を設計する
3. legacy data、破損 data、unknown schema のテストを追加する
4. 読み込み後の Worker request 破棄と dirty state 確認を検証する
5. バックアップ互換性を壊す場合は major 変更として明示する

### UI・レスポンシブ変更

1. 上記UIサイズ体系から操作の役割tierを決め、既存helper、primitive、semantic class、CSS variablesを再利用する
2. desktop の比較体験を壊していないか、1280x900、注釈で頻出する1186x698、1180px / 1181px境界で確認する
3. mobileは484x698、393x852、320x700を目安に、重なり、切れ、document / body / mainの横 overflowを確認する
4. click / tap、Tab / Space / Enter、focus ring、popover / sheet / dialogの到達性と、隣接操作の誤操作がないことを確認する
5. guide / privacyと埋め込みtutorialへ影響する場合は、同じ代表幅、本文・ナビ・footerの文字サイズ、意図しない横scrollを確認する
6. 文字やlayoutを変更した場合は200%文字拡大と320 CSS px相当のreflowも確認する
7. ユーザー向け表示なら app versionも確認し、Browserで画面version、実寸、console error / warningを確認する

## 検証方針

変更に関係する狭いテストから実行し、最後に必要な全体確認へ広げる。

基本コマンド:

```powershell
npm run typecheck
npm test
npm run build
npm run check
```

使い分け:

- logic / calc / search / Worker: `npm run typecheck`、対象テスト、`npm test`、`npm run build`
- generated data: 対象 generator、対応 validator、対象テスト、`npm run build`
- UI: `npm run typecheck`、対象テスト、`npm run build`、Browser 確認
- release 前または横断変更: `npm run check`
- docs / AGENTS / コメントだけ: 内容確認と `git diff --check`。アプリ test / build と version 更新は原則不要

優先する回帰テスト:

- resolver の exact / alias / ambiguous / not-found
- adapter と direct `@smogon/calc` の damage rolls / range parity
- 単発、複数回、連続技、HP イベント込みの生存・KO 判定
- 合法 SP、固定 SP 予算、最終再検証
- A/C 最小ラインと未達理由
- S の抜ける / 同速 / 届かない
- Worker cancel と stale requestId 破棄
- 全件候補数、20件ページング、sort 後の合否不変
- share / box schema の migration、import / export、破損データ
- exact な UI 文言と responsive DOM

### in-app Browser

現在の方針:

```yaml
skipInAppBrowserCheck: false
```

- UI 表示に関わる変更は、in-app Browser で DOM、対象操作、スクリーンショット、console を確認する
- desktop、代表スマホ幅、レイアウトに関係する場合は狭幅を確認する
- `design-qa` のスクリーンショット、比較画像、レポートは検証中だけの一時成果物として扱い、完了後に削除する
- 検証結果の要点は `PROGRESS.md` と最終報告へ残し、ユーザーが明示的に保存を求めない限り `design-qa*.png` や `design-qa.md` を作業差分へ残さない
- Browser が一時的に使えない場合は、静的 render、HTTP 200、配信 CSS / JS / HTML、対象関数テストで代替し、未実施範囲を最終報告と `PROGRESS.md` に書く
- Browser 復旧そのものをユーザーが依頼した場合だけ、個人用 `fix-in-app-browser-node-repl` skill で切り分ける
- `--disable-sandbox`、wrapper、Codex 設定変更など隔離を弱める操作は、ユーザーの明示承認なしに行わない

## バージョン更新ルール

ユーザー向けの挙動、機能、計算結果、表示内容を変更した場合は、同じ作業内でアプリバージョンを更新する。

- patch: 後方互換なバグ修正、小規模な表示修正
- minor: 後方互換な機能追加、大きな機能拡張
- major: 保存データや利用方法を含む非互換変更
- docs、テスト、コメント、AGENTS だけの変更では原則更新しない

バージョンの正は `package.json`。`package-lock.json` の root package version を同期し、`src/appVersion.ts` や UI へ重複ハードコードしない。

更新後は、テストと build に加えて画面の `app v...` 表示を確認する。

## 長期保守ルール

- 計算・通常編集・バックアップは guest / local-first の静的 Web アプリとして利用できる状態を保ち、同期だけを承認済みの Firebase Authentication / Cloud Firestore / App Check に限定する。それ以外の runtime backend / DB / scraping に依存しない
- GitHub Pages など静的ホスティングで継続運用できる構成を優先する
- 依存追加は必要性を説明できるものに絞り、package churn を最小化する
- lockfile と vendor provenance を保ち、再現可能な install / build を優先する
- 公式画像や sprite は表示専用とし、計算正確性の境界へ入れない
- データ未対応でも、可能な範囲で手動入力の逃げ道を残す
- localStorage、条件 JSON、バックアップでは schema と migration を優先する
- ユーザーが作成・削除した保存内容を、初期化処理で勝手に上書きしない
- 公開仕様、対応機能、制限は `README.md` とガイドへ反映する
- 未対応を推測実装で埋めず、UI とドキュメントで明示する

## 作業スタイル

- 既存変更を勝手に戻さない
- dirty worktree では、自分の変更と既存変更を分けて扱う
- 最小差分で owning layer を修正する
- 大きい変更でも、既存の canonical / domain / calc / search / Worker / UI 境界を崩さない
- ユーザーの exact な文字列、URL、数値、cutoff、画面幅をそのまま再確認する
- 実装前に処理の流れを聞かれた場合は、コード上の real control flow を先に説明する
- 診断依頼では原因と修正案を分け、実装を依頼されていない変更は勝手に行わない
- ドキュメントへローカル絶対パス、実ユーザー名、環境固有の秘密情報を書かない
- 生成物は生成経路から更新し、手作業の差分を正にしない
- UI 変更では diff だけで完了扱いにせず、ユーザーが見る表示を確認する

## `PROGRESS.md` 運用

個人用の汎用 skill `progress-update` を使い、意味のある作業単位ごとに primary agent が `PROGRESS.md` の `Recent Updates` へ原則1件だけ記録する。subagent は直接更新せず、primary agent が結果を集約する。

- `PROGRESS.md` と `PROGRESS.archive/` は `.git/info/exclude` で git 追跡対象外にするローカル進捗メモ
- `PROGRESS.md` は `Format: 2`、`Current Snapshot`、最新5〜10件程度の `Recent Updates` に保つ
- 通常の作業開始時は `Current Snapshot` と最新数件だけを読み、ファイルや archive の全件を読み込まない
- 過去履歴が必要な場合だけ `rg` で `PROGRESS.archive/` を検索し、該当する1〜3件だけを読む
- `SYNC-M0`〜`SYNC-M7` の実装・実施・検証記録は、月別 archive とは別の `PROGRESS.archive/SYNC-MILESTONES.md` に残し、通常の `No.N` 移動・採番の対象にしない
- 10件を超えた古い `done` エントリは `PROGRESS.archive/YYYY-MM.md` へ原文のまま移し、`in_progress` / `blocked` は解決まで active 側へ残す
- `No.N` は active と archive を通した連番とし、移動時に再採番しない。次番号は見出しだけを機械的に走査し、最大値1件だけを出力して決める
- `Current Snapshot` の最新番号、現在の goal / status、最後の検証、blocker、次の一手を、最新エントリと矛盾させない
- 1エントリは `Status`、`Outcome`、`Verification`、`Remaining / Next` を中心に簡潔にし、必要な場合だけ key files を repo 相対パスで書く
- micro-step、subagentごとの結果、解決済みの一時エラー、単なる調査メモ、最終報告の長い転載は記録しない
- repo の現行仕様は対象コード、テスト、`README.md`、`AGENTS.md` を正とし、進捗ログだけで判断しない
- ユーザーが「PROGRESS 更新いらない」と指定した場合は更新しない

## 完了済みマイルストーン

以下は完了済みの開発履歴。現在地は `PROGRESS.md`、詳細・検証・後続修正は必要な場合だけ `PROGRESS.archive/` を参照する。

| Milestone | 完了内容 |
| --- | --- |
| M0 | React / Vite / TypeScript の静的アプリ土台 |
| M1 | 日本語 resolver / catalog 境界 |
| M2 | domain model / scenario 設計 |
| M3 | `@smogon/calc` adapter |
| M4 | H/B/D 同時探索 |
| M5 | Web Worker、進捗、cancel、requestId |
| M6 | MVP 作業画面 |
| M7 | 回帰テスト、共有、version、Pages 公開準備 |
| M8 | A/C 火力ラインと S ライン |
| M8.1 | 調整対象・仮想敵ボックスとバックアップ |
| M8.2 | モバイル overview / sheet と responsive 対応 |
| M9 | 全合格候補、20件ページネーション、並び替え、探索軸絞り込み |

今後の機能追加や性能改善は新しい依頼単位で扱う。完了済みマイルストーンの未完了項目として自動的に再開しない。
