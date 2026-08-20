# Firebase 同期基盤セットアップ

この文書は `SYNC-M1` で追加した Firebase 基盤の開発・公開手順です。現在の実装範囲は Firebase client、Google provider の認証 session owner、Auth / Firestore Emulator、Firestore Security Rules、App Check の初期化までです。

ログイン操作、ボックスや下書きのクラウド保存、既存 localStorage の移行、競合解決、同期状態 UI は後続マイルストーンの範囲です。Firebase config がない公開・開発環境でも、既存の guest / local-first 機能はそのまま利用できます。

## 現在の状態

| 項目 | 状態 |
| --- | --- |
| Firebase Web SDK と `src/sync/` の境界 | 実装済み |
| 認証 session の restore / sign-in / sign-out / error 単体テスト | 実装済み |
| Auth / Firestore Emulator 設定 | 実装済み |
| Firestore Security Rules と Emulator test | 実装済み |
| Firebase project / Web app の作成 | Firebase Console で未実施 |
| Google provider / authorized domains の設定 | Firebase Console で未実施 |
| Cloud Firestore の作成と Rules の本番反映 | Firebase Console / CLI で未実施 |
| App Check の登録と monitor 確認 | Firebase Console で未実施 |
| 実ログイン UI とクラウド read / write | 後続マイルストーン |

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

## Firebase Console の手作業

次の項目は repository から自動実行しません。作業後は project ID や credential そのものではなく、完了した項目と検証結果だけを `PROGRESS.md` に残します。

1. Firebase project と Web app を作成し、Web config を取得する。
2. Authentication で Google provider を有効にする。追加 scope は要求しない。
3. Authentication の authorized domains に `championcreator.suisui-swimmy.com`、`localhost`、`127.0.0.1` を用途別に登録する。
4. Cloud Firestore を production mode で作成し、利用地域を確定する。
5. Web app を App Check の reCAPTCHA Enterprise provider に登録し、site key を設定する。最初は enforcement を有効にせず、verified / outdated / unknown / invalid request の metrics を monitor する。
6. GitHub repository variables を登録し、Pages build が Firebase Web config と App Check site key を受け取れるようにする。
7. Emulator test が pass した同じ Rules を、明示した production project へ deploy する。

```powershell
npx firebase-tools login
npx firebase-tools deploy --only firestore:rules,firestore:indexes --project <firebase-project-id>
```

`.firebaserc` の `demo-championcreator` alias を production project ID へ書き換えません。production deploy では常に `--project` を明示します。

## 認証方式

GitHub Pages / custom domain では `GoogleAuthProvider` と `signInWithPopup` を使用します。`signInWithRedirect` は採用せず、popup failure から redirect へ自動 fallback もしません。これは Firebase Hosting 以外で redirect helper の third-party storage 対策が別途必要になるためです。

session restore は `onAuthStateChanged`、logout は Firebase Auth の `signOut` を owner 経由で扱います。Firebase の `User`、credential、access token は `App` の state や保存 payload に渡しません。

## Firestore Rules の M1 契約

許可する path は `/users/{uid}/syncRecords/{documentId}` だけです。

- 未認証と別 UID の read / write を拒否し、write では path と `ownerUid` の一致を必須にする
- field は `ownerUid` / `kind` / `schemaVersion` / `payload` だけを許可する
- `kind` は `target-box` / `enemy-box` だけを許可する
- sync envelope の `schemaVersion` は整数 `1` だけを許可する
- `payload` は最大 200,000 bytes の JSON string とし、意味的な validation は後続 repository で既存 parser を通す
- M1 では物理 delete を拒否する

revision、baseRevision、mutationId、tombstone、outbox、実 payload の read / write は `SYNC-M2` の repository / coordinator と同時に追加します。`SYNC-M1` の Rules を使って既存 box や下書きを先行同期しません。
