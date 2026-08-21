# Firebase 同期基盤セットアップ（SYNC-M1〜M4）

この文書は `SYNC-M1`〜`SYNC-M4` で追加した Firebase 同期基盤の開発・公開手順です。現在の実装範囲は Firebase client、Google provider の認証 session owner、Auth / Firestore Emulator、App Check、保存スロット単位の local / Firestore repository、outbox、同期 coordinator、既存 localStorage の one-time migration controller、M4の調整対象・仮想敵ボックス接続、Firestore Security Rules までです。

`SYNC-M3` の controller は既存データを一度だけ移行するための状態・選択肢・UID境界を扱い、`SYNC-M4` の runtime owner はM3の移行が完了した復元済み認証 session にだけ通常のbox操作を接続します。ゲスト・未認証、移行保留中、移行失敗時は従来どおり browser storage / local-first です。常設のログイン・同期状態・アカウント管理 UI は提供せず、cloud draft は `SYNC-M5`、常設UIは `SYNC-M6` の範囲です。Firebase config がない公開・開発環境でも、既存の guest / local-first 機能はそのまま利用できます。

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
| App Check の登録と monitor | 2026-08-21 確認済み（enforcement は未実施） |
| SYNC-M3 one-time migration controller / UID別 marker / 初回統合dialog | 認証済みsessionのruntime gateへ接続済み |
| SYNC-M4 UID別local / outbox / Firestoreによるtarget・enemy box操作 | M3完了後の復元済み認証sessionへ接続済み |
| SYNC-M4 tombstone、競合保持、破損remote分離 | 実装済み（対象repository / coordinator経路） |
| SYNC-M4 backup importの`統合` / `全端末を置き換え`と件数preview | 実装済み |
| SYNC-M5 cloud draft | 未実装 |
| SYNC-M6 常設ログイン・同期状態・アカウント管理 UI | 未実装 |

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

その後、Emulator上でM3を `completed` にしたテスト用UIDの復元済みsessionを使い、調整対象・仮想敵の作成、上書き、名前変更、複製、削除、読み込み、バックアップ書き出し・読み込みを確認します。保存操作ではローカル保存とoutboxが先に成功し、Firestoreのnetwork / permission failure後も画面のentryとJSONバックアップが残ること、起動・focus・online復帰・ボックス操作後の再試行でoutboxが再送されることを確認します。削除後のtombstone、同一slotの更新競合・更新対削除、1件だけ壊れたremote、バックアップの件数preview（追加 / 更新 / 削除 / 変更なし）、`統合`、アカウント時の`全端末を置き換え`、削除済みentryのバックアップ復元も確認対象です。ゲスト・未認証、M3の移行保留・失敗、`variant="tutorial"` では従来のlocal-first動作を確認し、cloud draftと常設ログイン・同期状態・アカウント管理UIを期待しません。

## Web config

`.env.example` を `.env.local` へコピーした状態は Emulator 用です。本番用には次の GitHub repository variables を `Settings > Secrets and variables > Actions > Variables` へ登録します。workflow は値がそろっていない場合も build を成功させ、その build では Firebase を初期化しません。

必須:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_APP_ID`

任意:

- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_CHECK_SITE_KEY`

Firebase config を入れた development build では `VITE_FIREBASE_USE_EMULATORS` に `true` または `false` の明示が必須です。通常の開発では `true` を使います。production build はこの値に関係なく localhost の Emulator へ接続しません。

## Firebase Console と本番反映

次の項目は repository から自動実行しません。1〜7は2026-08-21に確認済みです。`SYNC-M3` の one-time migration controller と `SYNC-M4` のbox runtime ownerは既存の Web config、Rules、indexes、`target-box` / `enemy-box` の保存契約を再利用するため、新しい Firebase Console 設定は追加しません。Rules / indexes を変更した場合だけ7を改めて実施し、project ID や credential そのものではなく、完了した項目と検証結果だけを `PROGRESS.md` に残します。

1. Firebase project と Web app を作成し、Web config を取得する。
2. Authentication で Google provider を有効にする。追加 scope は要求しない。
3. Authentication の authorized domains に `championcreator.suisui-swimmy.com`、`localhost`、`127.0.0.1` を用途別に登録する。
4. Cloud Firestore を production mode で作成し、利用地域を確定する。
5. Web app を App Check の reCAPTCHA Enterprise provider に登録し、site key を設定する。最初は enforcement を有効にせず、verified / outdated / unknown / invalid request の metrics を monitor する。
6. GitHub repository variables を登録し、Pages build が Firebase Web config と App Check site key を受け取れるようにする。
7. Emulator test が pass した同じ Rules と indexes を、明示した production project へ deploy する（2026-08-21完了）。

```powershell
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project <firebase-project-id>
```

`.firebaserc` の `demo-championcreator` alias を production project ID へ書き換えません。production deploy では常に `--project` を明示します。

## 認証方式

GitHub Pages / custom domain では `GoogleAuthProvider` と `signInWithPopup` を使用します。`signInWithRedirect` は採用せず、popup failure から redirect へ自動 fallback もしません。これは Firebase Hosting 以外で redirect helper の third-party storage 対策が別途必要になるためです。

session restore は `onAuthStateChanged`、logout は Firebase Auth の `signOut` を owner 経由で扱います。Firebase の `User`、credential、access token は `App` の state や保存 payload に渡しません。

## Firestore repository / Rules の M2〜M4 契約

許可する path は `/users/{uid}/syncRecords/{documentId}` だけです。

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
- local変更は新しいUID別sync namespaceへ先に保存し、同じversioned document内の順序付きoutboxへ積む
- remote empty、network、permission、quota、invalid payload、future schemaを別状態として扱い、1件の破損documentで正常な一覧を空にしない
- 同一slotの同時更新や更新対削除はLast Write Winsにせず、local / remoteを要確認状態へ保持する

## SYNC-M3: 既存 localStorage の one-time migration

`SYNC-M3` は、既存端末の保存をアカウント単位の保存領域へ一度だけ移行する controller の内部境界です。通常のボックス操作を常時クラウドへ切り替える機能ではありません。

- `championcreator.box.v1`、`championcreator.enemy-box.v1`、`championcreator.box.default-example.v1` を移行元として扱う
- migration state は `not-started` / `in-progress` / `needs-review` / `completed` を区別し、UIDごとの marker として保存する。ゲスト領域とUID領域は分離し、logoutや別アカウントへの切り替えで混在させない
- local only / cloud only / 双方空 / 双方同一 / 双方競合を区別する。双方にデータがある場合の選択肢は `統合` / `クラウドを使用` / `この端末を使用` / `あとで決める`
- `統合`では同一ID・同一payloadを1件にまとめ、同一ID・異なるpayloadは競合コピーとして両方を保持する
- 移行完了が確認できるまで legacy localStorage key を削除しない。移行失敗時も旧データと既存のJSONバックアップを復旧手段として残す
- 未変更の既定サンプルは重複させず、ユーザーが削除した既定サンプルを移行や新しい端末で復活させない
- 移行対象は調整対象・仮想敵ボックスの保存済み入力条件だけで、計算結果、候補一覧、Worker state、チュートリアル state、cloud draft は含めない

この controller は `SYNC-M4` のbox runtime ownerが利用する内部境界です。M3のproduction確認では実Google popupと移行のread / writeを検証しますが、Firebase Consoleで新しいprovider、scope、collection、indexを追加する作業はありません。`SYNC-M5` のcloud draft、`SYNC-M6` の常設ログイン・同期状態・アカウント管理 UIは先取りしません。

## SYNC-M4: 調整対象・仮想敵ボックス同期

M4のruntime ownerは、次の条件をすべて満たす場合だけ有効になります。

- Firebase Authから復元された認証済みsessionである
- sessionのUIDとM3のmigration markerのUIDが一致する
- M3のone-time migration stateが `completed` である

条件を満たさないゲスト・未認証、移行中、`needs-review`、移行エラー、別UIDのsessionは、従来のbrowser storage / local-first経路を使います。M4はログインボタンや常設の同期状態・アカウント管理画面を追加するものではありません。

M4でUID別のlocal repositoryへ保存する対象は、調整対象ボックスと仮想敵ボックスの各保存slotです。作成、上書き、名前変更、複製、削除、読み込み、バックアップ書き出し、バックアップ読み込みを同じkind境界で扱い、調整対象と仮想敵のpayloadを混ぜません。計算結果、候補一覧、Worker state、作業中のdraft、チュートリアルstateは同期しません。

保存操作はlocal repositoryの成功を先に確定し、同じUID namespaceの順序付きoutboxへmutationを残してからFirestoreへpushします。同期はlaunch、window focus、online復帰、box操作後のretryで行います。network、permission、quota、invalid payload、future schemaは別状態として扱い、同期に失敗してもlocalのentryとJSON backupを失いません。

削除はpayloadを保持するtombstoneとしてFirestoreへ残します。同じslotの同時更新、更新対削除、復帰端末からの古いmutationはLast Write Winsで消さず、local / remoteの両方を競合として保持して要確認にします。remoteの1件が破損・未知schemaでも、その1件を問題として隔離し、正常なremote一覧を空にしません。

バックアップ読み込みは既存のbox parserとkind検証を通し、コミット前に追加・更新・削除・変更なし、競合コピー、重複除外の件数を表示します。認証済みsessionでは `統合` と `全端末を置き換え`、ゲスト・未認証では `統合` と `この端末を置き換え` を選べます。`統合` は同一ID・同一payloadを重複排除し、同一ID・異なるpayloadを競合コピーとして残します。読み込めないentryがある場合は警告を表示して置き換えを無効にし、validなentryの`統合`だけを許可します。保存0件の正常な空backupは、現在の全slotを削除する警告を表示したうえで置き換えを許可します。バックアップに残ったentryを統合すれば、tombstoneになった削除済みentryも明示的に復元できます。

### M4の確認項目

1. `npm run emulators` と `npm run test:rules` がpassし、Rulesが未認証・別UIDを拒否することを確認する。
2. M3 `completed` のテストUIDで、local保存成功後にoutboxが増え、Firestore failure時も保存済みentryとbackupが残ることを確認する。
3. launch、focus、online、box操作後のretryでoutboxが順番どおり送信され、同じmutationの再送が二重適用されないことを確認する。
4. tombstone、更新競合・更新対削除、壊れたremoteの分離、`統合` / `全端末を置き換え` の件数preview、削除済みentryのbackup復元を対象テストで確認する。
5. guest、M3移行保留・失敗、`variant="tutorial"` が永続化・同期されず、cloud draftとM6の常設UIを先取りしていないことを確認する。
