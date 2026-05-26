# ChampionCreator

ChampionCreator は、Pokemon Champions / Pokemon Showdown 系のダメージ計算に準拠する自動耐久調整ツールです。複数の仮想敵シナリオを同時に満たす `H / B / D` 配分を探し、候補の理由を説明できる静的 Web アプリとして育てます。

M0 では React + Vite + TypeScript の土台と、既存の軽量 UI プロトタイプを移植した作業画面だけを用意しています。`@smogon/calc` は依存に追加済みですが、ダメージ計算 adapter、resolver、探索ロジックは M1 以降で実装します。

## 開発コマンド

```powershell
npm install
npm run dev
npm test
npm run build
```

- `npm run dev`: ローカル開発サーバーを起動する
- `npm test`: M0 の React 表示スモークテストを実行する
- `npm run build`: TypeScript の型チェック後に Vite の production build を作る

## 方針

- ダメージ計算エンジンは独自実装しない
- 最終的な計算の正は `@smogon/calc` に置く
- 日本語入力や表示は、M1 以降の localization / resolver layer で扱う
- `others/` は参考資料置き場であり、runtime import しない
- 静的 Web アプリとして動く構成を維持する
