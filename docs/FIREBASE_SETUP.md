# Firebase 同期基盤セットアップ（SYNC-M1〜M7）

この文書は `SYNC-M1`〜`SYNC-M7` で追加した Firebase 同期基盤の開発・公開手順です。現在の実装範囲は Firebase client、Google provider の認証 session owner、Auth / Firestore Emulator、App Check、保存スロット単位の local / Firestore repository、outbox、同期 coordinator、既存 localStorage の one-time migration controller、M4の調整対象・仮想敵ボックス接続、M5のブラウザ別cloud draft、M6の常設ログイン・同期状態・アカウント管理 UI、Firestore Security Rules、M7の公開設定検証までです。

`SYNC-M3` の controller は既存データを一度だけ移行するための状態・選択肢・UID境界を扱い、`SYNC-M4` の runtime owner はM3の移行が完了した復元済み認証 session にだけ通常のbox操作を接続します。`SYNC-M5` の runtime owner は同じ認証・UID境界で、`userId + deviceId` ごとのcloud draftを別collectionへ接続します。`SYNC-M6` は未ログインでも到達できるGoogle popup loginと、M3完了後の7種類の同期状態、ログアウト、アカウントデータの書き出し、再認証付きアカウント削除を接続します。ゲスト・未認証、移行保留中、移行失敗時は従来どおり browser storage / local-first です。Firebase config がないローカル開発環境でも、既存の guest / local-first 機能はそのまま利用できます。本番Pages workflowは同期機能なしの誤公開を防ぐため、Firebase必須設定の欠落時に停止します。

## 現在の状態

| 項目 | 状態 |
| --- | --- |
| Firebase Web SDK と `src/sync/` の境界 | 実装済み |
| 認証 session の restore / sign-in / sign-out / error 単体テスト | 実装済み |
| Auth / Firestore Emulator 設定 | 実装済み |
| local / Firestore repository、outbox、同期 coordinator | 実装済み（M2） |
| Firestore Security Rules と Emulator test | 実装済み（M2） |
| Firebase project / Web app の作成 | 2026-08-21 確認済み |
| Google provider / authorized domains の設定 | 2026-08-21 確認済み |
| Cloud Firestore の作成 | 2026-08-21 確認済み |
| M2 Rules / indexes の本番反映 | 2026-08-21 完了 |
| M5 / M6 Rules / indexes の本番反映 | 2026-08-21 完了（M7でsource一致を再確認） |
| App Check の登録と monitor | 2026-08-21 確認済み（enforcement は未実施） |
| SYNC-M3 one-time migration controller / UID別 marker / 初回統合dialog | 認証済みsessionのruntime gateへ接続済み |
| SYNC-M4 UID別local / outbox / Firestoreによるtarget・enemy box操作 | M3完了後の復元済み認証sessionへ接続済み |
| SYNC-M4 tombstone、競合保持、破損remote分離 | 実装済み（対象repository / coordinator経路） |
| SYNC-M4 backup importの`統合` / `クラウド全体を置き換え`と件数preview | 実装済み |
| SYNC-M5 cloud draft | UID + deviceId別local / outbox / Firestoreへ接続済み（2秒queue、10件上限、30日保持、期限切れcleanup） |
| SYNC-M6 常設ログイン・同期状態・アカウント管理 UI | 実装済み（ログイン導線は未ログインでも表示） |
| SYNC-M6 アカウント export / delete と失敗時 retry | 実装済み（UID専用削除、Auth削除は最後） |
| SYNC-M6 account operation gate / provider disposal | 実装済み（export / delete / logout中の保存・同期を停止） |

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

M4のbox同期とバックアップ取り込みを変更した場合は、次の対象テストを先に実行します。

```powershell
npm test -- --run src/sync/syncBoxRepository.test.ts src/sync/SyncBoxProvider.test.tsx src/ui/boxBackupImport.test.ts src/ui/BackupImportDialog.test.tsx src/App.test.tsx
npm run typecheck
```

その後、Emulator上でM3を `completed` にしたテスト用UIDの復元済みsessionを使い、調整対象・仮想敵の作成、上書き、名前変更、複製、削除、読み込み、バックアップ書き出し・読み込みを確認します。保存操作ではブラウザ保存とoutboxが先に成功し、Firestoreのnetwork / permission failure後も画面のentryとJSONバックアップが残ること、起動・focus・online復帰・ボックス操作後の再試行でoutboxが再送されることを確認します。削除後のtombstone、同一slotの更新競合・更新対削除、1件だけ壊れたremote、バックアップの件数preview（追加 / 更新 / 削除 / 変更なし）、`統合`、アカウント時の`クラウド全体を置き換え`、削除済みentryのバックアップ復元も確認対象です。ゲスト・未認証、M3の移行保留・失敗、`variant="tutorial"` では従来のlocal-first動作を確認します。

M5のcloud draftは、同じテストUIDの複数deviceIdで、ブラウザ内0.75秒autosave、操作停止後2秒のcloud queue、別ブラウザ一覧の更新日時・ブラウザラベル・入力概要、明示的な復元・削除、同時編集、offline中のoutbox保持、network / permission / quota / 破損payload、10件上限、30日経過、起動・focus・online・手動cleanupを確認します。復元時にbox dataと計算結果・候補・Worker stateを変更しないこと、`pagehide` / `visibilitychange` で同期完了を装わないこと、`variant="tutorial"` が保存・同期されないことも確認対象です。realtime listenerと共有ボックスは採用しません。常設ログイン・同期状態・アカウント管理UIはM6で接続します。

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

次の項目は repository から自動実行しません。1〜6は2026-08-21に確認済みです。7はM2〜M6のsourceを2026-08-21に本番へ反映し、M7でRules release / indexesとrepositoryの一致を再確認しました。`SYNC-M3` と `SYNC-M4` は既存のbox保存契約を再利用し、`SYNC-M5` はFirestoreの `/users/{uid}/drafts/{deviceId}` へ保存するため、Firebase Console上で新しいproject、provider、scope、authorized domain、GitHub variable、手動collection作成は不要です。M6のアカウント削除で必要な変更は既存Rulesへのowner delete許可だけで、Admin SDKやFunctionsを追加しません。project IDやcredentialそのものではなく、完了した項目と検証結果だけを `PROGRESS.md` に残します。

1. Firebase project と Web app を作成し、Web config を取得する。
2. Authentication で Google provider を有効にする。追加 scope（Driveのファイル、連絡先、Gmailのメール本文などへアクセスする権限）は要求しない。
3. Authentication の authorized domains に `championcreator.suisui-swimmy.com`、`localhost`、`127.0.0.1` を用途別に登録する。
4. Cloud Firestore を production mode で作成し、利用地域を確定する。
5. Web app を App Check の reCAPTCHA Enterprise provider に登録し、site key を設定する。最初は enforcement を有効にせず、verified / outdated / unknown / invalid request の metrics を monitor する。
6. GitHub repository variables を登録し、Pages build が Firebase Web config と App Check site key を受け取れるようにする。
7. Emulator test が pass した同じ Rules と indexes を、明示した production project へ deployする。M2〜M6分は2026-08-21完了済みです。今後Rulesを変更した場合も同じ手順で再反映します。

```powershell
npx firebase-tools login
# Rules / indexesの本番反映
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project <firebase-project-id>
# indexes変更がないRulesだけの更新
npx firebase-tools deploy --only firestore:rules --project <firebase-project-id>
```

`.firebaserc` の `demo-championcreator` alias を production project ID へ書き換えません。production deploy では常に `--project` を明示します。

## 認証方式

GitHub Pages / custom domain では `GoogleAuthProvider` と `signInWithPopup` を使用します。`signInWithRedirect` は採用せず、popup failure から redirect へ自動 fallback もしません。これは Firebase Hosting 以外で redirect helper の third-party storage 対策が別途必要になるためです。Googleログインから受け取る標準プロフィールはUID、表示名、メールアドレス、プロフィール画像です。`addScope()`は呼ばず、Google Driveのファイル、連絡先、Gmailのメール本文などへアクセスする追加 scope は要求しません。

session restore は `onAuthStateChanged`、logout は Firebase Auth の `signOut` を owner 経由で扱います。Firebase の `User`、credential、access token は `App` の state や保存 payload に渡しません。アカウント削除では `reauthenticateWithPopup` の後に Firestore の UID専用データを消し、`deleteUser` を最後に一度だけ呼びます。成功時は Auth listener が `null` を通知するため、`signOut` を重ねて呼びません。

## Firestore repository / Rules の M2〜M5 契約

M2〜M4のbox保存で許可するpathは `/users/{uid}/syncRecords/{documentId}`、M5のdraft保存で許可するpathは `/users/{uid}/drafts/{deviceId}` だけです。両方とも認証済みownerのUID境界を持ち、通常のrepositoryから物理deleteは行いません。M6のアカウント削除専用サービスだけが、再認証済みの同一ownerとして両collectionの物理deleteを行います。

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

## SYNC-M3: 既存 localStorage の one-time migration

`SYNC-M3` は、既存ブラウザの保存をアカウント単位の保存領域へ一度だけ移行する controller の内部境界です。通常のボックス操作を常時クラウドへ切り替える機能ではありません。

- `championcreator.box.v1`、`championcreator.enemy-box.v1`、`championcreator.box.default-example.v1` を移行元として扱う
- migration state は `not-started` / `in-progress` / `needs-review` / `completed` を区別し、UIDごとの marker として保存する。ゲスト領域とUID領域は分離し、logoutや別アカウントへの切り替えで混在させない
- local only / cloud only / 双方空 / 双方同一 / 双方競合を区別する。双方にデータがある場合の選択肢は `統合` / `クラウドを使用` / `このブラウザを使用` / `あとで決める`
- `統合`では同一ID・同一payloadを1件にまとめ、同一ID・異なるpayloadは競合コピーとして両方を保持する
- 移行完了が確認できるまで legacy localStorage key を削除しない。移行失敗時も旧データと既存のJSONバックアップを復旧手段として残す
- 未変更の既定サンプルは重複させず、ユーザーが削除した既定サンプルを移行や新しいブラウザで復活させない
- 移行対象は調整対象・仮想敵ボックスの保存済み入力条件だけで、計算結果、候補一覧、Worker state、チュートリアル state、cloud draft は含めない

この controller は `SYNC-M4` のbox runtime ownerと `SYNC-M5` のcloud draft ownerが利用する内部境界です。M3のproduction確認では実Google popupと移行のread / writeを検証します。M5のdraftは移行対象へ含めず、別の `/users/{uid}/drafts/{deviceId}` namespaceへ保存します。M6のアカウント削除では、この legacy key をゲスト資産として扱い、UID専用cleanupの対象へ含めません。

## SYNC-M4: 調整対象・仮想敵ボックス同期

M4のruntime ownerは、次の条件をすべて満たす場合だけ有効になります。

- Firebase Authから復元された認証済みsessionである
- sessionのUIDとM3のmigration markerのUIDが一致する
- M3のone-time migration stateが `completed` である

条件を満たさないゲスト・未認証、移行中、`needs-review`、移行エラー、別UIDのsessionは、従来のbrowser storage / local-first経路を使います。M4のrepositoryはアカウント管理UIや物理deleteを直接所有せず、M6のaccount serviceとProvider停止APIから停止・削除の境界を受け取ります。

M4でUID別のlocal repositoryへ保存する対象は、調整対象ボックスと仮想敵ボックスの各保存slotです。作成、上書き、名前変更、複製、削除、読み込み、バックアップ書き出し、バックアップ読み込みを同じkind境界で扱い、調整対象と仮想敵のpayloadを混ぜません。計算結果、候補一覧、Worker state、作業中のdraft、チュートリアルstateは同期しません。

保存操作はlocal repositoryの成功を先に確定し、同じUID namespaceの順序付きoutboxへmutationを残してからFirestoreへpushします。同期はlaunch、window focus、online復帰、box操作後のretryで行います。network、permission、quota、invalid payload、future schemaは別状態として扱い、同期に失敗してもlocalのentryとJSON backupを失いません。

削除はpayloadを保持するtombstoneとしてFirestoreへ残します。同じslotの同時更新、更新対削除、復帰したブラウザからの古いmutationはLast Write Winsで消さず、local / remoteの両方を競合として保持して要確認にします。remoteの1件が破損・未知schemaでも、その1件を問題として隔離し、正常なremote一覧を空にしません。

バックアップ読み込みは既存のbox parserとkind検証を通し、コミット前に追加・更新・削除・変更なし、競合コピー、重複除外の件数を表示します。認証済みsessionでは `統合` と `クラウド全体を置き換え`、ゲスト・未認証では `統合` と `このブラウザの保存を置き換え` を選べます。`統合` は同一ID・同一payloadを重複排除し、同一ID・異なるpayloadを競合コピーとして残します。読み込めないentryがある場合は警告を表示して置き換えを無効にし、validなentryの`統合`だけを許可します。保存0件の正常な空backupは、現在の全slotを削除する警告を表示したうえで置き換えを許可します。バックアップに残ったentryを統合すれば、tombstoneになった削除済みentryも明示的に復元できます。

### M4の確認項目

1. `npm run emulators` と `npm run test:rules` がpassし、Rulesが未認証・別UIDを拒否することを確認する。
2. M3 `completed` のテストUIDで、local保存成功後にoutboxが増え、Firestore failure時も保存済みentryとbackupが残ることを確認する。
3. launch、focus、online、box操作後のretryでoutboxが順番どおり送信され、同じmutationの再送が二重適用されないことを確認する。
4. tombstone、更新競合・更新対削除、壊れたremoteの分離、`統合` / `クラウド全体を置き換え` の件数preview、削除済みentryのbackup復元を対象テストで確認する。
5. guest、M3移行保留・失敗、`variant="tutorial"` がboxの永続化・同期対象にならないことを確認し、M5 draftとM6の常設UIはそれぞれの確認項目で検証する。

## SYNC-M5: ブラウザ別クラウド下書き

M5のcloud draftは、M3のone-time migrationが `completed` になったUIDの復元済み認証sessionだけで有効になります。ゲスト・未認証、移行保留・失敗、別UIDのsession、`variant="tutorial"` はcloud draftを保存・同期しません。M6の常設UIはこのdraftのnamespaceと同期状態を表示し、cloud draft削除とアカウント全体削除を別操作として扱います。

Firestoreの保存先は `/users/{uid}/drafts/{deviceId}` です。1ブラウザ1documentとし、内部識別子として`deviceId` / `deviceLabel`を使います。ほかに`ownerUid`、draft `schemaVersion`、normalized payload、`revision`、`baseRevision`、`mutationId`、`updatedAt`、`expiresAt`、`deletedAt` を保持します。RulesではUIDとdeviceIdの一致、schema 1、payloadサイズ、将来schema、期限、server timestamp、連番revisionを検証し、物理deleteではなくpayloadを保持したtombstoneを使います。payload indexは検索に使わないため無効化します。

ブラウザ内の作業中下書きは入力変更後約0.75秒で保存し、cloud deliveryは操作停止後2秒でqueueします。local / cloudとも `userId + deviceId` namespaceを分け、同じアカウントの別ブラウザが同じdraftを上書きしないようにします。未送信mutationは順序付きoutboxへ残し、`pagehide` / `visibilitychange` で同期完了を装いません。realtime listenerは使わず、起動時、window focus時、online復帰時、手動操作時に期限切れcleanupを行います。

アカウントあたり有効なdraftは最大10件、保持期間は30日です。他のブラウザのdraft一覧には更新日時、ブラウザラベル、入力概要を表示し、ユーザーが選んだdraftだけを明示的に現在の作業画面へ復元します。復元はbox dataを変更せず、draftの削除も明示操作で行います。復元時は進行中Workerとstale resultを破棄し、計算結果、候補一覧、Worker state、tutorial stateはdraft payloadへ含めません。

### M5の確認項目

1. `npm run test:rules` と `npm run check` がpassし、`/users/{uid}/drafts/{deviceId}` の未認証・別UID・別deviceId書き込み、通常mutationからの物理delete、期限切れ、payload超過、future schemaを拒否することを確認する。M6のaccount delete専用owner deleteだけは別テストで許可を確認する。
2. 同じUIDの2つのdeviceIdで、ブラウザ内0.75秒autosave、操作停止後2秒のcloud queue、別ブラウザ一覧、明示的な復元・削除、10件上限を確認する。
3. 同時編集、revision競合、更新対削除、network / permission / quota failure、offline復帰、lost response再送、tombstone、壊れたdraftの隔離を確認する。
4. 起動、focus、online、手動操作時の30日cleanupと、`pagehide` / `visibilitychange` 後のoutbox保持を確認する。
5. draft復元後にbox dataが変わらず、Workerのstale resultが混入せず、`variant="tutorial"` が保存・同期されないことを確認する。

## SYNC-M6: アカウント・同期状態 UI とライフサイクル

M6は、未ログインでもヘッダーにアカウント画面とGoogleログイン導線を表示します。ログイン後、M3のmigration stateが `completed` になった認証済みsessionにだけ、通常同期、cloud draft、export、deleteなどのアカウント保存操作を接続します。Google popupでログイン・再認証し、UID、表示名、メールアドレス、プロフィール画像を受け取ります。Google Driveのファイル、連絡先、Gmailのメール本文などへアクセスする追加 scope は要求しません。FirebaseのUser object、credential、access tokenはUI state、localStorage、バックアップへ保存しません。

### 同期状態の表示契約

同期状態としてユーザーへ表示する文言は、次の7つだけです。実装上の内部状態やAuth popupのエラーコードを、そのまま画面へ露出させません。

- `このブラウザのみ`
- `未同期`
- `同期中…`
- `同期済み`
- `オフライン`
- `競合あり`
- `同期エラー`

local成功とFirestore成功を分けて表示し、未送信outbox、競合、network / permission / quota failureが残る状態を `同期済み` と表示しません。ログアウト・export・delete中は各account operationが通常のbox / draftの保存、queue、同期を止め、進行中の古い結果を現在のUIDへ適用しません。

### アカウントデータの export

アカウントデータ書き出しは、次の順で実行します。

1. 現在のUIDを固定し、手動同期を完了させる。
2. `/users/{uid}/syncRecords` と `/users/{uid}/drafts` を server read する。
3. read error、未送信outbox、競合、破損・未対応payloadがないことを確認する。
4. `schemaVersion`、`exportedAt`、UID、サニタイズしたプロフィール、両collectionのデータをJSONにまとめ、Blob download後にURLをrevokeする。

完全性を確認できない場合は、完全なexportと表示しません。部分exportを許可する場合も、欠落・警告のあるファイルであることを明示します。credential、token、Firebase Admin credential、service account key、Google OAuth client secret、ゲストnamespaceはexportへ含めません。

### アカウントデータの delete

静的Pages構成のため、アカウント削除は Firebase client SDK から直接実行します。Admin SDK、service account、別のruntime backendは追加しません。Rulesでは通常のbox / draft mutationを従来どおりtombstoneとして扱い、アカウント削除専用経路だけにownerの物理deleteを許可します。

処理順は固定します。

1. account lifecycleを `deleting` にし、同じタブのSyncBox / CloudDraftのtimer、queue、in-flight synchronize / pushを停止する。
2. UIDを固定して `reauthenticateWithPopup` を実行し、popup後も `currentUser.uid` が同じことを確認する。
3. `syncRecords` と `drafts` を server readし、`writeBatch` は1 batch 450件以下でdeleteする。両collectionを再列挙し、空になるまで有限回確認する。
4. UID専用の `championcreator.sync.v1.<uid>`、`championcreator.cloud-draft.v1.<uid>.<device>`、`championcreator.draft.v1.<uid>.<device>`、`championcreator.migration.v1.<uid>` と実行中のprovider cacheを削除する。
5. 最後に `deleteUser` を呼ぶ。成功時はAuth listenerが `null` を通知するため、追加の `signOut` は呼ばない。

legacyの `championcreator.box.v1` / `championcreator.enemy-box.v1`、既定サンプルmarker、guest namespaceはアカウント削除で消しません。ログイン前からこのブラウザだけにあるデータはアカウントデータと別管理であり、必要な場合はブラウザ側のサイトデータ削除や通常のbox操作で別途消します。

再認証、一覧取得、batch commit、空確認、UID専用local cleanupのいずれかが失敗した場合は `deleteUser` を呼ばず、stableなエラー分類と再試行を表示します。`deleteUser` だけが失敗した場合はFirebase Auth sessionを維持し、クラウド・UID専用localの削除済み状態を再試行へ引き継ぎます。別のブラウザからの同時書き込みに対して完全な原子性はないため、同じtabのmutationを停止し、削除後の再列挙・空確認を行います。

### M6の確認項目

1. popup gatewayのDI mockで、再認証 → server read → batch delete → empty verify → UID専用local cleanup → `deleteUser` の順序を確認し、各段階の失敗で `deleteUser` が呼ばれないことを確認する。
2. UID変更、popup blocked / closed、requires-recent-login、network / permission、quota、partial batch、再試行を確認する。別UIDの結果や古い同期結果を現UIDへ混ぜない。
3. exportは手動同期後に両collectionを読み、read error、pending outbox、conflict、partial warningを完全exportと誤表示しないことを確認する。credential、token、guest keyを含めない。
4. Rules Emulatorでownerの物理deleteだけを許可し、未認証・別UIDを拒否する。通常のtombstone、更新、復元の契約を回帰確認する。
5. desktop、代表スマホ幅、320px前後でlogin、sync status、migration、export、delete、retry、logoutを確認し、console errorと横overflowがないことを確認する。

M6の完了は、`SYNC-M7` の全体検証・公開・一時ロードマップ削除を意味しません。M7では `npm run typecheck`、`npm test`、`npm run test:rules`、`npm run build`、本番 Rules / App Check / authorized domains、custom domainのlogin・Firestore read / write・再読み込み・別ブラウザ反映・console smoke testを確認します。
