# ChampionCreator AGENTS

## プロジェクトの目的

ChampionCreator は、Pokemon Champions / Pokemon Showdown 系のダメージ計算に準拠しながら、複数の仮想敵シナリオを同時に満たす `H / B / D` 努力値配分を探索する、ブラウザで動く自動耐久調整ツール。

このツールの本質は「耐久指数をそれっぽく最大化すること」ではなく、ユーザーが指定した複数の被ダメージ条件に対して、

- 指定回数を耐える
- 指定確率以上で耐える
- 合法努力値配分だけを返す
- なぜその候補が通るか説明する

こと。

## 最重要ルール

### ダメージ計算エンジンは独自実装しない

`@smogon/calc` を唯一のダメージ計算の正とする。

禁止:

- 独自のダメージ計算式を実装すること
- 独自のタイプ相性・乱数分布・ランク補正を主計算として実装すること
- `@smogon/calc` の結果と異なる独自補正で最終合否を決めること
- upstream の `@smogon/calc` を直接改変すること

許可:

- 入力モデルを `@smogon/calc` 用に変換する薄い adapter
- 探索高速化のための候補事前フィルタ、キャッシュ、粗探索
- 複数被弾シーケンスをアプリ側で順に評価する管理層

ただし、最終候補の合否判定は必ず `@smogon/calc` ベースで再評価する。

### 日本語と Showdown canonical name を混ぜない

日本語入力・表示・検索は localization layer の責務。計算 adapter には、resolver 済みの Showdown canonical name だけを渡す。

方向性:

- `others/damage-calc-ja-layer` は日本語対応の参考実装・素材置き場として扱う。
- `others/` は git 追跡しない物置なので、本体コードから `others/` へ runtime import しない。
- 必要なデータ・型・設計は、明示的に本体へコピーするか、正式な package / dependency として扱う。
- 生成済み JSON を手で直さない。必要なら `scripts/`、`overrides/`、validation で扱う。
- resolver は `exact` / `alias` / `ambiguous` / `not-found` などの状態を UI に返し、曖昧さや欠損を握りつぶさない。

### 探索は H/B/D 同時探索にする

`HB` と `HD` を別々に解いて後で合成する方式は採用しない。1つの候補 `H / B / D` を、全シナリオに対して直接評価する。

理由:

- 物理と特殊が混在する複合シナリオに強い
- 説明しやすい
- 最終再検証と相性がいい
- 将来の条件追加に耐えやすい

## 参照すべき資料

作業開始時は、存在する範囲で次を読む。

- `AGENTS.md`
- `README.md`
- `package.json`
- `src/`
- `docs/`
- `PROGRESS.md`
- `others/auto-defence-adjustment.md`
- `others/auto-defence-adjustment-ai-prompt.md`
- `others/damage-calc-ja-layer/README.md`
- `others/damage-calc-ja-layer/src/localization/resolver.ts`
- `others/damage-calc-ja-layer/src/calc/smogonAdapter.ts`

`others/` は参考資料。必要なものだけ読む・コピーする。本体が `others/` なしでも動く状態を目指す。

## 推奨アーキテクチャ

### 1. localization / resolver layer

責務:

- 日本語名・別名・検索文字列から Showdown canonical name へ解決する
- 曖昧・未発見・fallback を明示する
- UI 表示用の日本語名や候補メタデータを返す

計算 adapter に日本語文字列を直接渡さない。

### 2. domain model layer

UI 入力をそのまま計算ロジックへ渡さず、純粋な TypeScript の domain model へ正規化する。

最低限分ける概念:

- `Build`: ポケモン、レベル、性格、個体値、努力値、特性、持ち物、テラスタイプ
- `Scenario`: 仮想敵、技、天候、フィールド、壁、ランク、急所、連続被弾など
- `SurvivalConstraint`: 必要耐久回数、必要生存確率、有効/無効
- `ScenarioEvaluation`: `@smogon/calc` 由来のダメージロール・致死率・生存率
- `CandidateResult`: 努力値候補、各シナリオ結果、残り努力値、ボトルネック説明

### 3. smogon adapter layer

責務:

- `Build` から `@smogon/calc` の `Pokemon` を作る
- `Scenario` から `Move` / `Field` / `Side` を作る
- `calculate` を呼び、damage rolls / range / description を薄く整形する
- adapter の入出力をテストしやすく保つ

受け取る名前は resolver 済み canonical name のみ。UI state や日本語入力を直接受け取らない。

### 4. scenario evaluation layer

責務:

- 1候補と1シナリオを評価する
- 複数 hit / 複数行動 / ステルスロックなどのシーケンスを扱う
- 生存条件を判定する

個々のダメージロール生成は `@smogon/calc` に任せる。アプリ側はシーケンス管理と確率集計に留める。

### 5. search layer

責務:

- 合法な `H / B / D` 候補だけを列挙する
- 全シナリオを同時に満たす候補を探す
- 粗探索、精密再探索、最終再検証を行う
- スコア順に候補を返す

SP 制約:

- Pokemon Champions の Stat Points / SP を探索単位にする
- 各ステータスは `0..32`
- 総 SP は `<= 66`
- `A / C / S` など固定済み SP を予算に含める
- `@smogon/calc` に渡す直前に、実数値が一致する Showdown EV 相当へ変換する
- 変換は `0SP => 0EV`、`1SP => 4EV`、以降 `+8EV`、`32SP => 252EV` を基本にする

推奨ソート:

1. `H + B + D` の SP が小さい
2. 残り SP が多い
3. 最も厳しいシナリオへの余裕が大きい
4. 同点なら `H` が高い候補を優先してよい

### 6. worker layer

探索は Web Worker で実行する。

必須メッセージ:

- start
- progress
- partialResult
- complete
- error
- cancel

ユーザーが条件を変えたら前回探索を中断できるようにする。`requestId` などで古い結果を捨てられる設計にする。

### 7. UI layer

UI は計算層に依存しすぎない。まずは見た目より、入力から探索完了までの動線と説明可能性を優先する。

UI の方向性は、添付参考画像のような「シンプルで密度のある調整ツール」に寄せる。派手なランディングページ、過剰なカード装飾、大きいヒーロー、説明文だらけの画面は避ける。

画面設計の優先:

- 1画面で「調整対象」「仮想敵シナリオ」「候補一覧」「選択候補の詳細」を見渡せる作業台にする
- 左側に調整対象、中央〜上部にシナリオ、下部に候補一覧、右下または詳細ペインに選択候補の内訳を置く構成を第一候補にする
- フォームは compact にし、入力欄・セレクト・トグル・小さいボタンを中心にする
- 色はタイプ、PASS/FAIL、選択状態、警告など意味がある場所に限定する
- 候補一覧はカードより table / list を優先し、順位・努力値配分・使用SP/残りSP・PASS条件・ボトルネック・余裕を横並びで比較できるようにする
- 詳細表示は常時全部を広げず、選択候補だけ詳しく見せる
- シナリオは追加・削除・折りたたみ・有効/無効がすぐ分かる薄い枠で表現する
- 装飾よりも、視線移動の少なさ、比較しやすさ、入力ミスの見つけやすさを優先する

色の定義:

| 用途 | Hex |
| --- | --- |
| HP | `#00ff72` |
| こうげき(A) | `#ff0000` |
| ぼうぎょ(B) | `#fba82f` |
| とくこう(C) | `#ff00d7` |
| とくぼう(D) | `#ebfe3d` |
| すばやさ(S) | `#00d8f0` |
| あく | `#624D4E` |
| いわ | `#AFA981` |
| エスパー | `#EF4179` |
| かくとう | `#FF8000` |
| くさ | `#3FA129` |
| ゴースト | `#704170` |
| こおり | `#3DCEF3` |
| じめん | `#915121` |
| でんき | `#FAC000` |
| どく | `#9141CB` |
| ドラゴン | `#5060E1` |
| ノーマル | `#9FA19F` |
| はがね | `#60A1B8` |
| ひこう | `#81B9EF` |
| フェアリー | `#EF70EF` |
| ほのお | `#E62829` |
| みず | `#2980EF` |
| むし | `#91A119` |

MVP UI の最低ライン:

- 調整対象の入力
- 仮想敵シナリオの追加・削除・有効無効
- 必要耐久回数・必要生存確率
- 計算開始・キャンセル・進捗
- 候補一覧
- 1位候補の適用
- 各候補のボトルネック表示

## MVP マイルストーン

### M0: プロジェクト土台

目的: 静的 Web アプリとして長く保守できる土台を作る。

完了条件:

- TypeScript ベースのフロントエンドを作成する
- `npm run build` と `npm test` の導線を用意する
- `@smogon/calc` を依存に追加する
- `others/` に runtime 依存しない構成にする
- README に開発コマンドと目的を書く

### M1: 日本語 resolver / catalog 方針

目的: 日本語 UX と Showdown canonical name の境界を作る。

完了条件:

- `others/damage-calc-ja-layer` の方針を確認する
- 本体側に必要な resolver / catalog / override 方針を置く
- 日本語入力から canonical name へ解決できる
- `ambiguous` / `not-found` / fallback を UI が扱える形で返す
- 生成データや手動 override の validation を用意する

### M2: domain model と scenario 設計

目的: UI から独立した計算モデルを固める。

完了条件:

- `Build`
- `Scenario`
- `ScenarioHit` または同等の被弾シーケンス
- `SurvivalConstraint`
- `ScenarioEvaluation`
- `CandidateResult`

を定義する。

この時点では UI が荒くてもよい。型と責務分離を優先する。

### M3: `@smogon/calc` adapter

目的: Showdown 計算エンジンだけを使う境界を作る。

完了条件:

- canonical name だけを受け取る adapter を実装する
- `Pokemon` / `Move` / `Field` / `Side` の変換を adapter に閉じ込める
- damage rolls / range を返す
- direct `@smogon/calc` 呼び出しとの parity test を書く
- 独自ダメージ式が存在しないことを確認する

### M4: H/B/D 同時探索

目的: 複数シナリオを同時充足する候補探索を作る。

完了条件:

- 合法努力値だけを列挙する
- `H / B / D` を1候補として同時評価する
- 粗探索を実装する
- 上位候補の近傍精密探索を実装する
- 最終候補を全シナリオで再検証する
- 不合格候補を返さないテストを書く

### M5: Web Worker 化

目的: ブラウザ UI を固めずに探索できるようにする。

完了条件:

- 探索を Worker で実行する
- 進捗と途中結果を返す
- キャンセルできる
- 古い request の結果を UI に反映しない
- エラー時に原因を表示できる

### M6: MVP UI

目的: 実際にユーザーが仮想敵を入れて候補を見られる状態にする。

完了条件:

- 調整対象と仮想敵を入力できる
- 複数シナリオを同時に扱える
- 生存回数と生存確率を設定できる
- 候補一覧と理由を表示できる
- 1位候補を適用できる
- 最低限のレスポンシブ表示を確認する
- 添付参考画像の方向性に寄せた、シンプルで比較しやすい作業画面になっている

### M7: MVP 検証・公開準備

目的: 壊れにくく共有しやすい MVP にする。

完了条件:

- `npm test` が通る
- `npm run build` が通る
- 代表シナリオの回帰テストがある
- README に使い方と制限を書く
- アプリ / `@smogon/calc` / データバージョンを表示できる
- JSON import/export または URL share の最低限の方針を決める
- GitHub Pages など静的ホスティングで動く準備をする

### M8: MVP 後の性能改善

目的: `@smogon/calc` を計算の正にしたまま、探索体験を軽くする。

前提:

- M6 / M7 までは、計算精度・責務分離・説明可能性を優先する
- 元実装より時間がかかる主因は、候補ごとに `@smogon/calc` へ渡して正確に再評価することと、`H / B / D` を同時探索すること
- 速くするために独自ダメージ式へ戻したり、adapter / search / worker の境界を崩したりしない

改善候補:

- `Scenario` / `ScenarioHit` を探索前に compiled form へ正規化し、attacker / move / field / side 入力の再構築を減らす
- 同一の候補・同一の hit 条件に対する `damage rolls` をキャッシュする
- Worker 内で評価をバッチ化し、progress / partialResult の頻度を調整して UI 更新コストを抑える
- 粗探索モードと精密探索モードを分け、まず早く候補を見せてから必要に応じて詰める
- HP / B / D の単調性を使った安全な枝刈りを検討する
- 代表シナリオで計測し、最適化前後の所要時間と候補一致をテストで確認する

完了条件:

- `@smogon/calc` ベースの最終合否判定を維持している
- canonical name / domain model / adapter / search / worker の境界を維持している
- 代表シナリオで候補結果が最適化前と一致する、または差分理由を説明できる
- 計算時間または UI 応答性の改善を計測できる
- `npm test` と `npm run build` が通る

## 検証方針

優先して書くテスト:

- resolver が日本語・別名・未発見・曖昧候補を正しく返す
- adapter が direct `@smogon/calc` と同じ damage rolls / range を返す
- 1 hit の生存判定
- 連続被弾の生存判定
- ステルスロックなど定数ダメージ込みの判定
- 合法努力値しか候補に出さない
- 最終再検証で不合格候補が落ちる
- Worker の cancel / requestId が古い結果を捨てる

実装後の基本確認:

```powershell
npm test
npm run build
```

まだ scripts がない段階では、M0 でこれらを整える。

### in-app Browser 確認方針

Codex in-app Browser / Browser plugin は環境依存の起動失敗や localhost URL ポリシー拒否が再発しているため、当面は UI 修正後の in-app Browser 確認を必須にせず、一時的にスルーする。

方針:

- UI 修正後は、`npm run typecheck`、対象テスト、`npm run build`、必要に応じて `npm run check` を優先し、DOM/CSS の静的確認、HTTP 200、既存テストなどで代替検証する。
- in-app Browser がその場で正常に利用できる場合だけ、DOM snapshot、対象操作、表示状態、必要に応じたスクリーンショット確認を追加する。
- `windows sandbox failed: spawn setup refresh` や localhost URL ポリシー拒否が発生した場合は深追いせず、ページやアプリの不具合と切り分けたうえで代替検証へ進む。
- Browser 確認を実施できなかった場合は、その理由と代替確認の結果を最終報告および `PROGRESS.md` に明記する。
- in-app Browser の起動と localhost 操作が安定して利用できることを確認できた時点で、この一時スルー方針を見直す。

## 長期保守ルール

- 基本は静的 Web アプリとして完結させる。runtime backend / DB / scraping に依存しない。
- GitHub Pages などで消えにくく動く形を優先する。
- 依存追加は必要性を説明できるものに絞る。
- lockfile を保ち、再現可能な install / build を優先する。
- 公式画像や sprite を使う場合も、計算正確性の境界には入れない。
- データ未対応でも手動数値入力で逃げ道を残す。
- localStorage を使う場合は `schemaVersion` を持たせ、古い保存データでアプリが壊れないようにする。
- JSON copy/import、URL share、Markdown copy など、計算条件をあとから復元できる機能を重視する。

## 作業スタイル

- 既存変更を勝手に戻さない。
- 最小差分で進める。
- 迷ったら、計算精度・再現性・説明可能性・静的運用を優先する。
- `others/` の資料は便利に使ってよいが、必要なものだけ本体へ昇格させる。
- 大きい作業は milestone 単位で区切り、次スレでも再開しやすいように README / PROGRESS / docs を更新する。
- ユーザーが「PROGRESS 更新いらない」と言った場合は更新しない。
- サブエージェントが使える環境では、データ収集、日本語対応、Showdown adapter 調査、UI 実装調査を分担してよい。

## in-app Browser / node_repl 復旧メモ

Codex in-app Browser や Browser plugin が `windows sandbox failed: spawn setup refresh` で起動できない場合は、ページやアプリの不具合と決めつけず、まず `node_repl` の最小実行を確認する。

復旧方針:

- 個人用 skill `fix-in-app-browser-node-repl` を使う。
- まず `node_repl` で `1 + 1` 相当の最小実行を試す。
- Codex 設定を触る場合は、必ず `%USERPROFILE%\.codex\config.toml` を timestamp 付きでバックアップする。
- `[mcp_servers.node_repl]` は `args = ["--disable-sandbox"]` を使う。
- Codex Desktop が `args` を実プロセスへ反映しない場合は、`node_repl_disable_sandbox.cmd` のような wrapper で `node_repl.exe --disable-sandbox %*` を起動する。
- `[mcp_servers.node_repl.env]` に `CODEX_CLI_PATH = ...` が残っていると sandbox launcher 経由になる場合があるため、fallback 時はこの行だけを外す。他の env や他 MCP 設定は触らない。
- この変更は `node_repl` の sandbox 隔離を弱めるため、ユーザーの明示承認がある場合だけ行う。
- 復旧後は Codex Desktop の再起動が必要になることがある。

復旧後の確認:

- `node_repl` の最小実行が成功する。
- in-app Browser で `http://127.0.0.1:5173/` を開ける。
- スクリーンショット取得、DOM evaluate、簡単なクリック操作を確認する。
- 実施内容と検証結果は `PROGRESS.md` に残す。

## ユーザー追記
- ドキュメントに絶対パス、ユーザー名を含めないでください
- 個人用の汎用 skill `progress-update` を使い、`PROGRESS.md`に作業内容に記録してください。プロジェクトの進捗は`PROGRESS.md`を参照してください。汎用 skill `progress-update` は `~/.agents/skills` に配置されています。
