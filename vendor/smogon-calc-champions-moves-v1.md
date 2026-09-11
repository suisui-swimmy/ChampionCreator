# Champions move metadata patch v1

2026-09-11のユーザー指定4件を、CCが実行するGen9の技データへ反映する。固定upstreamのChampionsデータにはすでに同じ値があるため、未確認の新しいダメージ式や効果は追加しない。

## Provenance / scope

- Base: `e7fd7e59f3eef7ea42fba3c8b83261cb4a14109d`、`@smogon/calc@0.11.0`。今回もupstream HEADが同じSHAであることを確認。
- Reference: [固定SHAのCHAMPIONS_PATCH](https://github.com/smogon/damage-calc/blob/e7fd7e59f3eef7ea42fba3c8b83261cb4a14109d/calc/src/data/moves.ts#L5456-L5491)。明示された仕様はPokemon Championsの4技。
- Runtime: `Generations.get(9)`。この依頼では計算世代、他のChampions技、Side条件、保存schemaを変更しない。
- Patch: `vendor/patches/smogon-calc-champions-moves-v1.patch`。base / ordered patch queue / SHA256 / artifact integrityは`vendor/smogon-calc-compat.json`を正とする。
- Support: metadata-supported / engine-supported / calculation-supported。catalogをCalc内部で変更し、既存の威力・パンチ・接触・丸め処理へ渡す。

| canonical | 日本語 | Gen9変更前 | CC patch後 |
| --- | --- | --- | --- |
| Snipe Shot | ねらいうち | 威力80 | 威力85 |
| Meteor Assault | スターアサルト | 威力150 | 威力170 |
| Slash | きりさく | 威力70 | 威力80、接触・切断flagは保持 |
| Double Shock | でんこうそうげき | 威力120、接触 | 威力120・接触を保持し、パンチflagを追加 |

変更箇所は`calc/src/data/moves.ts`の`SV_PATCH`。過去世代の威力を変更せず、Gen0のChampionsデータも従来と同じ値を維持する。upstreamのDex比較テストでは、Gen9の指定3技の威力だけを明示した期待値へ変更し、他の技・field・世代の検査は残す。Double Shockのパンチflagも明示assertする。

`src/calc/smogonAdapter.ts`、Worker、耐久・火力探索、`getMoveHpMechanicsProfile`は同じCalc catalogを消費する。パンチグローブでの非接触化はAura Guardの半減と、選択式のゴツゴツメット／さめはだ反動に反映する。任意威力を指定できる技の既存allow-listは変更しない。

## Lifecycle

他のAura Guard suppression / type override patchesとは独立に管理する。CCの実行経路が4件と同等のnative metadataを消費できるようになった時点で、該当entryを個別に撤去する。Gen0だけに対応がある状態は、Gen9用patchの撤去条件にしない。計算世代そのものを切り替える場合は別途全runtime contractを監査する。

build scriptは、Championsリストより前のnativeデータに指定値・flagが現れたら、適用前に再監査を要求する。native化後に古い値へ戻すことや、アプリ側で返却済みdamage配列へ倍率を掛けることはしない。

## Verification

- `rebuild:smogon-calc-vendor` / `verify:smogon-calc-vendor`: pass。upstream 379 tests（2 skipped）・lint、別cloneでのartifact SHA256 `af777f34bee437d2c0328bce507f1ea0e432af8b34864d6d556bd8a4ab351ad5` / integrity一致を確認。
- 4 validators、アプリ全76 files / 1164 tests、Security Rules 79 tests、型確認込みbuild / prerender: pass。全アプリテストは`npm test -- --maxWorkers=2`で実施。Rulesは使用中の8080を変更せず、一時設定の8087で同じtest suiteを実行した。
- 新規15回帰では、3技の威力・日本語ラベル・急所・Gen8維持、でんこうそうげきの120維持・パンチflag、てつのこぶし／パンチグローブ／かたいツメ／えんかく、Aura Guard、接触HPイベント、任意威力の既存対応範囲、Worker候補の最終再評価を確認。
- 生成された7 catalogsを既存版と構造比較し、entriesの変更は3技のbasePowerだけ。件数とポケモン・特性・持ち物・性格・タイプのentriesを維持。
- in-app Browserで85 / 170 / 80 / 120の威力表示、1089候補、ねらいうち33–39、てつのこぶし＋パンチグローブのでんこうそうげき60–71を確認。両者みがわり、Lv50、H300・A/B/C/D/S100、SP0、ランク・場の補正なし（でんこうそうげきのみ上記の特性・持ち物）の比較用条件。
- 同じ作業のヘッダー変更は、版表示のDOMと専用CSSだけを撤去し、フッターの`app v0.28.2`・calc revision・data 3206を維持。1245x827、1280x900、1186x698、1180 / 1181、484x698、393x852、320x700でdocument / body / main横overflow 0、console error / warning 0。ヘッダー・フッターの文字200%専用fixtureも1280 / 393 / 320pxで折り返し・横overflow 0を確認。
- `git diff --check`: pass。保存schema・既存の任意威力allow-list・通常操作の寸法は変更なし。commit / push / deployは未実施。
