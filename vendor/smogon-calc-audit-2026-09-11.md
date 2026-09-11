# Smogon Calc upstream audit — 2026-09-11

## 採用結果

旧pinから固定した最新headへ更新し、Aura Guardのcatalog・Mega特性・接触半減をupstream nativeへ移す。旧`cc-aura-guard-v1`をactive patch queueから撤去し、第9世代の特性無視判定だけを`cc-aura-suppression-v1`で補う。通常タイプ上書きはnative未対応のため`cc-type-overrides-v2`として再基底する。

- 旧base: `49d4d8696bf138b101cc47be8432489c3ac192aa`
- 旧build: `cc-aura-guard-v1-type-overrides-v1`
- 固定head: `e7fd7e59f3eef7ea42fba3c8b83261cb4a14109d`
- headのcommit日時: 2026-09-11 01:13:15 UTC。監査のcutoffはこのSHA。
- [全比較](https://github.com/smogon/damage-calc/compare/49d4d8696bf138b101cc47be8432489c3ac192aa...e7fd7e59f3eef7ea42fba3c8b83261cb4a14109d): 40 commits ahead / 0 behind。前回監査head `e087a5e0da71459047dc2da7cd3ebc676925215d`からは4 commits。
- `calc/package.json`は旧base・headとも`0.11.0`。root / calc lockfileも同一。
- 実行経路: `src/calc/smogonAdapter.ts`の`Generations.get(9)`。Champions専用`gen.num === 0`の計算へは切り替えない。
- active provenance: `vendor/smogon-calc-compat.json`。旧manifest・patch・tarballは履歴として保持し、現行依存から参照しない。

## Aura Guardと通常タイプのlifecycle

| 対象 | nativeの状態 | CCの採用経路・残す範囲 |
| --- | --- | --- |
| Aura Guardのcatalogと接触半減 | [PR #855](https://github.com/smogon/damage-calc/commit/111407c919c2c886688db704ae97376e768b72e4)で対応。2026-09-08 20:01 UTCにmerge | metadata-supported / engine-supported。旧patchの該当変更は撤去。最終modifier 2048、接触判定、Long Reach、Punching Glove、炎技・急所・連続技の丸めは同一 |
| Absol-Mega-Z / Garchomp-Mega-Z / Lucario-Mega-Zの特性 | 同PRでSharpness / Levitate / Aura Guardへ変更 | native採用。日本語表示・保存canonical・確認済みMega manifestの対応は維持 |
| Aura GuardのGen9特性無視判定 | [固定headのgen789.ts](https://github.com/smogon/damage-calc/blob/e7fd7e59f3eef7ea42fba3c8b83261cb4a14109d/calc/src/mechanics/gen789.ts)の`defenderAbilityIgnored`には未登録 | このリストへの1語追加だけを残す。native半減と補完によりcalculation-supported。Mold Breaker / Teravolt / Turboblazeと特性無視技、Ability Shieldの優先を既存回帰で保護 |
| Aura GuardのChampions特性無視判定 | [Regulation M-C更新](https://github.com/smogon/damage-calc/commit/06cc6116714a2dd92cc2fdcee3052bcecf8eb714)で対応 | CCの実行世代外。Championsでの対応をGen9対応とみなさない |
| 通常タイプ1〜2個・追加くさ／ゴースト | headのPokemon / Stateに`typeOverrides` / `addedType`なし | CC patchを再基底。STAB・相性・無効・clone・Tera／Stellar・HP helper・Forecast優先を維持 |

Aura Guardの半減をアプリ側で後補正しない。Gen9の無効化補完は従来の[Pokemon Showdown参照](https://github.com/smogon/pokemon-showdown/commit/7340ea497118a6752336d735e193cdf89a1adb5f)に基づく暫定対応で、実機仕様の確定を主張しない。

sunsetは独立に判定する。Gen9のnativeリストにAura Guardが追加されたら補完patchを外し、特性無視技・Ability Shieldまで再確認する。通常タイプのnative対応が現れたらtype patchを外し、clone・Tera・HPの全契約を再評価する。build scriptは、撤去対象がnative化済みなら重複適用前に停止する。

## 他の機能差分と実行境界

| upstream変更 | CCへの影響と処置 |
| --- | --- |
| [Intrepid Sword / Dauntless Shieldのtoggle](https://github.com/smogon/damage-calc/commit/2810dbf5edbcf3147e0266f66802a42dba86604b) | Gen9が`abilityOn`を要求する。tarballだけの更新では旧保存条件の自動上昇が消えるため、adapter既定でこの2特性だけtrueを渡す。ランクをアプリ側で加算せず、上限6を含めCalcに委譲。新しい保存fieldは不要 |
| [Dragonizeの修正](https://github.com/smogon/damage-calc/commit/e7e74f3036c9793813e197e28d54cc857ae7e8dd) | ノーマル以外にも強化が掛かる不具合をnative修正。ノーマル変換を保持し、ゴースト・ドラゴン技が強化されないことを回帰で確認 |
| [Analytic toggle](https://github.com/smogon/damage-calc/commit/7818567c7f784911945cf982f4efde900f8b1b2b)、[後続修正](https://github.com/smogon/damage-calc/commit/13ab43c19b39c8faf70afdbba75c890010975e48) | 既存の行動順判定を維持。CCは汎用toggleを追加せず、Analyticを無条件trueにしない |
| [Charge](https://github.com/smogon/damage-calc/commit/07b944631469eb76c8ec8482923eabadf3c8cd8a)、[Nightmare](https://github.com/smogon/damage-calc/commit/83807801012f0af3e2dbb543d6fd40b483b3ebab) | 新しいSide flagはCCから渡さずfalse。Electromorphosisも従来どおり非発動。これらの入力UI・保存条件は今回追加しない |
| [Gigantamax API](https://github.com/smogon/damage-calc/commit/6287bda767daeee7eec3ad10f70a0f94fbd4e803)、[Max技の急所](https://github.com/smogon/damage-calc/commit/9f672786bf4ecf679cc1984663cc96e2ed76b80f) | CCは`Move.species` / `useMax` / `overrideMove`を使わない。既存Gen9にGmax speciesはなく、今回も追加・削除0。通常Dynamaxのboolean・HP倍化・体重技無効を維持。新しい`canGigantamax` metadataはUIに公開しない |
| [ステルスロック最低1HP](https://github.com/smogon/damage-calc/commit/0d27d281e506997b7994edbd8a2abe58a344e5c2) | upstream `desc.ts`の最低1を保持してtype patchのhazard contextを再基底。CCの選択式HPイベントと合否計算は既存の別layerで処理 |
| [M-C catalog / mechanics](https://github.com/smogon/damage-calc/commit/06cc6116714a2dd92cc2fdcee3052bcecf8eb714) | Champions専用データ・ability・item処理はGen9では実行しない。共有ZA metadataのGolisopod-Mega=Tough ClawsはCCの確認済みoverrideと一致 |
| Championsの[能力上昇](https://github.com/smogon/damage-calc/commit/2681f3624c43324d6b22e56c68d294632178304f)、[Battle Armor](https://github.com/smogon/damage-calc/commit/ee9e25dc798602be853502b6841b34cd90123aef)、[特性](https://github.com/smogon/damage-calc/commit/d952bbe79ba8022dc3bc94ca28a601332536dc2c)、[Cloud Nine / Barb Barrage](https://github.com/smogon/damage-calc/commit/636e5b9bb42aa374e99323cdeec0317f7f8a16e0) | `gen.num === 0`または`champions.ts`内の変更。CCのGen9経路への影響なし |
| RBY/GSCのEV/DV、Gen2〜4のStruggle、Gen4のMetronome | CCは実行しない世代。新しいstats APIも利用しない |
| `calc/src/index.ts`のファイル名コメント、upstream web UI、set data、import tooling、CI | CCはupstreamサイト・setをimportしない。内部`dist/mechanics/util`の利用APIは保持されている |

Gen9 catalogは旧CC buildとnative headでspecies / moves / items / abilitiesの追加・削除0。種族値・タイプも同じ。意味のあるspecies差分は`canGigantamax`追加34件とGolisopod-Megaの特性1件で、日本語候補と既存のMega特性台帳の値は変わらない。

特性を省略した低水準のGolisopod-Mega入力では、Calcの既定特性もEmergency ExitからTough Clawsへ変わる。CCの確認済み自動入力はすでにTough Clawsを明示している。特性の効果を比較する既存テストは、省略を「効果なし」とみなさず無補正の特性を明示する。Zacian / Zacian-Crowned / Zamazenta / Zamazenta-Crownedの古い特性省略入力は、Calcが選んだ既定特性を確認して発動を維持する。

## 比較fixture

両者Mew、Lv50、個体値31、無補正・努力値0、場の補正なし。nativeは一時checkoutで固定SHAからbuildし、旧CC buildと全乱数を比較した。

| 攻撃条件 / 受け側 | 旧CC | native headのみ | 採用後の実測 |
| --- | --- | --- | --- |
| Tackle / Aura Guard | 8–9 | 8–9 | 8–9（重複半減なし） |
| Mold Breaker + Tackle / Aura Guard | 16–19 | 8–9 | 16–19（無効化補完） |
| Sunsteel Strike / Aura Guard | 39–46 | 19–23 | 39–46（無効化補完） |
| Mold Breaker + Tackle / Aura Guard + Ability Shield | 8–9 | 8–9 | 8–9 |
| Dragonize + Shadow Ball | 74–88 | 62–74 | 62–74（native修正） |
| Intrepid Sword + Tackle、発動指定省略 | 23–28 | 16–19 | 23–28（adapterでtrue指定） |
| Tackle / Dauntless Shield、発動指定省略 | 11–13 | 16–19 | 11–13（adapterでtrue指定） |

非接触、炎接触、Long Reach、Punching Glove、Neutralizing Gas、急所、5連続、通常攻撃・Dynamax体重技も比較。保存schema / Worker message / HPイベントの形式は変更しない。新しいUI操作はなく、guide改訂は不要。

## 検証

- `npm run rebuild:smogon-calc-vendor` / `npm run verify:smogon-calc-vendor`: pass。別の一時cloneでupstream 379 tests（2 skipped）・lintを通し、artifact SHA256 `601665fca7888109557814b6a3c273cb27f5399c3b0a147eab0024171f0b694c`とintegrityが完全一致。
- `generate:battle-options` / `generate:pokemon-abilities` / `generate:move-hit-counts`: pass。全7生成JSONのentries・summaryは旧版と構造比較で同一。変更はupstream / patch / sourceのprovenance。
- `npm run check`の4 validators: pass。アプリ全74 files / 1120 testsのうち、同時実行時にAppの4件で5000msの時間切れが発生したため、`npm test -- src/App.test.tsx --maxWorkers=1`でApp 173 testsを再確認してpass。他の73 filesと新規10回帰は全件pass。
- `npm run test:rules`: 79 tests pass。sandboxのFirebase CLI設定読取権限で止まった段階のみ通常環境で再実行。`npm run build`（型確認・prerender含む）も最終コードでpass。既存build warningsのみ。
- in-app Browser: 独立したローカルoriginでメガルカリオZの`はどうのぼうご`・対応stone自動入力、1089候補、通常5–6 / かたやぶり10–12の詳細を実確認。下書き復元後も同じ条件で再計算・Enterによる候補詳細展開が成功。
- Browserの1280x900、1186x698、1180 / 1181、484x698、393x852、320x700でdocument / body / main横overflow 0。実表示とconsole error / warning 0、`app v0.27.15`・Calc revisionを確認。変更したfooter版表示は専用一時fixtureで11→22px（200%）にし、320pxでも折返し・横overflow 0を確認。
- `git diff --check`: pass。既存保存schema・Worker契約・ユーザーの作業用originは変更なし。commit / push / deployはこの作業に含めていない。
