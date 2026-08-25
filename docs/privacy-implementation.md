# ChampionCreator データ取り扱いの技術詳細

この文書は、ChampionCreatorのユーザー向け[「プライバシーとデータの取り扱い」](https://championcreator.suisui-swimmy.com/privacy/)を補足する技術資料です。

ブラウザ内保存、Firebase Authentication、Cloud Firestore、Google Analytics、Google Fonts、GitHub Pages、App Check、データ書き出し、アカウント削除について、現在の実装上の保存対象と処理境界を記録します。実装とこの文書が食い違う場合は、対象コード、テスト、Security Rulesを正として文書を更新します。

> **更新日**
>
> 2026年8月25日
>
> 運営者: suisui-swimmy
>
> お問い合わせは[X（@peixe0307）](https://x.com/peixe0307)またはアプリ内の[不具合報告](https://docs.google.com/forms/d/e/1FAIpQLSdTUyrAmTwrcarMfMt56RrcwH_g4r4WhowW0i60HDK5BflylQ/viewform)からお願いします。

## 1. データフローの概要

| 保存先・送信先 | 主な対象 |
| --- | --- |
| アプリが管理するブラウザの`localStorage` | 未ログイン用ボックス・作業中下書き・候補表示設定、ブラウザ識別情報、初回統合状態、UID別の同期レコード・競合・未送信操作・クラウド下書きキャッシュ |
| Firebase SDKが管理するブラウザ保存 | Firebase Authenticationのログイン状態や認証に必要な情報。保存方法と有効期間はFirebase SDKが管理する |
| Firebase Authentication | UID、表示名、メールアドレス、プロフィール画像、ログイン状態、認証・不正利用対策に必要な通常の通信情報 |
| Cloud Firestore `syncRecords` | 調整対象・仮想敵ボックス、削除済み記録、同期に必要なrevisionなどの管理情報 |
| Cloud Firestore `drafts` | ブラウザ別の作業中下書き、ランダムなブラウザID、大まかなブラウザ表示名、削除済み記録、同期管理情報 |
| GitHub Pages | 静的ファイルの配信。GitHubはセキュリティ目的でアクセス元IPアドレスを記録すると説明している |
| Google Analytics 4 | ページ表示などの標準収集データ。Cookieや計測用IDを利用する場合がある |
| Google Fonts | `LINE Seed JP`のCSS・フォント配信に必要なHTTPリクエスト |
| Firebase App Check / reCAPTCHA Enterprise | 公開版アプリからのリクエストが正規のアプリ由来か確認するためのattestationとtoken |

計算結果、候補一覧、Workerの状態、使用率データ、チュートリアルの状態は、ボックス・下書き・クラウド同期の保存対象に含めません。

## 2. アプリが管理するブラウザ内保存

### 2.1 保存単位

`localStorage`は、同じサイトを開いている同一ブラウザプロファイル内のタブで共有されます。別のブラウザ、別プロファイル、別のスマホ・PCとは分かれます。

UIDとブラウザIDをキーへ含める場合は、`encodeURIComponent`でエスケープします。下表の`<uid>`と`<device>`は説明用のプレースホルダーです。

### 2.2 保存キー

| キー | 保存内容 | アカウント削除時 |
| --- | --- | --- |
| `championcreator.box.v1` | 未ログイン用の調整対象ボックス一覧 | 残す |
| `championcreator.enemy-box.v1` | 未ログイン用の仮想敵ボックス一覧 | 残す |
| `championcreator.box.default-example.v1` | 既定サンプルを一度だけ作成し、削除後に復活させないための状態 | 残す |
| `championcreator.draft.v1` | 未ログイン用の作業中下書き。調整対象とシナリオだけを含む | 残す |
| `championcreator.suggestion-format.v1` | 技・特性・持ち物の候補表示をSingles / Doublesのどちらにするかという設定 | 残す |
| `championcreator.device.v1` | 初回にランダム生成するUUIDと、「Windows / Chrome」などの大まかな表示名 | 残す |
| `championcreator.migration-source.v1` | 旧保存を別アカウントへ重複統合しないための`ownerUid`、source fingerprint、claim日時 | 残す |
| `championcreator.sync.v1.<uid>` | UID別のボックス同期レコード、outbox、競合、同期管理情報 | 削除する |
| `championcreator.cloud-draft.v1.<uid>.<device>` | 同じアカウントのクラウド下書き一覧、削除済み記録、outbox、同期管理情報のブラウザ内キャッシュ | 削除する |
| `championcreator.draft.v1.<uid>.<device>` | UID・ブラウザ別の現在作業中の下書き | 削除する |
| `championcreator.migration.v1.<uid>` | 初回データ統合の状態、選択、失敗・再開に必要な情報 | 削除する |

`championcreator.device.v1`のUUIDはアカウントIDではありません。表示名はブラウザのplatform / User-Agentから「Windows / Chrome」のような粗い情報だけを生成し、生のUser-Agentや利用者名をアプリの保存データへ含めません。このUUIDと表示名はCloud Firestoreのクラウド下書きにも保存します。

`championcreator.migration-source.v1`には統合先UIDが含まれますが、現行のアカウント削除では削除しません。未ログイン用の旧ボックスを別アカウントへ二重統合しないためのclaimとして残し、ボックスpayloadそのものはこのキーへ含めません。この履歴を含むサイト内データを消す場合は、ブラウザのサイトデータ削除が必要です。

### 2.3 未ログイン保存と初回統合

Googleログインを利用しない場合、またはGoogleログイン後に初回統合を保留している場合は、未ログイン用のボックス・下書き保存を使います。これらをFirebaseへ自動送信しません。

初回統合では、`championcreator.box.v1`、`championcreator.enemy-box.v1`、`championcreator.box.default-example.v1`を統合元として扱います。ブラウザ保存とクラウド保存の状況に応じて、統合、クラウドを使用、このブラウザを使用、あとで決める、を選択します。

FirestoreとUID別ブラウザ保存の両方が成功するまで未ログイン用キーは削除しません。統合完了後も、現行実装では未ログイン用キーを残します。

### 2.4 作業中下書きとバックアップ

作業中下書きのpayloadは、versionedなShareStateDocumentを使い、調整対象とシナリオだけを保存します。計算結果、候補一覧、search state、Worker stateは含めません。

ブラウザ内下書きは入力変更後750msで保存します。Googleログイン後のクラウド送信は、そのローカル保存とは別に2秒の待ち時間を設けます。

調整対象・仮想敵ボックスには、読み込み可能なJSONバックアップ機能があります。未ログイン用の作業中下書きには専用の書き出し・読み込み機能がないため、ブラウザのサイトデータを削除すると復元できません。

### 2.5 Firebase SDKが管理するブラウザ保存

アプリは`getAuth()`を使用し、Firebase Authenticationのpersistenceを独自設定していません。ログイン状態や認証に必要な情報のブラウザ保存はFirebase SDKが管理します。

上記のアプリ管理キー一覧は、Firebase SDKが内部で使用するIndexedDB、`localStorage`などを列挙するものではありません。アプリが作るbox / draft / sync payloadと、Firebase SDKが管理する認証状態を区別します。

## 3. Firebase Authentication

### 3.1 認証方式とGoogleから受け取る情報

公開版では`GoogleAuthProvider`と`signInWithPopup`を使用します。`signInWithRedirect`は使用しません。アカウント削除前の再認証には`reauthenticateWithPopup`を使用します。

`addScope()`は呼びません。Googleログインから受け取る標準プロフィールとFirebaseの識別情報は次のとおりです。

- UID
- 表示名
- メールアドレス
- プロフィール画像URL
- ログイン状態

Google Driveのファイル、連絡先、Gmailのメール本文を見る追加アクセス権は要求しません。

アプリへ渡す認証状態は、FirebaseのUser全体ではなく、UID、表示名、メールアドレス、プロフィール画像URLだけへ変換します。Google credential、access token、FirebaseのUserオブジェクトをbox / draft / sync payloadへ渡しません。

Firebase Authenticationでは、認証と不正利用対策のため、IPアドレスやUser-Agentなど通常の通信に伴う技術情報もFirebase側で扱われます。これらはアプリが保存する入力条件やボックスpayloadとは別です。Firebaseは、Authenticationで記録したIPアドレスを数週間保持し、Authenticationを米国のdata centerで処理すると説明しています。

### 3.2 ログアウトとアカウント削除

ログアウトはFirebase Authenticationのセッションを終了する操作です。Cloud Firestoreのアカウントデータ、UID別のアプリ管理ブラウザ保存、未ログイン用保存は削除しません。

Firebase AuthenticationのアカウントとCloud Firestoreのデータを削除する場合は、アカウント画面のアカウント削除を使用します。詳細な順序は「8. アカウント削除」に記載します。

### 3.3 秘密情報の境界

Google credentialやaccess tokenは、ChampionCreatorが作る保存データや書き出しJSONへ含めません。

FirebaseのWebアプリ用設定（Web config）は公開値です。次の秘密情報は、ブラウザ配信用bundle、repository、GitHub Pages artifactへ含めません。

- Firebase Admin credential
- service account key
- Google OAuth client secret

## 4. Cloud Firestore

### 4.1 保存パス

| 対象 | Firestore path | document ID |
| --- | --- | --- |
| 調整対象・仮想敵ボックス | `/users/{uid}/syncRecords/{documentId}` | `sha256(kind + ":" + entryId)`のlowercase hex |
| ブラウザ別クラウド下書き | `/users/{uid}/drafts/{deviceId}` | ランダム生成したブラウザID |

コレクションはUID配下へ分けます。Security Rulesは、pathのUIDと認証済みUIDが一致することを要求します。

### 4.2 `syncRecords`

Firestoreへ保存するfieldは次の10個だけです。

- `ownerUid`
- `kind`
- `schemaVersion`
- `entryId`
- `payload`
- `revision`
- `baseRevision`
- `mutationId`
- `updatedAt`
- `deletedAt`

`kind`は`target-box`または`enemy-box`、sync envelopeの`schemaVersion`は`1`です。`payload`は既存のbox parserで検証するJSON文字列で、上限は200,000 UTF-8 bytesです。`entryId`は1〜4,096 UTF-8 bytes、`mutationId`は1〜128 UTF-8 bytesです。

createは`revision = 1`、`baseRevision = 0`です。updateは既存revisionから1ずつ進め、`baseRevision`を直前のrevisionへ合わせます。`updatedAt`と、削除時の`deletedAt`にはserver timestampを使います。

### 4.3 `drafts`

Firestoreへ保存するfieldは次の11個だけです。

- `ownerUid`
- `deviceId`
- `deviceLabel`
- `schemaVersion`
- `payload`
- `revision`
- `baseRevision`
- `mutationId`
- `updatedAt`
- `expiresAt`
- `deletedAt`

draft envelopeの`schemaVersion`は`1`です。`payload`は既存のDraftStorageDocument parserで検証するJSON文字列で、上限は200,000 UTF-8 bytesです。`deviceId`は1〜128 UTF-8 bytes、`deviceLabel`は1〜200 UTF-8 bytesです。

`expiresAt`は書き込み時刻より後、かつ30日以内である必要があります。アプリが生成する`deviceLabel`は最大80文字、Security Rulesの上限は200 UTF-8 bytesです。作業中下書きはブラウザごとに分け、他のブラウザの下書きで現在の下書きを自動上書きしません。他のブラウザの下書きは、利用者が一覧から明示的に復元または削除できます。

### 4.4 ローカルファースト同期、競合、削除済み記録

ボックスとクラウド下書きは、ブラウザ内のUID別stateへ変更を先に保存し、順番付きの`outbox`へ追加してからFirestoreへ送ります。オフラインや送信失敗時はoutboxを保持し、再試行します。

同じ保存を複数のブラウザから変更した場合は、Last Write Winsで黙って上書きせず、revision、baseRevision、mutationIdを使って競合として残します。

クラウドへ保存済みのボックス・下書きを通常のUIで削除した場合は、`deletedAt`を持つ削除済み記録として更新し、競合確認や古いブラウザからの復活防止に必要なpayloadを残します。クラウドへ一度も送信されていない保存を削除した場合は、Firestoreへ削除済み記録を作らずローカルから破棄することがあります。

通常のrepositoryは物理削除を行いません。Security Rules上は認証済みownerによる物理deleteを許可しており、アプリではアカウント削除経路だけがこの操作を使用します。

### 4.5 クラウド下書きの件数と30日期限

有効な、削除済みでないクラウド下書きは1アカウントにつき最大10件です。現在のブラウザの下書きを優先し、期限切れまたは上限超過の下書きを削除済み記録へ変更します。

有効な下書きは最後の保存から30日後の`expiresAt`を持ちます。期限切れの整理は、アプリ起動時、画面へ戻ったとき、オンライン復帰時、手動同期時に行います。

30日は、有効な下書きを一覧へ表示し続ける期限と、整理を開始する条件です。30日後の物理削除を保証するものではありません。期限切れ・通常削除・上限超過による削除済み記録はpayloadを保持し、Firestoreではアカウント削除まで残ります。利用者がアプリを再度開かなければ、期限切れrecordが整理されないままFirestoreへ残る場合もあります。

### 4.6 Security Rules

Firestore Security Rulesでは、次を検証します。

- 未認証、またはpathと異なるUIDによるread / writeを拒否する
- 許可field以外を拒否する
- owner UID、kind、schemaVersion、document ID、payload sizeを検証する
- revisionとbaseRevisionの進行を検証する
- updatedAt、deletedAt、expiresAtのtimestamp条件を検証する

Security RulesとFirebase AuthenticationだけでApp Checkの役割を置き換えません。App Checkについては「5.4 Firebase / App Check / reCAPTCHA Enterprise」に記載します。

## 5. 外部サービスへの通信

### 5.1 GitHub Pages

ChampionCreatorはGitHub Pagesで配信する静的Webアプリです。GitHubは、GitHub Pagesへアクセスした利用者のIPアドレスをセキュリティ目的で記録・保存すると説明しています。

ChampionCreator独自のruntime backend、Adminサーバー、Google Drive保存はありません。

### 5.2 Google Analytics 4

アプリ、使い方ガイド、プライバシーページでは、HTMLのGoogle tagから次の設定を実行します。

- 測定ID: `G-VCGTV67QC2`
- 初期化: `gtag('config', 'G-VCGTV67QC2')`

この`config`はページ読み込み時に実行され、標準の`page_view`などを送信します。Google Analyticsの標準実装では、ページURL、参照元、ページタイトル、言語、画面サイズ、ブラウザ・利用環境、概算地域、セッション情報などを扱い、通常は`_ga` Cookieのclient IDを使います。

リポジトリ内にはFirebase Analytics、`logEvent`、ChampionCreator独自のcustom Analytics eventはありません。入力条件、ボックス内容、クラウド下書き、Firebase UID、credential、access tokenをAnalytics eventへ追加する処理もありません。

サイト内の計測OFF UIやConsent Mode設定は実装していません。ブラウザのCookie・計測制限や拡張機能によって通信を制限できる場合があります。

GA4 property側のdata retention、Google Signals、enhanced measurement、広告関連設定はリポジトリから確認できません。標準収集の範囲とGoogle側の処理は、GA4 property設定とGoogleのポリシーにも依存します。

### 5.3 Google Fonts

アプリ、使い方ガイド、プライバシーページは、`fonts.googleapis.com`から`LINE Seed JP`のCSSを読み、そのCSSが指定するフォントを`fonts.gstatic.com`から読み込みます。

この通信では、接続元IPアドレス、User-Agentなど、HTTP配信に必要な通常の通信情報がGoogleへ届きます。ChampionCreatorの入力条件やアカウントデータをフォントrequestへ含める処理はありません。

### 5.4 Firebase / App Check / reCAPTCHA Enterprise

公開版のメインアプリでは、Firebase clientを初期化します。Googleログインや同期を利用した場合はFirebase AuthenticationとCloud Firestoreへ通信します。

App Check site keyがあり、初期化に成功した公開buildでは、`ReCaptchaEnterpriseProvider`を使い、`isTokenAutoRefreshEnabled: true`でtokenを更新します。reCAPTCHA Enterpriseへブラウザ環境の確認に必要な情報が送られ、発行されたApp Check tokenをFirebase AuthenticationとCloud Firestoreのリクエストへ付けます。App Checkの通信はログイン前に発生する場合があります。

開発環境、またはApp Check site keyがないbuildではApp Checkを初期化しません。Pages workflowは本番buildでsite keyを必須にしています。

現在の本番運用手順では、Cloud FirestoreとFirebase AuthenticationのApp Check enforcementを有効にし、未検証requestを拒否する前提です。ただし、enforcementはFirebase Console側の状態であり、source codeだけでは有効性を保証できません。公開時とFirebase設定変更後にConsoleと実通信を再確認します。

Firebase側の認証、不正利用対策、service log、保持はFirebaseのポリシーに従います。

### 5.5 外部リンク

X、Googleフォーム、GitHub、Pokemon Champions Battle Dataなどの外部リンクは自動埋め込みではありません。利用者がリンクを選んだときだけ移動し、移動先では各サービスのポリシーが適用されます。

使用率データは公開build時に取得して同一サイトの静的JSONとして配信します。通常の利用時に入力条件やアカウントデータをPokemon Champions Battle Dataへ送信しません。

## 6. アカウントデータの書き出し

### 6.1 処理順

アカウント画面の`アカウントデータを書き出す`では、次の順に処理します。

1. 未保存の現在下書きをブラウザへ保存する。
2. ボックスとクラウド下書きの手動同期を実行する。
3. UIDが変わっていないことを確認し、同期providerの新規操作を一時停止する。
4. Firestoreの`syncRecords`と`drafts`をサーバーから読み直す。
5. 既存parserでrecordとpayloadを検証し、JSONファイルを生成する。

同期自体がerrorの場合、またはFirestoreのcollectionを読み取れない場合は書き出しを中止します。未送信outbox、競合、読み取りissue、破損・未対応recordが残る場合は、警告を付けた部分書き出しにします。未送信outboxのpayloadそのものは、サーバーから読めないため書き出しに含まれません。

### 6.2 JSONへ含める内容

- `schemaVersion`
- `exportedAt`
- `uid`
- `profile`
  - `displayName`
  - `email`
  - `photoURL`
- `complete`
- `warnings`
- `syncRecords`
- `draftRecords`

`syncRecords`と`draftRecords`には、既定で削除済み記録と保持payloadも含めます。owner不一致、schema不正、payload不正など、個別に検証できないrecordは除外し、warningへ記録します。record keyやdeviceIdの重複がある場合は、書き出し全体を中止します。

### 6.3 JSONへ含めない内容

- Google credential、access token、Firebase User
- Firebase Admin credential、service account key、Google OAuth client secret
- UID別ブラウザ保存のoutbox、競合cache、migration状態
- Firebaseへ未送信の作業内容
- 未ログイン用保存領域に残っているボックス・作業中下書き・表示設定
- Firebase SDKが管理するログイン状態

初回統合でFirebaseへ保存済みになったボックスは書き出し対象です。対象外なのは、初回統合でアカウントへ移さず未ログイン用保存領域に残っているデータです。

生成したBlob URLは通常のdownload操作後にrevokeします。現在、アカウント書き出しJSONをユーザー操作でアカウントへ一括importする機能はありません。調整対象・仮想敵ボックスの通常バックアップとは別形式です。

## 7. 通常削除と保持期間

| データ | 利用中の保持 | 通常削除後 | 物理削除 |
| --- | --- | --- | --- |
| 未ログイン用ブラウザ保存 | アプリ側の期限なし | ボックスは通常操作、作業中下書きなどはサイトデータ削除まで残る | ブラウザのサイトデータ削除 |
| UID別ブラウザ保存 | アプリ側の期限なし | 同期に必要なcache / outbox / tombstoneを保持する場合がある | アカウント削除またはサイトデータ削除 |
| Firestoreのボックス | アプリ側の期限なし | 削除済みrecordとpayloadを保持 | アカウント削除 |
| Firestoreの有効なクラウド下書き | 最後の保存から30日、1アカウント最大10件 | 期限切れ・超過・通常削除を削除済みrecordへ変更し、payloadを保持 | アカウント削除 |
| Google Analytics / Firebase / GitHub Pagesなどのservice log | 各サービスと設定による | 各サービスと設定による | 各サービスのポリシーによる |

クラウドへ未送信の新規保存は、通常削除時に削除済みrecordを作らず破棄する場合があります。

## 8. アカウント削除

### 8.1 利用者による確認

アカウント画面で確認欄へexact text `削除`を入力した場合だけ削除操作を開始します。削除操作では毎回Google popupを開き、`reauthenticateWithPopup`で再認証します。再認証結果と現在のFirebase Userが対象UIDと一致することを確認します。

### 8.2 処理順

1. Google popupで再認証し、対象UIDを再確認する。
2. 同じタブで動作するSyncBox / CloudDraftのtimer、queue、進行中同期を停止・完了待ちする。
3. `/users/{uid}/syncRecords`と`/users/{uid}/drafts`をサーバーから読み取る。
4. 1 batch最大450件で物理deleteし、両collectionを再列挙して空を確認する。
5. 再度両collectionを確認し、処理中に発生した同一アカウントの書き込みを可能な範囲で削除する。
6. UID別のアプリ管理ブラウザ保存を削除する。
7. 各削除試行の最後にFirebase Authenticationの`deleteUser`を呼ぶ。

削除時は通常parserを通さず、対象UID配下のraw documentを列挙します。破損・未対応schemaのdocumentも、対象collection内にあれば物理削除します。

### 8.3 失敗と再試行

再認証、provider停止、Firestoreの読み取り・batch delete・空確認、UID別ブラウザ保存の削除のいずれかが失敗した場合は、Firebase Authenticationのアカウントを削除しません。ログイン状態を維持し、同じ画面から再試行できます。

物理削除は複数のread / batch処理に分かれるため、失敗時点ですでに一部のクラウドデータが削除されている場合があります。ブラウザ内キーの削除中に失敗した場合は、UID別ブラウザ保存も一部だけ削除済みになる可能性があります。削除フェーズ開始後に失敗した場合は、通常の同期操作を再開せず、再試行まで変更をロックします。

最後のFirebase Authentication削除だけが失敗した場合は、Cloud FirestoreとUID別ブラウザ保存がすでに削除された状態でログインを維持し、Auth削除だけを再試行します。

`deleteUser`が成功した後のFirebase側のlog・live system・backup systemにおける削除時期は、Firebaseの保持方針に従います。Firebaseは、関連Userの削除後、IP log以外のAuthentication情報をlive systemとbackup systemから180日以内に削除すると説明しています。

静的clientからの処理であり、別のブラウザとの完全なtransactionにはできません。collectionの再列挙を繰り返して競合書き込みを減らしますが、削除処理中に他のブラウザから同じアカウントへ書き込む場合の完全な原子性は保証しません。

### 8.4 アカウント削除で削除するブラウザキー

- `championcreator.sync.v1.<uid>`
- `championcreator.cloud-draft.v1.<uid>.<device>`に一致する全キー
- `championcreator.draft.v1.<uid>.<device>`に一致する全キー
- `championcreator.migration.v1.<uid>`

### 8.5 アカウント削除後も残るブラウザキー

- `championcreator.box.v1`
- `championcreator.enemy-box.v1`
- `championcreator.box.default-example.v1`
- `championcreator.draft.v1`
- `championcreator.suggestion-format.v1`
- `championcreator.device.v1`
- `championcreator.migration-source.v1`

`championcreator.migration-source.v1`には統合先UIDが残ります。これらを含め、ChampionCreatorに関するブラウザ保存をすべて削除するには、ブラウザの設定からサイトデータを削除します。

## 9. 対応していない機能

- 共有ボックス
- リアルタイム共同編集
- Google以外のログイン方法
- Google Driveへの保存
- アカウント書き出しJSONの一括import
- 未ログイン用の作業中下書きのJSONバックアップ

## 10. 用語

| 用語 | この文書での意味 |
| --- | --- |
| `localStorage` | Webブラウザがサイトごと・ブラウザプロファイルごとにデータを保持する保存領域 |
| UID | Firebase Authenticationがアカウントを識別するための値 |
| scope | Googleアカウントから受け取れる情報や実行できる操作の範囲（アクセス権） |
| `deviceId` / `<device>` | クラウド下書きをブラウザごとに分けるため、初回にランダム生成するUUID |
| `deviceLabel` | platform / User-Agentから作る「Windows / Chrome」などの大まかな表示名。生のUser-Agentではない |
| `outbox` | Firebaseへまだ送信できていない操作を順番に保持するキュー |
| `syncRecords` | 調整対象・仮想敵ボックスと同期情報を保存するFirestore collection |
| `drafts` | ブラウザ別クラウド下書きと同期情報を保存するFirestore collection |
| tombstone / 削除済み記録 | 元データを保持したまま、削除済みであることを示すrecord |
| App Check | 正規のアプリから送られたrequestかを検証するFirebaseの仕組み |
| reCAPTCHA Enterprise | 公開版WebアプリでApp Checkのattestationに使用するGoogleのservice |

## 11. 関連する外部ポリシー・資料

- [GitHub Pagesのデータ収集](https://docs.github.com/ja/pages/getting-started-with-github-pages/what-is-github-pages#data-collection)
- [GitHubのプライバシーステートメント](https://docs.github.com/ja/site-policy/privacy-policies/github-general-privacy-statement)
- [Google Analyticsの標準データ収集](https://support.google.com/analytics/answer/11593727?hl=ja)
- [Google Analyticsの自動収集イベント](https://support.google.com/analytics/answer/9234069?hl=ja)
- [Googleのプライバシーポリシー](https://policies.google.com/privacy)
- [Google Fontsの技術的な仕組み](https://developers.google.com/fonts/docs/technical_considerations)
- [Firebaseのプライバシー情報](https://firebase.google.com/support/privacy)
- [Firebase App CheckとreCAPTCHA Enterprise](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider)
