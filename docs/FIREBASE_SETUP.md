# Firebase同期 セットアップ・運用手順

この文書は、ChampionCreatorのFirebase同期を開発・運用するための恒久的な手順です。Firebase client、Google認証、Auth / Firestore Emulator、Security Rules、App Check、ブラウザ内保存、Firestore同期、アカウントライフサイクルを扱います。

計算と通常編集は、Firebaseを利用できない場合もブラウザ内保存だけで動作します。本番Pages workflowは、Firebase Web configまたはApp Check site keyが欠けている場合に停止し、同期機能のないbuildを誤って公開しません。

Googleログイン後は、既存のブラウザ内保存をアカウントの保存領域へ初回統合します。統合後は、調整対象・仮想敵ボックスとブラウザ別クラウド下書きをUIDごとに同期します。ログアウト、書き出し、アカウント削除までの境界は`src/sync/`が所有し、`App`へFirebase固有処理を散らしません。

## 現在の設定状態

| 項目 | 現在の状態 |
| --- | --- |
| Firebase Web SDK | `src/sync/`の初期化境界から利用 |
| 認証状態 | restore / sign-in / sign-out / errorを専用sessionで管理 |
| Auth / Firestore Emulator | `firebase.json`と`.firebaserc`で設定 |
| ブラウザ内 / Firestore repository | UID別、ブラウザへの保存を先に確定 |
| 未送信操作 | 順序付きキュー（`outbox`）へ保持 |
| Firestore Security Rules | Emulator test対象。本番Rules / indexesはrepositoryと同じ内容 |
| Firebase project / Web app | 有効 |
| Google provider | 有効。追加のアクセス権は要求しない |
| authorized domains | custom domain、`localhost`、`127.0.0.1`を登録 |
| Cloud Firestore | `(default)` databaseを利用 |
| App Check | reCAPTCHA Enterprise。Cloud Firestore / Authenticationともenforcement有効 |
| 初回統合 | UID別の統合状態と4つの選択肢を管理 |
| ボックス同期 | 調整対象・仮想敵をUID別local / `outbox` / Firestoreへ保存 |
| バックアップ読み込み | `統合` / `クラウド全体を置き換え`と件数previewに対応 |
| ブラウザ別クラウド下書き | UID + deviceId別。2秒queue、10件上限、30日保持 |
| アカウント画面 | 未ログイン時のログイン導線と、認証後の同期・書き出し・削除を提供 |
| アカウント削除 | UID専用データを先に削除し、Authenticationのアカウントを最後に削除 |
| 公開版 | version `0.21.2`。custom domainでFirebase同期を有効化 |

## 秘密情報の境界

`VITE_FIREBASE_*` に置けるのは、Firebase Console が Web app 用に表示する公開 config だけです。Firebase Web API key は project を識別する公開値であり、認可の代わりにはなりません。API 制限、Firestore Security Rules、App Check を併用します。

次の値は repository、`.env`、GitHub Actions、browser bundle、Pages artifact のどこにも入れません。

- Firebase Admin credential
- service account key / `private_key`
- Google OAuth client secret
- App Check debug token
- Firebase 以外の秘密 API key

## ローカル Emulator

前提は Node.js 22.12 以上と Java 21 です。Firebase CLI は project dependency として固定しています。

```powershell
Copy-Item .env.example .env.local
npm ci
```

1つ目の terminal で Auth / Firestore Emulator を起動します。

```powershell
npm run emulators
```

2つ目の terminal で Vite を起動します。

```powershell
npm run dev
```

Security Rules test は Firestore Emulator を一時起動して実行します。

```powershell
npm run test:rules
```

通常の unit test は `npm test`、Rules を含む全体確認は `npm run check` です。`.firebaserc` は実 project へ接続しない `demo-championcreator` 専用です。

ボックス同期とバックアップ取り込みを変更した場合は、次の対象テストを先に実行します。

```powershell
npm test -- --run src/sync/syncBoxRepository.test.ts src/sync/SyncBoxProvider.test.tsx src/ui/boxBackupImport.test.ts src/ui/BackupImportDialog.test.tsx src/App.test.tsx
npm run typecheck
```

その後、Emulator上で初回統合済みのテスト用UIDを使い、調整対象・仮想敵の作成、上書き、名前変更、複製、削除、読み込み、バックアップ書き出し・読み込みを確認します。保存操作ではブラウザ内保存と`outbox`が先に成功し、Firestoreのnetwork / permission failure後も画面の保存とJSONバックアップが残ることを確認します。起動、画面focus、online復帰、ボックス操作後の再試行では、`outbox`を順番どおり再送します。

削除済み記録（`tombstone`）、同一スロットの更新競合・更新対削除、1件だけ壊れたremote、バックアップの件数preview（追加 / 更新 / 削除 / 変更なし）、`統合`、アカウント利用時の`クラウド全体を置き換え`、削除済み保存のバックアップ復元も確認対象です。未ログイン、初回統合の保留・失敗、`variant="tutorial"`では、ブラウザ内保存を優先する動作を確認します。

ブラウザ別クラウド下書きは、同じテストUIDの複数deviceIdで確認します。ブラウザ内の0.75秒autosave、操作停止後2秒のクラウド保存予約、別ブラウザ一覧の更新日時・ブラウザラベル・入力概要、明示的な復元・削除、同時編集、offline中の`outbox`保持、network / permission / quota / 破損`payload`、10件上限、30日経過、起動・focus・online・手動cleanupを対象にします。

復元時にボックス、計算結果、候補、Workerの状態を変更しないこと、`pagehide` / `visibilitychange`で同期完了を装わないこと、`variant="tutorial"`が保存・同期されないことも確認します。realtime listenerと共有ボックスは採用しません。

## Web config

`.env.example` を `.env.local` へコピーした状態は Emulator 用です。本番用には次の GitHub repository variables を `Settings > Secrets and variables > Actions > Variables` へ登録します。本番Pages workflowは、基本Web config 4件とApp Check site keyのいずれかが欠けている場合、guest-only buildを公開せずエラーで停止します。

本番Pagesで必須:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_APP_CHECK_SITE_KEY`

任意:

- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`

Firebase config を入れた development build では `VITE_FIREBASE_USE_EMULATORS` に `true` または `false` の明示が必須です。通常の開発では `true` を使います。production build はこの値に関係なく localhost の Emulator へ接続しません。

## Firebase Console と本番反映

次の項目はリポジトリから自動設定しません。初期セットアップ時と本番公開前に、Firebase Consoleの状態とリポジトリの設定が一致していることを確認します。ボックスは`/users/{uid}/syncRecords/{documentId}`、ブラウザ別クラウド下書きは`/users/{uid}/drafts/{deviceId}`へ保存するため、コレクションを手動作成する必要はありません。アカウント削除もFirebase client SDKとSecurity Rulesで処理し、Admin SDKやFunctionsは追加しません。

1. FirebaseプロジェクトとWebアプリを作成し、Web configを取得する。
2. AuthenticationでGoogleプロバイダーを有効にする。Driveのファイル、連絡先、Gmailのメール本文などへアクセスする追加権限は要求しない。
3. Authenticationのauthorized domainsへ`championcreator.suisui-swimmy.com`、`localhost`、`127.0.0.1`を用途別に登録する。
4. Cloud Firestoreを本番モードで作成し、利用地域を確定する。
5. WebアプリをApp CheckのreCAPTCHA Enterpriseプロバイダーへ登録し、site keyを設定する。新しいWebアプリを登録した直後は適用（enforcement）を有効にせず、verified / outdated / unknown / invalid requestの指標を監視する。正規リクエストがverifiedになることを確認してから、Cloud FirestoreとAuthenticationのenforcementを有効にする。現在の本番プロジェクトでは両APIとも有効にしている。
6. GitHub repository variablesを登録し、Pages buildがFirebase Web configとApp Check site keyを受け取れるようにする。
7. Emulator testがpassしたRulesとindexesを、明示した本番プロジェクトへdeployする。Rulesまたはindexesを変更した場合は、毎回この手順で再反映する。

```powershell
npx firebase-tools login
# Rules / indexesの本番反映
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project <firebase-project-id>
# indexes変更がないRulesだけの更新
npx firebase-tools deploy --only firestore:rules --project <firebase-project-id>
```

`.firebaserc` の `demo-championcreator` alias を production project ID へ書き換えません。production deploy では常に `--project` を明示します。

## 認証方式

GitHub Pagesとcustom domainでは、`GoogleAuthProvider`と`signInWithPopup`を使用します。`signInWithRedirect`は採用せず、popup失敗時もredirectへ自動切り替えしません。Firebase Hosting以外でredirectを安全に使うには、helper用storageへの追加対策が必要になるためです。Googleログインから受け取る標準プロフィールは、UID、表示名、メールアドレス、プロフィール画像です。`addScope()`は呼ばず、Google Driveのファイル、連絡先、Gmailのメール本文などへアクセスする追加権限は要求しません。

ログイン状態の復元は`onAuthStateChanged`、ログアウトはFirebase Authの`signOut`を専用session経由で扱います。Firebaseの`User`、credential、access tokenは`App`のstateや保存`payload`へ渡しません。アカウント削除では`reauthenticateWithPopup`の後にFirestoreのUID専用データを削除し、`deleteUser`を最後に一度だけ呼びます。成功時はAuth listenerが`null`を通知するため、`signOut`を重ねて呼びません。

## Firestore repository / Security Rules

ボックス保存で許可するpathは`/users/{uid}/syncRecords/{documentId}`、ブラウザ別クラウド下書きで許可するpathは`/users/{uid}/drafts/{deviceId}`だけです。どちらも認証済みownerのUID境界を持ち、通常のrepositoryから物理deleteは行いません。アカウント削除専用サービスだけが、再認証済みの同一ownerとして両コレクションを物理deleteします。

- 未認証と別 UID の read / write を拒否し、write では path と `ownerUid` の一致を必須にする
- 1保存スロットを1 documentとして扱い、全ボックスを1つのblobへまとめない
- field は `ownerUid` / `kind` / `schemaVersion` / `entryId` / `payload` / `revision` / `baseRevision` / `mutationId` / `updatedAt` / `deletedAt` だけを許可する
- `kind` は `target-box` / `enemy-box` だけを許可する
- sync envelope の `schemaVersion` は整数 `1` だけを許可する
- `entryId` はUUIDへ限定せず既存IDをfieldに保持し、Firestore document IDは`kind + ":" + entryId`のSHA-256 lowercase hexへ固定する
- `payload` は最大 200,000 UTF-8 bytes のJSON stringとし、repositoryで既存box parserを通して1件・kind・entry ID・payload schemaを検証する
- `payload` は検索条件に使わないため、`firestore.indexes.json`でsingle-field indexを無効化する
- createは`revision = 1` / `baseRevision = 0`、updateはremoteのrevisionから1ずつ進める
- `mutationId`を同一revisionの再送キーとして維持し、transaction内のrevision比較と合わせて二重適用を防ぐ
- `updatedAt`と削除時の`deletedAt`はserver timestampだけを許可する
- deleteは物理削除せず`deletedAt`付きtombstoneとして残し、削除前payloadも競合確認用に保持する
- アカウント削除専用経路の物理deleteは通常のmutation / tombstoneとは分離し、`writeBatch(...).delete(ref)` を最大450件ずつ実行した後に `getDocsFromServer` で空を確認する
- local変更は新しいUID別sync namespaceへ先に保存し、同じversioned document内の順序付きoutboxへ積む
- remote empty、network、permission、quota、invalid payload、future schemaを別状態として扱い、1件の破損documentで正常な一覧を空にしない
- 同一slotの同時更新や更新対削除はLast Write Winsにせず、local / remoteを要確認状態へ保持する

## 既存ブラウザ内保存の初回統合

Googleログイン後、既存ブラウザのボックス保存をアカウントの保存領域へ初めて結び付けるときに実行します。通常の編集や未ログイン時の保存を、常にクラウドへ切り替える処理ではありません。

- `championcreator.box.v1`、`championcreator.enemy-box.v1`、`championcreator.box.default-example.v1`を統合元として扱う
- 統合状態はUIDごとのversioned markerへ保存する。未ログイン領域とUID領域を分け、ログアウトやアカウント切り替えで混在させない
- ブラウザだけに保存がある、クラウドだけに保存がある、双方が空、双方が同じ、双方に異なる保存がある、の各状態を区別する
- 双方に保存がある場合は、`統合` / `クラウドを使用` / `このブラウザを使用` / `あとで決める`を表示する
- `統合`では同一ID・同一`payload`を1件にまとめ、同一IDで`payload`が異なる場合は競合コピーとして両方を保持する
- Firestoreとブラウザ内保存の両方が成功するまで、既存のlocalStorage keyを削除しない。失敗時も旧データとJSONバックアップを復旧手段として残す
- 未変更の既定サンプルは重複させず、ユーザーが削除した既定サンプルを復活させない
- 対象は調整対象・仮想敵ボックスの保存済み入力条件だけとし、計算結果、候補一覧、Workerの状態、チュートリアル、ブラウザ別クラウド下書きは含めない

ブラウザ別クラウド下書きは初回統合の対象にせず、`/users/{uid}/drafts/{deviceId}`へ別データとして保存します。アカウント削除でも、既存の未ログイン用keyはゲスト資産として残し、UID専用の削除対象へ含めません。

## ボックス同期

ボックス同期は、次の条件をすべて満たす場合だけ有効になります。

- Firebase Authから復元された認証済みsessionである
- sessionのUIDと初回統合のmarkerに保存したUIDが一致する
- 初回統合が正常に完了している

条件を満たさない未ログイン、統合中、確認待ち、統合エラー、別UIDのsessionは、ブラウザ内保存を優先する経路を使います。ボックスrepositoryはアカウント管理UIや物理deleteを直接所有しません。同期停止と削除は、アカウントサービスとProvider停止APIから受け取ります。

UID別のlocal repositoryへ保存する対象は、調整対象ボックスと仮想敵ボックスの各保存slotです。作成、上書き、名前変更、複製、削除、読み込み、バックアップ書き出し・読み込みを同じkind境界で扱い、調整対象と仮想敵の`payload`を混ぜません。計算結果、候補一覧、Workerの状態、作業中の下書き、チュートリアルは同期しません。

保存操作はlocal repositoryへの保存成功を先に確定します。その後、同じUID namespaceの順序付き`outbox`へ未送信操作（mutation）を残し、Firestoreへ送ります。同期は起動時、window focus時、online復帰時、ボックス操作後の再試行で行います。network、permission、quota、invalid `payload`、future schemaは別状態として扱い、同期に失敗してもブラウザ内の保存とJSONバックアップを失いません。

削除は`payload`を保持する`tombstone`としてFirestoreへ残します。同じslotの同時更新、更新対削除、復帰したブラウザからの古いmutationはLast Write Winsで消しません。ブラウザ側とクラウド側の両方を競合として保持し、確認待ちにします。クラウド上の1件が破損している、または未知schemaでも、その1件だけを問題として隔離し、正常な一覧を空にしません。

バックアップ読み込みは既存のボックスparserとkind検証を通します。反映前に、追加・更新・削除・変更なし、競合コピー、重複除外の件数を表示します。認証済みsessionでは`統合`と`クラウド全体を置き換え`、未ログインでは`統合`と`このブラウザの保存を置き換え`を選べます。`統合`は同一ID・同一`payload`を重複除外し、同一ID・異なる`payload`を競合コピーとして残します。読み込めない保存がある場合は警告を表示して置き換えを無効にし、validな保存の`統合`だけを許可します。保存0件の正常な空バックアップは、現在の全slotを削除する警告を表示したうえで置き換えを許可します。バックアップに残った保存を統合すれば、`tombstone`になった保存も明示的に復元できます。

### ボックス同期の確認項目

1. `npm run emulators` と `npm run test:rules` がpassし、Rulesが未認証・別UIDを拒否することを確認する。
2. 初回統合済みのテストUIDで、local保存成功後に`outbox`が増え、Firestore failure時も保存済みentryとbackupが残ることを確認する。
3. launch、focus、online、box操作後のretryでoutboxが順番どおり送信され、同じmutationの再送が二重適用されないことを確認する。
4. tombstone、更新競合・更新対削除、壊れたremoteの分離、`統合` / `クラウド全体を置き換え` の件数preview、削除済みentryのbackup復元を対象テストで確認する。
5. 未ログイン、初回統合の保留・失敗、`variant="tutorial"`がボックス同期の対象にならないことを確認する。ブラウザ別クラウド下書きとアカウント画面は、それぞれの確認項目で検証する。

## ブラウザ別クラウド下書き

ブラウザ別クラウド下書きは、Googleログイン後に初回統合を完了したUIDの認証sessionだけで有効になります。未ログイン、統合の保留・失敗、別UIDのsession、`variant="tutorial"`は保存・同期しません。アカウント画面では下書きのnamespaceと同期状態を表示し、下書き1件の削除とアカウント全体の削除を別操作として扱います。

Firestoreの保存先は`/users/{uid}/drafts/{deviceId}`です。1ブラウザにつき1documentとし、内部識別子には`deviceId` / `deviceLabel`を使います。ほかに`ownerUid`、下書きの`schemaVersion`、正規化済み`payload`、`revision`、`baseRevision`、`mutationId`、`updatedAt`、`expiresAt`、`deletedAt`を保持します。RulesではUIDとdeviceIdの一致、schema 1、`payload`サイズ、将来schema、期限、server timestamp、連番revisionを検証します。通常の削除には物理deleteではなく、`payload`を保持した`tombstone`を使います。`payload` indexは検索に使わないため無効化します。

ブラウザ内の作業中下書きは、入力変更後約0.75秒で保存します。Firestoreへの送信は、操作停止後2秒で予約します。ブラウザ内とクラウドの両方で`userId + deviceId` namespaceを分け、同じアカウントの別ブラウザが同じ下書きを上書きしないようにします。未送信mutationは順序付き`outbox`へ残し、`pagehide` / `visibilitychange`で同期完了を装いません。realtime listenerは使わず、起動時、window focus時、online復帰時、手動操作時に期限切れデータを整理します。

有効な下書きは1アカウント最大10件、保持期間は30日です。他のブラウザの下書き一覧には、更新日時、ブラウザラベル、入力概要を表示します。ユーザーが選んだ下書きだけを現在の作業画面へ復元し、ボックスの保存内容は変更しません。下書きの削除も明示操作で行います。復元時は進行中Workerと古い結果を破棄し、計算結果、候補一覧、Workerの状態、チュートリアルは下書きの`payload`へ含めません。

### ブラウザ別クラウド下書きの確認項目

1. `npm run test:rules`と`npm run check`がpassし、`/users/{uid}/drafts/{deviceId}`の未認証・別UID・別deviceId書き込み、通常mutationからの物理delete、期限切れ、`payload`超過、future schemaを拒否することを確認する。アカウント削除専用のowner deleteだけは別テストで許可を確認する。
2. 同じUIDの2つのdeviceIdで、ブラウザ内0.75秒autosave、操作停止後2秒のcloud queue、別ブラウザ一覧、明示的な復元・削除、10件上限を確認する。
3. 同時編集、revision競合、更新対削除、network / permission / quota failure、offline復帰、lost response再送、tombstone、壊れたdraftの隔離を確認する。
4. 起動、focus、online、手動操作時の30日cleanupと、`pagehide` / `visibilitychange` 後のoutbox保持を確認する。
5. draft復元後にbox dataが変わらず、Workerのstale resultが混入せず、`variant="tutorial"` が保存・同期されないことを確認する。

## アカウント・同期ライフサイクル

未ログインでも、ヘッダーにアカウント画面とGoogleログイン導線を表示します。ログイン後、初回統合を完了した認証済みsessionにだけ、通常同期、ブラウザ別クラウド下書き、書き出し、削除などのアカウント保存操作を接続します。Google popupでログイン・再認証し、UID、表示名、メールアドレス、プロフィール画像を受け取ります。Google Driveのファイル、連絡先、Gmailのメール本文などへアクセスする追加権限は要求しません。Firebaseの`User`、credential、access tokenはUI state、localStorage、バックアップへ保存しません。

### 同期状態の表示契約

同期状態としてユーザーへ表示する文言は、次の7つだけです。実装上の内部状態やAuth popupのエラーコードを、そのまま画面へ露出させません。

- `このブラウザのみ`
- `未同期`
- `同期中…`
- `同期済み`
- `オフライン`
- `競合あり`
- `同期エラー`

ブラウザ内保存とFirestoreへの保存を分けて表示します。未送信の`outbox`、競合、network / permission / quotaのエラーが残る状態を`同期済み`とは表示しません。ログアウト、書き出し、削除の実行中は、通常のボックス・下書き保存、送信予約、同期を止めます。進行中だった古い結果は、現在のUIDへ適用しません。

### アカウントデータの書き出し

アカウントデータ書き出しは、次の順で実行します。

1. 現在のUIDを固定し、手動同期を完了させる。
2. `/users/{uid}/syncRecords`と`/users/{uid}/drafts`をサーバーから読み直す。
3. 読み取りエラー、未送信の`outbox`、競合、破損・未対応`payload`がないことを確認する。
4. `schemaVersion`、`exportedAt`、UID、サニタイズしたプロフィール、両コレクションのデータをJSONにまとめる。Blobのdownload後にURLをrevokeする。

完全性を確認できない場合は、完全な書き出しとは表示しません。部分的な書き出しを許可する場合も、欠落や警告のあるファイルだと明示します。credential、token、Firebase Admin credential、service account key、Google OAuth client secret、未ログイン時のnamespaceは書き出しへ含めません。

### アカウントデータの削除

静的Pages構成のため、アカウント削除はFirebase client SDKから直接実行します。Admin SDK、service account、別のruntime backendは追加しません。Rulesでは通常のボックス・下書きmutationを`tombstone`として扱い、アカウント削除専用経路だけにownerの物理deleteを許可します。

処理順は固定します。

1. account lifecycleを`deleting`にし、同じタブのSyncBox / CloudDraftが持つtimer、queue、進行中のsynchronize / pushを停止する。
2. UIDを固定して `reauthenticateWithPopup` を実行し、popup後も `currentUser.uid` が同じことを確認する。
3. `syncRecords`と`drafts`をサーバーから読み、`writeBatch`は1 batch 450件以下でdeleteする。両コレクションを再列挙し、空になるまで有限回確認する。
4. UID専用の`championcreator.sync.v1.<uid>`、`championcreator.cloud-draft.v1.<uid>.<device>`、`championcreator.draft.v1.<uid>.<device>`、`championcreator.migration.v1.<uid>`と実行中のprovider cacheを削除する。
5. 最後に `deleteUser` を呼ぶ。成功時はAuth listenerが `null` を通知するため、追加の `signOut` は呼ばない。

既存の`championcreator.box.v1` / `championcreator.enemy-box.v1`、既定サンプルmarker、未ログイン時のnamespaceはアカウント削除で消しません。ログイン前からこのブラウザだけにあるデータはアカウントデータと別管理です。必要な場合は、ブラウザ側のサイトデータ削除や通常のボックス操作で別途削除します。

再認証、一覧取得、batch commit、空確認、UID専用local cleanupのいずれかが失敗した場合は`deleteUser`を呼びません。安定したエラー分類と再試行操作を表示します。`deleteUser`だけが失敗した場合はFirebase Auth sessionを維持し、クラウド・UID専用localの削除済み状態を再試行へ引き継ぎます。別のブラウザからの同時書き込みに対して完全な原子性はないため、同じタブのmutationを停止し、削除後の再列挙・空確認を行います。

### アカウント・同期ライフサイクルの確認項目

1. popup gatewayのDI mockで、再認証 → server read → batch delete → empty verify → UID専用local cleanup → `deleteUser` の順序を確認し、各段階の失敗で `deleteUser` が呼ばれないことを確認する。
2. UID変更、popup blocked / closed、requires-recent-login、network / permission、quota、partial batch、再試行を確認する。別UIDの結果や古い同期結果を現UIDへ混ぜない。
3. exportは手動同期後に両collectionを読み、read error、pending outbox、conflict、partial warningを完全exportと誤表示しないことを確認する。credential、token、guest keyを含めない。
4. Rules Emulatorでownerの物理deleteだけを許可し、未認証・別UIDを拒否する。通常のtombstone、更新、復元の契約を回帰確認する。
5. desktop、代表スマホ幅、320px前後でlogin、sync status、migration、export、delete、retry、logoutを確認し、console errorと横overflowがないことを確認する。

## 本番公開とApp Check

本番では、Googleプロバイダー、authorized domains、Cloud Firestore、GitHub Pages variables、reCAPTCHA Enterprise App Checkを有効にします。Cloud FirestoreとAuthenticationのApp Check enforcementも有効な状態を維持します。

公開前とFirebase設定変更後は、次の順で再検証します。

1. `npm run check`を実行し、unit test、Rules Emulator、production buildを完了させる。
2. リポジトリの`firestore.rules` / `firestore.indexes.json`と本番設定の差分を確認し、必要な場合だけ明示したプロジェクトへdeployする。
3. Pages workflowがFirebase Web configとApp Check site keyを受け取り、guest-only buildを公開していないことを確認する。
4. custom domainでGoogleログイン、Firestoreのread / write、再読み込み、別ブラウザへのボックス・下書き反映、削除同期、consoleを確認する。
5. desktop、393px前後、320px前後でログイン、初回統合、同期状態、競合、ログアウト、書き出し、削除・再試行の表示と横overflowを確認する。
6. App Checkのverified / outdated / unknown / invalid requestのmetricsを確認する。Webアプリ登録やsite key変更後にenforcementを再設定する場合は、正規リクエストがverifiedになることを確認してから有効にする。
7. enforcement変更後は、ログアウトからのGoogle再ログインと`今すぐ同期`を再実行し、AuthenticationとFirestoreの両方を確認する。

実アカウント削除はユーザーデータを破壊するため、通常の本番smokeには含めません。再認証、物理deleteの順序、途中失敗、再試行はmock、Rules Emulator、UI QAで確認します。
