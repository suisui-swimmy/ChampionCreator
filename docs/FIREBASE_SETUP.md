# Firebase 同期基盤セットアップ

この文書は `SYNC-M1`〜`SYNC-M3` で追加した Firebase 同期基盤の開発・公開手順です。現在の実装範囲は Firebase client、Google provider の認証 session owner、Auth / Firestore Emulator、App Check、保存スロット単位の local / Firestore repository、outbox、同期 coordinator、既存 localStorage の one-time migration controller、Firestore Security Rules までです。

これらは後続UIから利用するための内部境界であり、通常の既存ボックス操作にはまだ接続していません。`SYNC-M3` の controller は既存データを一度だけ移行するための状態・選択肢・UID境界を扱いますが、常設のログイン・同期状態・アカウント管理 UI は提供しません。通常の実ボックス操作のクラウド保存は `SYNC-M4`、cloud draft は `SYNC-M5`、常設UIは `SYNC-M6` の範囲です。Firebase config がない公開・開発環境でも、既存の guest / local-first 機能はそのまま利用できます。

## 現在の状態

| 項目 | 状態 |
| --- | --- |
| Firebase Web SDK と `src/sync/` の境界 | 実装済み |
| 認証 session の restore / sign-in / sign-out / error 単体テスト | 実装済み |
| Auth / Firestore Emulator 設定 | 実装済み |
| local / Firestore repository、outbox、同期 coordinator | 実装済み（既存ボックスUIへは未接続） |
| Firestore Security Rules と Emulator test | M2 source / test 実装済み |
| Firebase project / Web app の作成 | 2026-08-21 確認済み |
| Google provider / authorized domains の設定 | 2026-08-21 確認済み |
| Cloud Firestore の作成 | 2026-08-21 確認済み |
| M2 Rules / indexes の本番反映 | 2026-08-21 完了 |
| App Check の登録と monitor | 2026-08-21 確認済み（enforcement は未実施） |
| SYNC-M3 one-time migration controller / UID別 marker / 初回統合dialog | 認証済みsessionのruntime gateへ接続済み（通常box操作へは未接続） |
| 実ログイン UI と通常の実ボックス同期 | 後続マイルストーン（M4〜M6） |

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

次の項目は repository から自動実行しません。1〜7は2026-08-21に確認済みです。`SYNC-M3` の one-time migration controller は既存の Web config、Rules、indexes、`target-box` / `enemy-box` の保存契約を再利用するため、新しい Firebase Console 設定は追加しません。Rules / indexes を変更した場合だけ7を改めて実施し、project ID や credential そのものではなく、完了した項目と検証結果だけを `PROGRESS.md` に残します。

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

## Firestore repository / Rules の M2 契約

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

この controller は後続のアカウント導線から利用する内部境界であり、`SYNC-M4` の通常box UI同期、`SYNC-M5` のcloud draft、`SYNC-M6` の常設ログイン・同期状態・アカウント管理 UIを先取りしません。M3のproduction確認では実Google popupと移行のread / writeを検証しますが、Firebase Consoleで新しいprovider、scope、collection、indexを追加する作業はありません。
