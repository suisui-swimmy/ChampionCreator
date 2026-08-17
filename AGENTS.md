# ChampionCreator AGENTS

## この文書の役割

ChampionCreator は M0〜M9 の初期開発マイルストーンを完了し、現在は完成済みアプリへの機能追加、不具合修正、データ更新、UI 改善、公開運用が中心。

この文書は、過去の実装手順を再現するロードマップではなく、今後の変更でも守る設計境界と作業ルールを定義する。

- 現在の実装状況は、対象コード、対象テスト、`README.md`、`package.json` を確認して判断する
- 作業履歴と直近の引き継ぎは `PROGRESS.md` を参照する
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
- デスクトップとモバイルに対応した作業画面
- 公開ガイドと静的ホスティング

このツールの本質は、耐久指数や火力指数を独自式で近似することではない。指定条件を正しい計算境界で評価し、合法な配分と、その候補が通る理由を説明できる状態を保つこと。

## 作業開始時の確認

毎回リポジトリ全体を読む必要はない。次の順で、依頼に関係する範囲だけ確認する。

1. `AGENTS.md`
2. `PROGRESS.md` の直近項目と、依頼に関係する過去項目
3. 対象の実装ファイルと対応テスト
4. コマンド、依存、バージョンに関係する場合は `package.json`
5. ユーザー向け仕様に関係する場合は `README.md` と `guide/`
6. 必要な場合だけ `docs/`、`scripts/`、`.github/workflows/`

`others/` は参考資料置き場であり、通常の修正で毎回読む対象ではない。次の場合だけ必要な資料を選んで参照する。

- localization / resolver の設計境界を変更する
- `@smogon/calc` adapter の設計を変更する
- 初期仕様の意図を確認しないと現行コードだけでは判断できない

本体は `others/` なしで動く状態を維持し、runtime import しない。

## 一時ロードマップ: Firebase アカウント同期（完了後に章ごと削除）

> **TEMPORARY**: この章は、Google アカウントを使ったボックス同期と下書き保存を完成させるまでの一時的な実装手順。
> `SYNC-M7` の完了時に、この見出しから次の `## 最重要の設計境界` の直前までを同じ変更内で削除する。
> 完了済みマイルストーン表へ本ロードマップを転載せず、履歴は `PROGRESS.md` に残す。

現在の開始地点は `SYNC-M1`（`SYNC-M0` は 2026-08-17 完了）。各マイルストーンは `Done` を満たし、検証結果を `PROGRESS.md` へ記録してから次へ進む。後続マイルストーンの実装を先取りしない。

このロードマップ中だけ、Firebase Authentication / Cloud Firestore / App Check を、ユーザーが明示承認した managed backend / DB の例外として扱う。GitHub Pages の静的フロントは維持し、Firebase 以外の runtime backend、Google Drive 保存、自前 OAuth サーバー、Realtime 共同編集へ暗黙に拡張しない。

全マイルストーン共通の境界:

- 未ログインでも従来どおり利用できる guest / local-first を維持する
- 調整対象ボックス、仮想敵ボックス、作業中の下書きを別データとして扱う
- 既存の `BoxEntry` / `EnemyBoxEntry` と `ShareStateDocument` の validation / migration を再利用する
- クラウドから受け取った payload も必ず既存 parser で正規化し、不正値や未来 schema を空データとして扱わない
- 計算結果、候補一覧、Worker state、使用率データ、チュートリアル state は同期しない
- JSON バックアップの書き出し・読み込みを、同期後も独立した退避手段として維持する
- Google アカウントは本人確認だけに使い、Drive / 連絡先など追加 scope を要求しない
- Firebase Admin credential、service account key、Google client secret を browser bundle、repository、Pages artifact へ含めない
- 既存の app version、保存互換、desktop / mobile / narrow-width、in-app Browser の検証ルールを各マイルストーンでも守る

### SYNC-M0: 端末内の作業中下書き

Goal:

- ログインや通信なしでも、編集中の入力条件を同じ端末で安全に復元できるようにする

Scope:

- ボックスとは別の versioned draft schema / storage key を追加する
- `targetForm` と `scenarioForms` を既存 `ShareStateDocument` 経路で保存し、計算結果や候補は保存しない
- 入力変更後 `500..1000ms` の debounce で端末へ保存する
- 起動時に下書きがある場合は、現在の白紙状態へ黙って適用せず `復元` / `破棄` を選べるようにする
- box / backup 読み込み、白紙化、schema 不正、storage quota error、`variant="tutorial"` の扱いを定義する

Done:

- 下書きの save / load / discard / migration / corrupt data の対象テストがある
- 初回の白紙状態と、ユーザーが削除した既定サンプルを復活させない既存挙動が維持される
- desktop、代表スマホ幅、320px 前後で復元 UI、focus、keyboard、横 overflow、console を確認している
- ユーザー向けの保存挙動変更として version、README、guide が同期されている

Stop line:

- Firebase SDK、ログイン、クラウド保存、同期状態 UI へ進まない

### SYNC-M1: Firebase 基盤・Google 認証・Security Rules

Goal:

- GitHub Pages を維持したまま、Firebase を安全に呼べる最小基盤とユーザー境界を作る

Scope:

- Firebase project / Web app、Google provider、Cloud Firestore、Auth emulator / Firestore emulator の設定手順を確定する
- Firebase client 初期化と auth session owner を `src/sync/` 配下へ追加し、`App` へ provider 固有処理を散らさない
- 本番 custom domain と localhost を authorized domain に分け、GitHub Pages で壊れる未対策の `signInWithRedirect` を採用しない
- Firestore Security Rules で未認証拒否、`request.auth.uid` と document owner の一致、許可 field、kind、schema、payload size を検証する
- App Check は monitor から開始し、正規利用を確認してから enforcement する
- Firebase Web config と秘密情報の境界、開発 / 本番環境の切替を定義する

Done:

- 認証 session の restore / sign-in / sign-out / error を mock または emulator で検証できる
- Security Rules test で unauthenticated と別 UID の read / write が拒否され、自 UID の許可操作だけ通る
- production bundle に Admin / service account / client secret が含まれないことを確認している
- Firebase console で必要な手作業と未実施項目が `PROGRESS.md` に区別して記録されている

Stop line:

- 既存 localStorage の移行や実ボックス同期へ進まない

### SYNC-M2: local / cloud repository と同期 coordinator

Goal:

- UI から保存先を分離し、ローカル即時保存と競合を失わないクラウド同期の共通経路を作る

Scope:

- `src/sync/` に auth、types、local repository、Firestore repository、coordinator、outbox / metadata の owner を分ける
- クラウドは全件 blob ではなく、調整対象 / 仮想敵の1保存スロットを1 document として扱う
- `entryId` は UUID に限定せず既存 ID を保持し、sync schema と payload schema を分離する
- server timestamp、`revision`、`baseRevision`、`mutationId`、`deletedAt` tombstone を持たせる
- 保存操作は local 成功を先に確定して outbox へ積み、起動、focus、`online`、手動操作で pull / push する
- remote empty、network error、permission error、quota error、invalid payload、unknown future schema を別状態にする
- 同じ entry / revision の競合は Last Write Wins で消さず、元データを保持した競合コピーまたは要確認状態にする

Done:

- repository / coordinator を Firebase mock または emulator で独立テストできる
- 別スロット同士は自動統合され、同一 ID の同時更新、更新対削除、再送 mutation がデータ消失や二重適用を起こさない
- offline 中の変更が local に残り、復帰後に順序どおり送られる
- 1件の破損 remote document が一覧全体を空にしない

Stop line:

- 既存ユーザーデータの one-time migration や実 UI への全面接続へ進まない

### SYNC-M3: 既存 localStorage の one-time migration

Goal:

- 既存端末と既存クラウドのどちらも失わず、アカウント単位の保存領域へ一度だけ統合する

Scope:

- `championcreator.box.v1`、`championcreator.enemy-box.v1`、既定サンプル marker を読み取る migration state を追加する
- `not-started` / `in-progress` / `needs-review` / `completed` を区別し、完了までは旧 localStorage を削除しない
- cloud empty なら local upload、両方にデータがあれば `統合` / `クラウドを使用` / `この端末を使用` / `あとで決める` を提示する
- default は union とし、同一 ID・同一 payload は1件、同一 ID・異なる payload は両方残す
- guest と UID ごとの local namespace を分け、ログアウトや別アカウント login で前ユーザーのデータを混ぜない
- 未変更の既定サンプルと削除済み marker を特別扱いし、同期開始や新端末で勝手に復活・重複させない

Done:

- local only、cloud only、双方空、双方同一、双方競合、中断再開、アカウント切替の migration test がある
- migration 失敗時も旧データと既存 JSON backup が利用できる
- migration 完了 marker は remote write と local 保存が成功した後だけ確定する
- 初回統合 UI を desktop / mobile / narrow-width で確認している

Stop line:

- 通常利用中の全ボックス操作をクラウド同期へ切り替えない

### SYNC-M4: 調整対象・仮想敵ボックスの同期

Goal:

- 両ボックスの保存、上書き、名前変更、複製、削除、読み込みを端末間で同期する

Scope:

- `App` の直接 `save*ToBrowser()` 呼び出しを repository / coordinator 境界へ段階的に移す
- 調整対象と仮想敵の kind、payload、backup、表示文言を混ぜない
- 読み込み時は進行中 Worker と stale request を既存経路で破棄する
- 削除は tombstone として同期し、オフライン端末からの古い更新で復活させない
- backup import は同期中も validation を通し、`統合` と `全端末を置き換え` の影響件数を事前表示する
- Realtime listener は必須にせず、まず launch / focus / online / manual sync を正にする

Done:

- create / overwrite / rename / duplicate / delete / restore / import / export の両ボックス回帰テストがある
- 2端末で別スロット更新、同一スロット競合、削除対更新、offline 復帰を再現し、無言のデータ消失がない
- sync error 中も local 操作と JSON backup が利用できる
- 既存の20件ページング、計算、候補、box load 後の state reset に回帰がない

Stop line:

- 作業中下書きのクラウド同期や最終アカウント UI へ進まない

### SYNC-M5: 端末別クラウド下書き

Goal:

- SYNC-M0 の下書きを、別端末から明示的に選んで復元できるようにする

Scope:

- `userId + deviceId` 単位で draft document を分け、同時入力端末が同じ draft を上書きしないようにする
- local draft は `500..1000ms`、cloud draft は操作停止後 `1500..3000ms` を目安に queue する
- `pagehide` / `visibilitychange` では同期完了を装わず、未送信 mutation を outbox に残す
- 他端末の下書きは更新日時、端末ラベル、入力概要を表示し、ユーザーが選んだ時だけ現在 state へ復元する
- draft の上限、保持期間、手動削除、期限切れ cleanup を定義し、課金必須の仕組みへ暗黙に依存しない

Done:

- 同一端末復元、他端末復元、同時編集、offline、期限切れ、破損 draft のテストがある
- draft 復元時に進行中 Worker / stale result が破棄され、box data は変更されない
- 保存中、端末保存済み、クラウド保存済み、offline、error の表示が実状態と一致する
- desktop / mobile / narrow-width で下書き一覧と復元確認を検証している

Stop line:

- Google 以外の provider、端末間リアルタイム共同編集、共有ボックスへ拡張しない

### SYNC-M6: アカウント・同期状態 UI とライフサイクル

Goal:

- login から同期、logout、データ export、アカウント削除までをユーザーが安全に完結できるようにする

Scope:

- desktop header と既存 mobile sheet / box panel を再利用し、常設 UI を増やしすぎない
- exact status を `この端末のみ` / `未同期` / `同期中…` / `同期済み` / `オフライン` / `競合あり` / `同期エラー` として区別する
- `Googleでログイン`、初回統合、今すぐ同期、再試行、競合解決、logout を到達可能にする
- logout 時は未同期 mutation を明示し、guest namespace と user namespace を混ぜない
- account deletion は再認証後に cloud data を削除し、途中失敗時に auth user だけを先に消さない
- Google アカウントは本人確認だけに使い Drive / 連絡先へアクセスしない旨を表示する
- privacy policy、データ利用・保存・削除説明、Google OAuth production branding / authorized domain を整える

Done:

- keyboard / focus / screen reader label、popup error、cancel、session restore、別アカウント login をテストしている
- account export / delete と削除失敗時の retry を確認している
- desktop、代表スマホ幅、320px 前後で login / sync / conflict / logout / delete UI に切れや横 overflow がない
- tutorial variant に account / sync UI や永続化が混入しない

Stop line:

- 公開完了と誤認せず、SYNC-M7 の全体検証と本番 smoke test を残す

### SYNC-M7: 全体検証・公開・一時ロードマップ削除

Goal:

- セキュリティ、保存互換、2端末動作、公開版を検証し、同期機能を完成扱いにする

Scope:

- 対象 unit / integration / emulator tests、`npm run typecheck`、`npm test`、`npm run build`、`npm run check` を実行する
- unauthenticated、別 UID、payload size / schema、App Check、quota / network error を検証する
- desktop、代表スマホ幅、320px 前後で local draft、Google login、migration、両ボックス同期、cloud draft、競合、logout、account delete を確認する
- 2つの独立 browser context または実端末で、同一アカウント同期と別アカウント分離を確認する
- README、guide、privacy、公開仕様、制限、version、backup 手順を実装と同期する
- Pages 公開後に custom domain で Google login、Firestore read / write、再読み込み、別端末反映、console を smoke test する

Done:

- 上記検証が pass し、未確認範囲と運用上の残課題が `PROGRESS.md` に明記されている
- production の rules / indexes / App Check / authorized domains が source と一致する
- 同期失敗でも local data と JSON backup から復旧できる
- この `## 一時ロードマップ: Firebase アカウント同期（完了後に章ごと削除）` 章を、次の `## 最重要の設計境界` の直前まで同じ変更内で削除している
- 完了後の現行実装に必要な恒久ルールだけを既存セクションへ最小限反映し、本ロードマップや実装手順を転載していない

Stop line:

- Realtime 共同編集、共有、Google 以外の provider、有料機能は別依頼として扱う

## 最重要の設計境界

### 1. 直接ダメージ計算の正は `@smogon/calc`

`@smogon/calc` を、直接攻撃のダメージロール、タイプ相性、ランク補正、乱数分布などの唯一の計算元とする。

禁止:

- 独自のダメージ計算式を主計算として実装する
- 独自のタイプ相性、乱数分布、ランク補正で最終結果を決める
- `@smogon/calc` と異なる独自補正で候補の合否を上書きする
- upstream や vendor package を直接改変する
- UI 表示用の日本語名や画像を計算条件として使う

許可:

- domain model を `@smogon/calc` の `Pokemon` / `Move` / `Field` / `Side` へ変換する薄い adapter
- 複数攻撃と HP イベントを順番に処理する管理層
- 探索の事前フィルタ、候補列挙の絞り込み、キャッシュ、バッチ化
- `@smogon/calc` の結果を日本語 UI 向けに整形する表示層

最終候補は必ず `@smogon/calc` ベースで再評価し、不合格候補を返さない。

現在の主な境界:

- `src/calc/smogonAdapter.ts`: canonical name から直接ダメージを計算する adapter
- `src/calc/hpEventRules.ts`: 選択式 HP イベントのルール
- `src/calc/simulateHpSequence.ts`: 直接ダメージと HP イベントの順序付き評価
- `src/calc/moveHpMechanics.ts`: 現在 HP に依存する技などの判定

`@smogon/calc` の更新調査では、npm の公開バージョンだけで判断しない。repo 内の `.agents/skills/audit-smogon-calc-upstream/SKILL.md` に従い、現在の pin と upstream 最新コミットの差分、runtime 影響、採用方法を確認する。

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

ChampionCreator は静的 Web アプリとして完結し、通常の保存は browser storage、外部保存は明示的なバックアップ入出力で扱う。

- 保存形式には `schemaVersion` を持たせる
- schema 変更では migration または明確な非対応エラーを用意する
- 必須項目欠落、unknown schema、破損 JSON、resolver 未解決、SP 超過を区別する
- 読み込めない値を黙って正常値へ置き換えない
- 保存対象は入力条件を正とし、古い計算結果を唯一の正にしない
- 調整対象ボックスと仮想敵ボックスの責務を混ぜない
- 白紙初期状態と、削除できるサンプルの one-time seed を壊さない
- ユーザーが削除したサンプルを起動時に復活させない
- 読み込み時は進行中 Worker と表示中結果を安全に破棄する

現在の主な境界:

- `src/ui/shareState.ts`
- `src/ui/boxStorage.ts`
- `src/ui/enemyBoxStorage.ts`

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

### 表示文言

- ユーザーが指定した日本語文字列、記号、表記、順序をそのまま確認する
- 近い言い換えでテストや確認を済ませない
- named bug は同じ意味カテゴリ全体を確認し、名前付き1件だけの例外処理で済ませない
- エラーは、入力不足、resolver 未解決、計算未対応、保存形式不正、Worker error を区別する
- UI で表示する計算説明は、calc 由来の値とアプリ側 HP イベントを区別する

### 公開ガイド

`guide/` はアプリ本体とは別の利用導線だが、表示仕様とバージョンは本体と整合させる。

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

1. 既存 helper、primitive、semantic class を再利用する
2. desktop の比較体験を壊していないか確認する
3. 代表的なスマホ幅と狭い幅で、重なり、切れ、横 overflow を確認する
4. click / tap、focus、keyboard、popover / sheet の到達性を確認する
5. ユーザー向け表示なら app version も確認する

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

- 基本は静的 Web アプリとして完結させ、runtime backend / DB / scraping に依存しない
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

個人用の汎用 skill `progress-update` を使い、意味のある作業単位ごとに `PROGRESS.md` へ1件追記する。

- `PROGRESS.md` は git 追跡対象外のローカル進捗メモとして扱う
- 既存形式を維持し、末尾へ時系列順に追記する
- `No.N` はファイル全体の最大値に1を足す
- 変更内容、変更ファイル、検証、残課題、次の一手を書く
- repo 相対パスだけを使い、ローカル絶対パスや実ユーザー名を書かない
- micro-step や単なる調査メモは記録しない
- ユーザーが「PROGRESS 更新いらない」と指定した場合は更新しない

## 完了済みマイルストーン

以下は完了済みの開発履歴。詳細、検証、後続修正は `PROGRESS.md` を参照する。

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
