import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { CandidateResult } from "./domain/model";
import type { EntityKind } from "./data/localizationTypes";
import {
  App,
  CandidateStatPointBars,
  CandidateStatPointSpread,
  createAccountBoundaryForms,
  doesItemMatchMegaStone,
  DraftRecoveryDialog,
  ResultsPanel,
  StatPointCellBar,
  SuggestionFormatToggle,
  applyUsageDefaultInputValue,
  applyUsageDefaultsForAttackPokemonSelection,
  applyUsageDefaultsForTargetPokemonSelection,
  applyScenarioAdjustmentTypeDefaults,
  applySpeedOrderModeDefaults,
  clampTargetStatPointChange,
  compareResultCandidates,
  createScenario,
  attemptCloudDraftQueue,
  getAttackSuggestionRankingOwners,
  getDraftSaveStatusLabel,
  getDraftAutosaveDecision,
  getAccountSyncStatusIconPath,
  isCurrentAccountOperation,
  shouldInvalidateAccountOperationOnUidChange,
  shouldAutoFillUsageMoveForAttack,
  getOffenseDefenderStatKeys,
  getPokemonUsageDefaultInputValues,
  getPokemonSuggestionKeyAction,
  resolveUsageSuggestionOwner,
  resolveDraftStorageScope,
  formatLocalizedDamageDescription,
  formatNatureModifierLabel,
  formatNatureUsageAriaLabel,
  formatScenarioResultStatusLabel,
  getDropdownEntityOptions,
  getMobileAttackNavigationTargets,
  getMobileScenarioDirectionIconPath,
  getNatureModifierDirection,
  getNatureUsageOverlayOpacity,
  HpStatMarkerControl,
  getScenarioPanelVisibleScenarios,
  isAbilitySupportCard,
  isBoxStorageSourceReady,
  isUnresolvedEntityInput,
  formatMovePowerEvaluation,
  normalizeNumericInputText,
  syncScenarioGameTypesToSuggestionFormat,
} from "./App";
import type { StatPointMarker, StatPointMarkerRow } from "./calc/statPointMarkers";
import type { HpStatMarkerDisplayRow } from "./calc/hpStatMarkers";
import {
  formatUsageDataDateJst,
  getNatureUsageState,
  getUsageMatchingEntityInputOptions,
  type ChampionsUsageData,
} from "./usage";
import {
  applyMoveInputDefaults,
  createDefaultScenarioForms,
  createDefaultTargetForm,
} from "./ui/defenceSearchUi";
import { appVersionInfo } from "./appVersion";
import {
  DRAFT_STORAGE_KEY,
  createDraftStorageDocument,
} from "./ui/draftStorage";
import { GuideAllyAbilityTip, allyAbilityLabels } from "./guide/GuideAllyAbilityTip";
import {
  GuideTutorial,
  getTutorialMessage,
  guideTutorialSuggestionFormat,
  guideTutorialUsagePokemonAliases,
} from "./guide/GuideTutorial";

const renderExampleApp = (): string => renderToStaticMarkup(
  <App
    initialTargetForm={createDefaultTargetForm()}
    initialScenarioForms={createDefaultScenarioForms()}
  />,
);

const countClassToken = (html: string, token: string): number => (
  Array.from(html.matchAll(/class="([^"]*)"/g)).filter((match) => (
    (match[1] ?? "").split(/\s+/).includes(token)
  )).length
);

const findElementWithClasses = (
  source: string,
  requiredClasses: string[],
  fromIndex = 0,
): number => {
  const pattern = /<([a-z][\w-]*)\b[^>]*\bclass="([^"]*)"[^>]*>/g;
  pattern.lastIndex = fromIndex;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const classes = (match[2] ?? "").split(/\s+/).filter(Boolean);
    if (requiredClasses.every((requiredClass) => classes.includes(requiredClass))) {
      return match.index;
    }
  }
  return -1;
};

type UiStepperShape = {
  start: number;
  end: number;
  block: string;
};

const assertUiStepperShape = (
  source: string,
  modifier: string,
  centerMarker: string,
  fromIndex = 0,
): UiStepperShape => {
  const start = findElementWithClasses(source, ["ui-stepper", modifier], fromIndex);
  expect(start).toBeGreaterThanOrEqual(0);
  if (start < 0) {
    return { start, end: start, block: "" };
  }

  const lowerStart = findElementWithClasses(
    source,
    ["ui-stepper-button", "ui-stepper-button--lower"],
    start,
  );
  const valueStart = findElementWithClasses(source, ["ui-stepper-value"], lowerStart);
  const upperStart = findElementWithClasses(
    source,
    ["ui-stepper-button", "ui-stepper-button--upper"],
    valueStart,
  );
  expect(lowerStart).toBeGreaterThan(start);
  expect(valueStart).toBeGreaterThan(lowerStart);
  expect(upperStart).toBeGreaterThan(valueStart);

  const upperEnd = source.indexOf("</button>", upperStart);
  const lowerHtml = source.slice(lowerStart, valueStart);
  const valueHtml = source.slice(valueStart, upperStart);
  const upperHtml = source.slice(upperStart, upperEnd + "</button>".length);
  expect(lowerHtml).toContain("▼");
  expect(valueHtml).toContain(centerMarker);
  expect(upperHtml).toContain("▲");

  return {
    start,
    end: upperEnd + "</button>".length,
    block: source.slice(start, upperEnd + "</button>".length),
  };
};

const expectStepperButtonDisabled = (
  source: string,
  ariaLabel: string,
  disabled: boolean,
): void => {
  const ariaIndex = source.indexOf(`aria-label="${ariaLabel}"`);
  expect(ariaIndex).toBeGreaterThanOrEqual(0);
  if (ariaIndex < 0) {
    return;
  }
  const buttonStart = source.lastIndexOf("<button", ariaIndex);
  const buttonEnd = source.indexOf(">", ariaIndex);
  const attributes = source.slice(buttonStart, buttonEnd + 1);
  expect(attributes.includes('disabled=""')).toBe(disabled);
};

const renderMovePowerScenario = (
  moveInput: string,
  movePowerMode: "auto" | "assisted" | "manual",
  movePowerValue: number,
): string => {
  const [scenario] = createDefaultScenarioForms();
  return renderToStaticMarkup(
    <App
      initialTargetForm={createDefaultTargetForm()}
      initialScenarioForms={[{
        ...scenario,
        attacks: [{
          ...scenario.attacks[0],
          moveInput,
          movePowerMode,
          movePowerValue,
        }],
      }]}
    />,
  );
};

const assistedPowerFixtures = [
  {
    moveInput: "ゆきなだれ",
    powers: [60, 120],
    labels: ["通常", "同じターンに相手からダメージを受けた"],
  },
  {
    moveInput: "きまぐレーザー",
    powers: [80, 160],
    labels: ["通常（70%）", "威力が2倍になった（30%）"],
  },
  {
    moveInput: "おはかまいり",
    powers: [50, 100, 150, 200, 250, 300],
    labels: ["ひんしの味方 0体", "ひんしの味方 1体", "ひんしの味方 2体", "ひんしの味方 3体", "ひんしの味方 4体", "ひんしの味方 5体"],
  },
  {
    moveInput: "ふんどのこぶし",
    powers: [50, 100, 150, 200, 250, 300, 350],
    labels: ["攻撃を受けた回数 0回", "攻撃を受けた回数 1回", "攻撃を受けた回数 2回", "攻撃を受けた回数 3回", "攻撃を受けた回数 4回", "攻撃を受けた回数 5回", "攻撃を受けた回数 6回以上（最大）"],
  },
  {
    moveInput: "りんしょう",
    powers: [60, 120],
    labels: ["通常", "味方の「りんしょう」に続けて使用"],
  },
  {
    moveInput: "はきだす",
    powers: [100, 200, 300],
    labels: ["たくわえる 1回", "たくわえる 2回", "たくわえる 3回"],
  },
  {
    moveInput: "じだんだ",
    powers: [75, 150],
    labels: ["通常", "直前に使った技が失敗した"],
  },
  {
    moveInput: "やけっぱち",
    powers: [75, 150],
    labels: ["通常", "直前に使った技が失敗した"],
  },
] as const;

const usageDataFixture = (dataVersion = "test-version"): ChampionsUsageData => ({
  schemaVersion: 1,
  dataVersion,
  sourceGeneratedAt: "2026-08-13T15:30:00Z",
  formats: { Singles: {}, Doubles: {} },
});

const usageAutofillDataFixture = (): ChampionsUsageData => ({
  schemaVersion: 1,
  dataVersion: "autofill-test",
  sourceGeneratedAt: "2026-09-04T00:00:00Z",
  formats: {
    Singles: {
      pikachu: {
        move: ["Thunderbolt", "Fake Out"],
        ability: ["Lightning Rod", "Static"],
        item: ["Light Ball", "Focus Sash"],
        nature: [
          { canonicalName: "Jolly", rank: 2, percentage: 20 },
          { canonicalName: "Timid", rank: 1, percentage: null },
        ],
      },
      garchomp: {
        move: ["Earthquake"],
        ability: ["Rough Skin"],
        item: ["Life Orb"],
        nature: [{ canonicalName: "Jolly", rank: 1, percentage: 80 }],
      },
      xerneas: {
        move: ["Moonblast"],
        ability: ["Fairy Aura"],
        item: ["Power Herb"],
        nature: [{ canonicalName: "Timid", rank: 1, percentage: 75 }],
      },
      charizard: {
        move: ["Solar Beam"],
        ability: ["Blaze"],
        item: ["Charizardite Y", "Charizardite X"],
        nature: [{ canonicalName: "Modest", rank: 1, percentage: 60 }],
      },
      tatsugiri: {
        move: [],
        ability: ["Commander", "Storm Drain"],
        item: [],
        nature: [],
      },
      whimsicott: {
        move: ["Protect", "Moonblast", "Encore"],
        ability: [],
        item: [],
        nature: [],
      },
    },
    Doubles: {
      pikachu: {
        move: ["Fake Out", "Thunderbolt"],
        ability: ["Static", "Lightning Rod"],
        item: ["Focus Sash", "Light Ball"],
        nature: [{ canonicalName: "Jolly", rank: 1, percentage: 55 }],
      },
    },
  },
});

describe("App", () => {
  it("matches a selected mega stone by Japanese label, canonical name, or item id", () => {
    const garchompiteZ = {
      id: "garchompitez",
      value: "ガブリアスナイトZ",
      showdownName: "Garchompite Z",
    };

    expect(doesItemMatchMegaStone("ガブリアスナイトＺ", garchompiteZ)).toBe(true);
    expect(doesItemMatchMegaStone("Garchompite Z", garchompiteZ)).toBe(true);
    expect(doesItemMatchMegaStone("garchompitez", garchompiteZ)).toBe(true);
    expect(doesItemMatchMegaStone("こだわりスカーフ", garchompiteZ)).toBe(false);
  });

  it("accepts a duplicate Pokemon display label when its canonical hint identifies the branch", () => {
    expect(isUnresolvedEntityInput("pokemon", "メガマギアナ", "Magearna-Original-Mega")).toBe(false);
    expect(isUnresolvedEntityInput("pokemon", "メガマギアナ")).toBe(true);
  });

  it("rejects stale account operation results after a newer operation or UID switch", () => {
    expect(isCurrentAccountOperation(4, 4, "alice", "alice")).toBe(true);
    expect(isCurrentAccountOperation(4, 5, "alice", "alice")).toBe(false);
    expect(isCurrentAccountOperation(4, 4, "alice", "bob")).toBe(false);
    expect(isCurrentAccountOperation(4, 4, null, null)).toBe(true);
  });

  it("allows only an explicitly expected Auth UID transition to keep an operation current", () => {
    expect(shouldInvalidateAccountOperationOnUidChange(null, null)).toBe(false);
    expect(shouldInvalidateAccountOperationOnUidChange("alice", "alice")).toBe(false);
    expect(shouldInvalidateAccountOperationOnUidChange(undefined, "alice")).toBe(true);
    expect(shouldInvalidateAccountOperationOnUidChange(null, "bob")).toBe(true);
  });

  it("creates a blank workspace when the account namespace changes", () => {
    const reset = createAccountBoundaryForms("Doubles");

    expect(reset.target.pokemonInput).toBe("");
    expect(reset.target.statPoints).toEqual({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
    expect(reset.scenarios).toHaveLength(1);
    expect(reset.scenarios[0].attacks[0].gameType).toBe("doubles");
  });

  it("never falls an unavailable account draft namespace back to the guest key", () => {
    expect(resolveDraftStorageScope(null)).toEqual({
      sourceKey: "device",
      storageKey: "championcreator.draft.v1",
    });
    expect(resolveDraftStorageScope({
      sourceKey: "account:alice:draft:unavailable",
      localDraftStorageKey: null,
    })).toEqual({
      sourceKey: "account:alice:draft:unavailable",
      storageKey: null,
    });
  });

  it("does not autosave the previous namespace during an account or guest source transition", () => {
    const fingerprint = "current-visible-work";
    expect(getDraftAutosaveDecision({
      variant: "default",
      hasRecovery: false,
      sourceMatches: false,
      fingerprint,
      boxBaselineFingerprint: null,
      lastDraftFingerprint: "previous-source",
    })).toBe("skip");
    expect(getDraftAutosaveDecision({
      variant: "default",
      hasRecovery: false,
      sourceMatches: true,
      fingerprint,
      boxBaselineFingerprint: null,
      lastDraftFingerprint: fingerprint,
    })).toBe("unchanged");
  });

  it("keeps a failed cloud queue retryable after the device draft succeeds", () => {
    const draft = createDraftStorageDocument(
      createDefaultTargetForm(),
      createDefaultScenarioForms(),
    );
    const queueCurrentDraft = vi.fn()
      .mockReturnValueOnce("同期用ローカル保存の容量がありません")
      .mockReturnValueOnce(null);
    expect(attemptCloudDraftQueue(draft, { queueCurrentDraft })).toEqual({
      status: "error",
      message: "同期用ローカル保存の容量がありません",
    });
    expect(attemptCloudDraftQueue(draft, { queueCurrentDraft })).toEqual({ status: "success" });
    expect(queueCurrentDraft).toHaveBeenCalledTimes(2);
  });

  it("distinguishes draft saves from committed target-box saves", () => {
    expect(getDraftSaveStatusLabel({ status: "saving" })).toBe("下書きを保存中…");
    expect(getDraftSaveStatusLabel({ status: "saved" })).toBe("このブラウザに下書き保存済み");
    expect(getDraftSaveStatusLabel({ status: "saved" }, "queued")).toBe("ブラウザ保存済み");
    expect(getDraftSaveStatusLabel({ status: "saved" }, "syncing")).toBe("クラウドへ保存中…");
    expect(getDraftSaveStatusLabel({ status: "saved" }, "synced")).toBe("クラウド保存済み");
    expect(getDraftSaveStatusLabel({ status: "saved" }, "offline")).toBe("オフライン（ブラウザ保存済み）");
    expect(getDraftSaveStatusLabel({ status: "saved" }, "error")).toBe("同期エラー（ブラウザ保存済み）");
    expect(getDraftSaveStatusLabel({
      status: "error",
      operation: "cloud-save",
      message: "failed",
    })).toBe("同期エラー（ブラウザ保存済み）");
    expect(getDraftSaveStatusLabel({ status: "box-saved" })).toBe("ボックスに保存済み");
    expect(getDraftSaveStatusLabel({
      status: "error",
      operation: "commit",
      message: "failed",
    })).toBe("ボックス保存後の下書き削除エラー");
  });

  it("blocks box operations until the rendered list matches the active storage namespace", () => {
    expect(isBoxStorageSourceReady("device", "device", true)).toBe(true);
    expect(isBoxStorageSourceReady("device", "account:a", true)).toBe(false);
    expect(isBoxStorageSourceReady("account:a", "device", true)).toBe(false);
    expect(isBoxStorageSourceReady("account:a", "account:a", false)).toBe(false);
    expect(isBoxStorageSourceReady("account:a", "account:a", true)).toBe(true);
  });

  it("uses the intended Pokemon as each suggestion ranking owner", () => {
    expect(getAttackSuggestionRankingOwners("defence", "Target", "Attacker")).toEqual({
      move: "Attacker",
      ability: "Attacker",
      item: "Attacker",
    });
    expect(getAttackSuggestionRankingOwners("offense", "Target", "Virtual Enemy")).toEqual({
      move: "Target",
      ability: "Virtual Enemy",
      item: "Virtual Enemy",
    });
    expect(getAttackSuggestionRankingOwners("speed", "Target", "Virtual Enemy")).toEqual({
      move: "Virtual Enemy",
      ability: "Virtual Enemy",
      item: "Virtual Enemy",
    });
  });

  it("uses pre-Mega usage data only for deterministic Mega forms", () => {
    expect(resolveUsageSuggestionOwner("Charizard-Mega-X", {})).toBe("Charizard");
    expect(resolveUsageSuggestionOwner("Charizard-Mega-Y", {})).toBe("Charizard");
    expect(resolveUsageSuggestionOwner("Garchomp-Mega-Z", {})).toBe("Garchomp");
    expect(resolveUsageSuggestionOwner("Rayquaza-Mega", {})).toBe("Rayquaza");
    expect(resolveUsageSuggestionOwner("Aegislash-Blade", {})).toBe("Aegislash-Blade");
    expect(resolveUsageSuggestionOwner("Unknown-Mega", {})).toBe("Unknown-Mega");
    expect(resolveUsageSuggestionOwner("Charizard-Mega-X", {
      "Charizard-Mega-X": "Explicit-Owner",
    })).toBe("Explicit-Owner");
  });

  it("prefers available Mega, pre-Mega, then aggregate owner data", () => {
    const entry = (item: string) => ({ move: [], ability: [], item: [item] });
    const usageData: ChampionsUsageData = {
      ...usageDataFixture("mega-owner-resolution"),
      formats: {
        Singles: {
          Charizard: entry("Charizardite Y"),
          "Charizard-Mega-X": {
            move: ["Flare Blitz"],
            ability: [],
            item: [],
            nature: [{ canonicalName: "Adamant", rank: 1, percentage: 80 }],
          },
          Floette: entry("Floettite"),
          Meowstic: entry("Light Clay"),
          "Meowstic-F": entry("Mental Herb"),
        },
        Doubles: {},
      },
    };

    expect(resolveUsageSuggestionOwner(
      "Charizard-Mega-X",
      {},
      usageData,
      "Singles",
      "item",
    )).toBe("Charizard");
    expect(resolveUsageSuggestionOwner(
      "Charizard-Mega-X",
      {},
      usageData,
      "Singles",
      "move",
    )).toBe("Charizard-Mega-X");
    expect(resolveUsageSuggestionOwner(
      "Charizard-Mega-X",
      {},
      usageData,
      "Singles",
      "nature",
    )).toBe("Charizard-Mega-X");
    expect(resolveUsageSuggestionOwner(
      "Charizard-Mega-Y",
      {},
      usageData,
      "Singles",
      "item",
    )).toBe("Charizard");
    expect(resolveUsageSuggestionOwner(
      "Floette-Mega",
      {},
      usageData,
      "Singles",
      "item",
    )).toBe("Floette");
    expect(resolveUsageSuggestionOwner(
      "Floette-Eternal",
      {},
      usageData,
      "Singles",
      "item",
    )).toBe("Floette-Eternal");
    expect(resolveUsageSuggestionOwner(
      "Meowstic-F-Mega",
      {},
      usageData,
      "Singles",
      "item",
    )).toBe("Meowstic-F");
    expect(resolveUsageSuggestionOwner(
      "Aegislash-Blade",
      {},
      usageData,
      "Singles",
      "item",
    )).toBe("Aegislash-Blade");
  });

  it("applies aggregated Charizard rankings and nature usage to both Mega branches", () => {
    const charizardUsage: ChampionsUsageData = {
      ...usageDataFixture("mega-owner"),
      formats: {
        Singles: {
          charizard: {
            move: ["Solar Beam"],
            ability: ["Blaze"],
            item: ["Charizardite Y", "Charizardite X"],
            nature: [{ canonicalName: "Timid", rank: 1, percentage: 64.2 }],
          },
        },
        Doubles: {},
      },
    };
    const itemCandidates = [
      { canonicalName: "Charizardite X", value: "リザードナイトＸ" },
      { canonicalName: "Life Orb", value: "いのちのたま" },
      { canonicalName: "Charizardite Y", value: "リザードナイトＹ" },
    ];

    for (const mega of ["Charizard-Mega-X", "Charizard-Mega-Y"]) {
      const owner = resolveUsageSuggestionOwner(mega, {}, charizardUsage, "Singles", "item");
      expect(getUsageMatchingEntityInputOptions(
        itemCandidates,
        "",
        charizardUsage,
        "Singles",
        owner,
        "item",
      ).map((option) => option.canonicalName)).toEqual([
        "Charizardite Y",
        "Charizardite X",
        "Life Orb",
      ]);
      const natureOwner = resolveUsageSuggestionOwner(mega, {}, charizardUsage, "Singles", "nature");
      expect(getNatureUsageState(charizardUsage, "Singles", natureOwner, "Timid")).toEqual({
        kind: "listed",
        rank: 1,
        percentage: 64.2,
      });
    }
  });

  it("builds format-specific top usage defaults without inventing incompatible values", () => {
    const data = usageAutofillDataFixture();
    expect(getPokemonUsageDefaultInputValues("Pikachu", { data, format: "Singles" })).toEqual({
      moveInput: "10まんボルト",
      natureInput: "おくびょう",
      abilityInput: "ひらいしん",
      itemInput: "でんきだま",
    });
    expect(getPokemonUsageDefaultInputValues("Pikachu", { data, format: "Doubles" })).toEqual({
      moveInput: "ねこだまし",
      natureInput: "ようき",
      abilityInput: "せいでんき",
      itemInput: "きあいのタスキ",
    });
    expect(getPokemonUsageDefaultInputValues("Charizard-Mega-X", { data, format: "Singles" })).toEqual({
      moveInput: "ソーラービーム",
      natureInput: "ひかえめ",
      abilityInput: "かたいツメ",
      itemInput: "リザードナイトＸ",
    });
    expect(getPokemonUsageDefaultInputValues("Charizard-Mega-Y", { data, format: "Singles" })).toEqual({
      moveInput: "ソーラービーム",
      natureInput: "ひかえめ",
      abilityInput: "ひでり",
      itemInput: "リザードナイトＹ",
    });
    expect(getPokemonUsageDefaultInputValues("Charizard-Mega-X", {
      data: null,
      format: "Singles",
    }).abilityInput).toBe("かたいツメ");
    expect(getPokemonUsageDefaultInputValues("Meowstic-M-Mega", {
      data: null,
      format: "Singles",
    }).abilityInput).toBe("トレース");
    expect(getPokemonUsageDefaultInputValues("Skarmory-Mega", {
      data: null,
      format: "Singles",
    }).abilityInput).toBe("すじがねいり");
    expect(getPokemonUsageDefaultInputValues("Hawlucha-Mega", {
      data: null,
      format: "Singles",
    }).abilityInput).toBe("ノーガード");
    expect(getPokemonUsageDefaultInputValues("Lucario-Mega-Z", {
      data: null,
      format: "Singles",
    }).abilityInput).toBe("はどうのぼうご");
    expect(getPokemonUsageDefaultInputValues("Tatsugiri-Curly-Mega", {
      data,
      format: "Singles",
    }).abilityInput).toBeUndefined();
    expect(getPokemonUsageDefaultInputValues("Magearna-Mega", {
      data: null,
      format: "Singles",
    }).abilityInput).toBeUndefined();
    expect(getPokemonUsageDefaultInputValues("Heatran-Mega", {
      data: null,
      format: "Singles",
    }).abilityInput).toBeUndefined();
    expect(getPokemonUsageDefaultInputValues("Whimsicott", { data, format: "Singles" })).toEqual({
      moveInput: "ムーンフォース",
      natureInput: undefined,
      abilityInput: undefined,
      itemInput: undefined,
    });
    data.formats.Singles.whimsicott.move = ["Protect", "Encore"];
    expect(getPokemonUsageDefaultInputValues("Whimsicott", { data, format: "Singles" }).moveInput)
      .toBeUndefined();
    expect(getPokemonUsageDefaultInputValues("Pikachu", { data: null, format: "Singles" })).toEqual({
      moveInput: undefined,
      natureInput: undefined,
      abilityInput: undefined,
      itemInput: undefined,
    });
  });

  it("replaces blank or previous defaults while preserving a manually changed value", () => {
    expect(applyUsageDefaultInputValue("", undefined, "new")).toBe("new");
    expect(applyUsageDefaultInputValue("old", "old", "new")).toBe("new");
    expect(applyUsageDefaultInputValue("manual", "old", "new")).toBe("manual");
    expect(applyUsageDefaultInputValue("old", "old", undefined)).toBe("");
  });

  it("fills target fields and target-owned offense moves without replacing manual edits", () => {
    const data = usageAutofillDataFixture();
    const context = { data, format: "Singles" as const };
    const [defenceTemplate, offenseTemplate] = createDefaultScenarioForms();
    const blankAttack = {
      ...defenceTemplate.attacks[0],
      attackerPokemonInput: "",
      attackerPokemonCanonicalName: undefined,
      attackerNatureInput: "",
      attackerAbilityInput: "",
      attackerItemInput: "",
      moveInput: "",
    };
    const target = {
      ...createDefaultTargetForm(),
      pokemonInput: "",
      pokemonCanonicalName: undefined,
      natureInput: "",
      abilityInput: "",
      itemInput: "",
    };
    const scenarios = [
      { ...defenceTemplate, attacks: [{ ...blankAttack }] },
      { ...offenseTemplate, attacks: [{ ...blankAttack, id: "offense-attack" }] },
    ];
    const pikachu = applyUsageDefaultsForTargetPokemonSelection(
      target,
      scenarios,
      "ピカチュウ",
      "Pikachu",
      context,
    );

    expect(pikachu.target).toMatchObject({
      pokemonInput: "ピカチュウ",
      pokemonCanonicalName: "Pikachu",
      natureInput: "おくびょう",
      abilityInput: "ひらいしん",
      itemInput: "でんきだま",
    });
    expect(pikachu.scenarios[0].attacks[0].moveInput).toBe("");
    expect(pikachu.scenarios[1].attacks[0].moveInput).toBe("10まんボルト");

    const doublesReselect = applyUsageDefaultsForTargetPokemonSelection(
      pikachu.target,
      pikachu.scenarios,
      "ピカチュウ",
      "Pikachu",
      { data, format: "Doubles" },
      "Pikachu",
      context,
    );
    expect(doublesReselect.target).toMatchObject({
      natureInput: "ようき",
      abilityInput: "せいでんき",
      itemInput: "きあいのタスキ",
    });
    expect(doublesReselect.scenarios[1].attacks[0].moveInput).toBe("ねこだまし");

    const automaticSwitch = applyUsageDefaultsForTargetPokemonSelection(
      pikachu.target,
      pikachu.scenarios,
      "ガブリアス",
      "Garchomp",
      context,
    );
    expect(automaticSwitch.target).toMatchObject({
      natureInput: "ようき",
      abilityInput: "さめはだ",
      itemInput: "いのちのたま",
    });
    expect(automaticSwitch.scenarios[1].attacks[0].moveInput).toBe("じしん");

    const switchAfterRawTyping = applyUsageDefaultsForTargetPokemonSelection(
      {
        ...pikachu.target,
        pokemonInput: "ガブリアス",
        pokemonCanonicalName: undefined,
      },
      pikachu.scenarios,
      "ガブリアス",
      "Garchomp",
      context,
      "Pikachu",
    );
    expect(switchAfterRawTyping.target).toMatchObject({
      natureInput: "ようき",
      abilityInput: "さめはだ",
      itemInput: "いのちのたま",
    });
    expect(switchAfterRawTyping.scenarios[1].attacks[0].moveInput).toBe("じしん");

    const manualSwitch = applyUsageDefaultsForTargetPokemonSelection(
      { ...pikachu.target, abilityInput: "せいでんき" },
      pikachu.scenarios.map((scenario) => scenario.adjustmentType === "offense"
        ? { ...scenario, attacks: scenario.attacks.map((attack) => ({ ...attack, moveInput: "ねこだまし" })) }
        : scenario),
      "ガブリアス",
      "Garchomp",
      context,
    );
    expect(manualSwitch.target.abilityInput).toBe("せいでんき");
    expect(manualSwitch.scenarios[1].attacks[0].moveInput).toBe("ねこだまし");

    const megaSwitch = applyUsageDefaultsForTargetPokemonSelection(
      { ...pikachu.target, itemInput: "こだわりスカーフ" },
      pikachu.scenarios,
      "メガリザードンX",
      "Charizard-Mega-X",
      context,
    );
    expect(megaSwitch.target.itemInput).toBe("リザードナイトＸ");
    expect(megaSwitch.target.abilityInput).toBe("かたいツメ");
    const megaBranchSwitch = applyUsageDefaultsForTargetPokemonSelection(
      megaSwitch.target,
      megaSwitch.scenarios,
      "メガリザードンY",
      "Charizard-Mega-Y",
      context,
      "Charizard-Mega-X",
    );
    expect(megaBranchSwitch.target.itemInput).toBe("リザードナイトＹ");
    expect(megaBranchSwitch.target.abilityInput).toBe("ひでり");
    const baseSwitch = applyUsageDefaultsForTargetPokemonSelection(
      megaSwitch.target,
      megaSwitch.scenarios,
      "リザードン",
      "Charizard",
      context,
      "Charizard-Mega-X",
    );
    expect(baseSwitch.target.itemInput).toBe("");
    expect(baseSwitch.target.abilityInput).toBe("もうか");
    const manualItemBaseSwitch = applyUsageDefaultsForTargetPokemonSelection(
      { ...megaSwitch.target, itemInput: "こだわりスカーフ" },
      megaSwitch.scenarios,
      "リザードン",
      "Charizard",
      context,
      "Charizard-Mega-X",
    );
    expect(manualItemBaseSwitch.target.itemInput).toBe("こだわりスカーフ");
    const manualAbilityMegaSwitch = applyUsageDefaultsForTargetPokemonSelection(
      { ...pikachu.target, abilityInput: "せいでんき" },
      pikachu.scenarios,
      "メガリザードンX",
      "Charizard-Mega-X",
      context,
    );
    expect(manualAbilityMegaSwitch.target.abilityInput).toBe("せいでんき");
    const differentPokemonSwitch = applyUsageDefaultsForTargetPokemonSelection(
      megaSwitch.target,
      megaSwitch.scenarios,
      "ピカチュウ",
      "Pikachu",
      context,
      "Charizard-Mega-X",
    );
    expect(differentPokemonSwitch.target.itemInput).toBe("でんきだま");
  });

  it("fills all attacker-owned defaults only when the card owns the move", () => {
    const data = usageAutofillDataFixture();
    const context = { data, format: "Singles" as const };
    const blankAttack = {
      ...createDefaultScenarioForms()[0].attacks[0],
      attackerPokemonInput: "",
      attackerPokemonCanonicalName: undefined,
      attackerNatureInput: "",
      attackerAbilityInput: "",
      attackerItemInput: "",
      moveInput: "",
    };
    const defenceAttack = applyUsageDefaultsForAttackPokemonSelection(
      blankAttack,
      "ピカチュウ",
      "Pikachu",
      "defence",
      context,
    );
    expect(defenceAttack).toMatchObject({
      attackerPokemonInput: "ピカチュウ",
      attackerPokemonCanonicalName: "Pikachu",
      attackerNatureInput: "おくびょう",
      attackerAbilityInput: "ひらいしん",
      attackerItemInput: "でんきだま",
      moveInput: "10まんボルト",
    });

    const switchedAttack = applyUsageDefaultsForAttackPokemonSelection(
      defenceAttack,
      "ガブリアス",
      "Garchomp",
      "defence",
      context,
    );
    expect(switchedAttack).toMatchObject({
      attackerNatureInput: "ようき",
      attackerAbilityInput: "さめはだ",
      attackerItemInput: "いのちのたま",
      moveInput: "じしん",
    });

    const offenseDefender = applyUsageDefaultsForAttackPokemonSelection(
      blankAttack,
      "ピカチュウ",
      "Pikachu",
      "offense",
      context,
    );
    expect(offenseDefender.moveInput).toBe("");
    expect(offenseDefender).toMatchObject({
      attackerNatureInput: "おくびょう",
      attackerAbilityInput: "ひらいしん",
      attackerItemInput: "でんきだま",
    });

    const megaAttacker = applyUsageDefaultsForAttackPokemonSelection(
      { ...defenceAttack, attackerItemInput: "こだわりスカーフ" },
      "メガリザードンX",
      "Charizard-Mega-X",
      "defence",
      context,
    );
    expect(megaAttacker.attackerItemInput).toBe("リザードナイトＸ");
    expect(megaAttacker.attackerAbilityInput).toBe("かたいツメ");

    const tatsugiriAttacker = applyUsageDefaultsForAttackPokemonSelection(
      blankAttack,
      "シャリタツ そったすがた",
      "Tatsugiri",
      "defence",
      context,
    );
    expect(tatsugiriAttacker.attackerAbilityInput).toBe("しれいとう");
    const unconfirmedMegaAttacker = applyUsageDefaultsForAttackPokemonSelection(
      tatsugiriAttacker,
      "メガシャリタツ",
      "Tatsugiri-Curly-Mega",
      "defence",
      context,
      "Tatsugiri",
    );
    expect(unconfirmedMegaAttacker.attackerAbilityInput).toBe("");

    const previousAutoSupport = applyUsageDefaultsForAttackPokemonSelection(
      {
        ...blankAttack,
        attackerPokemonInput: "ゼルネアス",
        attackerPokemonCanonicalName: "Xerneas",
        attackerAbilityInput: "フェアリーオーラ",
      },
      "ピカチュウ",
      "Pikachu",
      "defence",
      context,
      "Xerneas",
    );
    expect(previousAutoSupport.attackerAbilityInput).toBe("ひらいしん");
    expect(previousAutoSupport.moveInput).toBe("10まんボルト");

    const manualSupport = applyUsageDefaultsForAttackPokemonSelection(
      {
        ...blankAttack,
        attackerPokemonInput: "ガブリアス",
        attackerPokemonCanonicalName: "Garchomp",
        attackerAbilityInput: "フェアリーオーラ",
      },
      "ピカチュウ",
      "Pikachu",
      "defence",
      context,
      "Garchomp",
    );
    expect(manualSupport.attackerAbilityInput).toBe("フェアリーオーラ");
    expect(manualSupport.moveInput).toBe("");
  });

  it("only treats field-wide or ally-targeting abilities as move-less support cards", () => {
    for (const skinAbility of [
      "フェアリースキン",
      "スカイスキン",
      "フリーズスキン",
      "エレキスキン",
      "ノーマルスキン",
      "ドラゴンスキン",
    ]) {
      expect(isAbilitySupportCard("defence", "", skinAbility)).toBe(false);
    }

    expect(isAbilitySupportCard("defence", "", "フェアリーオーラ")).toBe(true);
    expect(isAbilitySupportCard("defence", "", "ダークオーラ")).toBe(true);
    expect(isAbilitySupportCard("defence", "", "オーラブレイク")).toBe(true);
    expect(isAbilitySupportCard("defence", "", "はどうのぼうご")).toBe(false);
    expect(isAbilitySupportCard("defence", "ムーンフォース", "フェアリーオーラ")).toBe(false);
    expect(isAbilitySupportCard("offense", "", "フェアリーオーラ")).toBe(false);
    expect(shouldAutoFillUsageMoveForAttack("defence", "", "フェアリーオーラ")).toBe(false);
    expect(shouldAutoFillUsageMoveForAttack("defence", "", "はどうのぼうご")).toBe(true);
    expect(shouldAutoFillUsageMoveForAttack("defence", "", "もうか")).toBe(true);
    expect(shouldAutoFillUsageMoveForAttack("offense", "", "もうか")).toBe(false);
    expect(shouldAutoFillUsageMoveForAttack("speed", "", "もうか")).toBe(false);
  });

  it("keeps mobile text controls large enough to avoid iOS focus zoom", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

    expect(css).toContain("iOS zooms focused text controls below 16px");
    expect(css).toContain('.mobile-scenarios-open input:not([type="checkbox"]):not([type="radio"])');
    expect(css).toContain('.box-overlay input:not([type="checkbox"]):not([type="radio"])');
    expect(css).toMatch(/\.mobile-scenarios-open \.scenario-panel:not\(\.mobile-scenario-detail-panel\)\s*\{[^}]*padding-top:\s*0;/s);
    expect(css).toMatch(/\.hp-event-rule-meta span\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
    expect(css).toMatch(/\.hp-event-formula,[\s\S]*?\.hp-events-empty\s*\{[^}]*overflow-wrap:\s*anywhere;/s);
    expect(css).toMatch(/\.hp-event-row\s*\{[^}]*min-width:\s*0;/s);
    expect(css).toMatch(/font-size: 16px;/);
    expect(html).not.toMatch(/maximum-scale|user-scalable\s*=\s*no/);
  });

  it("defines the role-based mobile size tokens used by the workbench", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const expectedTokens = {
      "--mobile-control-compact": "32px",
      "--mobile-control-standard": "36px",
      "--mobile-control-primary": "40px",
      "--mobile-control-comfort": "44px",
      "--mobile-icon-compact": "16px",
      "--mobile-icon-standard": "20px",
      "--mobile-text-heading": "15px",
      "--mobile-text-control": "13px",
      "--mobile-text-interactive-small": "12px",
      "--mobile-text-meta": "11px",
      "--mobile-text-input": "16px",
    } as const;

    for (const [token, value] of Object.entries(expectedTokens)) {
      expect(css).toMatch(new RegExp(`${token}\\s*:\\s*${value};`));
    }
    expect(css).toMatch(/--footer-icon-size:\s*18px;/);
    expect(css).toMatch(/--desktop-page-gutter:\s*16px;/);
    expect(css).toMatch(/--stacked-page-max-width:\s*780px;/);
    expect(css).toMatch(/--mobile-page-gutter:\s*8px;/);
    expect(css).toMatch(/--narrow-page-gutter:\s*6px;/);
    expect(css).toMatch(/--mobile-page-max-width:\s*460px;/);
    expect(css).toMatch(/\.app-footer\s*\{[^}]*font-size:\s*12px;/s);
    expect(css).toMatch(/\.app-footer\s*\{[^}]*gap:\s*2px;[^}]*margin:\s*8px auto 0;[^}]*padding:\s*8px 10px;[^}]*line-height:\s*1\.35;/s);
    expect(css).toMatch(/\.app-footer-copy\s*\{[^}]*display:\s*grid;[^}]*gap:\s*0;/s);
    expect(css).toMatch(/\.app-footer-links\s*\{[^}]*flex-wrap:\s*wrap;[^}]*white-space:\s*normal;/s);
    expect(css).toMatch(/\.app-footer-link-item\s*\{[^}]*display:\s*inline-flex;[^}]*white-space:\s*nowrap;/s);
    expect(css).toMatch(/\.app-footer-source > \.app-footer-link-item:first-child,[\s\S]*?\.app-footer-source-link\s*\{[^}]*max-width:\s*100%;[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;/s);
    expect(css).toMatch(/\.app-footer-contact:focus-visible,[\s\S]*?\.app-footer-source-link:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--gold\);[^}]*outline-offset:\s*2px;/s);
    expect(css).toMatch(/\.app-footer-contact img\s*\{[^}]*width:\s*var\(--footer-icon-size\);[^}]*height:\s*var\(--footer-icon-size\);/s);
    expect(css).toMatch(/\.app-footer-version\s*\{[^}]*display:\s*block;[^}]*font-size:\s*var\(--desktop-text-meta\);[^}]*line-height:\s*1\.2;/s);

    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.search-control-bar #runButton,[\s\S]*?\.mobile-candidate-actions \.ui-button-primary\s*\{[^}]*min-height:\s*var\(--mobile-control-primary\);[^}]*font-size:\s*14px;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.search-control-bar > \.ui-button-ghost,[\s\S]*?\.mobile-candidate-actions \.ui-button-ghost\s*\{[^}]*min-height:\s*var\(--mobile-control-standard\);[^}]*font-size:\s*var\(--mobile-text-control\);/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.mobile-target-open \.target-level-field \.level-inline-control\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--mobile-control-compact\);[^}]*height:\s*var\(--mobile-control-standard\);/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.mobile-target-open \.target-level-field \.move-power-lock-toggle\s*\{[^}]*width:\s*var\(--mobile-control-compact\);[^}]*min-width:\s*var\(--mobile-control-compact\);[^}]*height:\s*var\(--mobile-control-standard\);/s);
  });

  it("defines role-based desktop size tokens and keeps the desktop workbench controls in their tiers", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const nonMobileStart = css.indexOf("@media (min-width: 721px)");
    const nonMobileEnd = css.indexOf("@media (min-width: 1181px)", nonMobileStart);
    const nonMobileCss = css.slice(nonMobileStart, nonMobileEnd);
    const desktopCss = nonMobileCss;
    const expectedTokens = {
      "--desktop-control-compact": "32px",
      "--desktop-control-standard": "36px",
      "--desktop-control-primary": "40px",
      "--desktop-control-comfort": "44px",
      "--desktop-icon-compact": "16px",
      "--desktop-icon-standard": "20px",
      "--desktop-text-heading": "15px",
      "--desktop-text-control": "13px",
      "--desktop-text-interactive-small": "12px",
      "--desktop-text-meta": "11px",
      "--desktop-text-input": "16px",
    } as const;

    expect(nonMobileStart).toBeGreaterThanOrEqual(0);
    expect(nonMobileEnd).toBeGreaterThan(nonMobileStart);
    for (const [token, value] of Object.entries(expectedTokens)) {
      expect(css).toMatch(new RegExp(`${token}\\s*:\\s*${value};`));
    }

    // Header format choices remain compact in width, but become first-class 36px controls.
    expect(nonMobileCss).toMatch(/\.suggestion-format-option\s*\{[^}]*min-width:\s*80px;[^}]*min-height:\s*var\(--desktop-control-standard\);/s);
    expect(nonMobileCss).toMatch(/\.suggestion-format-option-content\s*\{[^}]*min-height:\s*var\(--desktop-control-standard\);[^}]*padding:\s*0 8px;[^}]*font-size:\s*var\(--desktop-text-interactive-small\);/s);
    expect(nonMobileCss).toMatch(/\.suggestion-format-icon\s*\{[^}]*width:\s*var\(--desktop-icon-standard\);[^}]*height:\s*var\(--desktop-icon-standard\);/s);
    expect(nonMobileCss).toMatch(/\.suggestion-format-option-label\s*\{[^}]*font-size:\s*var\(--desktop-text-interactive-small\);/s);
    expect(nonMobileCss).toMatch(/\.cloud-draft-trigger,\s*\.account-sync-trigger\s*\{[^}]*height:\s*var\(--desktop-control-standard\);[^}]*min-height:\s*var\(--desktop-control-standard\);/s);
    expect(nonMobileCss).toMatch(/\.account-sync-trigger-icon\s*\{[^}]*width:\s*var\(--desktop-icon-standard\);[^}]*height:\s*var\(--desktop-icon-standard\);/s);

    // Dense fields use 32px; visible actions use 36px; primary actions get extra emphasis.
    expect(desktopCss).toMatch(/\.target-summary\.compact > \.pokemon-autocomplete-field input,[^{]*\{[^}]*height:\s*var\(--desktop-control-compact\);[^}]*font-size:\s*var\(--desktop-text-control\);/s);
    expect(desktopCss).toMatch(/\.scenario-row-title \.inline-title-input,[\s\S]*?\.attack-card-header \.inline-title-input\s*\{[^}]*height:\s*var\(--desktop-control-standard\);/s);
    expect(desktopCss).toMatch(/\.scenario-row input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\.inline-title-input\),[\s\S]*?\.attack-condition-card input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\.inline-title-input\),[\s\S]*?\.attack-condition-card \.nature-trigger\s*\{[^}]*height:\s*var\(--desktop-control-compact\);[^}]*font-size:\s*var\(--desktop-text-control\);/s);
    expect(desktopCss).toMatch(/\.ui-button,[\s\S]*?\.ui-button-small\s*\{[^}]*min-height:\s*var\(--desktop-control-standard\);/s);
    expect(desktopCss).toMatch(/#runButton,[\s\S]*?\.account-sync-window \.ui-button-primary\s*\{[^}]*min-height:\s*var\(--desktop-control-primary\);[^}]*font-size:\s*14px;/s);

    // Switch hit area grows to 36px while the visual track/knob keeps its established shape.
    expect(desktopCss).toMatch(/\.switch\s*\{[^}]*width:\s*42px;[^}]*height:\s*var\(--desktop-control-standard\);/s);
    expect(desktopCss).toMatch(/\.switch span\s*\{[^}]*width:\s*38px;[^}]*height:\s*22px;/s);
    expect(desktopCss).toMatch(/\.switch span::after\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;/s);
    expect(css).toMatch(/\.switch input:focus-visible \+ span\s*\{[^}]*box-shadow:\s*inset 0 0 0 2px var\(--text\);/s);
    expect(css).not.toMatch(/\.switch:focus-within\s*\{/s);
    expect(css).not.toMatch(/\.mobile-scenarios-open \.switch:focus-within\s*\{/s);

    // Scenario/attack controls share the same standard target and compact steppers remain usable.
    expect(desktopCss).toMatch(/\.scenario-adjustment-card\s*\{[^}]*min-height:\s*var\(--desktop-control-standard\);[^}]*font-size:\s*var\(--desktop-text-interactive-small\);/s);
    expect(desktopCss).toMatch(/\.scenario-remove-button,[\s\S]*?\.attack-remove-button,[\s\S]*?\.hp-event-remove-button\s*\{[^}]*width:\s*var\(--desktop-control-standard\);[^}]*height:\s*var\(--desktop-control-standard\);/s);
    expect(desktopCss).toMatch(/\.scenario-remove-button \.ui-button-icon,[\s\S]*?\.attack-remove-button \.ui-button-icon,[\s\S]*?\.hp-event-remove-button \.ui-button-icon\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s);
    expect(desktopCss).toMatch(/\.attack-direction-button\s*\{[^}]*width:\s*var\(--desktop-control-standard\);/s);
    expect(desktopCss).toMatch(/\.attack-direction-icon\s*\{[^}]*width:\s*var\(--desktop-icon-standard\);[^}]*height:\s*var\(--desktop-icon-standard\);/s);
    expect(desktopCss).toMatch(/\.mechanic-icon-button\s*\{[^}]*width:\s*var\(--desktop-control-standard\);[^}]*height:\s*var\(--desktop-control-standard\);/s);
    expect(desktopCss).toMatch(/\.mechanic-icon-button img\s*\{[^}]*width:\s*var\(--desktop-icon-standard\);[^}]*height:\s*var\(--desktop-icon-standard\);/s);
    expect(desktopCss).toMatch(/\.ui-stepper(?:,[^{}]+)*\s*\{[^}]*grid-template-columns:\s*var\(--desktop-control-compact\)\s+minmax\([^;]+1fr\)\s+var\(--desktop-control-compact\);/s);
    expect(desktopCss).toMatch(/\.ui-stepper(?:,[^{}]+)*\s*\{[^}]*height:\s*var\(--desktop-control-standard\);/s);
    expect(desktopCss).toMatch(/\.speed-offset-input,\s*\.speed-manual-target-input\s*\{[^}]*width:\s*112px;/s);
    expect(desktopCss).toMatch(/\.move-power-inline-control\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--desktop-control-compact\);/s);
    expect(desktopCss).toMatch(/\.move-power-trigger,[\s\S]*?\.move-power-inline-control\s*\{[^}]*height:\s*var\(--desktop-control-standard\);/s);
    expect(desktopCss).toMatch(/\.move-power-lock-toggle\s*\{[^}]*width:\s*var\(--desktop-control-compact\);/s);
    expect(desktopCss).toMatch(/\.beat-up-participant-power\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--desktop-control-compact\);[^}]*height:\s*var\(--desktop-control-standard\);/s);
    expect(desktopCss).toMatch(/\.beat-up-participant-power \.move-power-lock-toggle\s*\{[^}]*width:\s*var\(--desktop-control-compact\);[^}]*height:\s*var\(--desktop-control-standard\);/s);

    // Search, candidate, box, and footer surfaces follow the same standard/primary tiers.
    expect(desktopCss).toMatch(/#runButton,[\s\S]*?min-height:\s*var\(--desktop-control-primary\);/s);
    expect(desktopCss).toMatch(/\.candidate-toolbar\s*\{[^}]*min-height:\s*var\(--desktop-control-standard\);/s);
    expect(desktopCss).toMatch(/\.candidate-apply-button,[\s\S]*?\.candidate-page-actions \.ui-button,[\s\S]*?\.adjustment-apply-button\s*\{[^}]*min-height:\s*var\(--desktop-control-standard\);/s);
    expect(desktopCss).toMatch(/\.box-window-actions \.ui-button-small,[\s\S]*?\.box-close-button\s*\{[^}]*width:\s*var\(--desktop-control-standard\);[^}]*height:\s*var\(--desktop-control-standard\);/s);
    expect(desktopCss).toMatch(/\.box-window-action-icon\s*\{[^}]*width:\s*var\(--desktop-icon-standard\);[^}]*height:\s*var\(--desktop-icon-standard\);/s);
    expect(desktopCss).toMatch(/#runButton,[\s\S]*?\.box-current-row \.ui-button-primary,[\s\S]*?\.box-action-buttons \.ui-button-primary,[\s\S]*?\.account-sync-window \.ui-button-primary\s*\{[^}]*min-height:\s*var\(--desktop-control-primary\);/s);
    expect(desktopCss).toMatch(/\.app-footer-links \.app-footer-contact,[\s\S]*?\.app-footer-source-link\s*\{[^}]*min-height:\s*var\(--desktop-control-standard\);[^}]*font-size:\s*var\(--desktop-text-interactive-small\);/s);
    expect(css).toMatch(/\.app-footer-icon-link\s*\{[^}]*width:\s*var\(--desktop-control-standard\);[^}]*height:\s*var\(--desktop-control-standard\);/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.app-footer-icon-link\s*\{[^}]*width:\s*var\(--mobile-control-standard\);[^}]*height:\s*var\(--mobile-control-standard\);/s);
  });

  it("keeps desktop workbench add actions aligned to the row-and-column grid", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const html = renderExampleApp();
    const rootStart = css.indexOf(":root");
    const rootEnd = css.indexOf("}", rootStart);
    const nonMobileStart = css.indexOf("@media (min-width: 721px)");
    const wideStart = css.indexOf("@media (min-width: 1181px)", nonMobileStart);
    const wideEnd = css.indexOf("@media (max-width: 1180px)", wideStart);
    const stackStart = css.indexOf("@media (min-width: 721px) and (max-width: 1180px)");
    const mobileStart = css.indexOf("@media (max-width: 720px)");
    const rootCss = css.slice(rootStart, rootEnd + 1);
    const nonMobileCss = css.slice(nonMobileStart, mobileStart);
    const stackCss = css.slice(stackStart, mobileStart);
    const desktopAttackAddRules = Array.from(
      nonMobileCss.matchAll(/(?:\.scenario-attack-lane\s*>)?\s*\.attack-add-card\s*\{([^}]*)\}/g),
    ).map((match) => match[1] ?? "").join("\n");

    expect(nonMobileStart).toBeGreaterThanOrEqual(0);
    expect(wideStart).toBeGreaterThan(nonMobileStart);
    expect(wideEnd).toBeGreaterThan(wideStart);
    expect(stackStart).toBeGreaterThan(wideEnd);
    expect(mobileStart).toBeGreaterThan(stackStart);

    expect(rootCss).toContain("--desktop-attack-card-width: 340px;");
    expect(rootCss).toContain("--desktop-grid-add-size: 64px;");
    expect(rootCss).toContain("--desktop-grid-add-color: rgba(245, 197, 66, 0.42);");
    expect(rootCss).toContain("--desktop-attack-lane-gap: 8px;");
    expect(rootCss).not.toContain("--desktop-attack-add-height:");
    expect(rootCss).not.toContain("--desktop-attack-add-min-width:");

    expect(css).toMatch(
      /\.scenario-attack-lane\s*\{[^}]*display:\s*flex;[^}]*gap:\s*var\(--desktop-attack-lane-gap\);[^}]*align-items:\s*stretch;[^}]*overflow-x:\s*auto;/s,
    );
    expect(css).toMatch(
      /\.scenario-attack-lane > \*\s*\{[^}]*flex:\s*0 0 var\(--desktop-attack-card-width\);/s,
    );
    expect(nonMobileCss).toMatch(
      /\.attack-add-card\s*\{[^}]*align-self:\s*stretch;[^}]*flex:\s*0 0 var\(--desktop-grid-add-size\);[^}]*width:\s*var\(--desktop-grid-add-size\);[^}]*min-width:\s*var\(--desktop-grid-add-size\);/s,
    );
    expect(stackCss).toMatch(
      /\.scenario-attack-lane > \.attack-add-card\s*\{[^}]*flex:\s*0 0 var\(--desktop-grid-add-size\);[^}]*width:\s*var\(--desktop-grid-add-size\);[^}]*min-width:\s*var\(--desktop-grid-add-size\);/s,
    );
    expect(desktopAttackAddRules).not.toMatch(/\b(?:min-)?height\s*:\s*(?:\d+px|var\(--desktop-[^)]+\))/);
    expect(nonMobileCss).not.toMatch(/\.scenario-attack-lane > \.attack-add-card\s*\{[^}]*clamp\(/s);
    expect(css).toMatch(/\.attack-add-card\s*\{[^}]*display:\s*grid;[^}]*place-items:\s*center;/s);
    expect(nonMobileCss).toMatch(/\.attack-add-card\s*\{[^}]*border-style:\s*dashed;/s);
    expect(nonMobileCss).toMatch(
      /\.attack-add-card span\s*\{[^}]*font-size:\s*var\(--desktop-attack-add-plus-size\);/s,
    );
    expect(nonMobileCss).toMatch(
      /\.attack-add-card span\s*\{[^}]*color:\s*var\(--desktop-grid-add-color\);[^}]*font-size:\s*var\(--desktop-attack-add-plus-size\);[^}]*font-weight:\s*800;/s,
    );
    expect(nonMobileCss).toMatch(
      /\.scenario-add-row\s*\{[^}]*width:\s*100%;[^}]*height:\s*var\(--desktop-grid-add-size\);[^}]*min-height:\s*var\(--desktop-grid-add-size\);[^}]*color:\s*var\(--desktop-grid-add-color\);/s,
    );

    // 721-1180 remains a horizontal flex lane; the add column is never rewritten as a grid row.
    expect(stackCss).toMatch(
      /\.scenario-attack-lane\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*stretch;/s,
    );
    expect(stackCss).not.toMatch(/\.scenario-attack-lane\s*\{[^}]*display:\s*grid;/s);
    expect(stackCss).not.toMatch(
      /\.scenario-attack-lane > \.attack-condition-card\s*\{[^}]*width:\s*100%;/s,
    );
    expect(stackCss).not.toMatch(
      /\.scenario-attack-lane > \.attack-add-card\s*\{[^}]*width:\s*100%;/s,
    );

    // Desktop-only tokens and overrides must not leak into the mobile rules.
    const mobileCss = css.slice(mobileStart);
    expect(mobileCss).not.toContain("--desktop-");

    const scenarioStart = html.indexOf('<article class="scenario-row defence"');
    const scenarioEnd = html.indexOf("</article>", scenarioStart);
    const scenarioHtml = html.slice(scenarioStart, scenarioEnd + "</article>".length);
    const attackAddIndex = scenarioHtml.indexOf('class="attack-add-card ui-button"');
    expect(scenarioStart).toBeGreaterThanOrEqual(0);
    expect(scenarioEnd).toBeGreaterThan(scenarioStart);
    expect(scenarioHtml).toContain('aria-label="シナリオ1に攻撃を追加"');
    expect(attackAddIndex).toBeGreaterThan(scenarioHtml.lastIndexOf('class="attack-condition-card"'));
    expect(html).toContain('class="scenario-add-row ui-button"');
    expect(html).toContain("シナリオを追加");

    const [baseScenario, ...otherScenarios] = createDefaultScenarioForms();
    const multipleAttackScenario = {
      ...baseScenario,
      attacks: [
        ...baseScenario.attacks,
        { ...baseScenario.attacks[0], id: "attack-b", label: "追加条件", attackerPokemonInput: "", moveInput: "" },
      ],
    };
    const multipleHtml = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[multipleAttackScenario, ...otherScenarios]}
      />,
    );
    const multipleStart = multipleHtml.indexOf('<article class="scenario-row defence"');
    const multipleEnd = multipleHtml.indexOf("</article>", multipleStart);
    const multipleScenarioHtml = multipleHtml.slice(multipleStart, multipleEnd + "</article>".length);
    expect(multipleScenarioHtml.match(/class="attack-condition-card"/g)).toHaveLength(2);
    expect(multipleScenarioHtml.indexOf('class="attack-add-card ui-button"')).toBeGreaterThan(
      multipleScenarioHtml.lastIndexOf('class="attack-condition-card"'),
    );
  });

  it("keeps desktop secondary controls readable and keyboard reachable", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const nonMobileStart = css.indexOf("@media (min-width: 721px)");
    const mobileStart = css.indexOf("@media (max-width: 720px)");
    const nonMobileCss = css.slice(nonMobileStart, mobileStart);

    expect(nonMobileCss).toMatch(
      /\.bulk-nature-toggle\s*\{[^}]*min-height:\s*var\(--desktop-control-compact\);/s,
    );
    expect(nonMobileCss).toMatch(
      /\.hp-event-enable input,\s*\.bulk-nature-toggle input,\s*\.scenario-options input,\s*\.speed-target-mode-option input\[type="radio"\]\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s,
    );
    expect(nonMobileCss).not.toMatch(/\.speed-target-mode-option input\s*\{[^}]*width:/s);
    expect(nonMobileCss).toMatch(/\.bulk-nature-toggle:focus-within\s*\{[^}]*outline:/s);

    expect(nonMobileCss).toMatch(
      /\.hp-event-rule-meta small,\s*\.hp-event-formula,\s*\.hp-event-warning,\s*\.hp-event-help,\s*\.hp-dependent-move-note,\s*\.hp-events-empty\s*\{[^}]*font-size:\s*var\(--desktop-text-meta\);/s,
    );
    expect(nonMobileCss).toMatch(
      /\.hp-event-help a\s*\{[^}]*display:\s*inline-flex;[^}]*min-height:\s*24px;[^}]*font-size:\s*var\(--desktop-text-interactive-small\);/s,
    );
    expect(nonMobileCss).toMatch(/\.hp-event-help a:focus-visible\s*\{[^}]*outline:/s);
  });

  it("keeps speed target controls aligned across responsive size tiers", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const nonMobileStart = css.indexOf("@media (min-width: 721px)");
    const mobileStart = css.indexOf("@media (max-width: 720px)");
    const narrowStart = css.indexOf("@media (max-width: 380px)", mobileStart);
    const nonMobileCss = css.slice(nonMobileStart, mobileStart);
    const mobileCss = css.slice(mobileStart, narrowStart);
    const narrowCss = css.slice(narrowStart);

    const hasWidthRule = (source: string, selector: string, width: string): boolean =>
      Array.from(source.matchAll(/([^{}]*\.[^{}]+)\{([^}]*)\}/g)).some((match) => {
        const selectors = match[1] ?? "";
        const declarations = match[2] ?? "";
        return selectors.includes(selector) && new RegExp(`width:\\s*${width};`).test(declarations);
      });

    expect(nonMobileStart).toBeGreaterThanOrEqual(0);
    expect(mobileStart).toBeGreaterThan(nonMobileStart);
    expect(narrowStart).toBeGreaterThan(mobileStart);
    expect(hasWidthRule(nonMobileCss, ".speed-offset-input", "112px")).toBe(true);
    expect(hasWidthRule(nonMobileCss, ".speed-manual-target-input", "112px")).toBe(true);
    expect(hasWidthRule(mobileCss, ".mobile-scenarios-open .speed-offset-input", "120px")).toBe(true);
    expect(hasWidthRule(mobileCss, ".mobile-scenarios-open .speed-manual-target-input", "120px")).toBe(true);
    expect(mobileCss).toMatch(
      /\.mobile-scenarios-open \.speed-manual-target-input\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
    );
    expect(narrowCss).toMatch(/\.mobile-scenarios-open \.speed-target-mode-option\s*\{[^}]*gap:\s*6px;/s);
    expect(narrowCss).toMatch(/\.mobile-scenarios-open \.speed-target-mode-control\s*\{[^}]*gap:\s*2px;/s);
    expect(narrowCss).not.toMatch(/\.speed-(?:offset-input|manual-target-input)\s*\{[^}]*width:/s);
  });

  it("keeps numeric and power-condition steppers on the shared visual primitive", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const uiStepperCss = css.match(/\.ui-stepper\s*\{[^}]*\}/s)?.[0] ?? "";
    const nonMobileStart = css.indexOf("@media (min-width: 721px)");
    const mobileStart = css.indexOf("@media (max-width: 720px)");
    const nonMobileCss = css.slice(nonMobileStart, mobileStart);
    const mobileCss = css.slice(mobileStart);

    expect(css).not.toContain(".move-power-stepper");
    expect(uiStepperCss).toContain("display: grid;");
    expect(uiStepperCss).toContain("grid-template-columns: var(--desktop-control-compact) minmax(var(--desktop-control-compact), 1fr) var(--desktop-control-compact);");
    expect(uiStepperCss).toContain("height: var(--desktop-control-standard);");
    expect(uiStepperCss).toContain("overflow: hidden;");
    expect(uiStepperCss).toContain("min-width: 0;");
    expect(uiStepperCss).toMatch(/border:[^;]+;/);
    expect(uiStepperCss).toMatch(/border-radius:[^;]+;/);
    expect(css).toMatch(
      /\.ui-stepper-button\s*\{[^}]*display:\s*grid;[^}]*place-items:\s*center;[^}]*cursor:\s*pointer;/s,
    );
    expect(css).toMatch(/\.ui-stepper-value\s*\{[^}]*min-width:\s*0;/s);
    expect(css).toMatch(
      /\.ui-stepper-button:hover:not\(:disabled\),\s*\.ui-stepper-button:focus-visible:not\(:disabled\),\s*\.ui-stepper-value > \.move-power-trigger:hover,\s*\.ui-stepper-value > \.move-power-trigger:focus-visible,\s*\.ui-stepper-value > \.move-power-trigger\[data-state="open"\]\s*\{[^}]*background:\s*var\(--gold-soft\);[^}]*color:\s*var\(--gold\);/s,
    );
    expect(css).toMatch(/\.ui-stepper-button:disabled\s*\{[^}]*opacity:[^;]+;[^}]*cursor:\s*not-allowed;/s);
    expect(css).toMatch(/\.ui-stepper-value > input\s*\{[^}]*padding:\s*0 2px;[^}]*font-size:\s*var\(--desktop-text-interactive-small\);[^}]*text-align:\s*center;/s);
    expect(css).toMatch(/\.ui-stepper-value > \.move-power-trigger\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s);
    expect(nonMobileCss).toMatch(
      /\.ui-stepper(?:,[^{}]+)*\s*\{[^}]*height:\s*var\(--desktop-control-standard\);/s,
    );
    expect(nonMobileCss).toMatch(
      /\.ui-stepper-button(?:,[^{}]+)*\s*\{[^}]*width:\s*var\(--desktop-control-compact\);/s,
    );
    expect(nonMobileCss).toMatch(
      /\.scenario-row \.ui-stepper-value > input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\.inline-title-input\),\s*\.attack-condition-card \.ui-stepper-value > input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\.inline-title-input\)\s*\{[^}]*padding-inline:\s*2px;[^}]*font-size:\s*var\(--desktop-text-interactive-small\);/s,
    );
    expect(mobileCss).toMatch(
      /\.ui-stepper(?:,[^{}]+)*\s*\{[^}]*height:\s*var\(--mobile-control-standard\);/s,
    );
    expect(mobileCss).toMatch(
      /\.ui-stepper-button(?:,[^{}]+)*\s*\{[^}]*width:\s*var\(--mobile-control-compact\);/s,
    );
    expect(mobileCss).toMatch(
      /\.mobile-scenarios-open \.ui-stepper-value > input\s*\{[^}]*font-size:\s*var\(--mobile-text-input\);[^}]*letter-spacing:\s*-1\.5px;/s,
    );
    expect(mobileCss).toMatch(
      /\.mobile-scenarios-open \.attack-number-grid,\s*\.mobile-scenarios-open \.attack-move-power-cell:has\(\.move-power-field\.steppable\)\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit, minmax\(152px, 1fr\)\);/s,
    );
    expect(mobileCss).toMatch(
      /\.mobile-scenarios-open \.scenario-stepper-field,\s*\.mobile-scenarios-open \.move-power-field\.steppable\s*\{[^}]*grid-template-columns:\s*minmax\(48px, max-content\) minmax\(0, 1fr\);[^}]*align-items:\s*center;[^}]*gap:\s*4px;/s,
    );
    expect(mobileCss).not.toMatch(
      /\.mobile-scenarios-open \.scenario-stepper-field,\s*\.mobile-scenarios-open \.move-power-field\.steppable\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s,
    );
  });

  it("keeps the mobile SP summary on one stable two-row layout", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const mobileStart = css.indexOf("@media (max-width: 720px)");
    const narrowStart = css.indexOf("@media (max-width: 380px)", mobileStart);
    const mobileCss = css.slice(mobileStart, narrowStart);
    const narrowCss = css.slice(narrowStart);

    expect(mobileCss).toMatch(
      /\.mobile-target-open \.sp-summary\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto;[^}]*align-items:\s*start;[^}]*gap:\s*0 12px;/s,
    );
    expect(mobileCss).toMatch(
      /\.mobile-target-open \.sp-summary-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*max-content\);[^}]*grid-template-rows:\s*repeat\(2,\s*var\(--mobile-control-standard\)\);[^}]*gap:\s*8px;/s,
    );
    expect(mobileCss).toMatch(
      /\.mobile-target-open \.sp-summary-actions \.ui-button\s*\{[^}]*min-height:\s*var\(--mobile-control-standard\);[^}]*font-size:\s*var\(--mobile-text-interactive-small\);/s,
    );
    expect(mobileCss).toMatch(
      /\.mobile-target-open \.bulk-nature-toggle\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*min-height:\s*var\(--mobile-control-standard\);[^}]*font-size:\s*var\(--mobile-text-interactive-small\);/s,
    );
    expect(mobileCss).toMatch(/\.mobile-target-open \.bulk-nature-toggle:focus-within\s*\{[^}]*outline:/s);
    expect(mobileCss).toMatch(
      /\.mobile-target-open \.sp-summary-total\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*1;[^}]*align-self:\s*start;[^}]*min-height:\s*var\(--mobile-control-standard\);[^}]*margin-left:\s*0;/s,
    );

    expect(narrowCss).not.toMatch(
      /\.mobile-target-open \.sp-summary(?:-actions|-total)?\s*\{[^}]*(?:grid-template|align-items|min-height|font-size):/s,
    );
  });

  it("organizes battle modifiers as one accessible two-column section per attack", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const mobileStart = css.indexOf("@media (max-width: 720px)");
    const narrowStart = css.indexOf("@media (max-width: 380px)", mobileStart);
    const mobileCss = css.slice(mobileStart, narrowStart);
    const narrowCss = css.slice(narrowStart);

    expect(css).toMatch(
      /\.scenario-options\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*gap:\s*6px;[^}]*margin-left:\s*0;/s,
    );
    expect(css).toMatch(
      /\.scenario-options label\s*\{[^}]*display:\s*inline-flex;[^}]*width:\s*100%;[^}]*min-height:\s*var\(--desktop-control-standard\);[^}]*border:\s*1px solid[^}]*background:\s*var\(--surface-inset\);[^}]*padding:\s*0 8px;/s,
    );
    expect(css).toMatch(
      /\.scenario-options label:focus-within\s*\{[^}]*border-color:[^}]*box-shadow:/s,
    );
    expect(css).toMatch(
      /\.scenario-options input\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s,
    );

    // Mobile keeps the same 2-column interaction model and the narrow block does not shrink it.
    expect(mobileCss).toMatch(
      /\.mobile-scenarios-open \.scenario-options\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[^}]*gap:\s*6px;/s,
    );
    expect(mobileCss).toMatch(
      /\.mobile-scenarios-open \.scenario-options label\s*\{[^}]*height:\s*var\(--mobile-control-standard\);[^}]*min-height:\s*var\(--mobile-control-standard\);[^}]*font-size:\s*var\(--mobile-text-interactive-small\);/s,
    );
    expect(narrowCss).not.toMatch(
      /\.mobile-scenarios-open \.scenario-options\s*\{[^}]*grid-template-columns:\s*repeat\(1/s,
    );
    expect(narrowCss).not.toMatch(
      /\.mobile-scenarios-open \.scenario-options label\s*\{[^}]*\b(?:height|min-height|font-size)\s*:\s*(?:10|11|12|28|30|32)px;/s,
    );
    expect(narrowCss).toMatch(
      /\.mobile-scenarios-open \.scenario-options label\s*\{[^}]*gap:\s*0;[^}]*padding:\s*0 2px;/s,
    );

    const html = renderExampleApp();
    const attackCount = html.match(/class="attack-condition-card"/g)?.length ?? 0;
    const modifierSectionCount = html.match(/class="attack-setting-section attack-battle-modifiers"/g)?.length ?? 0;
    const optionsCount = html.match(/class="scenario-options"/g)?.length ?? 0;
    expect(attackCount).toBeGreaterThan(0);
    // Speed attacks intentionally do not expose these battle modifiers; every rendered
    // modifier section must still own exactly one options grid.
    expect(modifierSectionCount).toBeGreaterThan(0);
    expect(optionsCount).toBe(modifierSectionCount);

    const labels = ["急所", "てだすけ", "リフレクター", "ひかりのかべ", "オーロラベール", "フレンドガード"];
    const modifierSections = Array.from(html.matchAll(
      /<section class="attack-setting-section attack-battle-modifiers" aria-labelledby="([^"]+)">([\s\S]*?)<\/section>/g,
    ));
    expect(modifierSections).toHaveLength(modifierSectionCount);
    for (const modifierSection of modifierSections) {
      const headingId = modifierSection[1] ?? "";
      const sectionHtml = modifierSection[2] ?? "";
      expect(sectionHtml).toContain(`<h3 id="${headingId}">戦闘補正</h3>`);
      expect(sectionHtml).toContain('class="scenario-options"');

      const labelOrder = labels.map((label) => sectionHtml.indexOf(`> ${label}</label>`));
      expect(labelOrder.every((index) => index >= 0)).toBe(true);
      expect(labelOrder).toEqual([...labelOrder].sort((left, right) => left - right));
      for (const label of labels) {
        expect(sectionHtml.match(new RegExp(`> ${label}</label>`, "g"))).toHaveLength(1);
      }
    }

    const [baseScenario, ...otherScenarios] = createDefaultScenarioForms();
    const [baseAttack, ...otherAttacks] = baseScenario.attacks;
    const checkedScenario = {
      ...baseScenario,
      attacks: [{
        ...baseAttack,
        critical: true,
        reflect: true,
        lightScreen: true,
        auroraVeil: true,
        helpingHand: true,
        friendGuard: true,
      }, ...otherAttacks],
    };
    const checkedHtml = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[checkedScenario, ...otherScenarios]}
      />,
    );
    const checkedSection = checkedHtml.match(
      /<section class="attack-setting-section attack-battle-modifiers" aria-labelledby="([^"]+)">([\s\S]*?)<\/section>/,
    )?.[2] ?? "";
    expect((checkedSection.match(/<input type="checkbox" checked=""/g) ?? [])).toHaveLength(6);
    for (const label of labels) {
      expect(checkedSection).toContain(`> ${label}</label>`);
    }
  });

  it("keeps mobile overview scenario affordances role-sized at narrow widths", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const enabledHtml = renderExampleApp();
    const disabledScenarios = createDefaultScenarioForms().map((scenario, index) => (
      index === 0 ? { ...scenario, enabled: false } : scenario
    ));
    const disabledHtml = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={disabledScenarios}
      />,
    );

    expect(enabledHtml).toMatch(
      /<button class="mobile-scenario-state on" type="button" role="switch" aria-checked="true" aria-label="シナリオ1を無効化">/,
    );
    expect(disabledHtml).toMatch(
      /<button class="mobile-scenario-state off" type="button" role="switch" aria-checked="false" aria-label="シナリオ1を有効化">/,
    );
    expect(enabledHtml).toContain('class="mobile-scenario-state on"');
    expect(enabledHtml).toContain('class="mobile-scenario-adjustment-row"');
    expect(enabledHtml).toMatch(/class="[^"]*mobile-scenario-remove-button[^"]*"/);

    expect(css).toMatch(/\.mobile-scenario-state\s*\{[^}]*width:\s*var\(--mobile-control-standard\);[^}]*height:\s*var\(--mobile-control-standard\);/s);
    expect(css).toMatch(/\.mobile-scenario-state:focus-visible\s*\{[^}]*outline:\s*0;[^}]*box-shadow:\s*none;/s);
    expect(css).toMatch(/\.mobile-scenario-state:focus-visible::before\s*\{[^}]*border-width:\s*2px;[^}]*border-color:\s*var\(--text\);/s);
    expect(css).toMatch(/\.mobile-scenario-summary-main,\s*\.mobile-scenario-title\s*\{[^}]*min-height:\s*var\(--mobile-control-standard\);/s);
    expect(css).toMatch(/\.mobile-scenario-remove-button\s*\{[^}]*width:\s*var\(--mobile-control-standard\);[^}]*height:\s*var\(--mobile-control-standard\);[^}]*min-width:\s*var\(--mobile-control-standard\);/s);
    expect(css).toMatch(/\.mobile-scenario-remove-button \.ui-button-icon\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;/s);
    expect(css).toMatch(/\.mobile-scenario-adjustment-row\s*\{[^}]*width:\s*100%;[^}]*min-height:\s*var\(--mobile-control-standard\);/s);
    expect(css).toMatch(/\.mobile-scenario-adjustment-label\s*\{[^}]*font-size:\s*var\(--mobile-text-interactive-small\);/s);

    const has34x20ToggleTrack = [
      /\.mobile-scenario-state::before\s*\{[^}]*width:\s*34px;[^}]*height:\s*20px;/s,
      /\.mobile-scenario-state span\s*\{[^}]*width:\s*34px;[^}]*height:\s*20px;/s,
    ].some((pattern) => pattern.test(css));
    const has14pxToggleKnob = [
      /\.mobile-scenario-state::after\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px;/s,
      /\.mobile-scenario-state span::after\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px;/s,
      /\.mobile-scenario-state span\s*\{[^}]*width:\s*14px;[^}]*height:\s*14px;/s,
    ].some((pattern) => pattern.test(css));
    expect(has34x20ToggleTrack).toBe(true);
    expect(has14pxToggleKnob).toBe(true);

    const narrowMedia = css.match(/@media \(max-width: 380px\)[\s\S]*$/)?.[0] ?? "";
    expect(narrowMedia).not.toMatch(/\.mobile-scenario-state\s*\{[^}]*width:\s*(?:28|30)px;/s);
    expect(narrowMedia).not.toMatch(/\.mobile-scenario-state\s*\{[^}]*height:\s*16px;/s);
    expect(narrowMedia).not.toMatch(/\.mobile-scenario-state\.on span\s*\{[^}]*transform:\s*translateX\(12px\);/s);
    expect(narrowMedia).not.toMatch(/\.mobile-scenario-title strong(?:\s*,[^{}]*?)?\s*\{[^}]*font-size:\s*12px;/s);
    expect(narrowMedia).not.toMatch(/\.mobile-scenario-adjustment-label\s*\{[^}]*font-size:\s*10px;/s);
  });

  it("keeps mobile overview large-card controls stable on narrow rails", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const rootStart = css.indexOf(":root");
    const mobileStart = css.indexOf("@media (max-width: 720px)");
    const narrowStart = css.indexOf("@media (max-width: 380px)", mobileStart);
    const rootCss = css.slice(rootStart, css.indexOf("}", rootStart) + 1);
    const mobileCss = css.slice(mobileStart, narrowStart);
    const narrowCss = css.slice(narrowStart);

    expect(rootStart).toBeGreaterThanOrEqual(0);
    expect(mobileStart).toBeGreaterThan(rootStart);
    expect(narrowStart).toBeGreaterThan(mobileStart);
    expect(rootCss).toContain("--mobile-overview-card-action-height: 64px;");
    expect(rootCss).toContain("--mobile-overview-attack-gap: 7px;");
    expect(rootCss).toContain("--mobile-overview-attack-artwork-size: 32px;");

    // One attack consumes the rail content width left after the 44px add action and 7px gap.
    expect(mobileCss).toMatch(
      /\.mobile-attack-rail\s*\{[^}]*gap:\s*var\(--mobile-overview-attack-gap\);[^}]*overflow-x:\s*auto;[^}]*overscroll-behavior-inline:\s*contain;[^}]*scroll-snap-type:\s*x\s+proximity;/s,
    );
    expect(mobileCss).toMatch(
      /\.mobile-attack-summary\s*\{[^}]*grid-template-columns:\s*var\(--mobile-overview-attack-artwork-size\)\s+minmax\(0,\s*1fr\);[^}]*gap:\s*6px;[^}]*flex:\s*0\s*0\s*calc\(100%\s*-\s*var\(--mobile-control-comfort\)\s*-\s*var\(--mobile-overview-attack-gap\)\);[^}]*width:\s*calc\(100%\s*-\s*var\(--mobile-control-comfort\)\s*-\s*var\(--mobile-overview-attack-gap\)\);[^}]*min-width:\s*calc\(100%\s*-\s*var\(--mobile-control-comfort\)\s*-\s*var\(--mobile-overview-attack-gap\)\);[^}]*height:\s*var\(--mobile-overview-card-action-height\);[^}]*min-height:\s*var\(--mobile-overview-card-action-height\);[^}]*padding:\s*6px;/s,
    );
    expect(mobileCss).toMatch(
      /\.mobile-attack-summary \.pokemon-artwork\.attack\s*\{[^}]*width:\s*var\(--mobile-overview-attack-artwork-size\);[^}]*height:\s*var\(--mobile-overview-attack-artwork-size\);/s,
    );

    // The add affordance shares the attack-card height and the comfort-width hit target.
    expect(mobileCss).toMatch(
      /\.mobile-attack-add\s*\{[^}]*flex:\s*0\s*0\s*var\(--mobile-control-comfort\);[^}]*width:\s*var\(--mobile-control-comfort\);[^}]*min-width:\s*var\(--mobile-control-comfort\);[^}]*height:\s*var\(--mobile-overview-card-action-height\);[^}]*min-height:\s*var\(--mobile-overview-card-action-height\);[^}]*padding:\s*0;[^}]*font-size:\s*24px;/s,
    );
    expect(mobileCss).toMatch(
      /\.mobile-scenario-add-card\s*\{[^}]*width:\s*100%;[^}]*height:\s*var\(--mobile-overview-card-action-height\);[^}]*min-height:\s*var\(--mobile-overview-card-action-height\);[^}]*font-size:\s*28px;/s,
    );
    // The narrow media block must keep the same content-width calculation instead of a second fixed width.
    for (const pattern of [
      /\.mobile-attack-summary\s*\{[^}]*grid-template-columns:/s,
      /\.mobile-attack-summary\s*\{[^}]*flex-basis:/s,
      /\.mobile-attack-summary\s*\{[^}]*width:/s,
      /\.mobile-attack-summary\s*\{[^}]*min-width:/s,
      /\.mobile-attack-summary\s*\{[^}]*height:/s,
      /\.mobile-attack-summary\s*\{[^}]*min-height:/s,
      /\.mobile-attack-summary \.pokemon-artwork\.attack\s*\{[^}]*width:/s,
      /\.mobile-attack-summary \.pokemon-artwork\.attack\s*\{[^}]*height:/s,
      /\.mobile-attack-add\s*\{[^}]*flex-basis:/s,
      /\.mobile-attack-add\s*\{[^}]*width:/s,
      /\.mobile-attack-add\s*\{[^}]*height:/s,
      /\.mobile-attack-add\s*\{[^}]*min-height:/s,
      /\.mobile-scenario-add-card\s*\{[^}]*height:/s,
      /\.mobile-scenario-add-card\s*\{[^}]*min-height:/s,
    ]) {
      expect(narrowCss).not.toMatch(pattern);
    }

    const defaultHtml = renderExampleApp();
    expect(defaultHtml).toContain('aria-label="シナリオ1に攻撃を追加"');
    expect(defaultHtml).toContain('aria-label="シナリオを追加"');

    // Unresolved inputs still render one stable attack card and its explicit add action.
    const unresolvedTarget = { ...createDefaultTargetForm(), pokemonInput: "" };
    const unresolvedScenarios = createDefaultScenarioForms().map((scenario, index) => index === 0
      ? {
          ...scenario,
          attacks: scenario.attacks.map((attack) => ({
            ...attack,
            label: "",
            attackerPokemonInput: "",
            moveInput: "",
          })),
        }
      : scenario);
    const unresolvedHtml = renderToStaticMarkup(
      <App initialTargetForm={unresolvedTarget} initialScenarioForms={unresolvedScenarios} />,
    );
    const unresolvedArticle = unresolvedHtml.match(
      /<article class="mobile-scenario-summary defence[\s\S]*?<\/article>/,
    )?.[0] ?? "";
    expect(unresolvedArticle.match(/class="mobile-attack-summary"/g)).toHaveLength(1);
    expect(unresolvedArticle).toContain("未設定");
    expect(unresolvedArticle).toContain('aria-label="シナリオ1に攻撃を追加"');

    // Multiple attacks remain independent cards, with the add control after the rail items.
    const [baseScenario, ...otherScenarios] = createDefaultScenarioForms();
    const multipleAttackScenario = {
      ...baseScenario,
      attacks: [
        ...baseScenario.attacks,
        { ...baseScenario.attacks[0], id: "attack-b", label: "追加条件", attackerPokemonInput: "", moveInput: "" },
      ],
    };
    const multipleHtml = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[multipleAttackScenario, ...otherScenarios]}
      />,
    );
    const multipleArticle = multipleHtml.match(
      /<article class="mobile-scenario-summary defence[\s\S]*?<\/article>/,
    )?.[0] ?? "";
    expect(multipleArticle.match(/class="mobile-attack-summary"/g)).toHaveLength(2);
    expect(multipleArticle).toContain(">追加条件</strong>");
    expect(multipleArticle.indexOf('class="mobile-attack-add"')).toBeGreaterThan(
      multipleArticle.lastIndexOf('class="mobile-attack-summary"'),
    );
    expect(multipleArticle).toContain('aria-label="シナリオ1に攻撃を追加"');
  });

  it("keeps box dialogs above mobile sheets and candidate budget values proportional", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(css).toMatch(/--mobile-sheet-z:\s*70;/);
    expect(css).toMatch(/--box-overlay-z:\s*100;/);
    expect(css).toMatch(/\.box-overlay\s*\{[^}]*z-index:\s*var\(--box-overlay-z\);/s);
    expect(css).toMatch(/\.mobile-candidate-layout \.candidate-row-toggle\s*\{[^}]*grid-template-columns:\s*36px minmax\(0, 1fr\) 18px;/s);
    expect(css).toMatch(/\.mobile-candidate-layout \.candidate-budget-bar\s*\{[^}]*grid-template-columns:\s*minmax\(max-content, var\(--candidate-used-track, 1fr\)\)\s*minmax\(max-content, var\(--candidate-remaining-track, 1fr\)\);/s);
    expect(css).toMatch(/\.mobile-candidate-layout \.candidate-budget-value\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;[^}]*height:\s*24px;[^}]*min-height:\s*24px;[^}]*border:\s*1px solid[^}]*border-radius:\s*5px;[^}]*overflow:\s*hidden;/s);
    expect(css).toMatch(/\.mobile-candidate-layout \.candidate-budget-value\.used\s*\{[^}]*border-color:\s*color-mix\(in srgb,\s*var\(--gold\) 60%,\s*var\(--bg\)\);[^}]*background:\s*var\(--gold\);[^}]*color:\s*var\(--bg\);/s);
    expect(css).toMatch(/\.mobile-candidate-layout \.candidate-budget-value\.used::before\s*\{[^}]*margin-right:\s*2px;[^}]*color:\s*inherit;[^}]*content:\s*"使用";/s);
    expect(css).toMatch(/\.mobile-candidate-layout \.candidate-budget-value\.used\.is-budget-full\s*\{[^}]*border-color:\s*var\(--red\);/s);
    expect(css).toMatch(/\.mobile-candidate-layout \.candidate-budget-value\.remaining\.has-remaining\s*\{[^}]*color:\s*var\(--text\);/s);
    expect(css).toMatch(/\.mobile-candidate-layout \.candidate-budget-value\.remaining\.is-zero\s*\{[^}]*color:\s*var\(--muted\);/s);
    expect(css).toMatch(/\.mobile-candidate-layout \.candidate-budget-value\.remaining::before\s*\{[^}]*margin-right:\s*2px;[^}]*color:\s*inherit;[^}]*content:\s*"残";/s);
    expect(css).toMatch(/\.mobile-candidate-actions \.ui-button\s*\{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/s);
    expect(css).toMatch(/\.mobile-search-counts\s*\{[^}]*display:\s*inline-flex;[^}]*flex:\s*1 1 auto;[^}]*gap:\s*8px;[^}]*min-width:\s*0;/s);
    expect(css).toMatch(/\.mobile-search-counts > span:first-child\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/s);
    expect(css).toMatch(/\.mobile-search-counts > span:last-child\s*\{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/s);
    const narrowStart = css.lastIndexOf("@media (max-width: 380px)");
    const narrowCss = css.slice(narrowStart);
    expect(narrowCss).toMatch(/\.mobile-candidate-actions\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/s);
    expect(narrowCss).toMatch(/\.mobile-search-counts\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*width:\s*100%;[^}]*margin-right:\s*0;/s);
    expect(narrowCss).toMatch(/\.mobile-candidate-actions \.ui-button\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s);
    expect(css).toMatch(/@media \(max-width: 380px\)[\s\S]*?\.mobile-candidate-layout \.candidate-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 60px;/s);
    expect(css).toMatch(/@media \(max-width: 380px\)[\s\S]*?\.mobile-candidate-layout \.candidate-apply-button\s*\{[^}]*width:\s*60px;[^}]*min-width:\s*60px;/s);
  });

  it("keeps box slot names constrained without clipping their line box", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.box-slot > strong\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-block-size:\s*1\.5em;[^}]*line-height:\s*1\.5;[^}]*justify-self:\s*stretch;/s);
  });

  it("gives narrow box stat summaries more room without shrinking their text", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const narrowStart = css.lastIndexOf("@media (max-width: 380px)");
    const narrowCss = css.slice(narrowStart);

    expect(css).toMatch(/\.box-slot\s*\{[^}]*padding:\s*10px 4px;/s);
    expect(narrowCss).toMatch(/\.box-slot\s*\{[^}]*padding-inline:\s*4px;/s);
    expect(narrowCss).not.toMatch(/\.box-slot span\s*\{[^}]*font-size:/s);
  });

  it("lets the mobile board follow its content while keeping the footer at the viewport bottom", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.app-shell:not\(\.app-shell--tutorial\)\s*\{[^}]*min-height:\s*100dvh;[^}]*grid-template-rows:\s*auto 1fr auto auto;[^}]*align-content:\s*stretch;/s);
    expect(css).toMatch(/\.mobile-overview\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
    expect(css).toMatch(/\.mobile-symmetric-board\s*\{[^}]*min-height:\s*0;/s);
    expect(css).not.toMatch(/\.mobile-symmetric-board\s*\{[^}]*min-height:\s*610px;/s);
    expect(css).toMatch(/\.mobile-candidate-dock\s*\{[^}]*position:\s*static;[^}]*margin-top:\s*auto;/s);
  });

  it("adds a third mobile-header row only while a draft status is visible", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const html = renderExampleApp();

    expect(css).toContain('"description description"\n      "brand actions";');
    expect(css).toMatch(/\.topbar\.has-draft-status\s*\{[^}]*grid-template-areas:\s*"description description"\s*"brand actions"\s*"status status";/s);
    expect(css).toMatch(/\.brand-title,\s*\.brand-line\s*\{[^}]*display:\s*contents;/s);
    expect(css).toMatch(/\.topbar \.brand-description\s*\{[^}]*grid-area:\s*description;[^}]*text-align:\s*center;[^}]*text-wrap:\s*balance;/s);
    expect(css).toMatch(/\.topbar \.brand-version\s*\{[^}]*display:\s*none;/s);
    expect(css).toMatch(/\.topbar \.draft-save-status\s*\{[^}]*font-weight:\s*400;/s);
    expect(css).toMatch(/\.topbar-draft-row\s*\{[^}]*display:\s*contents;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.topbar \.draft-save-status\s*\{[^}]*text-align:\s*right;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.topbar-draft-row\s*\{[^}]*display:\s*flex;[^}]*grid-area:\s*status;[^}]*justify-content:\s*flex-end;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.topbar-meta\s*\{[^}]*display:\s*contents;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.topbar-action-row\s*\{[^}]*grid-area:\s*actions;[^}]*justify-self:\s*end;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.suggestion-format-toggle\s*\{[^}]*height:\s*36px;[^}]*border:\s*0;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.suggestion-format-option\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;[^}]*flex:\s*0 0 36px;[^}]*overflow:\s*visible;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.suggestion-format-option-content\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;[^}]*min-height:\s*36px;[^}]*gap:\s*0;[^}]*padding:\s*0;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.suggestion-format-option:first-child \.suggestion-format-option-content\s*\{[^}]*border-radius:\s*6px 0 0 6px;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.suggestion-format-option:last-child \.suggestion-format-option-content\s*\{[^}]*border-left:\s*0;[^}]*border-radius:\s*0 6px 6px 0;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.suggestion-format-option\[data-checked="true"\]\s*\{[^}]*background:\s*transparent;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.suggestion-format-option-label\s*\{[^}]*display:\s*none;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.suggestion-format-icon\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;/s);
    expect(css).toMatch(/@media \(max-width: 380px\)[\s\S]*?\.topbar-action-row\s*\{[^}]*gap:\s*8px;/s);
    expect(css).toMatch(/\.readme-link\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s);
    expect(css).toMatch(/\.app-footer-version\s*\{[^}]*display:\s*block;/s);
    expect(html).toContain("ポケモンチャンピオンズ 耐久・火力・素早さ自動調整ツール");
    expect(html).toContain('class="suggestion-format-option-label">シングル</span>');
    expect(html).toContain('class="suggestion-format-option-label">ダブル</span>');
    expect(html).toContain('class="topbar"');
    expect(html).not.toContain("has-draft-status");
    expect(html).not.toContain('class="topbar-draft-row"');
    expect(html).toContain('class="app-footer-version"');
  });

  it("shows the matching account status icon in the app header but keeps it out of the tutorial", () => {
    const html = renderToStaticMarkup(<App />);
    const tutorial = renderToStaticMarkup(<App variant="tutorial" />);
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    const expectedIconPaths = {
      "local-only": "assets/ui/sync-local-only.svg",
      unsynced: "assets/ui/sync-unsynced.svg",
      syncing: "assets/ui/sync-syncing.svg",
      synced: "assets/ui/sync-synced.svg",
      offline: "assets/ui/sync-offline.svg",
      conflict: "assets/ui/sync-conflict.svg",
      error: "assets/ui/sync-error.svg",
    } as const;

    expect(html).toContain('class="account-sync-trigger local-only"');
    expect(html).toContain('aria-label="アカウントと同期: このブラウザのみ"');
    expect(html).toContain("このブラウザのみ");
    expect(html).toContain("assets/ui/sync-local-only.svg");
    expect(tutorial).not.toContain("account-sync-trigger");
    expect(tutorial).not.toContain("Googleでログイン");
    for (const [status, path] of Object.entries(expectedIconPaths)) {
      expect(getAccountSyncStatusIconPath(status as keyof typeof expectedIconPaths)).toBe(path);
      expect(readFileSync(new URL(`../public/${path}`, import.meta.url), "utf8")).toContain('viewBox="0 0 24 24"');
    }
    expect(css).toMatch(/\.account-sync-trigger-icon\s*\{[^}]*width:\s*16px;[^}]*height:\s*16px;[^}]*mask-size:\s*contain;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.account-sync-trigger\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.account-sync-trigger-icon\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;/s);
    expect(css).toMatch(/\.account-sync-window\s*\{[^}]*width:\s*min\(660px, calc\(100vw - 36px\)\);[^}]*overflow:\s*auto;/s);
  });

  it("uses the provided icons for box actions and requested mobile sheet controls", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const guideCss = readFileSync(new URL("./guide/guide.css", import.meta.url), "utf8");
    const guideMain = readFileSync(new URL("./guide/main.tsx", import.meta.url), "utf8");
    const privacyMain = readFileSync(new URL("./privacy/main.ts", import.meta.url), "utf8");

    expect(source).toMatch(/aria-label="バックアップを書き出す"[\s\S]*?assets\/ui\/download\.svg/);
    expect(source).toMatch(/aria-label="バックアップを読み込む"[\s\S]*?assets\/ui\/upload\.svg/);
    expect(source).toMatch(/className="box-close-button"[^>]*aria-label="閉じる"[\s\S]*?assets\/ui\/close\.svg/);
    expect(source.match(/assets\/ui\/close\.svg/g)).toHaveLength(3);
    expect(source).not.toContain("assets/ui/x.svg");
    expect(source.match(/mobile-sheet-close mobile-sheet-icon-button/g)).toHaveLength(2);
    expect(source).toMatch(/mobile-sheet-list-button mobile-sheet-icon-button"[\s\S]*?aria-label="一覧"[\s\S]*?assets\/ui\/list\.svg/);
    expect(source).not.toContain("box-action-label");

    for (const path of ["download.svg", "upload.svg", "list.svg", "close.svg", "x.svg"]) {
      const svg = readFileSync(new URL(`../public/assets/ui/${path}`, import.meta.url), "utf8");
      expect(svg).toContain('viewBox="0 0 24 24"');
      expect(svg).toContain('stroke="#ffffff"');
    }
    expect(readFileSync(new URL("../public/assets/ui/x.svg", import.meta.url), "utf8"))
      .toContain('<circle cx="12" cy="12" r="10"/>');
    expect(readFileSync(new URL("../public/assets/ui/close.svg", import.meta.url), "utf8"))
      .toContain('class="lucide lucide-x-icon lucide-x"');
    expect(guideMain).toContain('nextOpen ? "assets/ui/x.svg" : "assets/ui/menu.svg"');
    expect(privacyMain).toContain('nextOpen ? "assets/ui/x.svg" : "assets/ui/menu.svg"');
    expect(css).toMatch(/\.topbar-action-row\s*\{[^}]*gap:\s*8px;/s);
    expect(css).toMatch(/\.readme-link\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;/s);
    expect(css).toMatch(/\.readme-link img\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;/s);
    expect(css).toMatch(/\.box-access-button\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;[^}]*padding:\s*7px;/s);
    expect(css).toMatch(/\.box-access-button img\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;/s);
    expect(css).toMatch(/\.box-window-actions\s*\{[^}]*gap:\s*8px;/s);
    expect(css).toMatch(/\.box-window-actions \.ui-button-small\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;[^}]*padding:\s*0;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.mobile-target-heading\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 36px;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.mobile-box-access-button\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;[^}]*padding:\s*7px;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.mobile-sheet-heading-actions\s*\{[^}]*gap:\s*8px;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.mobile-sheet-icon-button\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;[^}]*padding:\s*7px;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.box-window-actions\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*gap:\s*8px;/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-menu-toggle\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;[^}]*flex:\s*0 0 36px;/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-menu-toggle img\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;/s);
  });

  it("publishes indexable metadata and canonical XML and text sitemaps", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    const sitemap = readFileSync(new URL("../public/sitemap.xml", import.meta.url), "utf8");
    const textSitemap = readFileSync(new URL("../public/sitemap.txt", import.meta.url), "utf8");

    expect(css).toMatch(/\.brand-title\s*\{[^}]*flex:\s*1 1 auto;/s);
    expect(css).toMatch(/\.topbar-meta\s*\{[^}]*justify-items:\s*end;/s);
    expect(css).toMatch(/\.topbar \.brand-version\s*\{[^}]*font-size:\s*9px;[^}]*text-align:\s*right;/s);
    expect(html).toContain("<title>ChampionCreator | ポケモンチャンピオンズ 耐久・火力・素早さ自動調整ツール</title>");
    const description = "「神調整」を誰にでも ― ポケモンチャンピオンズ（ポケチャン）の耐久・火力・素早さ条件から、能力ポイント（SP）の配分を自動計算できるツール";
    expect(html.match(new RegExp(`content="${description}"`, "g"))).toHaveLength(3);
    expect(html).not.toContain("能力ポイント（SP・努力値相当）");
    expect(html).toContain('name="robots" content="index, follow, max-image-preview:large"');
    expect(html).toContain('rel="canonical" href="https://championcreator.suisui-swimmy.com/"');
    expect(html).toContain('property="og:url" content="https://championcreator.suisui-swimmy.com/"');
    expect(html).toContain('property="og:image"');
    expect(html).toContain('name="twitter:image"');
    const searchThumbnailUrl = "https://championcreator.suisui-swimmy.com/assets/seo/championcreator-search-thumbnail.png";
    expect(html.match(new RegExp(`content="${searchThumbnailUrl.replaceAll(".", "\\.")}"`, "g"))).toHaveLength(2);
    expect(html).toContain('property="og:image:width" content="1024"');
    expect(html).toContain('property="og:image:height" content="1024"');
    const structuredData = Array.from(html.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g))
      .map((match) => JSON.parse(match[1] ?? "{}"));
    expect(structuredData).toContainEqual({
      "@context": "https://schema.org",
      "@type": "WebSite",
      name: "ChampionCreator",
      url: "https://championcreator.suisui-swimmy.com/",
    });
    expect(structuredData).toContainEqual({
      "@context": "https://schema.org",
      "@type": "WebPage",
      name: "ChampionCreator | ポケモンチャンピオンズ 耐久・火力・素早さ自動調整ツール",
      url: "https://championcreator.suisui-swimmy.com/",
      primaryImageOfPage: {
        "@type": "ImageObject",
        url: searchThumbnailUrl,
        width: 1024,
        height: 1024,
      },
    });
    const searchThumbnail = readFileSync(new URL("../public/assets/seo/championcreator-search-thumbnail.png", import.meta.url));
    expect(searchThumbnail.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(searchThumbnail.readUInt32BE(16)).toBe(1024);
    expect(searchThumbnail.readUInt32BE(20)).toBe(1024);
    expect(html).toContain('name="twitter:card" content="summary"');
    expect(sitemap).toContain("<loc>https://championcreator.suisui-swimmy.com/</loc>");
    expect(sitemap).toContain("<loc>https://championcreator.suisui-swimmy.com/guide/</loc>");
    expect(sitemap).not.toContain("localhost");
    expect(textSitemap.trim().split(/\r?\n/)).toEqual([
      "https://championcreator.suisui-swimmy.com/",
      "https://championcreator.suisui-swimmy.com/guide/",
      "https://championcreator.suisui-swimmy.com/privacy/",
    ]);
  });

  it("uses the shared search thumbnail for every public page social card", () => {
    const searchThumbnailUrl = "https://championcreator.suisui-swimmy.com/assets/seo/championcreator-search-thumbnail.png";
    const pages = [
      readFileSync(new URL("../index.html", import.meta.url), "utf8"),
      readFileSync(new URL("../guide/index.html", import.meta.url), "utf8"),
      readFileSync(new URL("../privacy/index.html", import.meta.url), "utf8"),
    ];

    for (const html of pages) {
      expect(html.match(new RegExp(`content="${searchThumbnailUrl.replaceAll(".", "\\.")}"`, "g")))
        .toHaveLength(2);
      expect(html).toContain('property="og:image:type" content="image/png"');
      expect(html).toContain('property="og:image:width" content="1024"');
      expect(html).toContain('property="og:image:height" content="1024"');
      expect(html).toContain('property="og:image:alt" content="ChampionCreatorのロゴ"');
      expect(html).toContain('name="twitter:image:alt" content="ChampionCreatorのロゴ"');
    }

    expect(pages[1]).not.toContain("/assets/icons/icon-512.png");
    expect(pages[2]).not.toContain("/assets/icons/icon-512.png");
  });

  it("publishes the same five-group footer contract on the app, guide, and privacy pages", () => {
    const appFooter = renderExampleApp().match(/<footer class="app-footer"[\s\S]*?<\/footer>/)?.[0] ?? "";
    const guideHtml = readFileSync(new URL("../guide/index.html", import.meta.url), "utf8");
    const guideFooter = guideHtml.match(/<footer class="app-footer"[\s\S]*?<\/footer>/)?.[0] ?? "";
    const privacyHtml = readFileSync(new URL("../privacy/index.html", import.meta.url), "utf8");
    const privacyFooter = privacyHtml.match(/<footer class="app-footer"[\s\S]*?<\/footer>/)?.[0] ?? "";
    const githubIcon = readFileSync(
      new URL("../public/assets/social/github-invertocat-white.svg", import.meta.url),
      "utf8",
    );

    for (const footer of [appFooter, guideFooter, privacyFooter]) {
      expect(footer).toContain('aria-label="サイトフッター"');
      expect(footer).toContain('class="app-footer-copy"');
      expect(footer).toContain('class="app-footer-links app-footer-page-links"');
      expect(footer).toContain('aria-label="ページリンク"');
      expect(footer).toContain('class="app-footer-links app-footer-support-links"');
      expect(footer).toContain('aria-label="サポート・関連リンク"');
      expect(footer).toContain('class="app-footer-source"');
      expect(footer).toContain('class="app-footer-version"');
      expect(footer).toContain("© 2026 suisui-swimmy");
      expect(footer).toContain("本ツールは非公式のファンツールであり、画像、名称などに関する著作権は 任天堂 / クリーチャーズ / ゲームフリーク に帰属します");
      expect(footer.indexOf('class="app-footer-copy"')).toBeLessThan(footer.indexOf("app-footer-page-links"));
      expect(footer.indexOf("app-footer-page-links")).toBeLessThan(footer.indexOf("app-footer-support-links"));
      expect(footer.indexOf("app-footer-support-links")).toBeLessThan(footer.indexOf('class="app-footer-source"'));
      expect(footer.indexOf('class="app-footer-source"')).toBeLessThan(footer.indexOf('class="app-footer-version"'));
      expect(footer.indexOf("アプリ")).toBeLessThan(footer.indexOf("使い方ガイド"));
      expect(footer.indexOf("使い方ガイド")).toBeLessThan(footer.indexOf("プライバシー"));
      expect(footer).toContain('href="https://github.com/suisui-swimmy/ChampionCreator"');
      expect(footer).toContain('aria-label="ChampionCreator GitHub リポジトリ"');
      expect(footer).toContain("assets/social/github-invertocat-white.svg");
      expect(footer.indexOf("不具合報告")).toBeLessThan(footer.indexOf("お問い合わせ"));
      expect(footer.indexOf("お問い合わせ")).toBeLessThan(footer.indexOf("https://github.com/suisui-swimmy/ChampionCreator"));
      expect(footer).toContain("使用率データ提供元: Pokemon Champions Battle Data");
      expect(footer).toContain("データ更新日:");
      expect(footer.match(/aria-current="page"/g)).toHaveLength(1);
      expect(footer.match(/app-footer-separator/g)).toHaveLength(5);
    }

    expect(appFooter).toMatch(/href="\/" aria-current="page"[^>]*>アプリ<\/a>/);
    expect(guideFooter).toMatch(/href="\/guide\/" aria-current="page"[^>]*>使い方ガイド<\/a>/);
    expect(privacyFooter).toMatch(/href="\/privacy\/" aria-current="page"[^>]*>プライバシー<\/a>/);
    expect(appFooter).toContain(`app v${appVersionInfo.appVersion} / calc ${appVersionInfo.smogonCalcVersion} / data ${appVersionInfo.localizationEntries}`);
    for (const staticFooter of [guideFooter, privacyFooter]) {
      expect(staticFooter).toContain("__CHAMPIONCREATOR_FOOTER_USAGE_DATE__");
      expect(staticFooter).toContain("__CHAMPIONCREATOR_FOOTER_VERSION__");
    }

    expect(githubIcon).toContain('<svg width="98" height="96"');
    expect(githubIcon).toContain('fill="white"');
  });

  it("publishes a static, indexable guide with a responsive real-calculation tutorial", () => {
    const guideHtml = readFileSync(new URL("../guide/index.html", import.meta.url), "utf8");
    const guideCss = readFileSync(new URL("./guide/guide.css", import.meta.url), "utf8");
    const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const robots = readFileSync(new URL("../public/robots.txt", import.meta.url), "utf8");
    const allyAbilityTipHtml = renderToStaticMarkup(<GuideAllyAbilityTip />);
    const tutorialHtml = renderToStaticMarkup(<GuideTutorial />);
    const tutorialPreset = JSON.parse(
      readFileSync(new URL("./guide/tutorial-preset.json", import.meta.url), "utf8"),
    ) as { entries: Array<{ payload: { scenarios: Array<{ attacks: Array<{ gameType: string }> }> } }> };

    expect(guideHtml).toContain("<title>ChampionCreator 使い方ガイド | ポケモンチャンピオンズ 耐久・火力・素早さ自動調整ツール</title>");
    const guideDescription = "ChampionCreatorの使い方を、調整対象と仮想敵シナリオの入力から、耐久・火力・素早さの計算、候補の適用、保存・同期まで順番に解説します";
    expect(guideHtml.match(new RegExp(`content="${guideDescription}"`, "g"))).toHaveLength(3);
    expect(guideHtml).toContain('rel="canonical" href="https://championcreator.suisui-swimmy.com/guide/"');
    expect(guideHtml).toContain('name="robots" content="index, follow, max-image-preview:large"');
    expect(guideHtml).toContain('name="championcreator-app-base" content="../"');
    expect(guideHtml).not.toContain("<base ");
    expect(guideHtml).toContain('href="#screen"');
    expect(guideHtml).toContain('href="#constant-damage"');
    expect(guideHtml).toContain('class="guide-menu-toggle"');
    expect(guideHtml).toContain('aria-controls="guide-toc-panel"');
    expect(guideHtml).toContain('src="/assets/ui/menu.svg"');
    expect(guideHtml).toContain('id="guide-toc-panel"');
    expect(guideHtml).toContain('<p class="guide-toc-label">目次</p>');
    expect(guideHtml).toContain('href="#getting-started" aria-current="location"');
    expect(guideHtml).toContain('<a href="#home-screen">ホーム画面へ追加</a>');
    expect(guideHtml).toContain('<a href="#notes">注意点</a>');
    const guideTocHtml = guideHtml.match(/<nav>[\s\S]*?<\/nav>/)?.[0] ?? "";
    const expectedGuideTocLabels = [
      "まずは使ってみよう",
      "画面の見方",
      "基本の流れ",
      "調整対象",
      "入力候補",
      "SP（能力ポイント）",
      "仮想敵シナリオ",
      "定数ダメージ・回復",
      "候補一覧",
      "保存・読み込み",
      "ブラウザ同期",
      "ホーム画面へ追加",
      "よくある困りごと",
      "注意点",
    ];
    let previousTocLabelIndex = -1;
    for (const label of expectedGuideTocLabels) {
      const labelIndex = guideTocHtml.indexOf(`>${label}</a>`);
      expect(labelIndex).toBeGreaterThan(previousTocLabelIndex);
      previousTocLabelIndex = labelIndex;
    }
    for (const heading of ["調整対象", "入力候補", "SP（能力ポイント）", "仮想敵シナリオ", "候補一覧", "ブラウザ同期"]) {
      expect(guideHtml).toContain(`<h2>${heading}</h2>`);
    }
    expect(guideHtml).toContain('<a class="guide-brand-page" href="#getting-started">使い方ガイド</a>');
    expect(guideHtml).not.toContain('class="guide-global-nav"');
    expect(guideHtml).toContain('<a class="guide-header-action" href="/">アプリを開く</a>');
    expect(guideHtml).not.toContain('href="#defence"');
    expect(guideHtml).not.toContain('href="#offense"');
    expect(guideHtml).not.toContain('href="#speed"');
    expect(guideHtml.indexOf('href="#scenarios"')).toBeLessThan(guideHtml.indexOf('href="#constant-damage"'));
    expect(guideHtml).not.toContain('class="guide-toc-help"');
    expect(guideHtml).toContain('id="guide-tutorial-root"');
    expect(guideHtml).toContain('id="guide-ally-ability-tip-root"');
    expect(guideHtml).not.toContain('class="guide-quick-steps"');
    expect(guideHtml).not.toContain("下の作業台は画像ではなく、実際のアプリと同じ計算UIです。");
    expect(guideHtml).toContain('id="constant-damage"');
    expect(guideHtml).toContain('src="/assets/guide/overview.png"');
    expect(guideHtml.indexOf('class="guide-overview-image"')).toBeLessThan(guideHtml.indexOf('class="guide-feature-list"'));
    expect(guideHtml).toContain('class="feature-mark target">①</span>');
    expect(guideHtml).toContain('class="feature-mark scenario">②</span>');
    expect(guideHtml).toContain('class="feature-mark result">③</span>');
    expect(guideHtml).toContain('class="feature-mark format">④</span>');
    expect(guideHtml).toContain('<h3>シングル／ダブル</h3>');
    expect(guideHtml).toContain('class="feature-mark sync">⑤</span>');
    expect(guideHtml).toContain('<h3>同期</h3>');
    expect(guideHtml).toContain('class="feature-mark box">⑥</span>');
    expect(guideHtml.indexOf('class="feature-mark format">④</span>')).toBeLessThan(guideHtml.indexOf('class="feature-mark sync">⑤</span>'));
    expect(guideHtml.indexOf('class="feature-mark sync">⑤</span>')).toBeLessThan(guideHtml.indexOf('class="feature-mark box">⑥</span>'));
    expect(guideHtml).not.toContain('class="guide-feature-grid"');
    expect(guideHtml).toContain('src="/assets/guide/lightbulb.svg"');
    expect(guideHtml).toContain("スマホでは？");
    expect(guideHtml).toContain("調整対象やシナリオのカードをタップすると、画面下から入力用のシートが開きます。候補一覧はメイン画面に表示され、そのまま詳細の確認や適用ができます。");
    expect(guideHtml).toContain("カードをつなぐ線は、「どちらが攻撃するか」「どちらの素早さを比べるか」を表しています。");
    expect(guideHtml).toContain('src="/assets/guide/overview_mobile.png"');
    expect(guideHtml.indexOf("どちらの素早さを比べるか")).toBeLessThan(guideHtml.indexOf('class="guide-mobile-overview-image"'));
    expect(guideHtml).not.toContain("調整対象、シナリオ、候補をタップすると");
    expect(guideHtml).toContain("画面は、主に3つの作業エリアと、3つの共通操作で構成されています。");
    expect(guideHtml).toContain("すべての条件を同時に満たすSP（能力ポイント）配分");
    expect(guideHtml).toContain("ログインしなくても、計算・保存・バックアップを利用できます。");
    const scenarioColumnText = "技Aを受けたあとに技Bも受ける場合や、同じ相手へ複数の技を使う場合に使います。耐久調整と火力調整では、攻撃を左から右へ順番に評価し、HPの変化を引き継ぎます。ダブルバトルでは、味方を追加するときにも使います。";
    const scenarioRowText = "別の相手や別の目的を追加するときは、画面下の「シナリオを追加」を使います。";
    const scenarioEvaluationText = '<p>有効になっているシナリオは、<strong>すべて同時に満たす必要があります。</strong></p>';
    expect(guideHtml).toContain(scenarioColumnText);
    expect(guideHtml).toContain(scenarioRowText);
    expect(guideHtml).toContain(scenarioEvaluationText);
    expect(guideHtml.indexOf(scenarioColumnText)).toBeLessThan(guideHtml.indexOf('src="/assets/guide/scenario-adjustment-column-addition.png"'));
    expect(guideHtml.indexOf('src="/assets/guide/scenario-adjustment-column-addition.png"')).toBeLessThan(guideHtml.indexOf(scenarioRowText));
    expect(guideHtml.indexOf(scenarioRowText)).toBeLessThan(guideHtml.indexOf('src="/assets/guide/scenario-row-addition.png"'));
    expect(guideHtml.indexOf('src="/assets/guide/scenario-row-addition.png"')).toBeLessThan(guideHtml.indexOf(scenarioEvaluationText));
    expect(guideHtml).toContain('class="guide-mode-grid guide-mode-grid--detailed" role="group" aria-label="仮想敵シナリオの調整種別"');
    expect(guideHtml.indexOf('id="defence"')).toBeLessThan(guideHtml.indexOf('id="offense"'));
    expect(guideHtml.indexOf('id="offense"')).toBeLessThan(guideHtml.indexOf('id="speed"'));
    expect(guideHtml.indexOf('id="speed"')).toBeLessThan(guideHtml.indexOf("技の威力を確認する"));
    expect(guideHtml.indexOf("技の威力を確認する")).toBeLessThan(guideHtml.indexOf('id="guide-ally-ability-tip-root"'));
    expect(guideHtml.indexOf('id="guide-ally-ability-tip-root"')).toBeLessThan(guideHtml.indexOf('id="constant-damage"'));
    expect(guideHtml).toContain("「相手のこの技を、指定した回数・確率で耐える」という条件です。");
    expect(guideHtml).toContain("「調整対象のこの技で、相手を指定した確率で倒す」という条件です。");
    expect(guideHtml).toContain("「この相手より速くする」「この相手より遅くする」という条件です。");
    expect(guideHtml).toContain("ポケモン・技・特性・持ち物の入力欄に文字を入力、または「&gt;」ボタンを押すと、入力候補が表示されます。");
    expect(guideHtml).toContain('href="https://championsbattledata.com/" target="_blank" rel="noreferrer">Pokemon Champions Battle Data</a>の使用率データを参考に並び替えます。');
    expect(guideHtml).toContain("使用率データの取得後にポケモンを候補から選ぶと、その形式で最上位かつ、そのポケモンで有効な技・性格・特性・持ち物を初期入力します。");
    expect(guideHtml).toContain("技は変化技を除外し、ランキング内で最上位の物理技または特殊技を入力します。");
    expect(guideHtml).toContain("確定済みのメガシンカ後の特性だけは、使用率データの取得状況や順位に関係なく、そのフォームで唯一の特性を入力します。");
    expect(guideHtml).toContain("現行データで未確定のメガヒードラン、メガダークライ、メガジガルデ、メガグソクムシャ、メガマギアナ、メガゼラオラ、メガシャリタツ、メガセグレイブは、特性を自動入力せず空欄を維持し、ドロップダウンにはメガシンカ前の特性候補を表示します。");
    expect(guideHtml).toContain("メガルカリオZの「はどうのぼうご」は、接触技で受けるダメージを半減する効果として暫定対応しています。");
    expect(guideHtml).not.toContain("最上位が変化技の場合はその技が入る");
    expect(guideHtml).toContain("空欄または、現在値が直前のポケモンにおける同形式の1位と一致する欄だけを更新するため、別の値へ手動変更した欄は残ります。");
    expect(guideHtml).toContain("形式や調整種別を切り替えただけでは既存入力を変更せず、その後にポケモンを候補から選んだ時点で新しい基準を使います。");
    expect(guideHtml).toContain("対応するメガストーンがある姿では、使用率1位の持ち物より対応石を優先します。");
    expect(guideHtml).toContain("個体値は全能力31固定で計算します。現在、個体値を変更する入力欄はありません。");
    expect(guideHtml).not.toContain("レベル、性格、SP、個体値");
    expect(guideHtml).toContain("現在HPで威力が変わる技は、ロック中に各攻撃時点のHPから自動計算されます。");
    expect(guideHtml).toContain("攻撃カード下部の「定数ダメージ・回復」を開き、「効果を追加」から計算に含めたい効果を選んでください。");
    expect(guideHtml).toContain("持ち物・状態・天候を入力しても、それに対応する定数ダメージや回復は、この欄へ自動では追加されません。");
    expect(guideHtml).toContain("調整対象ボックスへの保存は行われません。");
    expect(guideHtml).toContain("ChampionCreatorには、作業中の下書き、2種類のボックス、JSONバックアップがあります。");
    expect(guideHtml).toContain("迷った場合はこの方法が安全です。");
    expect(guideHtml).toContain("同期に失敗しても、ブラウザ内の保存やJSONバックアップはそのまま利用できます。");
    expect(guideHtml).toContain("アドレスバーに表示されるインストールアイコンから追加します。");
    expect(guideHtml).toContain("シナリオを1つずつ無効にし、候補が出なくなる条件を特定する");
    expect(guideHtml).toContain("計算方式、対応している効果、未対応範囲、保存・同期の詳しい仕様は、");
    expect(guideHtml).toContain('href="https://github.com/suisui-swimmy/ChampionCreator#readme"');
    expect(guideHtml).toContain("<code>@smogon/calc</code>");
    for (const technicalDetail of ["Firestore", "Worker", "outbox", "tombstone", "HBD/(B+D)", "Showdown EV", "userId + deviceId"]) {
      expect(guideHtml).not.toContain(technicalDetail);
    }
    expect(guideHtml).toContain('class="guide-notes-list"');
    expect(guideHtml).toContain("ログインしない場合、ボックスと下書きは基本的に現在のブラウザ内へ保存されます。");
    expect(guideHtml).toContain('src="/src/guide/main.tsx"');
    const guideOverviewImage = readFileSync(new URL("../public/assets/guide/overview.png", import.meta.url));
    expect(guideOverviewImage.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(guideOverviewImage.readUInt32BE(16)).toBe(1905);
    expect(guideOverviewImage.readUInt32BE(20)).toBe(2249);
    const guideMobileOverviewImage = readFileSync(new URL("../public/assets/guide/overview_mobile.png", import.meta.url));
    expect(guideMobileOverviewImage.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(guideMobileOverviewImage.readUInt32BE(16)).toBe(1179);
    expect(guideMobileOverviewImage.readUInt32BE(20)).toBe(2218);
    const guideScenarioColumnImage = readFileSync(new URL("../public/assets/guide/scenario-adjustment-column-addition.png", import.meta.url));
    expect(guideScenarioColumnImage.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(guideScenarioColumnImage.readUInt32BE(16)).toBe(1045);
    expect(guideScenarioColumnImage.readUInt32BE(20)).toBe(390);
    const guideScenarioRowImage = readFileSync(new URL("../public/assets/guide/scenario-row-addition.png", import.meta.url));
    expect(guideScenarioRowImage.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(guideScenarioRowImage.readUInt32BE(16)).toBe(820);
    expect(guideScenarioRowImage.readUInt32BE(20)).toBe(1139);
    const guideTipIcon = readFileSync(new URL("../public/assets/guide/lightbulb.svg", import.meta.url), "utf8");
    expect(guideTipIcon).toContain("<svg");
    expect(guideTipIcon).toContain('stroke="#00FF72"');
    const guideAlertIcon = readFileSync(new URL("../public/assets/guide/triangle-alert.svg", import.meta.url), "utf8");
    expect(guideAlertIcon).toContain('viewBox="0 0 24 24"');
    expect(guideAlertIcon).toContain('stroke="#f7d447"');
    const importantTipIndex = guideHtml.indexOf('class="guide-tip guide-important-tip"');
    const alertIconIndex = guideHtml.indexOf('src="/assets/guide/triangle-alert.svg"', importantTipIndex);
    const importantLabelIndex = guideHtml.indexOf("<strong>重要</strong>", importantTipIndex);
    expect(importantTipIndex).toBeGreaterThan(-1);
    expect(alertIconIndex).toBeGreaterThan(importantTipIndex);
    expect(alertIconIndex).toBeLessThan(importantLabelIndex);
    const guideAllyAbilityImage = readFileSync(new URL("../public/assets/guide/double-battle-ally-abilities.png", import.meta.url));
    expect(guideAllyAbilityImage.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(guideAllyAbilityImage.readUInt32BE(16)).toBe(871);
    expect(guideAllyAbilityImage.readUInt32BE(20)).toBe(548);
    expect(allyAbilityTipHtml).toContain('class="guide-tip-icon"');
    expect(allyAbilityTipHtml).toContain("ダブルバトルの味方特性");
    expect(allyAbilityTipHtml).toContain("ダブルバトルでは、同じシナリオに味方を追加し、そのポケモンの特性による補正を計算へ含められます。");
    expect(allyAbilityTipHtml).toContain("ヘッダーを「ダブル」に切り替え、同じシナリオ内の「＋」から味方を追加して、ポケモンと特性を選択してください。");
    expect(allyAbilityTipHtml).toContain('class="guide-ability-disclosure-trigger"');
    expect(allyAbilityTipHtml).toContain('data-state="closed"');
    expect(allyAbilityTipHtml).toContain("対応している味方特性");
    expect(allyAbilityLabels).toEqual([
      "わざわいのつるぎ",
      "わざわいのたま",
      "わざわいのおふだ",
      "わざわいのうつわ",
      "フラワーギフト",
      "バッテリー",
      "パワースポット",
      "はがねのせいしん",
      "フェアリーオーラ",
      "ダークオーラ",
      "オーラブレイク",
      "プラス",
      "マイナス",
      "フレンドガード",
    ]);
    expect(allyAbilityTipHtml).toContain('src="/assets/guide/double-battle-ally-abilities.png"');
    expect(allyAbilityTipHtml.indexOf("対応している味方特性")).toBeLessThan(allyAbilityTipHtml.indexOf('class="guide-ally-ability-image"'));
    const guideStructuredDataMatch = guideHtml.match(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/);
    expect(guideStructuredDataMatch).not.toBeNull();
    const guideStructuredData = JSON.parse(guideStructuredDataMatch?.[1] ?? "{}");
    expect(guideStructuredData["@graph"]).toEqual(expect.arrayContaining([
      expect.objectContaining({ "@type": "TechArticle" }),
      expect.objectContaining({ "@type": "BreadcrumbList" }),
    ]));
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-page \.app-shell--tutorial \.workbench\s*\{[^}]*display:\s*block;/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-menu-toggle\s*\{[^}]*display:\s*inline-grid;/s);
    expect(guideCss).toMatch(/\.guide-menu-open \.guide-toc\s*\{[^}]*visibility:\s*visible;/s);
    expect(guideCss).toMatch(/\.guide-page \.app-shell--tutorial \.results-panel\s*\{[^}]*top:\s*60px;[^}]*height:\s*calc\(100dvh - 60px\);/s);
    expect(guideCss).toMatch(/\.guide-intro h1\s*\{[^}]*font-size:\s*clamp\(23px, 2\.4vw, 32px\);/s);
    expect(guideCss).toMatch(/body\.guide-page\s*\{[^}]*font-size:\s*14px;/s);
    expect(guideCss).toMatch(/\.guide-header-action\s*\{[^}]*min-height:\s*36px;[^}]*font-size:\s*12px;/s);
    expect(guideCss).toMatch(/\.guide-reset-button\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;[^}]*min-height:\s*36px;/s);
    expect(guideCss).toMatch(/\.guide-reset-button img\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;/s);
    expect(guideCss).toMatch(/\.guide-lead\s*\{[^}]*max-width:\s*none;[^}]*margin:\s*14px 0 16px;/s);
    expect(guideCss).toMatch(/\.guide-overview-image\s*\{[^}]*width:\s*100%;[^}]*height:\s*auto;/s);
    expect(guideCss).toMatch(/\.guide-feature-list\s*\{[^}]*list-style:\s*none;/s);
    expect(guideCss).toMatch(/\.guide-feature-list p\s*\{[^}]*font-size:\s*14px;/s);
    expect(guideCss).toContain(".feature-mark.target { color: var(--guide-yellow); }");
    expect(guideCss).toContain(".feature-mark.format { color: var(--guide-magenta); }");
    expect(guideCss).toContain("--guide-blue: #6EA8FF;");
    expect(guideCss).toContain(".feature-mark.sync { color: var(--guide-blue); }");
    expect(guideCss).toMatch(/\.guide-tip-heading\s*\{[^}]*display:\s*flex;/s);
    expect(guideCss).toMatch(/\.guide-mobile-overview-image\s*\{[^}]*width:\s*min\(100%, 320px\);[^}]*height:\s*auto;/s);
    expect(guideCss).toMatch(/\.guide-ability-disclosure-trigger\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*var\(--desktop-control-comfort\);[^}]*font-size:\s*var\(--desktop-text-control\);[^}]*cursor:\s*pointer;/s);
    expect(guideCss).toMatch(/\.guide-ability-disclosure-trigger\[data-state="open"\] \.guide-disclosure-chevron\s*\{[^}]*transform:\s*rotate\(90deg\);/s);
    expect(guideCss).toMatch(/\.guide-ally-ability-image\s*\{[^}]*width:\s*min\(100%, 720px\);[^}]*height:\s*auto;/s);
    expect(guideCss).toMatch(/\.guide-scenario-image\s*\{[^}]*width:\s*min\(100%, 720px\);[^}]*height:\s*auto;/s);
    expect(guideCss).toMatch(/\.guide-scenario-row-image\s*\{[^}]*width:\s*min\(100%, 520px\);/s);
    expect(guideCss).toMatch(/\.guide-mode-grid\s*\{[^}]*margin-top:\s*28px;/s);
    expect(guideCss).toMatch(/\.guide-mode-grid--detailed\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
    expect(guideCss).toMatch(/\.guide-mode-section p\s*\{[^}]*font-size:\s*14px;/s);
    expect(guideCss).toMatch(/\.guide-tutorial-steps\s*\{[^}]*grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\);[^}]*gap:\s*8px;[^}]*padding:\s*10px;/s);
    expect(guideCss).toMatch(/\.guide-tutorial-steps li\s*\{[^}]*min-height:\s*56px;[^}]*border:\s*1px solid var\(--guide-border\);[^}]*font-size:\s*13px;/s);
    expect(guideCss).toMatch(/\.guide-tutorial-steps span\s*\{[^}]*width:\s*30px;[^}]*height:\s*30px;[^}]*font-size:\s*12px;/s);
    expect(guideCss).toMatch(/\.guide-tutorial-steps li\.active\s*\{[^}]*border-color:\s*rgba\(247, 212, 71, 0\.72\);[^}]*background:\s*rgba\(247, 212, 71, 0\.09\);/s);
    expect(guideCss).toMatch(/\.guide-tutorial-steps li\.complete\s*\{[^}]*border-color:\s*rgba\(0, 255, 114, 0\.38\);[^}]*background:\s*rgba\(0, 255, 114, 0\.04\);/s);
    expect(guideCss).toMatch(/\.guide-tutorial-message span\s*\{[^}]*font-size:\s*12px;/s);
    expect(guideCss).toMatch(/\.guide-tutorial-message p\s*\{[^}]*font-size:\s*13px;/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-tutorial-steps\s*\{[^}]*overflow-x:\s*visible;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-tutorial-steps li:not\(:last-child\)::after\s*\{[^}]*display:\s*none;/s);
    expect(guideCss).not.toMatch(/\.guide-tutorial-steps\s*\{[^}]*overflow-x:\s*auto;/s);
    expect(guideHtml).toContain('table aria-label="SPの上限と表示内容"');
    expect(guideHtml).toContain("<tr><td>各能力に使えるSP</td><td>0〜32</td></tr>");
    expect(guideHtml).toContain("<tr><td>6能力の合計SP</td><td>66まで</td></tr>");
    expect(guideHtml).toContain("<tr><td>使用SP</td><td>その候補で使用するSPの合計</td></tr>");
    expect(guideHtml).toContain("<tr><td>残りSP</td><td>上限66から使用SPを引いた値</td></tr>");
    expect(guideCss).toMatch(/\.guide-inline-action\s*\{[^}]*min-height:\s*var\(--desktop-control-standard\);/s);
    expect(guideCss).toMatch(/\.guide-prose-list\s*\{[^}]*margin-top:\s*12px;[^}]*margin-bottom:\s*18px;/s);
    expect(guideCss).toMatch(/\.guide-troubleshooting-list,\s*\.guide-notes-list\s*\{[^}]*padding-left:\s*20px;[^}]*font-size:\s*14px;/s);
    expect(guideCss).toMatch(/\.guide-toc nav a\s*\{[^}]*min-height:\s*36px;[^}]*font-size:\s*13px;/s);
    expect(guideCss).toMatch(/\.guide-flow-list p\s*\{[^}]*font-size:\s*12px;/s);
    expect(guideCss).toMatch(/\.guide-flow-list strong\s*\{[^}]*font-size:\s*13px;/s);
    expect(guideCss).toMatch(/\.guide-table-wrap table\s*\{[^}]*font-size:\s*12px;/s);
    expect(guideCss).toMatch(/\.guide-table-wrap th\s*\{[^}]*font-size:\s*11px;/s);
    expect(guideCss).toMatch(/\.guide-layout\s*\{[^}]*grid-template-columns:\s*220px minmax\(0, 1fr\);/s);
    expect(guideHtml).toContain("<h3>候補が出ない</h3>");
    expect(guideHtml).toContain("<h3>実際のゲーム内結果と違う</h3>");
    expect(guideHtml).not.toContain("<details");
    expect(guideHtml).not.toContain('class="guide-context"');
    expect(guideHtml).not.toContain('id="guide-version"');
    expect(guideHtml).toContain('class="app-footer"');
    expect(guideHtml).toContain("不具合報告");
    expect(guideHtml).toContain('aria-label="お問い合わせ: X @peixe0307"');
    expect(guideHtml).toContain('href="https://github.com/suisui-swimmy/ChampionCreator"');
    expect(guideHtml).toContain('aria-label="ChampionCreator GitHub リポジトリ"');
    expect(guideHtml).toContain('src="/assets/social/github-invertocat-white.svg"');
    expect(tutorialHtml).toContain("サンプル入力で計算してみよう");
    expect(tutorialHtml).toContain("このサンプルは実際に操作できます。");
    expect(tutorialHtml).toContain("メガマフォクシーのダブル向け調整例です。技・特性・持ち物の入力候補はダブル基準で表示します。");
    expect(tutorialHtml).toContain("チュートリアル内の変更内容・計算結果は保存・同期されません。");
    expect(guideTutorialSuggestionFormat).toBe("Doubles");
    expect(guideTutorialUsagePokemonAliases).toEqual({
      "Delphox-Mega": "Delphox",
      "Gengar-Mega": "Gengar",
    });
    expect(resolveUsageSuggestionOwner("Delphox-Mega", guideTutorialUsagePokemonAliases)).toBe("Delphox");
    expect(resolveUsageSuggestionOwner("Kingambit", guideTutorialUsagePokemonAliases)).toBe("Kingambit");
    expect(tutorialPreset.entries.flatMap((entry) => (
      entry.payload.scenarios.flatMap((scenario) => scenario.attacks.map((attack) => attack.gameType))
    ))).toEqual(["doubles", "doubles", "doubles"]);
    expect(appSource).toContain("const activeUsageData = usageData === undefined");
    expect(appSource).not.toContain('const activeUsageData = variant === "tutorial"');
    expect(appSource).toMatch(/useEffect\(\(\) => \{\s*if \(usageData !== undefined\)/);
    expect(tutorialHtml).toContain("入力内容を確認する");
    expect(tutorialHtml).toContain("候補の詳細を見る");
    expect(getTutorialMessage("idle", false)).toBe("必要な条件は、あらかじめ入力されています。まずは「計算開始」を押してください。");
    expect(getTutorialMessage("running", false)).toBe("条件に合うSP配分を探索しています。計算が完了するまで、そのままお待ちください。");
    expect(getTutorialMessage("complete", false)).toBe("候補を1つ開き、各条件の「PASS」表示とダメージ詳細を確認してみましょう。");
    expect(getTutorialMessage("complete", true)).toBe("上部の「調整対象」を確認してください。選んだ候補のSP配分が反映されています。");
    expect(tutorialHtml).toContain("必要な条件は、あらかじめ入力されています。まずは「計算開始」を押してください。");
    expect(tutorialHtml).not.toContain("作業台の「計算開始」");
    expect(tutorialHtml).not.toContain("添付バックアップの3条件を、本体と同じ計算経路で同時評価します。");
    expect(tutorialHtml).not.toContain('class="guide-open-app-button"');
    expect(tutorialHtml).toContain('aria-label="サンプルに戻す"');
    expect(tutorialHtml).toContain('assets/ui/refresh-ccw.svg');
    expect(tutorialHtml).toContain('class="app-shell app-shell--tutorial"');
    expect(tutorialHtml).toContain('value="メガマフォクシー"');
    expect(tutorialHtml).toContain('value="ドドゲザン"');
    expect(tutorialHtml).toContain('value="ふいうち"');
    expect(tutorialHtml).toContain('value="メガゲンガー"');
    expect(tutorialHtml).toContain('value="サイコキネシス"');
    expect(tutorialHtml).not.toContain('class="topbar"');
    expect(tutorialHtml).not.toContain('aria-label="バトル形式とサジェスト基準"');
    expect(tutorialHtml).not.toContain('class="app-footer"');
    expect(robots).toContain("Sitemap: https://championcreator.suisui-swimmy.com/sitemap.xml");
  });

  it("keeps guide and privacy mobile navigation and prose in the shared size system", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const guideCss = readFileSync(new URL("./guide/guide.css", import.meta.url), "utf8");
    const guideHtml = readFileSync(new URL("../guide/index.html", import.meta.url), "utf8");
    const privacyHtml = readFileSync(new URL("../privacy/index.html", import.meta.url), "utf8");

    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-header-action\s*\{[^}]*min-height:\s*var\(--mobile-control-standard\);[^}]*font-size:\s*var\(--mobile-text-interactive-small\);/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-menu-toggle\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;[^}]*flex:\s*0 0 36px;/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-menu-toggle img\s*\{[^}]*width:\s*20px;[^}]*height:\s*20px;/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-toc nav a\s*\{[^}]*min-height:\s*var\(--mobile-control-comfort\);[^}]*font-size:\s*var\(--mobile-text-control\);/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-lead\s*\{[^}]*font-size:\s*15px;/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-section > p:not\(\.guide-section-kicker\),[\s\S]*?\.guide-notes-list\s*\{[^}]*font-size:\s*14px;/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-tip strong,[\s\S]*?\.guide-ability-disclosure-content ul\s*\{[^}]*font-size:\s*var\(--mobile-text-interactive-small\);/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-ability-disclosure-trigger\s*\{[^}]*min-height:\s*var\(--mobile-control-comfort\);[^}]*font-size:\s*var\(--mobile-text-control\);/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-table-wrap table\s*\{[^}]*font-size:\s*12px;/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-table-wrap th\s*\{[^}]*font-size:\s*11px;/s);
    expect(css).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.app-footer-links \.app-footer-contact,[\s\S]*?\.app-footer-source-link\s*\{[^}]*min-height:\s*var\(--mobile-control-standard\);[^}]*font-size:\s*var\(--mobile-text-interactive-small\);/s);
    expect(guideCss).toMatch(/\.guide-page > \.app-footer\s*\{[^}]*width:\s*min\([\s\S]*?var\(--desktop-page-gutter\)[\s\S]*?1540px[\s\S]*?\);[^}]*margin-inline:\s*auto;/s);
    expect(guideCss).toMatch(/@media \(max-width: 1180px\)[\s\S]*?\.guide-page > \.app-footer\s*\{[^}]*width:\s*min\([\s\S]*?var\(--stacked-page-max-width\)[\s\S]*?\);/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-page > \.app-footer\s*\{[^}]*width:\s*min\([\s\S]*?var\(--mobile-page-max-width\)[\s\S]*?\);/s);
    expect(guideCss).toMatch(/\.guide-page \.app-footer-contact\s*\{[^}]*color:\s*rgba\(238, 241, 237, 0\.7\);/s);
    expect(guideCss).toMatch(/\.guide-page \.app-footer-contact:hover,[\s\S]*?\.guide-page \.app-footer-contact:focus-visible\s*\{[^}]*color:\s*var\(--text\);/s);
    expect(guideCss).toMatch(/\.guide-page \.app-footer-contact\[aria-current="page"\]\s*\{[^}]*color:\s*var\(--gold\);/s);
    expect(guideCss).toMatch(/@media \(max-width: 380px\)[\s\S]*?\.guide-page > \.app-footer\s*\{[^}]*width:\s*min\([\s\S]*?var\(--narrow-page-gutter\)[\s\S]*?\);/s);
    expect(guideCss).not.toContain(".guide-page > .app-footer .app-footer-contact");

    for (const html of [guideHtml, privacyHtml]) {
      expect(html).toContain('class="guide-header"');
      expect(html).toContain('class="guide-header-action"');
      expect(html).toContain('class="guide-menu-toggle"');
      expect(html).toContain('class="guide-toc"');
    }
    expect(privacyHtml).toContain('<body class="guide-page privacy-page">');
    expect(privacyHtml).toContain('aria-label="プライバシーメニューを開く"');
  });

  it("splits the static-page brand into an app logo link and a page-top link", () => {
    const guideHtml = readFileSync(new URL("../guide/index.html", import.meta.url), "utf8");
    const privacyHtml = readFileSync(new URL("../privacy/index.html", import.meta.url), "utf8");
    const guideCss = readFileSync(new URL("./guide/guide.css", import.meta.url), "utf8");

    for (const [html, pageLabel, pageTopHref] of [
      [guideHtml, "使い方ガイド", "#getting-started"],
      [privacyHtml, "プライバシー", "#overview"],
    ] as const) {
      const brand = html.match(/<div class="guide-brand">[\s\S]*?<\/div>/)?.[0] ?? "";
      expect(brand).toContain('<a class="guide-brand-home" href="/" aria-label="ChampionCreatorを開く">');
      expect(brand).toContain('<img src="/assets/brand/championcreator-title.svg" alt="ChampionCreator" />');
      expect(brand).toContain(`<a class="guide-brand-page" href="${pageTopHref}">${pageLabel}</a>`);
      expect(brand.match(/href="\/"/g)).toHaveLength(1);
      expect(brand).not.toContain("<span>");
      expect(html).not.toContain('<a class="guide-brand" href="/"');
    }

    expect(guideCss).toMatch(/\.guide-brand-page\s*\{[^}]*min-height:\s*var\(--desktop-control-standard\);[^}]*padding-left:\s*14px;/s);
    expect(guideCss).toMatch(/\.guide-brand-page::before\s*\{[^}]*height:\s*18px;[^}]*background:\s*var\(--guide-border\);/s);
    expect(guideCss).toMatch(/\.guide-brand-home:focus-visible,[\s\S]*?\.guide-brand-page:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--guide-yellow\);/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.guide-brand-page\s*\{[^}]*min-height:\s*var\(--mobile-control-standard\);[^}]*padding-left:\s*8px;[^}]*font-size:\s*11px;/s);
    expect(guideCss).toMatch(/@media \(max-width: 440px\)[\s\S]*?\.guide-brand-page\s*\{[^}]*display:\s*none;/s);
    expect(guideCss).toMatch(/@media \(max-width: 380px\)[\s\S]*?\.guide-brand img\s*\{[^}]*width:\s*min\(150px, 46vw\);/s);
  });

  it("keeps official dropdown candidates while hiding CAP and calc-only entries", () => {
    const hasOption = (kind: EntityKind, input: string, value: string) => (
      getDropdownEntityOptions(kind, input).some((option) => option.value === value)
    );

    expect(hasOption("move", "じしん", "じしん")).toBe(true);
    expect(hasOption("type", "ほのお", "ほのお")).toBe(true);
    expect(hasOption("item", "たべのこし", "たべのこし")).toBe(true);
    expect(hasOption("ability", "いかく", "いかく")).toBe(true);

    expect(hasOption("move", "(No Move)", "(No Move)")).toBe(false);
    expect(hasOption("move", "Paleo Wave", "Paleo Wave")).toBe(false);
    expect(hasOption("type", "???", "???")).toBe(false);
    expect(hasOption("item", "Crucibellite", "Crucibellite")).toBe(false);
    expect(hasOption("item", "Vile Vial", "Vile Vial")).toBe(false);
    expect(hasOption("ability", "Mountaineer", "Mountaineer")).toBe(false);
  });

  it("supports keyboard navigation and Tab selection for Pokemon suggestions", () => {
    expect(getPokemonSuggestionKeyAction("ArrowDown", 0, 2)).toEqual({ type: "move", index: 1 });
    expect(getPokemonSuggestionKeyAction("ArrowDown", 1, 2)).toEqual({ type: "move", index: 0 });
    expect(getPokemonSuggestionKeyAction("ArrowUp", 0, 2)).toEqual({ type: "move", index: 1 });
    expect(getPokemonSuggestionKeyAction("Tab", 0, 2)).toEqual({ type: "select" });
    expect(getPokemonSuggestionKeyAction("Enter", 0, 2)).toEqual({ type: "select" });
    expect(getPokemonSuggestionKeyAction("Escape", 0, 2)).toEqual({ type: "close" });
  });

  it("gives every target and scenario Pokemon field a focusable ranking trigger, including the tutorial", () => {
    const [scenario] = createDefaultScenarioForms();
    const initialScenarioForms = (["defence", "offense", "speed"] as const).map((adjustmentType, index) => ({
      ...scenario,
      id: `ranking-scenario-${index}`,
      adjustmentType,
      attacks: [scenario.attacks[0]],
    }));
    const app = renderToStaticMarkup(<App initialTargetForm={createDefaultTargetForm()} initialScenarioForms={initialScenarioForms} />);
    const tutorial = renderToStaticMarkup(<GuideTutorial />);
    for (const html of [app, tutorial]) {
      const fields = [...html.matchAll(/class="pokemon-autocomplete-field [^"]*"/g)];
      const triggers = [...html.matchAll(/<button[^>]*aria-label="[^"]*の使用率ランキングを開く"[^>]*>/g)];
      expect(fields.length).toBeGreaterThan(1);
      expect(triggers).toHaveLength(fields.length);
      for (const [trigger] of triggers) {
        expect(trigger).toContain('class="dropdown-menu-trigger"');
        expect(trigger).toContain('aria-haspopup="listbox"');
        expect(trigger).toContain('aria-expanded="false"');
        expect(trigger).not.toContain("tabindex");
        expect(trigger).not.toContain("disabled");
      }
    }
  });

  it("uses compact ranking triggers and readable input tokens in both viewport tiers", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const desktopStart = css.indexOf("@media (min-width: 721px)");
    const desktopEnd = css.indexOf("@media (min-width: 1181px)", desktopStart);
    const mobileStart = css.lastIndexOf("@media (max-width: 720px)");
    for (const [block, tier, height, font] of [
      [css.slice(desktopStart, desktopEnd), "desktop", "compact", "control"],
      [css.slice(mobileStart), "mobile", "standard", "input"],
    ]) {
      const trigger = block.match(/\.pokemon-autocomplete-field \.dropdown-menu-trigger\s*\{([^}]*)\}/)?.[1];
      const input = block.match(/\.pokemon-autocomplete-field \.dropdown-input-row input\s*\{([^}]*)\}/)?.[1];
      const icon = block.match(/\.pokemon-autocomplete-field \.disclosure-chevron\s*\{([^}]*)\}/)?.[1];
      expect(trigger).toContain(`width: var(--${tier}-control-compact);`);
      expect(trigger).toContain(`height: var(--${tier}-control-${height});`);
      expect(input).toContain(`font-size: var(--${tier}-text-${font});`);
      expect(input).toContain(`padding-right: calc(var(--${tier}-control-compact) + 8px);`);
      expect(icon).toContain(`width: var(--${tier}-icon-compact);`);
    }
  });

  it("does not mark selectable Pokemon form suggestions as unresolved", () => {
    expect(isUnresolvedEntityInput("pokemon", "イッカネズミ ３びきかぞく")).toBe(false);
    expect(isUnresolvedEntityInput("pokemon", "イッカネズミ ４ひきかぞく")).toBe(false);
    expect(isUnresolvedEntityInput("pokemon", "プルリル メスのすがた")).toBe(false);
    expect(isUnresolvedEntityInput("pokemon", "ブルンゲル メスのすがた")).toBe(false);
    expect(isUnresolvedEntityInput("pokemon", "カエンジシ メスのすがた")).toBe(false);
    expect(isUnresolvedEntityInput("pokemon", "オーガポン いしずえのめん")).toBe(false);
    expect(isUnresolvedEntityInput("pokemon", "オーガポン いしずえのかめん")).toBe(false);
    for (const input of [
      "チャデス マガイモノのすがた",
      "チャデス タカイモノのすがた",
      "ヤバソチャ ボンサクのすがた",
      "ヤバソチャ ケッサクのすがた",
      "ヤバチャ がんさくフォルム",
      "ヤバチャ しんさくフォルム",
      "ポットデス がんさくフォルム",
      "ポットデス しんさくフォルム",
    ]) {
      expect(isUnresolvedEntityInput("pokemon", input)).toBe(false);
    }
  });

  it("renders the M0 workbench sections", () => {
    const html = renderExampleApp();
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(html).toContain("ChampionCreator");
    expect(html).toContain('class="brand-line"');
    expect(html).toContain("ポケモンチャンピオンズ 耐久・火力・素早さ自動調整ツール");
    expect(html).toContain('class="topbar-meta"');
    expect(html).not.toContain("title=");
    expect(html).toContain(`app v${appVersionInfo.appVersion} / calc ${appVersionInfo.smogonCalcVersion} / data ${appVersionInfo.localizationEntries}`);
    expect(html.indexOf("ポケモンチャンピオンズ 耐久・火力・素早さ自動調整ツール")).toBeLessThan(
      html.indexOf(`app v${appVersionInfo.appVersion}`),
    );
    expect(html).not.toContain("Pokemon Champions 自動耐久調整");
    expect(html).toContain("調整対象");
    expect(html).toContain('class="target-sheet-body"');
    expect(html).toContain('class="box-access-button"');
    expect(html.match(/aria-label="調整対象ボックスを開く"/g)).toHaveLength(2);
    expect(html.match(/aria-label="仮想敵ボックスを開く"/g)).toHaveLength(2);
    expect(html).toContain('aria-expanded="false"');
    expect(html.match(/assets\/ui\/box\.svg/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).not.toContain("assets/ui/pokebox.svg");
    expect(html.match(/assets\/ui\/trash-2\.svg/g)?.length).toBeGreaterThanOrEqual(5);
    expect(html).not.toContain("assets/ui/trash.svg");
    expect(html).toContain(">レベル</span>");
    expect(html).toMatch(/class="placeholder-field target-level-field"[\s\S]*?aria-label="調整対象 レベルの固定を解除"/);
    expect(html).toMatch(/aria-label="調整対象 レベルの固定を解除"[^>]*>[\s\S]*?assets\/ui\/lock\.svg/);
    expect(html).toContain(">残りSPで耐久最大化</button>");
    expect(html).toContain(">性格変更を許可する</span>");
    expect(html).toContain('class="sp-summary-actions"');
    expect(html).toContain('class="sp-summary-total"');
    expect(html).not.toContain(">条件JSON</button>");
    expect(html).not.toContain(">コピー</button>");
    expect(html).toContain("仮想敵シナリオ");
    expect(html).toContain('aria-label="スマホ用調整ボード"');
    expect(html).toContain('aria-label="ノード接続調整ボード"');
    expect(html).toContain('aria-label="シナリオ調整種別"');
    expect(html).toContain('class="mobile-target-heading"');
    expect(html).toContain('class="box-access-button mobile-box-access-button"');
    expect(html).not.toContain('class="mobile-board-heading-actions"');
    expect(html.match(/>追加<\/button>/g)).toHaveLength(2);
    expect(html).not.toContain("攻撃は横スクロール");
    expect(html).toContain('class="mobile-scenario-flow-list"');
    expect(html).toContain('class="mobile-scenario-flow-row defence"');
    expect(html).toContain('class="mobile-flow-edge-layer"');
    expect(html).toContain('aria-label="シナリオ調整種別エッジ"');
    expect(html).not.toContain('class="mobile-flow-label"');
    expect(html).not.toContain('class="mobile-flow-edge-arrow"');
    expect(html).not.toContain('class="mobile-flow-edge-start-node"');
    expect(html).not.toContain('class="mobile-flow-edge-end-node-outer"');
    expect(html).toContain('class="mobile-target-stat-meter hp"');
    expect(html).toContain('class="mobile-scenario-direction-icon"');
    expect(html).toContain('class="mobile-scenario-adjustment-row"');
    expect(html).toContain('class="mobile-scenario-state on"');
    expect(html).toContain('class="icon-button scenario-remove-button mobile-scenario-remove-button"');
    expect(html).toContain('aria-label="シナリオ1を削除"');
    expect(html).toContain('role="switch"');
    expect(html).not.toContain('class="mobile-scenario-count"');
    expect(html).toContain('class="mobile-candidate-dock"');
    expect(html).toContain('class="mobile-attack-rail"');
    expect(html).toContain('aria-label="シナリオ1 調整種別"');
    expect(html).toContain('aria-label="シナリオ2 調整種別"');
    expect(html).toContain('aria-label="シナリオ3 調整種別"');
    expect(html).toContain('class="scenario-row defence"');
    expect(html).toContain('class="scenario-row offense"');
    expect(html).toContain('class="scenario-row speed"');
    expect(html).toContain(">耐久調整</span>");
    expect(html).toContain(">火力調整</span>");
    expect(html).toContain(">素早さ調整</span>");
    expect(html).toContain('value="耐久調整A"');
    expect(html).toContain('value="火力調整A"');
    expect(html).toContain('value="素早さ調整A"');
    expect(html).toContain(">確定抜き</span>");
    expect(html).toContain(">任意S値</span>");
    expect(html).toContain(">素早さ条件</h3>");
    expect(html).toContain('aria-label="素早さ調整A 確定抜き差分値"');
    expect(html).toContain('class="ui-stepper number-stepper speed-offset-input"');
    expect(html).not.toContain('class="number-stepper speed-offset-input"');
    expect(html).toContain('aria-label="素早さ調整A 確定抜き差分値を1下げる"');
    expect(html).toContain('aria-label="素早さ調整A 確定抜き差分値を1上げる"');
    expect(html).toContain(">共通S条件</h3>");
    expect(html).toContain(">相手S条件</h3>");
    expect(html).toContain(">調整対象S条件</h3>");
    expect(html).not.toContain("調整対象Sランク");
    expect(html).toContain(">状態異常</span>");
    expect(html).toContain(">行動順</span>");
    expect(html).toContain(">おいかぜ</span>");
    expect(html).not.toContain("両側の手動倍率は、選択中の持ち物・特性による自動補正を置き換えます。");
    expect(html).not.toContain("speed-manual-badge");
    expect(html).not.toContain("speed-override-summary");
    expect(html).not.toContain("speed-source-overridden");
    expect(html.match(/>自動<\/span>/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain('aria-label="素早さ調整A 共通S条件 行動順"');
    expect(html).toContain('aria-label="素早さ調整A 相手S条件 状態異常"');
    expect(html).toContain('aria-label="素早さ調整A 調整対象S条件 状態異常"');
    expect(html).toContain('aria-label="素早さ調整A 任意S値"');
    expect(css).toMatch(/\.speed-multiplier-control\.is-manual \.select-trigger\s*\{[^}]*border-color:\s*var\(--gold-line\);/s);
    expect(css).toMatch(/\.select-trigger-has-badge\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto 14px;/s);
    expect(css).toMatch(/\.speed-source-overridden:not\(\.is-invalid\) \.dropdown-input-row input\s*\{[^}]*border-color:\s*var\(--gold-line\);/s);
    expect(css).toMatch(/\.speed-source-overridden:not\(\.is-invalid\) \.dropdown-input-row input\s*\{[^}]*color:\s*#7f8987;/s);
    expect(css).not.toContain(".speed-source-overridden:not(.is-invalid) .dropdown-input-row::before");
    expect(css).toMatch(/\.mobile-scenario-flow-row\.trick-room \.mobile-scenario-summary\.speed\s*\{[^}]*border-color:\s*rgba\(181, 108, 255, 0\.64\);/s);
    expect(html).not.toContain(">技補正</span>");
    expect(html).not.toContain("speed-tailwind-toggle");
    expect(html).toContain('class="scenario-cell number-cell number-labeled-field speed-manual-target-input"');
    expect(html).toContain('inputMode="numeric"');
    expect(html.match(/>任意S値<\/span>/g)).toHaveLength(1);
    expect(html).not.toContain("同速以上");
    expect(html).not.toContain(">目標S<");
    expect(html).not.toContain(">S条件</h3>");
    expect(html).toContain('value="90"');
    expect(html).toContain('value="80"');
    expect(html).toContain('value="メガゲンガー"');
    expect(html).toContain("assets/ui/arrow-left-circle.svg");
    expect(html).toContain("assets/ui/arrow-right-circle.svg");
    expect(html).not.toMatch(/<img[^>]+assets\/ui\/arrow-(?:left|right|up|down)-circle\.svg/);
    expect(html).toContain('class="attack-direction-icon"');
    expect(html).toContain('aria-label="耐久調整A 耐久調整。クリックで火力調整に切り替え"');
    expect(html).toContain('aria-label="火力調整A 火力調整。クリックで素早さ調整に切り替え"');
    expect(html).toContain('aria-label="素早さ調整A 素早さ調整。クリックで耐久調整に切り替え"');
    expect(html).toContain("assets/ui/arrow-up-circle.svg");
    expect(html).not.toContain("assets/ui/arrow-down-circle.svg");
    expect(html.match(/>定数ダメージ・回復<\/span>/g)).toHaveLength(2);
    expect(html.match(/>追加する効果<\/span>/g)).toHaveLength(2);
    expect(html.match(/>追加<\/button>/g)).toHaveLength(2);
    expect(html).not.toContain('aria-label="Sライン結果"');
    expect(html).toContain("シナリオを追加");
    expect(html).toContain('aria-label="探索操作"');
    expect(html).toMatch(/class="mobile-progress-line" role="progressbar" aria-label="探索進捗" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"/);
    expect(html).toMatch(/class="mobile-progress-line"[^>]*>[\s\S]*?<span style="width:0%" aria-hidden="true"><\/span>/);
    expect(html).toContain('class="mobile-search-counts"');
    expect(html).toContain("評価 0/-");
    expect(html).toContain("合格 0");
    expect(html).not.toContain("0% / 評価");
    expect(html).toContain(">キャンセル<");
    expect(html).toContain(">計算開始<");
    expect(html).toContain("候補一覧");
    expect(html).toContain("計算結果");
    expect(html).not.toContain("計算開始で Worker 経由の候補がここに出ます");
    expect(html).toContain('aria-label="サイトフッター"');
    expect(html).toContain("© 2026 suisui-swimmy");
    expect(html).toContain("本ツールは非公式のファンツールであり、画像、名称などに関する著作権は 任天堂 / クリーチャーズ / ゲームフリーク に帰属します");
    expect(html).toContain('class="app-footer-links app-footer-page-links"');
    expect(html).toContain('class="app-footer-links app-footer-support-links"');
    expect(html).toContain('class="app-footer-version"');
    expect(html).toContain('role="radiogroup" aria-label="バトル形式とサジェスト基準"');
    expect(html).toContain('aria-label="シングル"');
    expect(html).toContain('aria-label="ダブル"');
    expect(html).toContain("assets/ui/single.svg");
    expect(html).toContain("assets/ui/double.svg");
    expect(html).toContain('href="https://championsbattledata.com/"');
    expect(html).toContain("Pokemon Champions Battle Data");
    expect(html).toContain("データ更新日: 未取得");
    expect(html).not.toContain("ゲームフリーク に帰属します。");
    expect(html).toContain('href="https://docs.google.com/forms/d/e/1FAIpQLSdTUyrAmTwrcarMfMt56RrcwH_g4r4WhowW0i60HDK5BflylQ/viewform?usp=header"');
    expect(html).toContain('href="https://x.com/peixe0307"');
    expect(html).toContain('href="https://github.com/suisui-swimmy/ChampionCreator"');
    expect(html).toContain("不具合報告");
    expect(html).toContain(" | ");
    expect(html).toContain("お問い合わせ");
    expect(html).not.toContain("不具合報告 / お問い合わせ");
    expect(html).toContain("assets/social/x-logo.svg");
    expect(html).toContain('aria-label="ChampionCreator GitHub リポジトリ"');
    expect(html).toContain("assets/social/github-invertocat-white.svg");
    expect(html).not.toContain("火力ライン結果");
    expect(html).not.toContain("pokemon-artwork-meta");
    expect(html).not.toContain("将来の詳細パネル用空き領域");
    expect(html.indexOf('aria-label="探索操作"')).toBeLessThan(html.indexOf('id="results-title"'));
  });

  it("keeps speed target mode rows structured and shows a readable zero manual value", () => {
    const html = renderExampleApp();
    const modeStart = html.indexOf(
      '<div class="speed-target-mode" role="radiogroup" aria-label="素早さ調整A 素早さ条件">',
    );
    const modeEnd = html.indexOf(
      '<section class="attack-setting-section attack-setting-section--indented speed-condition-section"',
      modeStart,
    );
    expect(modeStart).toBeGreaterThanOrEqual(0);
    expect(modeEnd).toBeGreaterThan(modeStart);

    const modeHtml = html.slice(modeStart, modeEnd);
    const opponentStart = modeHtml.indexOf(
      '<div class="speed-target-mode-option speed-target-mode-primary">',
    );
    const manualStart = modeHtml.indexOf(
      '<div class="speed-target-mode-option speed-target-mode-manual">',
    );
    expect(opponentStart).toBeGreaterThanOrEqual(0);
    expect(manualStart).toBeGreaterThan(opponentStart);
    expect(modeHtml.match(/class="speed-target-mode-option/g)).toHaveLength(2);

    const opponentRowHtml = modeHtml.slice(opponentStart, manualStart);
    const manualRowHtml = modeHtml.slice(manualStart);
    for (const rowHtml of [opponentRowHtml, manualRowHtml]) {
      expect(rowHtml.match(/class="speed-target-radio-label"/g)).toHaveLength(1);
      expect(rowHtml.match(/class="speed-target-mode-control"/g)).toHaveLength(1);
      expect(rowHtml.indexOf('class="speed-target-radio-label"')).toBeLessThan(
        rowHtml.indexOf('class="speed-target-mode-control"'),
      );
    }

    expect(opponentRowHtml).toContain('class="speed-target-mode-operator" aria-hidden="true">+</span>');
    expect(opponentRowHtml).not.toContain(">差分</span>");
    expect(manualRowHtml).toContain('class="speed-target-mode-control-label">S値</span>');
    expect(modeHtml).not.toContain('tabindex="-1"');
    expect(modeHtml).not.toContain('class="speed-offset-sign"');
    expect(modeHtml).not.toMatch(/<strong>/);
    const speedStepper = assertUiStepperShape(
      opponentRowHtml,
      "number-stepper",
      'aria-label="素早さ調整A 確定抜き差分値"',
    );
    expect(opponentRowHtml.match(/class="speed-target-mode-operator"/g)).toHaveLength(1);
    expect(opponentRowHtml.indexOf('class="speed-target-mode-operator"')).toBeLessThan(speedStepper.start);
    expect(speedStepper.block).not.toContain("speed-target-mode-operator");
    expect(opponentRowHtml).toContain('class="ui-stepper number-stepper speed-offset-input"');
    expect(opponentRowHtml).not.toContain('class="number-stepper speed-offset-input"');
    expect(opponentRowHtml).toContain('aria-label="素早さ調整A 確定抜き差分値を1下げる"');
    expect(opponentRowHtml).toContain('aria-label="素早さ調整A 確定抜き差分値を1上げる"');
    expect(manualRowHtml).toContain('class="scenario-cell number-cell number-labeled-field speed-manual-target-input"');

    const manualInput = manualRowHtml.match(
      /<input(?=[^>]*aria-label="素早さ調整A 任意S値")(?=[^>]*value="0")[^>]*>/,
    )?.[0] ?? "";
    expect(manualInput).not.toBe("");
    expect(manualInput).not.toContain('disabled=""');
  });

  it("shows manual badges inside S fields and decorates the overridden source inputs", () => {
    const target = {
      ...createDefaultTargetForm(),
      itemInput: "こだわりスカーフ",
      abilityInput: "すいすい",
    };
    const scenarios = createDefaultScenarioForms().map((scenario) => scenario.adjustmentType === "speed"
      ? {
          ...scenario,
          attacks: scenario.attacks.map((attack) => ({
            ...attack,
            attackerItemInput: "こだわりスカーフ",
            attackerAbilityInput: "すいすい",
            weather: "rain" as const,
            speedItemMultiplier: "0.5" as const,
            speedAbilityMultiplier: "1.5" as const,
            speedTargetItemMultiplier: "2" as const,
            speedTargetAbilityMultiplier: "0.5" as const,
          })),
        }
      : scenario);
    const html = renderToStaticMarkup(
      <App initialTargetForm={target} initialScenarioForms={scenarios} />,
    );

    expect(html.match(/class="speed-multiplier-control is-manual"/g)).toHaveLength(4);
    expect(html.match(/class="select-trigger-value-badge"/g)).toHaveLength(4);
    expect(html.match(/class="speed-manual-badge"/g)).toHaveLength(4);
    expect(html.match(/speed-source-overridden/g)).toHaveLength(4);
    expect(html).toContain("1件の素早さ条件で持ち物のS補正を手動倍率に上書き中");
    expect(html).toContain("1件の素早さ条件で特性のS補正を手動倍率に上書き中");
    expect(html).toContain("この素早さ条件では持ち物のS補正を手動倍率に上書き中");
    expect(html).toContain("この素早さ条件では特性のS補正を手動倍率に上書き中");
    expect(html).not.toContain("speed-override-summary");
    expect(html).not.toContain("<del>");
    expect(html).not.toContain("両側の手動倍率は");
  });

  it("keeps the manual badge without inventing an automatic source", () => {
    const scenarios = createDefaultScenarioForms().map((scenario) => scenario.adjustmentType === "speed"
      ? {
          ...scenario,
          attacks: scenario.attacks.map((attack) => ({
            ...attack,
            speedTargetItemMultiplier: "1.5" as const,
          })),
        }
      : scenario);
    const html = renderToStaticMarkup(<App initialScenarioForms={scenarios} />);

    expect(html.match(/class="speed-multiplier-control is-manual"/g)).toHaveLength(1);
    expect(html.match(/class="select-trigger-value-badge"/g)).toHaveLength(1);
    expect(html.match(/class="speed-manual-badge"/g)).toHaveLength(1);
    expect(html).not.toContain("speed-override-summary");
    expect(html).not.toContain("speed-source-overridden");
  });

  it("keeps target override sources visible while the opponent is unresolved", () => {
    const target = {
      ...createDefaultTargetForm(),
      itemInput: "こだわりスカーフ",
    };
    const scenarios = createDefaultScenarioForms().map((scenario) => scenario.adjustmentType === "speed"
      ? {
          ...scenario,
          attacks: scenario.attacks.map((attack) => ({
            ...attack,
            attackerPokemonInput: "",
            speedTargetItemMultiplier: "0.5" as const,
          })),
        }
      : scenario);
    const html = renderToStaticMarkup(
      <App initialTargetForm={target} initialScenarioForms={scenarios} />,
    );

    expect(html).toContain("speed-source-overridden");
    expect(html).toContain("1件の素早さ条件で持ち物のS補正を手動倍率に上書き中");
    expect(html).not.toContain("speed-override-summary");
  });

  it("keeps common and target speed conditions visible for a manual S target", () => {
    const scenarios = createDefaultScenarioForms();
    const speedScenario = scenarios[2];
    const html = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={scenarios.map((scenario) => scenario.id === speedScenario.id
          ? {
              ...scenario,
              attacks: scenario.attacks.map((attack) => ({
                ...attack,
                speedTargetMode: "manual" as const,
                speedTargetValue: 150,
              })),
            }
          : scenario)}
      />,
    );

    expect(html).toContain(">共通S条件</h3>");
    expect(html).toContain(">調整対象S条件</h3>");
    expect(html).not.toContain(">相手S条件</h3>");
    expect(html).not.toContain("相手S能力");
    expect(html).toContain(">任意S値</span>");
  });

  it("keeps the battle format selector native, accessible, and single-first", () => {
    const html = renderToStaticMarkup(<SuggestionFormatToggle />);

    expect(html).toMatch(/role="radiogroup" aria-label="バトル形式とサジェスト基準"/);
    expect(html).toMatch(/type="radio"[^>]*checked=""[^>]*value="Singles"/);
    expect(html).toMatch(/type="radio"[^>]*value="Doubles"/);
    expect(html).toContain('aria-label="シングル"');
    expect(html).toContain('aria-label="ダブル"');
    expect(html).not.toContain("title=");
  });

  it("syncs every scenario attack to the header format while preserving individual overrides", () => {
    const [baseScenario] = createDefaultScenarioForms();
    const scenarios = [
      {
        ...baseScenario,
        attacks: [
          baseScenario.attacks[0],
          { ...baseScenario.attacks[0], id: "attack-b", label: "攻撃B" },
        ],
      },
      {
        ...baseScenario,
        id: "scenario-b",
        label: "シナリオ2",
        attacks: [{ ...baseScenario.attacks[0], id: "attack-c", label: "攻撃C" }],
      },
    ];

    const synced = syncScenarioGameTypesToSuggestionFormat(scenarios, "Doubles");
    expect(synced.flatMap((scenario) => scenario.attacks.map((attack) => attack.gameType))).toEqual([
      "doubles",
      "doubles",
      "doubles",
    ]);

    const withIndividualOverride = synced.map((scenario, scenarioIndex) => (
      scenarioIndex === 0
        ? {
            ...scenario,
            attacks: scenario.attacks.map((attack, attackIndex) => (
              attackIndex === 1 ? { ...attack, gameType: "singles" as const } : attack
            )),
          }
        : scenario
    ));
    expect(withIndividualOverride[0].attacks.map((attack) => attack.gameType)).toEqual([
      "doubles",
      "singles",
    ]);
  });

  it("applies the existing Beat Up participant limit during header synchronization", () => {
    const [baseScenario] = createDefaultScenarioForms();
    const beatUpAttack = {
      ...baseScenario.attacks[0],
      moveInput: "ふくろだたき",
      gameType: "doubles" as const,
      repeat: 4,
      requiredSurvivedHits: 4,
      beatUpParticipants: [
        { id: "attacker", source: "attacker" as const, pokemonInput: "", powerMode: "auto" as const, powerValue: 0 },
        { id: "party-1", source: "party" as const, pokemonInput: "コータス", powerMode: "auto" as const, powerValue: 0 },
        { id: "party-2", source: "party" as const, pokemonInput: "コノヨザル", powerMode: "auto" as const, powerValue: 0 },
        { id: "party-3", source: "party" as const, pokemonInput: "ピカチュウ", powerMode: "manual" as const, powerValue: 22 },
      ],
    };

    const [synced] = syncScenarioGameTypesToSuggestionFormat([
      { ...baseScenario, attacks: [beatUpAttack] },
    ], "Singles");

    expect(synced.attacks[0]).toMatchObject({
      gameType: "singles",
      repeat: 3,
      requiredSurvivedHits: 3,
    });
    expect(synced.attacks[0].beatUpParticipants).toHaveLength(3);
  });

  it("formats source update timestamps as JST dates and falls back when unavailable", () => {
    expect(formatUsageDataDateJst("2026-08-13T15:30:00Z")).toBe("2026-08-14");
    expect(formatUsageDataDateJst(undefined)).toBe("未取得");
    expect(formatUsageDataDateJst("not-a-date")).toBe("未取得");
  });

  it("uses loaded usage metadata in the footer and keeps an empty fallback unavailable", () => {
    const loadedHtml = renderToStaticMarkup(
      <App suggestionFormat="Doubles" usageData={usageDataFixture()} />,
    );
    const emptyHtml = renderToStaticMarkup(<App usageData={usageDataFixture("empty")} />);

    expect(loadedHtml).toContain("データ更新日: 2026-08-14");
    expect(loadedHtml).toMatch(/type="radio"[^>]*checked=""[^>]*value="Doubles"/);
    expect(emptyHtml).toContain("データ更新日: 未取得");
  });

  it("keeps nature usage ARIA explicit for listed, unlisted, unavailable, and real zero values", () => {
    const jolly = { label: "ようき", plus: "spe" as const, minus: "spa" as const };
    const hardy = { label: "がんばりや", plus: "atk" as const, minus: "atk" as const };

    expect(formatNatureModifierLabel(jolly)).toBe("S↑ C↓");
    expect(formatNatureModifierLabel(hardy)).toBe("補正なし");
    expect(formatNatureUsageAriaLabel(
      jolly,
      "Doubles",
      { kind: "listed", rank: 1, percentage: 66.2 },
    )).toBe("ようき｜S↑ C↓｜ダブル使用率 66.2%（1位）");
    expect(formatNatureUsageAriaLabel(
      hardy,
      "Doubles",
      { kind: "listed", rank: 10, percentage: 0 },
    )).toBe("がんばりや｜補正なし｜ダブル使用率 0.0%（10位）");
    expect(formatNatureUsageAriaLabel(
      hardy,
      "Doubles",
      { kind: "listed", rank: 10, percentage: null },
    )).toBe("がんばりや｜補正なし｜ダブル使用率 10位");
    expect(formatNatureUsageAriaLabel(
      hardy,
      "Doubles",
      { kind: "unlisted" },
    )).toBe("がんばりや｜補正なし｜ダブル使用率 上位外／データなし");
    expect(formatNatureUsageAriaLabel(
      hardy,
      "Doubles",
      { kind: "unavailable" },
    )).toBe("がんばりや｜補正なし｜使用率データなし");
    expect(getNatureUsageOverlayOpacity({ kind: "listed", rank: 1, percentage: 0 })).toBe(0);
    expect(getNatureUsageOverlayOpacity({ kind: "listed", rank: 1, percentage: null })).toBeNull();
    expect(getNatureUsageOverlayOpacity({ kind: "unlisted" })).toBeNull();
  });

  it("renders nature heatmaps for both owners while keeping tutorial matrices data-free", () => {
    const [defaultScenario] = createDefaultScenarioForms();
    const natureUsageData: ChampionsUsageData = {
      ...usageDataFixture("nature-test"),
      formats: {
        Singles: {
          Pikachu: {
            move: [],
            ability: [],
            item: [],
            nature: [
              { canonicalName: "Timid", rank: 2, percentage: 66.2 },
              { canonicalName: "Hardy", rank: 10, percentage: 0 },
            ],
          },
        },
        Doubles: {
          Pikachu: {
            move: [],
            ability: [],
            item: [],
            nature: [
              { canonicalName: "Jolly", rank: 1, percentage: 66.2 },
              { canonicalName: "Hardy", rank: 10, percentage: 0 },
            ],
          },
        },
      },
    };
    const initialTargetForm = {
      ...createDefaultTargetForm(),
      pokemonInput: "ピカチュウ",
      natureInput: "おくびょう",
    };
    const initialScenarioForms = [{
      ...defaultScenario,
      attacks: [{
        ...defaultScenario.attacks[0],
        attackerPokemonInput: "ピカチュウ",
        attackerNatureInput: "ようき",
      }],
    }];
    const html = renderToStaticMarkup(
      <App
        suggestionFormat="Doubles"
        usageData={natureUsageData}
        initialTargetForm={initialTargetForm}
        initialScenarioForms={initialScenarioForms}
      />,
    );

    // Radix portals intentionally omit the open matrix during SSR.  The
    // per-cell usage contract is covered by the pure formatting assertions
    // above; this render still guards that both owner fields remain present.
    expect(html.match(/class="nature-trigger"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="性格: おくびょう"');

    const tutorialHtml = renderToStaticMarkup(
      <App
        variant="tutorial"
        suggestionFormat="Doubles"
        usageData={natureUsageData}
        initialTargetForm={initialTargetForm}
        initialScenarioForms={initialScenarioForms}
      />,
    );

    expect(tutorialHtml).not.toContain("nature-usage-detail");
    expect(tutorialHtml).not.toContain("data-usage-kind");
    expect(tutorialHtml).not.toContain("nature-usage-opacity");
    expect(tutorialHtml.match(/class="nature-trigger"/g)).toHaveLength(2);
  });

  it("keeps usage heatmap color separate from selection and keyboard focus styles", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(css).toMatch(/\.nature-option::before\s*\{[^}]*background:\s*rgba\(32, 194, 108, 0\.72\);[^}]*opacity:\s*var\(--nature-usage-opacity, 0\);/s);
    expect(css).toMatch(/\.nature-option:hover\s*\{[^}]*border-color:[^}]*box-shadow:[^}]*color:[^}]*\}/s);
    expect(css).toMatch(/\.nature-option:focus-visible\s*\{[^}]*border-color:[^}]*box-shadow:/s);
    expect(css).toMatch(/\.nature-option\.selected\s*\{[^}]*border-color:[^}]*color:[^}]*box-shadow:/s);
    expect(css).not.toMatch(/\.nature-option:hover\s*\{[^}]*background:/s);
    expect(css).not.toMatch(/\.nature-option\.selected\s*\{[^}]*background:/s);
    expect(css).not.toContain(".nature-usage-detail");
  });

  it("keeps a compact power field beside every non-speed move input", () => {
    const html = renderExampleApp();
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(html.match(/class="attack-card-field-row attack-card-identity-row"/g)).toHaveLength(3);
    expect(html.match(/class="attack-card-field-row attack-move-power-cell"/g)).toHaveLength(2);
    expect(html.match(/class="attack-card-field-row attack-card-details-row"/g)).toHaveLength(3);
    expect(html.match(/class="attack-card-field-row attack-card-item-row"/g)).toHaveLength(3);
    expect(html.match(/class="move-power-inline-control is-readonly"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="威力 70"');
    expect(html).toContain('aria-label="威力 90"');
    expect(html).not.toContain('aria-label="素早さ調整A 威力');
    expect(css).toMatch(/\.attack-card-identity-row,\s*\.attack-move-power-cell\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/s);
    expect(css).toMatch(/\.move-power-field\s*\{[^}]*grid-template-columns:\s*minmax\(52px, max-content\) minmax\(0, 1fr\);/s);
    expect(css).toMatch(/\.mobile-scenarios-open \.move-power-field\s*\{[^}]*grid-template-columns:\s*minmax\(54px, auto\) minmax\(0, 1fr\);/s);
    expect(html).toMatch(/attack-card-identity-row[^>]*>[\s\S]*?aria-label="ポケモン"[\s\S]*?<span class="row-label">レベル<\/span>/);
    expect(html.match(/aria-label="[^"]+ レベルの固定を解除"/g)).toHaveLength(4);
    expect(html).toMatch(/class="move-power-lock-toggle is-closed" type="button" aria-label="耐久調整A レベルの固定を解除"/);
    expect(html).not.toMatch(/class="move-power-lock-toggle is-closed" type="button" tabindex="-1" aria-label="耐久調整A レベルの固定を解除"/);
    expect(html).not.toMatch(/<button type="button" tabindex="-1" aria-label="耐久調整A 威力条件を(?:上げる|下げる)/);
    expect(html).toMatch(/attack-move-power-cell[^>]*>[\s\S]*?placeholder="技"[\s\S]*?move-power-field/);
    expect(html).toMatch(/move-power-field[^>]*aria-label="耐久調整A 威力"[^>]*>[\s\S]*?<span class="move-power-label">威力<\/span>[\s\S]*?move-power-inline-control is-readonly/);
    expect(html).toMatch(/attack-card-details-row[^>]*>[\s\S]*?aria-label="性格:[^"]+"[\s\S]*?aria-label="特性候補を開く"/);
    expect(html).toMatch(/attack-card-item-row[^>]*>[\s\S]*?placeholder="持ち物"/);

    const [scenario] = createDefaultScenarioForms();
    const calculationPendingHtml = renderToStaticMarkup(
      <App
        initialTargetForm={{ ...createDefaultTargetForm(), pokemonInput: "" }}
        initialScenarioForms={[{
          ...scenario,
          attacks: scenario.attacks.map((attack) => ({
            ...attack,
            attackerPokemonInput: "",
            moveInput: "ふいうち",
          })),
        }]}
      />,
    );
    expect(calculationPendingHtml).toContain('aria-label="威力 70（基礎値・計算前）"');
  });

  it("matches the target form density to attack cards on desktop only", () => {
    const html = renderExampleApp();
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const nonMobileStart = css.indexOf("@media (min-width: 721px)");
    const desktopStart = css.indexOf("@media (min-width: 1181px)");
    const desktopEnd = css.indexOf("@media (max-width: 1180px)", desktopStart);
    const nonMobileCss = css.slice(nonMobileStart, desktopStart);
    const desktopCss = css.slice(desktopStart, desktopEnd);

    expect(html).toMatch(/class="target-summary compact"[\s\S]*?aria-label="ポケモン"[\s\S]*?aria-label="性格:[^"]+"[\s\S]*?placeholder="持ち物"[\s\S]*?aria-label="特性候補を開く"[\s\S]*?>レベル<\/span>/);
    expect(css).toMatch(/\.workbench\s*\{[^}]*grid-template-columns:\s*468px minmax\(0, 1fr\);/s);
    expect(nonMobileStart).toBeGreaterThanOrEqual(0);
    expect(desktopStart).toBeGreaterThanOrEqual(0);
    expect(desktopEnd).toBeGreaterThan(desktopStart);
    expect(desktopCss).toMatch(/\.target-identity,\s*\.target-summary\.compact\s*\{[^}]*gap:\s*6px;/s);
    expect(nonMobileCss).toMatch(/\.target-summary\.compact > \.pokemon-autocomplete-field input,[^{]*\{[^}]*height:\s*var\(--desktop-control-compact\);[^}]*padding:\s*0 7px;[^}]*font-size:\s*var\(--desktop-text-control\);/s);
    expect(nonMobileCss).toMatch(/\.target-level-field,\s*\.placeholder-field\.target-level-field\s*\{[^}]*grid-template-columns:\s*52px minmax\(0, 1fr\);[^}]*gap:\s*6px;/s);
    expect(nonMobileCss).toMatch(/\.target-level-field \.level-inline-control\s*\{[^}]*height:\s*var\(--desktop-control-compact\);/s);
    expect(nonMobileCss).toMatch(/\.target-level-field \.move-power-lock-toggle\s*\{[^}]*width:\s*var\(--desktop-control-compact\);/s);
    expect(css.slice(desktopEnd)).toMatch(/\.workbench\s*\{[^}]*grid-template-columns:\s*1fr;/s);
  });

  it("uses the power-lock design for an unlocked level in the normal Tab order", () => {
    const [scenario] = createDefaultScenarioForms();
    const html = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[{
          ...scenario,
          attacks: scenario.attacks.map((attack) => ({
            ...attack,
            attackerLevel: 73,
            attackerLevelMode: "manual" as const,
          })),
        }]}
      />,
    );

    expect(html).toContain("level-inline-control is-manual");
    expect(html).toMatch(/<input(?=[^>]*value="73")(?=[^>]*aria-label="レベル")[^>]*>/);
    expect(html).not.toMatch(/<input(?=[^>]*value="73")(?=[^>]*tabindex="-1")(?=[^>]*aria-label="レベル")[^>]*>/);
    expect(html).toContain('aria-label="耐久調整A レベルを50に戻して固定"');
    expect(html).not.toMatch(/class="move-power-lock-toggle is-open" type="button" tabindex="-1" aria-label="耐久調整A レベルを50に戻して固定"/);
    expect(html).toContain('src="/assets/ui/lock-open.svg"');
    expect(html).not.toContain('aria-label="耐久調整A レベルを50に戻して固定" disabled=""');
  });

  it("uses the same unlocked level field in the target panel", () => {
    const html = renderToStaticMarkup(
      <App
        initialTargetForm={{
          ...createDefaultTargetForm(),
          level: 73,
          levelMode: "manual",
        }}
        initialScenarioForms={createDefaultScenarioForms()}
      />,
    );

    expect(html).toMatch(/class="placeholder-field target-level-field"[\s\S]*?level-inline-control is-manual/);
    expect(html).toMatch(/<input(?=[^>]*value="73")(?=[^>]*aria-label="レベル")[^>]*>/);
    expect(html).not.toMatch(/<input(?=[^>]*value="73")(?=[^>]*tabindex="-1")(?=[^>]*aria-label="レベル")[^>]*>/);
    expect(html).toContain('aria-label="調整対象 レベルを50に戻して固定"');
    expect(html).not.toMatch(/class="move-power-lock-toggle is-open" type="button" tabindex="-1" aria-label="調整対象 レベルを50に戻して固定"/);
    expect(html).not.toContain('aria-label="調整対象 レベルを50に戻して固定" disabled=""');
  });

  it("shows assisted and HP-dependent powers through the same compact field", () => {
    const [scenario] = createDefaultScenarioForms();
    const lastRespectsScenario = {
      ...scenario,
      attacks: scenario.attacks.map((attack) => ({
        ...attack,
        moveInput: "おはかまいり",
        movePowerMode: "assisted" as const,
        movePowerValue: 150,
      })),
    };
    const lastRespectsHtml = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[lastRespectsScenario]}
      />,
    );

    expect(lastRespectsHtml).toContain('class="move-power-field steppable"');
    expect(lastRespectsHtml).toContain('aria-label="耐久調整A 威力 150（条件: ひんしの味方 2体）。条件を開く"');
    expect(lastRespectsHtml).toMatch(/class="move-power-trigger" type="button" aria-label="耐久調整A 威力 150/);
    expect(lastRespectsHtml).toContain('aria-label="耐久調整A 威力条件を上げる: ひんしの味方 3体"');
    expect(lastRespectsHtml).toContain('aria-label="耐久調整A 威力条件を下げる: ひんしの味方 1体"');
    expect(lastRespectsHtml).not.toMatch(/<button type="button" tabindex="-1" aria-label="耐久調整A 威力条件を(?:上げる|下げる)/);
    expect(countClassToken(lastRespectsHtml, "move-power-condition-stepper")).toBe(1);
    expect(countClassToken(lastRespectsHtml, "move-power-stepper")).toBe(0);
    const lastRespectsStepper = assertUiStepperShape(
      lastRespectsHtml,
      "move-power-condition-stepper",
      'class="move-power-trigger"',
    );
    expect(lastRespectsStepper.block).toContain('aria-label="耐久調整A 威力条件を下げる: ひんしの味方 1体"');
    expect(lastRespectsStepper.block).toContain('aria-label="耐久調整A 威力条件を上げる: ひんしの味方 3体"');
    expectStepperButtonDisabled(lastRespectsStepper.block, "耐久調整A 威力条件を下げる: ひんしの味方 1体", false);
    expectStepperButtonDisabled(lastRespectsStepper.block, "耐久調整A 威力条件を上げる: ひんしの味方 3体", false);

    const eruptionScenario = {
      ...scenario,
      attacks: scenario.attacks.map((attack) => ({
        ...attack,
        moveInput: "ふんか",
        movePowerMode: "auto" as const,
        movePowerValue: 0,
      })),
    };
    const eruptionHtml = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[eruptionScenario]}
      />,
    );

    expect(eruptionHtml).toContain('aria-label="耐久調整A 威力の自動入力を解除"');
    expect(eruptionHtml).toMatch(/class="move-power-lock-toggle is-closed" type="button" aria-label="耐久調整A 威力の自動入力を解除"/);
    expect(eruptionHtml).not.toMatch(/class="move-power-lock-toggle is-closed" type="button" tabindex="-1" aria-label="耐久調整A 威力の自動入力を解除"/);
    expect(eruptionHtml).toContain(
      '<strong>150</strong><button class="move-power-lock-toggle is-closed"',
    );
    expect(eruptionHtml).toContain('src="/assets/ui/lock.svg"');
    expect(eruptionHtml).not.toContain("技の威力設定");
    expect(eruptionHtml).not.toContain('<small>HP</small>');
    expect(eruptionHtml).not.toContain("威力条件ステッパー");

    const incompleteEruptionHtml = renderToStaticMarkup(
      <App
        initialTargetForm={{ ...createDefaultTargetForm(), pokemonInput: "" }}
        initialScenarioForms={[{
          ...eruptionScenario,
          attacks: eruptionScenario.attacks.map((attack) => ({
            ...attack,
            attackerPokemonInput: "",
          })),
        }]}
      />,
    );
    expect(incompleteEruptionHtml).toContain('<strong>150</strong><button class="move-power-lock-toggle is-closed"');

    const manualEruptionHtml = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[{
          ...eruptionScenario,
          attacks: eruptionScenario.attacks.map((attack) => ({
            ...attack,
            movePowerMode: "manual" as const,
            movePowerValue: 87,
          })),
        }]}
      />,
    );
    expect(manualEruptionHtml).toContain('aria-label="耐久調整A 任意威力"');
    expect(manualEruptionHtml).not.toMatch(/<input[^>]*tabindex="-1"[^>]*aria-label="耐久調整A 任意威力"/);
    expect(manualEruptionHtml).toContain('aria-label="耐久調整A 威力を自動入力に戻す"');
    expect(manualEruptionHtml).not.toMatch(/class="move-power-lock-toggle is-open" type="button" tabindex="-1" aria-label="耐久調整A 威力を自動入力に戻す"/);
    expect(manualEruptionHtml).toContain('src="/assets/ui/lock-open.svg"');
  });

  it.each(assistedPowerFixtures)(
    "$moveInput uses the shared power-condition stepper at every option boundary",
    ({ moveInput, powers, labels }) => {
      const renderAt = (optionIndex: number): string => renderMovePowerScenario(
        moveInput,
        "assisted",
        powers[optionIndex] ?? powers[0],
      );
      const minHtml = renderAt(0);
      const maxIndex = powers.length - 1;
      const maxHtml = renderAt(maxIndex);

      expect(countClassToken(minHtml, "move-power-condition-stepper")).toBe(1);
      expect(countClassToken(minHtml, "move-power-stepper")).toBe(0);
      const minStepper = assertUiStepperShape(
        minHtml,
        "move-power-condition-stepper",
        'class="move-power-trigger"',
      );
      expectStepperButtonDisabled(
        minStepper.block,
        "耐久調整A 威力条件を下げる",
        true,
      );
      expectStepperButtonDisabled(
        minStepper.block,
        `耐久調整A 威力条件を上げる: ${labels[1]}`,
        false,
      );

      const maxStepper = assertUiStepperShape(
        maxHtml,
        "move-power-condition-stepper",
        'class="move-power-trigger"',
      );
      expectStepperButtonDisabled(
        maxStepper.block,
        `耐久調整A 威力条件を下げる: ${labels[maxIndex - 1]}`,
        false,
      );
      expectStepperButtonDisabled(
        maxStepper.block,
        "耐久調整A 威力条件を上げる",
        true,
      );

      if (powers.length > 2) {
        const middleIndex = Math.floor(powers.length / 2);
        const middleHtml = renderAt(middleIndex);
        const middleStepper = assertUiStepperShape(
          middleHtml,
          "move-power-condition-stepper",
          'class="move-power-trigger"',
        );
        expectStepperButtonDisabled(
          middleStepper.block,
          `耐久調整A 威力条件を下げる: ${labels[middleIndex - 1]}`,
          false,
        );
        expectStepperButtonDisabled(
          middleStepper.block,
          `耐久調整A 威力条件を上げる: ${labels[middleIndex + 1]}`,
          false,
        );
      }
    },
  );

  it("keeps the power-condition stepper out of manual, automatic, fixed, status, and unsupported controls", () => {
    const cases = [
      ["おはかまいり", "manual", 87],
      ["ふんか", "auto", 0],
      ["ふいうち", "auto", 0],
      ["まもる", "auto", 0],
      ["ふくろだたき", "auto", 0],
    ] as const;

    for (const [moveInput, mode, value] of cases) {
      const html = renderMovePowerScenario(moveInput, mode, value);
      expect(countClassToken(html, "move-power-condition-stepper")).toBe(0);
      expect(countClassToken(html, "move-power-stepper")).toBe(0);
    }
  });

  it("uses the shared numeric stepper for attack and survival counts while keeping probability direct", () => {
    const [scenario] = createDefaultScenarioForms();
    const html = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[scenario]}
      />,
    );

    expect(countClassToken(html, "scenario-stepper-field")).toBe(2);
    expect(countClassToken(html, "number-stepper")).toBe(2);
    const attackStepper = assertUiStepperShape(
      html,
      "number-stepper",
      'aria-label="攻撃回数"',
    );
    const survivalStepper = assertUiStepperShape(
      html,
      "number-stepper",
      'aria-label="耐久回数"',
      attackStepper.end,
    );
    expect(attackStepper.block).toContain('value="1"');
    expect(survivalStepper.block).toContain('value="1"');
    const attackInputId = attackStepper.block.match(
      /<input(?=[^>]*aria-label="攻撃回数")[^>]*\bid="([^"]+)"/,
    )?.[1];
    expect(attackInputId).toBeTruthy();
    expect(html).toContain(`<label class="row-label" for="${attackInputId}">攻撃回数</label>`);
    expect(attackStepper.block).toContain('aria-label="攻撃回数を1下げる"');
    expect(attackStepper.block).toContain('aria-label="攻撃回数を1上げる"');
    expect(survivalStepper.block).toContain('aria-label="耐久回数を1下げる"');
    expect(survivalStepper.block).toContain('aria-label="耐久回数を1上げる"');
    expectStepperButtonDisabled(attackStepper.block, "攻撃回数を1下げる", true);
    expectStepperButtonDisabled(attackStepper.block, "攻撃回数を1上げる", false);
    expectStepperButtonDisabled(survivalStepper.block, "耐久回数を1下げる", true);
    expectStepperButtonDisabled(survivalStepper.block, "耐久回数を1上げる", false);
    expect(html).toMatch(/<input(?=[^>]*aria-label="耐久確率 %")(?=[^>]*value="90")[^>]*>/);
    expect(html).not.toContain('aria-label="耐久確率 %を1下げる"');
    expect(html).not.toContain('aria-label="耐久確率 %を1上げる"');
    const probabilityInputIndex = html.indexOf('aria-label="耐久確率 %"');
    const probabilityFieldStart = html.lastIndexOf("<label", probabilityInputIndex);
    const probabilityFieldEnd = html.indexOf("</label>", probabilityInputIndex);
    expect(html.slice(probabilityFieldStart, probabilityFieldEnd)).not.toContain("scenario-stepper-field");

    const maxHtml = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[{
          ...scenario,
          attacks: [{
            ...scenario.attacks[0],
            repeat: 10,
            requiredSurvivedHits: 10,
          }],
        }]}
      />,
    );
    const maxAttackStepper = assertUiStepperShape(
      maxHtml,
      "number-stepper",
      'aria-label="攻撃回数"',
    );
    const maxSurvivalStepper = assertUiStepperShape(
      maxHtml,
      "number-stepper",
      'aria-label="耐久回数"',
      maxAttackStepper.end,
    );
    expectStepperButtonDisabled(maxAttackStepper.block, "攻撃回数を1下げる", false);
    expectStepperButtonDisabled(maxAttackStepper.block, "攻撃回数を1上げる", true);
    expectStepperButtonDisabled(maxSurvivalStepper.block, "耐久回数を1下げる", false);
    expectStepperButtonDisabled(maxSurvivalStepper.block, "耐久回数を1上げる", true);
  });

  it("formats the actually applied power without mixing it with damage", () => {
    expect(formatMovePowerEvaluation({
      catalogBasePower: 65,
      appliedBasePower: 130,
      source: "automatic",
    })).toBe("基礎威力 65 → 適用威力 130（自動計算）");
    expect(formatMovePowerEvaluation({
      catalogBasePower: 50,
      appliedBasePower: 300,
      source: "assisted",
      detailLabel: "ひんしの味方 5体",
    })).toBe("威力 300（条件: ひんしの味方 5体）");
    expect(formatMovePowerEvaluation({
      catalogBasePower: 20,
      appliedBasePower: 120,
      source: "automatic",
      perHitBasePowers: [20, 40, 60],
    })).toBe("威力 20→40→60（各ヒット）");
    expect(formatMovePowerEvaluation({
      catalogBasePower: 150,
      appliedBasePower: 150,
      source: "automatic",
    }, { hpDependent: true })).toBe("HP依存威力（満タン時 150・各攻撃直前に自動計算）");
    expect(formatMovePowerEvaluation({ catalogBasePower: 0, source: "fixed-damage" }))
      .toBe("固定ダメージ（数値威力なし）");
    expect(formatMovePowerEvaluation(
      { catalogBasePower: 0, source: "fixed-damage" },
      { hpDependent: true },
    )).toBe("固定ダメージ（数値威力なし・各攻撃直前のHPで自動計算）");
    expect(formatMovePowerEvaluation({ catalogBasePower: 0, source: "status" }))
      .toBe("変化技（数値威力なし）");
    expect(formatMovePowerEvaluation({ catalogBasePower: 0, source: "unsupported" }))
      .toBe("個別威力（現在の計算には未対応）");
  });

  it("shows Beat Up power and opens its participant settings", () => {
    const [scenario] = createDefaultScenarioForms();
    const beatUpAttack = applyMoveInputDefaults(scenario.attacks[0], "ふくろだたき", true);
    const html = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[{
          ...scenario,
          attacks: [beatUpAttack],
        }]}
      />,
    );

    expect(html).toContain("ふくろだたき参加ポケモンを設定。威力 18");
    expect(html).toMatch(/class="move-power-trigger" type="button" aria-label="耐久調整A ふくろだたき参加ポケモンを設定/);
    expect(html).toContain("<strong>18</strong>");
    const attackStepper = assertUiStepperShape(html, "number-stepper", 'aria-label="攻撃回数"');
    expect(attackStepper.block).toMatch(/<input(?=[^>]*aria-label="攻撃回数")(?=[^>]*disabled="")[^>]*>/);
    expect(attackStepper.block.match(/<button(?=[^>]*disabled="")[^>]*>/g)).toHaveLength(2);
    expect(attackStepper.block).toContain("▼");
    expect(attackStepper.block).toContain("▲");
    const survivalStepper = assertUiStepperShape(
      html,
      "number-stepper",
      'aria-label="耐久回数"',
      attackStepper.end,
    );
    const survivalInputStart = survivalStepper.block.indexOf("<input");
    const survivalInputEnd = survivalStepper.block.indexOf(">", survivalInputStart);
    expect(survivalStepper.block.slice(survivalInputStart, survivalInputEnd + 1)).not.toContain('disabled=""');
    expectStepperButtonDisabled(survivalStepper.block, "耐久回数を1下げる", true);
    expectStepperButtonDisabled(survivalStepper.block, "耐久回数を1上げる", false);
  });

  it("keeps HP events collapsed in attack cards and summarizes them on mobile", () => {
    const [defenceScenario, ...rest] = createDefaultScenarioForms();
    const scenarios = [
      {
        ...defenceScenario,
        attacks: defenceScenario.attacks.map((attack, index) => index === 0 ? {
          ...attack,
          hpEvents: [{
            id: "sand-after-hit",
            effectId: "sandstorm-damage",
            enabled: true,
          }, {
            id: "life-orb-after-move",
            effectId: "life-orb-recoil",
            enabled: true,
          }],
        } : attack),
      },
      ...rest,
    ];

    const html = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={scenarios}
      />,
    );

    expect(html).toContain("<summary>");
    expect(html).toContain(">定数ダメージ・回復</span>");
    expect(html).toContain(">2件</span>");
    expect(html).toContain("すなあらしダメージ");
    expect(html).toContain("いのちのたま反動");
    expect(html).toContain("icon-button scenario-remove-button hp-event-remove-button");
    expect(html).toContain("最大HPの1/16（切り捨て・最低1）");
    expect(html).toContain("ターン終了時・ターンごと");
    expect(html).toContain("技使用後・技ごと");
    expect(html).toContain("<strong>対象</strong><span>仮想敵（技使用者）</span>");
    expect(html).toContain("<strong>対象</strong><span>調整対象（被弾側）</span>");
    expect(html).not.toContain("直前の技使用後 → 今回の攻撃前に1回");
    expect(html).not.toMatch(/select-field-label[^>]*>対象<\/span>/);
    expect(html).not.toMatch(/select-field-label[^>]*>タイミング<\/span>/);
    expect(html).toContain("効果2");
  });

  it("shows offense HP event targets from each effect without a subject selector", () => {
    const [baseScenario] = createDefaultScenarioForms();
    const offenseScenario = {
      ...baseScenario,
      adjustmentType: "offense" as const,
      attacks: baseScenario.attacks.map((attack) => ({
        ...attack,
        hpEvents: [{
          id: "offense-life-orb",
          effectId: "life-orb-recoil",
          enabled: true,
        }, {
          id: "offense-sand",
          effectId: "sandstorm-damage",
          enabled: true,
        }],
      })),
    };

    const html = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[offenseScenario]}
      />,
    );

    expect(html).toContain("<strong>対象</strong><span>調整対象（技使用者）</span>");
    expect(html).toContain("<strong>対象</strong><span>仮想敵（被弾側）</span>");
    expect(html).not.toMatch(/select-field-label[^>]*>対象<\/span>/);
  });

  it("shows contact damage presets with fixed subjects and timing", () => {
    const [baseScenario] = createDefaultScenarioForms();
    const target = {
      ...createDefaultTargetForm(),
      abilityInput: "さめはだ",
      itemInput: "ゴツゴツメット",
    };
    const scenario = {
      ...baseScenario,
      attacks: baseScenario.attacks.map((attack) => ({
        ...attack,
        moveInput: "すいりゅうれんだ",
        hpEvents: [{
          id: "rocky-helmet",
          effectId: "rocky-helmet-damage",
          enabled: true,
        }, {
          id: "rough-skin",
          effectId: "rough-skin-damage",
          enabled: true,
        }],
      })),
    };

    const html = renderToStaticMarkup(
      <App initialTargetForm={target} initialScenarioForms={[scenario]} />,
    );
    const mismatchHtml = renderToStaticMarkup(
      <App
        initialTargetForm={{
          ...createDefaultTargetForm(),
          abilityInput: "",
          itemInput: "",
        }}
        initialScenarioForms={[scenario]}
      />,
    );
    const offenseHtml = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[{
          ...scenario,
          adjustmentType: "offense",
          attacks: scenario.attacks.map((attack) => ({
            ...attack,
            attackerAbilityInput: "さめはだ",
            attackerItemInput: "ゴツゴツメット",
          })),
        }]}
      />,
    );

    expect(html).toContain("ゴツゴツメット");
    expect(html).toContain("さめはだ／てつのトゲ");
    expect(html).toContain("接触ヒットごとに技使用者の最大HPの1/6（切り捨て・最低1）");
    expect(html).toContain("接触ヒットごとに技使用者の最大HPの1/8（切り捨て・最低1）");
    expect(html.match(/<strong>対象<\/strong><span>仮想敵（技使用者）<\/span>/g)).toHaveLength(2);
    expect(offenseHtml.match(/<strong>対象<\/strong><span>調整対象（技使用者）<\/span>/g)).toHaveLength(2);
    expect(html.match(/<strong>発動<\/strong><span>ヒット後・ヒットごと<\/span>/g)).toHaveLength(2);
    expect(html).not.toContain("被弾側の持ち物が「ゴツゴツメット」ではありません");
    expect(html).not.toContain("被弾側の特性が「さめはだ／てつのトゲ」ではありません");
    expect(mismatchHtml).toContain("被弾側の持ち物が「ゴツゴツメット」ではありません。発動前提で計算します");
    expect(mismatchHtml).toContain("被弾側の特性が「さめはだ／てつのトゲ」ではありません。発動前提で計算します");
    expect(html).toContain("ガイドの定数ダメージ・回復");
    expect(html).toContain('href="/guide/#constant-damage"');
    expect(html).not.toContain("ゴツゴツメット・さめはだ／てつのトゲの接触判定は、選択技・えんかく・ぼうごパット・パンチグローブから自動判定します。");
  });

  it("keeps current-HP move recalculation separate from configured HP effects", () => {
    const [baseScenario] = createDefaultScenarioForms();
    const baseAttack = baseScenario.attacks[0];
    const scenario = {
      ...baseScenario,
      attacks: [
        {
          ...baseAttack,
          id: "automatic-cost",
          attackerPokemonInput: "ミュウ",
          moveInput: "みがわり",
        },
        {
          ...baseAttack,
          id: "automatic-current-hp",
          attackerPokemonInput: "イーユイ",
          moveInput: "カタストロフィ",
        },
        {
          ...baseAttack,
          id: "automatic-recoil",
          attackerPokemonInput: "ピカチュウ",
          moveInput: "ワイルドボルト",
        },
        {
          ...baseAttack,
          id: "automatic-faint",
          attackerPokemonInput: "ムクホーク",
          moveInput: "いのちがけ",
        },
      ],
    };

    const html = renderToStaticMarkup(
      <App
        initialTargetForm={createDefaultTargetForm()}
        initialScenarioForms={[scenario]}
      />,
    );

    expect(html).not.toContain(">自動1件</span>");
    expect(html).not.toContain(">自動2件</span>");
    expect(html).not.toContain(">技から自動適用</p>");
    expect(html).not.toContain("みがわりのHP消費");
    expect(html).not.toContain("最大HPの1/4（切り捨て・最低1）");
    expect(html).not.toContain("カタストロフィの現在HP計算");
    expect(html).not.toContain("相手の現在HPの1/2（切り捨て・最低1）");
    expect(html).not.toContain("ワイルドボルトの反動");
    expect(html).not.toContain("実際に与えたダメージの1/4（四捨五入・最低1）");
    expect(html).not.toContain("いのちがけの現在HP計算");
    expect(html).not.toContain("使用者の現在HP");
    expect(html).not.toContain("いのちがけの使用者ひんし");
    expect(html).not.toContain("ダメージを与えた使用者がひんし");
    expect(html).not.toContain('class="hp-event-auto-badge"');
    expect(html).not.toContain("<strong>適用</strong><span>選択技から自動</span>");
    expect(html).not.toContain('aria-label="みがわりのHP消費を削除"');
    expect(html).not.toContain('aria-label="ワイルドボルトの反動を削除"');
    expect(html.match(/>定数ダメージ・回復<\/span><span class="active-adjustment-empty">なし<\/span>/g)).toHaveLength(4);
    expect(html.match(/HP依存技は、変化後のHPから自動計算されます。/g)).toHaveLength(2);
    expect(html).not.toContain("HP変化自動1");
    expect(html).not.toContain("HP変化自動2");
    expect(html).toContain("対象・発動順・頻度などの詳しい仕様は");
    expect(html).toContain("ガイドの定数ダメージ・回復");
    expect(html).not.toContain("現在HP依存の直接ダメージ・威力は選択技から自動計算します。");
    expect(html).not.toContain("技使用者側の技固有反動・HP消費・使用者ひんしは、通常の耐久・火力ラインへ自動では含めません。");
  });

  it("starts with the same blank condition shown by the empty box slot", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('aria-label="性格: 未選択"');
    expect(html).toContain('aria-label="シナリオ1 調整種別"');
    expect(html).not.toContain('aria-label="シナリオ2 調整種別"');
    expect(html).not.toContain('value="メガマフォクシー"');
    expect(html).not.toContain('value="ドドゲザン"');
    expect(html).not.toContain('value="メガゲンガー"');
    expect(html).not.toContain('value="サイコキネシス"');
  });

  it("shows an accessible restore-or-discard dialog only in the default app", () => {
    const draft = createDraftStorageDocument(
      { ...createDefaultTargetForm(), pokemonInput: "オオニューラ" },
      createDefaultScenarioForms(),
      new Date("2026-08-17T03:04:05.000Z"),
    );
    const values = new Map([[DRAFT_STORAGE_KEY, JSON.stringify(draft)]]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    };
    vi.stubGlobal("localStorage", storage);

    try {
      const html = renderToStaticMarkup(<App />);
      const tutorialHtml = renderToStaticMarkup(
        <App
          variant="tutorial"
          initialTargetForm={draft.payload.target}
          initialScenarioForms={draft.payload.scenarios}
        />,
      );

      expect(html).toContain('role="dialog"');
      expect(html).toContain('aria-modal="true"');
      expect(html).toContain('aria-labelledby="draft-recovery-title"');
      expect(html).toContain('aria-describedby="draft-recovery-description"');
      expect(html).toContain("保存した下書きがあります");
      expect(html).toContain("前回の入力条件をこのブラウザから復元できます。");
      expect(html).toContain("下書きを復元");
      expect(html).toContain("下書きを破棄");
      expect(html).toContain("オオニューラ");
      expect(tutorialHtml).not.toContain("draft-recovery-overlay");
      expect(tutorialHtml).not.toContain("下書きを復元");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps corrupt drafts explicit and the recovery dialog narrow-width safe", () => {
    const html = renderToStaticMarkup(
      <DraftRecoveryDialog
        recovery={{
          status: "error",
          reason: "corrupt",
          message: "前回の下書きを読み込めませんでした: broken JSON",
        }}
        onRestore={() => undefined}
        onDiscard={() => undefined}
        onDismissUnavailable={() => undefined}
      />,
    );
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

    expect(html).toContain("下書きを読み込めませんでした");
    expect(html).toContain("下書きを破棄");
    expect(html).not.toContain("下書きを復元");
    expect(css).toMatch(/\.draft-recovery-window\s*\{[^}]*width:\s*min\(480px, calc\(100vw - 36px\)\);[^}]*overflow:\s*auto;/s);
    expect(css).toMatch(/@media \(max-width: 380px\)[\s\S]*?\.draft-recovery-actions\s*\{[^}]*grid-template-columns:\s*1fr;/s);
  });

  it("keeps public guidance approachable while technical documents retain save and sync details", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const guide = readFileSync(new URL("../guide/index.html", import.meta.url), "utf8");
    const privacy = readFileSync(new URL("../privacy/index.html", import.meta.url), "utf8");
    const firebaseSetup = readFileSync(new URL("../docs/FIREBASE_SETUP.md", import.meta.url), "utf8");
    const privacyImplementation = readFileSync(
      new URL("../docs/privacy-implementation.md", import.meta.url),
      "utf8",
    );

    for (const technicalDetail of [
      "作業中の下書き",
      "ブラウザ別クラウド下書き",
      "約0.75秒",
      "初回統合",
      "Firestore",
      "クラウド全体を置き換え",
      "削除済み",
      "未送信操作を順番に保持するキュー（`outbox`）",
      "削除済みと記録します（`tombstone`）",
      "保存内容のJSON文字列（`payload`）",
      "`syncRecords`",
      "`drafts`",
      "Firebase Authenticationのアカウントを削除します",
    ]) {
      expect(readme).toContain(technicalDetail);
    }

    expect(guide).toContain("入力中の内容は、ボックスとは別に、このブラウザへ自動で下書き保存されます。");
    expect(guide).toContain("「下書きを復元」または「下書きを破棄」");
    expect(guide).toContain("「ボックスに保存済み」");
    expect(guide).toContain("「Googleでログイン」を選ぶ");
    expect(guide).toContain("JSONバックアップ");
    expect(guide).toContain("「ログアウト」「アカウントデータを書き出す」「アカウントを削除」");
    expect(guide).toContain("プライバシー");
    expect(guide).not.toContain("ブラウザ別クラウド下書き");
    expect(guide).not.toContain("約0.75秒");
    expect(guide).not.toContain("初回統合");
    expect(guide).not.toContain("Firestore");
    expect(guide).not.toContain("クラウド全体を置き換え");

    for (const label of ["統合", "クラウドを使用", "このブラウザを使用", "あとで決める"]) {
      expect(readme).toContain(`\`${label}\``);
      expect(guide).toContain(`<strong>${label}</strong>`);
    }
    for (const label of ["このブラウザのみ", "未同期", "同期中…", "同期済み", "オフライン", "競合あり", "同期エラー"]) {
      expect(readme).toContain(`\`${label}\``);
      expect(guide).toContain(`<code>${label}</code>`);
    }

    for (const publicDetail of [
      "<h2>まとめ</h2>",
      "このブラウザのサイトデータ",
      "調整対象・仮想敵ボックス",
      "ブラウザごとの作業中の下書き",
      "Google Drive",
      "Gmail",
      "連絡先",
      "Google Analytics 4",
      "Google Fonts",
      "Firebase / reCAPTCHA Enterprise",
      "アカウントデータを書き出す",
      "アカウントを削除",
      "ログアウト",
      "docs/privacy-implementation.md",
    ]) {
      expect(privacy).toContain(publicDetail);
    }
    for (const internalTerm of [
      "syncRecords",
      "tombstone",
      "outbox",
      "schemaVersion",
      "revision",
      "source fingerprint",
      "deviceId",
      "Firestore Security Rules",
    ]) {
      expect(privacy).not.toContain(internalTerm);
    }
    expect(privacy).toContain("2026年8月25日");
    expect(privacy).toContain("https://docs.google.com/forms/d/e/1FAIpQLSdTUyrAmTwrcarMfMt56RrcwH_g4r4WhowW0i60HDK5BflylQ/viewform");

    for (const heading of [
      "# ChampionCreator データ取り扱いの技術詳細",
      "## 1. データフローの概要",
      "## 2. アプリが管理するブラウザ内保存",
      "## 4. Cloud Firestore",
      "## 6. アカウントデータの書き出し",
      "## 8. アカウント削除",
    ]) {
      expect(privacyImplementation).toContain(heading);
    }
    for (const technicalDetail of [
      "Firebase SDKが管理するブラウザ保存",
      "championcreator.device.v1",
      "championcreator.migration-source.v1",
      "championcreator.sync.v1.<uid>",
      "championcreator.cloud-draft.v1.<uid>.<device>",
      "championcreator.draft.v1.<uid>.<device>",
      "`syncRecords`",
      "`drafts`",
      "削除済み記録",
      "App Check",
    ]) {
      expect(privacyImplementation).toContain(technicalDetail);
    }

    expect(firebaseSetup).toContain("## 既存ブラウザ内保存の初回統合");
    expect(firebaseSetup).toContain("## ボックス同期");
    expect(firebaseSetup).toContain("## ブラウザ別クラウド下書き");
    expect(firebaseSetup).toContain("## アカウント・同期ライフサイクル");
    expect(firebaseSetup).toContain("## 本番公開とApp Check");
    expect(firebaseSetup).toContain("Cloud FirestoreとAuthenticationのApp Check enforcement");

    for (const document of [readme, guide, privacy, firebaseSetup, privacyImplementation]) {
      expect(document).not.toMatch(/SYNC-M|\bM\d+(?:\.\d+)?\b/);
      expect(document).not.toContain("controller");
      expect(document).not.toContain("runtime gate");
      expect(document).not.toContain("`completed`");
    }

    for (const document of [readme, guide, privacy]) {
      expect(document).toContain("表示名");
      expect(document).toContain("メールアドレス");
      expect(document).toContain("プロフィール画像");
      expect(document).toContain("Google Drive");
      expect(document).toContain("Gmail");
      expect(document).not.toContain("追加scope");
    }
  });

  it("keeps the privacy title on one line and follows the guide scroll spy contract", () => {
    const privacyHtml = readFileSync(new URL("../privacy/index.html", import.meta.url), "utf8");
    const privacyMain = readFileSync(new URL("./privacy/main.ts", import.meta.url), "utf8");
    const guideCss = readFileSync(new URL("./guide/guide.css", import.meta.url), "utf8");
    const privacyCalendarIcon = readFileSync(
      new URL("../public/assets/guide/calendar-days.svg", import.meta.url),
      "utf8",
    );

    expect(privacyHtml).toContain('<body class="guide-page privacy-page">');
    expect(privacyHtml).toContain("<title>ChampionCreator | プライバシーとデータの取り扱い</title>");
    const privacyDescription = "ChampionCreatorにおけるデータの保存先、GoogleログインとFirebase同期、外部サービスへの通信、データの書き出し・削除について説明します";
    expect(privacyHtml.match(new RegExp(`content="${privacyDescription}"`, "g"))).toHaveLength(3);
    expect(privacyHtml).toContain("<h1>プライバシーとデータの取り扱い</h1>");
    expect(privacyHtml).not.toContain("プライバシーと<br");
    expect(privacyHtml).toContain(
      '<img class="guide-tip-icon" src="/assets/guide/calendar-days.svg" width="24" height="24" alt="" aria-hidden="true" />',
    );
    expect(privacyHtml.indexOf('src="/assets/guide/calendar-days.svg"'))
      .toBeLessThan(privacyHtml.indexOf("<strong>更新日</strong>"));
    expect(privacyCalendarIcon).toContain('viewBox="0 0 24 24"');
    expect(privacyCalendarIcon).toContain('stroke="#00ff72"');
    expect(privacyCalendarIcon).toContain('fill="none"');
    for (const [sectionId, label] of [
      ["overview", "概要"],
      ["summary", "まとめ"],
      ["local-storage", "データの保存"],
      ["firebase", "Googleログイン"],
      ["analytics-fonts", "外部通信"],
      ["export", "書き出し"],
      ["delete", "削除と保存期間"],
      ["security", "安全性"],
      ["technical-details", "技術的な詳細"],
    ] as const) {
      expect(privacyHtml).toContain(`href="#${sectionId}"`);
      expect(privacyHtml).toContain(`id="${sectionId}"`);
      expect(privacyHtml).toContain(`>${label}</a>`);
    }
    expect(privacyMain).toContain('import { getActiveGuideSectionIndex } from "../guide/scrollSpy"');
    expect(privacyMain).toContain('window.addEventListener("scroll", scheduleActiveTocUpdate, { passive: true })');
    expect(privacyMain).toContain('link.setAttribute("aria-current", "location")');
    expect(guideCss).toMatch(/\.privacy-page \.guide-intro h1\s*\{[^}]*white-space:\s*nowrap;/s);
    expect(guideCss).toMatch(/@media \(max-width: 720px\)[\s\S]*?\.privacy-page \.guide-intro h1\s*\{[^}]*font-size:\s*clamp\(18px, 6vw, 23px\);/s);
  });

  it("maps mobile scenario direction icons by adjustment type", () => {
    expect(getMobileScenarioDirectionIconPath("defence", false)).toBe("assets/ui/arrow-left-circle.svg");
    expect(getMobileScenarioDirectionIconPath("offense", false)).toBe("assets/ui/arrow-right-circle.svg");
    expect(getMobileScenarioDirectionIconPath("speed", false)).toBe("assets/ui/arrow-up-circle.svg");
    expect(getMobileScenarioDirectionIconPath("speed", true)).toBe("assets/ui/arrow-down-circle.svg");
  });

  it("limits mobile scenario detail sheets to the selected scenario", () => {
    const scenarios = createDefaultScenarioForms();
    const twoAttackScenario = {
      ...scenarios[1],
      attacks: [
        scenarios[1].attacks[0],
        { ...scenarios[1].attacks[0], id: "attack-b", label: "攻撃B" },
      ],
    };

    expect(getScenarioPanelVisibleScenarios(scenarios, scenarios[1].id).map((scenario) => scenario.label))
      .toEqual(["シナリオ2"]);
    expect(getScenarioPanelVisibleScenarios(scenarios, null).map((scenario) => scenario.label))
      .toEqual(["シナリオ1", "シナリオ2", "シナリオ3"]);
    expect(getScenarioPanelVisibleScenarios(scenarios, "missing-scenario").map((scenario) => scenario.label))
      .toEqual(["シナリオ1", "シナリオ2", "シナリオ3"]);
    expect(getMobileAttackNavigationTargets(twoAttackScenario, "attack-b")).toEqual({
      currentIndex: 1,
      currentId: "attack-b",
      currentLabel: "火力調整B",
      total: 2,
      previousId: scenarios[1].attacks[0].id,
      nextId: null,
      nextLabel: "火力調整C",
    });
    expect(getMobileAttackNavigationTargets(scenarios[0], scenarios[0].attacks[0].id)?.previousId).toBeNull();
    expect(getMobileAttackNavigationTargets({ ...scenarios[0], attacks: [] })).toBeNull();
  });

  it("creates added scenarios as enabled by default and accepts the current header format", () => {
    const scenario = createScenario(3);
    const doublesScenario = createScenario(4, "doubles");

    expect(scenario).toMatchObject({
      label: "シナリオ4",
      enabled: true,
      adjustmentType: "defence",
    });
    expect(doublesScenario).toMatchObject({
      label: "シナリオ5",
      enabled: true,
      attacks: [{ gameType: "doubles" }],
    });
  });

  it("defaults opponent S SP to 32 when a scenario becomes a speed adjustment", () => {
    const [scenario] = createDefaultScenarioForms();
    const speedScenario = applyScenarioAdjustmentTypeDefaults({
      ...scenario,
      adjustmentType: "defence",
      attacks: scenario.attacks.map((attack) => ({
        ...attack,
        attackerStatPoints: { ...attack.attackerStatPoints, spe: 0 },
        speedOrderMode: "trick-room" as const,
        speedTargetTailwind: true,
        speedOpponentTailwind: true,
      })),
    }, "speed");

    expect(speedScenario.adjustmentType).toBe("speed");
    expect(speedScenario.attacks[0].attackerStatPoints.spe).toBe(32);
    expect(speedScenario.attacks[0].speedOrderMode).toBe("normal");
    expect(speedScenario.attacks[0].speedTargetTailwind).toBe(false);
    expect(speedScenario.attacks[0].speedOpponentTailwind).toBe(false);
  });

  it("defaults opponent S SP to 0 for Trick Room speed adjustment", () => {
    const speedAttack = {
      ...createDefaultScenarioForms()[2].attacks[0],
      attackerStatPoints: {
        ...createDefaultScenarioForms()[2].attacks[0].attackerStatPoints,
        spe: 32,
      },
    };

    const trickRoomAttack = applySpeedOrderModeDefaults(speedAttack, "trick-room");
    expect(trickRoomAttack.speedOrderMode).toBe("trick-room");
    expect(trickRoomAttack.attackerStatPoints.spe).toBe(0);

    const normalAttack = applySpeedOrderModeDefaults(trickRoomAttack, "normal");
    expect(normalAttack.speedOrderMode).toBe("normal");
    expect(normalAttack.attackerStatPoints.spe).toBe(32);
  });

  it("marks Trick Room speed scenarios in the mobile overview", () => {
    const scenarios = createDefaultScenarioForms().map((scenario) => scenario.adjustmentType === "speed"
      ? {
          ...scenario,
          attacks: scenario.attacks.map((attack) => ({
            ...attack,
            speedOrderMode: "trick-room" as const,
          })),
        }
      : scenario);
    const html = renderToStaticMarkup(<App initialScenarioForms={scenarios} />);

    expect(html).toContain('class="mobile-scenario-flow-row speed trick-room"');
    expect(html).toContain('aria-label="シナリオ3: 素早さ調整（トリックルーム）。タップで次の調整種別に切り替え"');
    expect(html).toContain(">確定トリル先制</span>");
    expect(html).toContain('class="speed-target-mode-operator" aria-hidden="true">-</span>');
  });

  it("does not overwrite manually edited opponent S SP for Trick Room", () => {
    const speedAttack = {
      ...createDefaultScenarioForms()[2].attacks[0],
      attackerStatPoints: {
        ...createDefaultScenarioForms()[2].attacks[0].attackerStatPoints,
        spe: 12,
      },
    };

    const trickRoomAttack = applySpeedOrderModeDefaults(speedAttack, "trick-room");
    expect(trickRoomAttack.attackerStatPoints.spe).toBe(12);
  });

  it("normalizes full-width numeric input text before parsing", () => {
    expect(normalizeNumericInputText("１２３４５")).toBe("12345");
    expect(normalizeNumericInputText(" ＋１２．５ ")).toBe("+12.5");
    expect(normalizeNumericInputText("－６")).toBe("-6");
  });

  it("renders exact 32-cell SP allocation sliders", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('role="slider"');
    expect(html).toContain('aria-valuemax="32"');
    expect(html).toContain('aria-label="H SP配分"');
    expect(html).toContain('class="sp-cell-bar hp"');
    expect(html).toContain(">ランク<");
    expect(html).toContain('aria-label="Bランク: 0"');
    expect(html).toContain('aria-label="Dランク: 0"');
    expect(html).not.toContain("assets/ui/lock-open.svg");
    expect(html).not.toContain("assets/ui/lock-closed.svg");
    expect(html).not.toContain('class="allocation-lock');
    expect(html).not.toContain("固定状態");
    expect(html).not.toContain('aria-label="状態異常: なし"');
    expect(html).toContain(">耐久調整A 調整対象の状態異常</span>");
  });

  it("renders game-style red and blue nature gain markers without changing slider interaction", () => {
    const createMarkers = (
      marker: StatPointMarker,
      positions: number[],
    ): StatPointMarkerRow => Array.from({ length: 33 }, (_value, statPoints) => (
      positions.includes(statPoints) ? marker : null
    ));
    const redMarkers = createMarkers("red", [5, 15, 25]);
    const blueMarkers = createMarkers("blue", [2, 12, 22, 32]);
    const edgeMarkers = createMarkers("blue", [1, 32]);
    const getCells = (html: string): string[] => (
      Array.from(html.matchAll(/<span([^>]*)><\/span>/g), (match) => match[1] ?? "")
    );
    const redBeforeHtml = renderToStaticMarkup(
      <StatPointCellBar
        stat="atk"
        value={24}
        markers={redMarkers}
        onChange={() => undefined}
      />,
    );
    const redReachedHtml = renderToStaticMarkup(
      <StatPointCellBar
        stat="atk"
        value={25}
        markers={redMarkers}
        onChange={() => undefined}
      />,
    );
    const blueBeforeHtml = renderToStaticMarkup(
      <StatPointCellBar
        stat="spa"
        value={21}
        markers={blueMarkers}
        onChange={() => undefined}
      />,
    );
    const blueReachedHtml = renderToStaticMarkup(
      <StatPointCellBar
        stat="spa"
        value={22}
        markers={blueMarkers}
        onChange={() => undefined}
      />,
    );
    const blueEndHtml = renderToStaticMarkup(
      <StatPointCellBar
        stat="spa"
        value={32}
        markers={blueMarkers}
        onChange={() => undefined}
      />,
    );
    const edgeStartHtml = renderToStaticMarkup(
      <StatPointCellBar
        stat="spa"
        value={1}
        markers={edgeMarkers}
        onChange={() => undefined}
      />,
    );
    const edgeEndHtml = renderToStaticMarkup(
      <StatPointCellBar
        stat="spa"
        value={32}
        markers={edgeMarkers}
        onChange={() => undefined}
      />,
    );
    const plainHtml = renderToStaticMarkup(
      <StatPointCellBar stat="hp" value={0} onChange={() => undefined} />,
    );
    const candidateHtml = renderToStaticMarkup(<CandidateStatPointBars statPoints={{
      hp: 0,
      atk: 15,
      def: 0,
      spa: 21,
      spd: 0,
      spe: 0,
    }} />);
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const guideHtml = readFileSync(new URL("../guide/index.html", import.meta.url), "utf8");

    expect(redBeforeHtml.match(/<span/g)).toHaveLength(32);
    expect(blueBeforeHtml.match(/<span/g)).toHaveLength(32);
    expect(redBeforeHtml.match(/data-marker="red"/g)).toHaveLength(3);
    expect(blueBeforeHtml.match(/data-marker="blue"/g)).toHaveLength(4);
    expect(redBeforeHtml.match(/data-marker-state="reached"/g)).toHaveLength(2);
    expect(redBeforeHtml.match(/data-marker-state="pending"/g)).toHaveLength(1);
    expect(redReachedHtml.match(/data-marker-state="reached"/g)).toHaveLength(3);
    expect(redReachedHtml).not.toContain('data-marker-state="pending"');
    expect(blueBeforeHtml.match(/data-marker-state="reached"/g)).toHaveLength(2);
    expect(blueBeforeHtml.match(/data-marker-state="pending"/g)).toHaveLength(2);
    expect(blueReachedHtml.match(/data-marker-state="reached"/g)).toHaveLength(3);
    expect(blueReachedHtml.match(/data-marker-state="pending"/g)).toHaveLength(1);
    expect(blueEndHtml.match(/data-marker-state="reached"/g)).toHaveLength(4);
    expect(blueEndHtml).not.toContain('data-marker-state="pending"');
    expect(getCells(edgeStartHtml)[0]).toContain('data-marker="blue"');
    expect(getCells(edgeStartHtml)[0]).toContain('data-marker-state="reached"');
    expect(getCells(edgeStartHtml).at(-1)).toContain('data-marker-state="pending"');
    expect(getCells(edgeEndHtml).at(-1)).toContain('data-marker="blue"');
    expect(getCells(edgeEndHtml).at(-1)).toContain('data-marker-state="reached"');
    expect(plainHtml.match(/<span/g)).toHaveLength(32);
    expect(plainHtml).not.toContain("data-marker");
    expect(plainHtml).not.toContain("data-marker-state");
    expect(redBeforeHtml).toContain('role="slider"');
    expect(redBeforeHtml).toContain('tabindex="0"');
    expect(redBeforeHtml).toContain('aria-valuemin="0"');
    expect(redBeforeHtml).toContain('aria-valuemax="32"');
    expect(redBeforeHtml).toContain('aria-valuenow="24"');
    expect(redBeforeHtml).toContain('aria-description="赤マーク位置: 5、15、25 SP"');
    expect(blueBeforeHtml).toContain('aria-description="青マーク位置: 2、12、22、32 SP"');
    expect(candidateHtml).not.toContain("data-marker");

    expect(css).toMatch(/--sp-marker-red:\s*#ff2500;/);
    expect(css).toMatch(/--sp-marker-blue:\s*#0098ff;/);
    expect(css).toMatch(/--sp-marker-red-fill-start:\s*#ff8604;/);
    expect(css).toMatch(/--sp-marker-red-fill-end:\s*#ffff12;/);
    expect(css).toMatch(/--sp-marker-blue-fill-start:\s*#749efe;/);
    expect(css).toMatch(/--sp-marker-blue-fill-end:\s*#30ffd6;/);
    expect(css).toMatch(/--sp-marker-outer-edge:\s*rgba\(255, 255, 255, 0\.82\);/);
    expect(css).toMatch(/--sp-marker-outer-glow:\s*rgba\(255, 255, 255, 0\.48\);/);
    expect(css).toMatch(/\.sp-cell-bar\s*\{[^}]*overflow:\s*visible;/s);
    expect(css).toMatch(/\.sp-cell-bar span:first-child\s*\{[^}]*border-radius:\s*4px 0 0 4px;/s);
    expect(css).toMatch(/\.sp-cell-bar span:last-child\s*\{[^}]*border-radius:\s*0 4px 4px 0;/s);
    expect(css).toMatch(/\.sp-cell-bar span\[data-marker\]::after\s*\{[^}]*inset:\s*3px 0;[^}]*background:\s*var\(--sp-marker-fill\);[^}]*box-shadow:\s*none;[^}]*opacity:\s*0\.82;[^}]*pointer-events:\s*none;/s);
    expect(css).toMatch(/\.sp-cell-bar span\[data-marker-state="reached"\]::after\s*\{[^}]*inset:\s*2px -1px;[^}]*border:\s*2px solid var\(--sp-marker-color\);[^}]*box-shadow:\s*0 0 0 1px var\(--sp-marker-outer-edge\),\s*0 0 4px var\(--sp-marker-outer-glow\);[^}]*opacity:\s*1;/s);
    expect(css).not.toContain('span:first-child[data-marker-state="reached"]');
    expect(css).not.toContain('span:last-child[data-marker-state="reached"]');
    expect(css).toMatch(/\.sp-cell-bar span\[data-marker="red"\]\s*\{[^}]*--sp-marker-color:\s*var\(--sp-marker-red\);[^}]*--sp-marker-fill:\s*linear-gradient\(180deg, var\(--sp-marker-red-fill-start\) 30%, var\(--sp-marker-red-fill-end\) 100%\);/s);
    expect(css).toMatch(/\.sp-cell-bar span\[data-marker="blue"\]\s*\{[^}]*--sp-marker-color:\s*var\(--sp-marker-blue\);[^}]*--sp-marker-fill:\s*linear-gradient\(180deg, var\(--sp-marker-blue-fill-start\) 30%, var\(--sp-marker-blue-fill-end\) 100%\);/s);
    expect(guideHtml).toContain("赤マークは、性格上昇補正によって、そのSPで性格無補正時より実数値が多く伸びる位置です。");
    expect(guideHtml).toContain("青マークは、性格下降補正によって、そのSPで性格無補正時より実数値の伸びが少なくなる位置です。");
    expect(guideHtml).toContain("マーク位置へ到達する前は控えめに、到達すると枠と発光を強く表示します。");
  });

  it("renders one selected HP criterion without adding per-cell controls", () => {
    const createHpDisplay = (
      matches: number[],
      boundaries: number[],
    ): HpStatMarkerDisplayRow => Array.from({ length: 33 }, (_value, sp) => ({
      matched: matches.includes(sp),
      boundary: boundaries.includes(sp),
    }));
    const pointHtml = renderToStaticMarkup(
      <StatPointCellBar
        stat="hp"
        value={8}
        hpMarkerDisplay={createHpDisplay([0, 8, 24], [0, 8, 24])}
        hpMarkerKind="point"
        hpMarkerDescription="HP基準 16n"
        onChange={() => undefined}
      />,
    );
    const appHtml = renderExampleApp();
    const unselectedControlHtml = renderToStaticMarkup(
      <HpStatMarkerControl value="none" row={[]} onChange={() => undefined} />,
    );
    const selectedControlHtml = renderToStaticMarkup(
      <HpStatMarkerControl value="16n" row={[]} onChange={() => undefined} />,
    );
    const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const guideHtml = readFileSync(new URL("../guide/index.html", import.meta.url), "utf8");

    expect(appHtml).toContain('class="hp-marker-trigger"');
    expect(appHtml).toContain('aria-label="HP基準: 表示なし"');
    expect(unselectedControlHtml).toContain('class="hp-marker-trigger-icon"');
    expect(unselectedControlHtml).toContain('assets/ui/sliders-horizontal.svg');
    expect(unselectedControlHtml).toContain('alt=""');
    expect(unselectedControlHtml).toContain('aria-hidden="true"');
    expect(unselectedControlHtml).not.toContain('>HP</button>');
    expect(selectedControlHtml).toContain('class="hp-marker-trigger selected"');
    expect(selectedControlHtml).toContain('aria-label="HP基準: 16n"');
    expect(selectedControlHtml).toContain('>16n</button>');
    expect(selectedControlHtml).not.toContain('sliders-horizontal.svg');
    expect(appHtml).not.toContain('class="target-rank-placeholder"');
    expect(pointHtml.match(/<span/g)).toHaveLength(32);
    expect(pointHtml).toContain('data-hp-zero-match="true"');
    expect(pointHtml).toContain('data-hp-zero-boundary="true"');
    expect(pointHtml.match(/data-hp-marker-boundary="true"/g)).toHaveLength(2);
    expect(pointHtml).toContain('data-hp-marker-kind="point"');
    expect(pointHtml).toContain('aria-description="HP基準 16n"');
    expect(appSource).toContain("通常HPで判定（Dmax増加は除外）");
    expect(appSource).not.toContain("hp-marker-rule-summary");
    expect(appSource).not.toContain("特殊しきい値");

    expect(css).toMatch(/\.hp-marker-trigger\s*\{[^}]*display:\s*grid;[^}]*place-items:\s*center;[^}]*height:\s*28px;[^}]*font-size:\s*11px;/s);
    expect(css).toMatch(/\.hp-marker-trigger-icon\s*\{[^}]*width:\s*var\(--desktop-icon-compact\);[^}]*height:\s*var\(--desktop-icon-compact\);/s);
    expect(css).toMatch(/\.mobile-target-open \.hp-marker-trigger-icon\s*\{[^}]*width:\s*var\(--mobile-icon-standard\);[^}]*height:\s*var\(--mobile-icon-standard\);/s);
    expect(css).toMatch(/\.hp-marker-popover\s*\{[^}]*width:\s*min\(310px, calc\(100vw - 16px\)\);[^}]*max-height:\s*min\(440px, var\(--radix-popover-content-available-height, 72vh\)\);/s);
    expect(css).toMatch(/\.hp-marker-rule-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\);/s);
    expect(css).toMatch(/\.sp-cell-bar span\[data-hp-marker-boundary="true"\]::before\s*\{[^}]*background:\s*linear-gradient\(180deg, var\(--gold\) 30%, var\(--hp-marker-fill-end\) 100%\);[^}]*pointer-events:\s*none;/s);
    expect(css).toMatch(/--hp-marker-edge:\s*#ffa100;/);
    expect(css).toMatch(/\.sp-cell-bar span\.active\[data-hp-marker-boundary="true"\]\s*\{[^}]*opacity:\s*1;/s);
    expect(css).toMatch(/\.sp-cell-bar span\.active\[data-hp-marker-boundary="true"\]::before\s*\{[^}]*border:\s*2px solid var\(--hp-marker-edge\);[^}]*box-shadow:\s*0 0 0 1px var\(--sp-marker-outer-edge\),\s*0 0 4px var\(--sp-marker-outer-glow\);/s);
    expect(css).toMatch(/\.sp-cell-bar\[data-hp-zero-boundary="true"\]::before\s*\{[^}]*left:\s*0;[^}]*width:\s*calc\(\(100% - 31px\) \/ 32 \+ 2px\);[^}]*transform:\s*translateX\(-50%\);[^}]*pointer-events:\s*none;/s);
    expect(css).toMatch(/\.sp-cell-bar\[data-hp-zero-boundary="true"\]::before\s*\{[^}]*border:\s*2px solid var\(--hp-marker-edge\);[^}]*box-shadow:\s*0 0 0 1px var\(--sp-marker-outer-edge\),\s*0 0 4px var\(--sp-marker-outer-glow\);/s);
    expect(css).toMatch(/\.sp-cell-bar\[data-hp-zero-match="true"\]:not\(\[data-hp-zero-boundary="true"\]\)::after\s*\{[^}]*left:\s*-1px;[^}]*width:\s*2px;[^}]*opacity:\s*0\.5;[^}]*pointer-events:\s*none;/s);
    expect(guideHtml).toContain("H行のHP基準ボタン（未選択時はスライダーアイコン）では、");
    expect(guideHtml).toContain("HP基準はDmax増加を除外した通常HPをSP 0〜32で実計算します。");
    expect(guideHtml).toContain("SP0が該当するときは、SP1と混同しないようバー左端の外側へ表示します。");
  });

  it("renders only A and C parameter rows for each virtual attacker", () => {
    const html = renderExampleApp();

    expect(html).toContain(">耐久条件<");
    expect(html).toContain(">状況条件<");
    expect(html).toContain('aria-label="耐久調整A 能力"');
    expect(html.indexOf(">状況条件<")).toBeLessThan(html.indexOf('class="attack-stat-section'));
    expect(html).not.toContain('id="scenario-defence-attack-a-stat-title">能力</h3>');
    expect(html).toContain(">調整対象条件<");
    expect(html).toContain(">耐久回数<");
    expect(html).toContain(">耐久確率<");
    expect(html).not.toContain("<span>詳細補正</span>");
    expect(html).not.toContain(">補正なし<");
    expect(html).toContain(">攻撃回数<");
    expect(html).toContain('aria-label="耐久調整A 参照能力"');
    expect(html).toContain('aria-label="耐久調整A A SP"');
    expect(html).toContain('aria-label="耐久調整A Aランク: 0"');
    expect(html).not.toContain('aria-label="耐久調整A C SP"');
    expect(html).not.toContain('aria-label="耐久調整A Cランク: 0"');
    expect(html).not.toContain('aria-label="耐久調整A H SP"');
    expect(html).not.toContain('aria-label="耐久調整A B SP"');
    expect(html).not.toContain('aria-label="耐久調整A D SP"');
    expect(html).not.toContain('aria-label="耐久調整A S SP"');
    expect(html).not.toContain('aria-label="耐久調整A Bランク: 0"');
    expect(html).not.toContain('aria-label="耐久調整A Dランク: 0"');
    expect(html).toContain('aria-label="耐久調整A 調整対象条件"');
    expect(html).toContain('aria-label="耐久調整A 調整対象Bランク: 0"');
    expect(html).toContain('aria-label="耐久調整A 調整対象Dランク: 0"');
    expect(html).not.toContain("（この攻撃のみ）");
  });

  it("shows only relevant defender stats for offense adjustment moves", () => {
    expect(getOffenseDefenderStatKeys("サイコキネシス")).toEqual(["hp", "spd"]);
    expect(getOffenseDefenderStatKeys("ふいうち")).toEqual(["hp", "def"]);
    expect(getOffenseDefenderStatKeys("イカサマ")).toEqual(["hp", "atk", "def"]);
    expect(getOffenseDefenderStatKeys("ジャイロボール")).toEqual(["hp", "def", "spe"]);
    expect(getOffenseDefenderStatKeys("")).toEqual(["hp", "def", "spd"]);

    const html = renderExampleApp();

    expect(html).toContain('aria-label="火力調整A 仮想敵能力"');
    expect(html).toContain('aria-label="火力調整A 仮想敵H SP"');
    expect(html).toContain('aria-label="火力調整A 仮想敵D SP"');
    expect(html).toContain('aria-label="火力調整A 仮想敵Dランク: 0"');
    expect(html).not.toContain('aria-label="火力調整A 仮想敵A SP"');
    expect(html).not.toContain('aria-label="火力調整A 仮想敵B SP"');
    expect(html).not.toContain('aria-label="火力調整A 仮想敵C SP"');
    expect(html).not.toContain('aria-label="火力調整A 仮想敵S SP"');
    expect(html).not.toContain('aria-label="火力調整A 仮想敵Bランク');
  });

  it("renders nature stat modifiers beside target and attacker SP fields", () => {
    expect(getNatureModifierDirection("ひかえめ", "spa")).toBe("up");
    expect(getNatureModifierDirection("ひかえめ", "atk")).toBe("down");
    expect(getNatureModifierDirection("いじっぱり", "atk")).toBe("up");
    expect(getNatureModifierDirection("いじっぱり", "spa")).toBe("down");
    expect(getNatureModifierDirection("おくびょう", "spe")).toBe("up");
    expect(getNatureModifierDirection("おくびょう", "atk")).toBe("down");
    expect(getNatureModifierDirection("ひかえめ", "hp")).toBeNull();
    expect(getNatureModifierDirection("がんばりや", "atk")).toBeNull();

    const html = renderExampleApp();

    expect(html).toContain('class="nature-stat-modifier up" aria-label="S 上昇"');
    expect(html).toContain('class="nature-stat-modifier down" aria-label="A 下降"');
    expect(html).toContain('class="nature-stat-modifier up" aria-label="A 上昇"');
    expect(html).not.toContain('class="nature-stat-modifier down" aria-label="C 下降"');
  });

  it("marks only non-empty unresolved entity inputs as invalid", () => {
    expect(isUnresolvedEntityInput("pokemon", "テラスタイプ")).toBe(true);
    expect(isUnresolvedEntityInput("pokemon", "メガスターミー")).toBe(false);
    expect(isUnresolvedEntityInput("item", "")).toBe(false);
  });

  it("caps target SP edits at the total 66 budget", () => {
    expect(clampTargetStatPointChange({
      hp: 10,
      atk: 20,
      def: 20,
      spa: 0,
      spd: 0,
      spe: 0,
    }, "hp", 32)).toBe(26);

    expect(clampTargetStatPointChange({
      hp: 26,
      atk: 20,
      def: 20,
      spa: 0,
      spd: 0,
      spe: 0,
    }, "atk", 5)).toBe(5);
  });

  it("renders candidate H/A/B/C/D/S SP values", () => {
    const html = renderToStaticMarkup(<CandidateStatPointSpread statPoints={{
      hp: 0,
      atk: 12,
      def: 16,
      spa: 20,
      spd: 32,
      spe: 4,
    }} />);

    expect(html).toContain('aria-label="H 0 / A 12 / B 16 / C 20 / D 32 / S 4 SP"');
    expect(html).toContain('class="candidate-stat-value hp"');
    expect(html).toContain(">H</span><span>0</span>");
    expect(html).toContain(">A</span><span>12</span>");
    expect(html).toContain(">C</span><span>20</span>");
    expect(html).toContain('class="candidate-sp-bars"');
    expect(html).toContain('aria-label="SPバー: H 0 / A 12 / B 16 / C 20 / D 32 / S 4"');
  });

  it("renders compact SP bars for candidate rows", () => {
    const html = renderToStaticMarkup(<CandidateStatPointBars statPoints={{
      hp: 9,
      atk: 0,
      def: 30,
      spa: 7,
      spd: 0,
      spe: 0,
    }} />);

    expect(html).toContain('class="candidate-sp-bars"');
    expect(html).toContain('aria-label="SPバー: H 9 / A 0 / B 30 / C 7 / D 0 / S 0"');
    expect(html).toContain('class="candidate-sp-bar hp"');
    expect(html).toContain('style="width:28.125%"');
    expect(html).toContain('class="candidate-sp-bar def"');
    expect(html).toContain('style="width:93.75%"');
    expect(html).toContain('class="candidate-sp-bar spa"');
  });

  it("renders only the first 20 result candidates on the initial page", () => {
    const [scenario] = createDefaultScenarioForms();
    const candidates: CandidateResult[] = Array.from({ length: 25 }, (_, index) => {
      const rank = index + 1;
      return {
        id: `candidate-${rank}`,
        rank,
        candidate: { hp: rank, def: 0, spd: 0 },
        bulkScore: { overallBulk: rank, physicalBulk: rank, specialBulk: rank },
        appliedStatPoints: { hp: rank, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        appliedEvs: { hp: rank, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        usedStatPointBudget: rank,
        remainingStatPointBudget: 66 - rank,
        usedEvBudget: rank,
        remainingEvBudget: 66 - rank,
        passed: true,
        scenarioResults: [],
        bottleneckLabel: `表示候補${rank}`,
      };
    });

    const html = renderToStaticMarkup(
      <ResultsPanel
        candidates={candidates}
        passingCandidateCount={25}
        selectedCandidateId={null}
        appliedCandidateId={null}
        scenarios={[scenario]}
        status="complete"
        offenseResults={[]}
        speedResults={[]}
        strictestFailureLabel={null}
        targetLabel="メガマフォクシー"
        resultAlertMessage={null}
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).toContain("候補 25 件 / 1-20 件目");
    expect(html).toContain("1 / 2");
    expect(html).toContain("表示候補20");
    expect(html).not.toContain("表示候補21");
  });

  it("keeps the mobile candidate workflow inline with five candidates per page", () => {
    const [scenario] = createDefaultScenarioForms();
    const candidates: CandidateResult[] = Array.from({ length: 12 }, (_, index) => {
      const rank = index + 1;
      const usedStatPointBudget = rank === 1 ? 33 : rank === 2 ? 64 : rank === 3 ? 0 : rank === 4 ? 66 : rank;
      return {
        id: `candidate-${rank}`,
        rank,
        candidate: { hp: rank, def: 0, spd: 0 },
        bulkScore: { overallBulk: rank, physicalBulk: rank, specialBulk: rank },
        appliedStatPoints: { hp: rank, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        appliedEvs: { hp: rank, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
        usedStatPointBudget,
        remainingStatPointBudget: 66 - usedStatPointBudget,
        usedEvBudget: rank,
        remainingEvBudget: 66 - rank,
        passed: true,
        scenarioResults: [],
        bottleneckLabel: `モバイル候補${rank}`,
      };
    });

    const html = renderToStaticMarkup(
      <ResultsPanel
        displayMode="mobile-inline"
        pageSize={5}
        candidates={candidates}
        passingCandidateCount={12}
        selectedCandidateId="candidate-1"
        appliedCandidateId={null}
        scenarios={[scenario]}
        status="complete"
        offenseResults={[]}
        speedResults={[]}
        strictestFailureLabel={null}
        targetLabel="メガマフォクシー"
        resultAlertMessage={null}
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).toContain('class="mobile-candidate-results mobile-candidate-layout"');
    expect(html).toContain('id="mobile-candidate-title"');
    expect(html).toContain("候補 12 件 / 1-5 件目");
    expect(html).toContain("1-5 / 12");
    expect(html).toContain("1 / 3");
    expect(html).toContain("並び替え");
    expect(html).toContain("順序");
    expect(html).toContain("モバイル候補5");
    expect(html).not.toContain("モバイル候補6");
    expect(html).toContain("--candidate-used-track:33fr;--candidate-remaining-track:33fr");
    expect(html).toContain("--candidate-used-track:64fr;--candidate-remaining-track:2fr");
    expect(html).toContain("--candidate-used-track:0fr;--candidate-remaining-track:66fr");
    expect(html).toContain("--candidate-used-track:66fr;--candidate-remaining-track:0fr");
    expect(html).toContain('class="candidate-budget-value used is-budget-full"');
    expect(html).toContain('class="candidate-budget-value remaining has-remaining"');
    expect(html).toContain('class="candidate-budget-value remaining is-zero"');
    expect(html).toContain('<span class="visually-hidden">使用SP</span>33');
    expect(html).toContain('<span class="visually-hidden">残りSP</span>33');
    expect(html).toContain("最厳条件: モバイル候補1");
    expect(html.match(/位の候補を調整対象へ適用/g)).toHaveLength(5);
    expect(html).toContain('id="mobile-candidate-1-details"');
    expect(html).not.toContain('class="mobile-sheet-close"');
    expect(html.indexOf('class="candidate-table"')).toBeLessThan(
      html.indexOf('class="candidate-page-actions mobile-candidate-page-actions"'),
    );
  });

  it("sorts result candidates by the selected full-list key before pagination", () => {
    const makeCandidate = (
      id: string,
      rank: number,
      statPoints: CandidateResult["appliedStatPoints"],
      margin: number,
      bulkScore: CandidateResult["bulkScore"] = {
        overallBulk: rank * 100,
        physicalBulk: rank * 200,
        specialBulk: rank * 300,
      },
    ): CandidateResult => ({
      id,
      rank,
      candidate: { hp: statPoints.hp, def: statPoints.def, spd: statPoints.spd },
      bulkScore,
      appliedStatPoints: statPoints,
      appliedEvs: statPoints,
      usedStatPointBudget: statPoints.hp + statPoints.atk + statPoints.def + statPoints.spa + statPoints.spd + statPoints.spe,
      remainingStatPointBudget: 66 - statPoints.hp - statPoints.atk - statPoints.def - statPoints.spa - statPoints.spd - statPoints.spe,
      usedEvBudget: 0,
      remainingEvBudget: 0,
      passed: true,
      bottleneckLabel: `${id} ${margin}`,
      scenarioResults: [{
        scenarioId: "scenario-a",
        passed: true,
        survivalProbability: 0.5 + margin,
        requiredSurvivedHits: 1,
        minSurvivalProbability: 0.5,
        hitEvaluations: [],
        bottleneckLabel: `${id} ${margin}`,
      }],
    });
    const lowHp = makeCandidate(
      "low-hp",
      1,
      { hp: 1, atk: 0, def: 1, spa: 0, spd: 0, spe: 0 },
      0.01,
      { overallBulk: 100, physicalBulk: 200, specialBulk: 300 },
    );
    const highHp = makeCandidate(
      "high-hp",
      2,
      { hp: 20, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
      0.2,
      { overallBulk: 200, physicalBulk: 400, specialBulk: 600 },
    );
    const tiedBulkRankOne = makeCandidate(
      "tied-bulk-rank-one",
      1,
      { hp: 2, atk: 0, def: 2, spa: 0, spd: 0, spe: 0 },
      0.03,
      { overallBulk: 150, physicalBulk: 250, specialBulk: 350 },
    );
    const tiedBulkRankThree = makeCandidate(
      "tied-bulk-rank-three",
      3,
      { hp: 3, atk: 0, def: 3, spa: 0, spd: 0, spe: 0 },
      0.04,
      { overallBulk: 150, physicalBulk: 250, specialBulk: 350 },
    );

    expect(compareResultCandidates(highHp, lowHp, "hp", "desc")).toBeLessThan(0);
    expect(compareResultCandidates(lowHp, highHp, "used", "asc")).toBeLessThan(0);
    expect(compareResultCandidates(highHp, lowHp, "margin", "desc")).toBeLessThan(0);
    expect(compareResultCandidates(lowHp, highHp, "recommended", "asc")).toBeLessThan(0);
    for (const sortKey of ["overallBulk", "physicalBulk", "specialBulk"] as const) {
      expect(compareResultCandidates(highHp, lowHp, sortKey, "desc")).toBeLessThan(0);
      expect(compareResultCandidates(highHp, lowHp, sortKey, "asc")).toBeGreaterThan(0);
      expect(compareResultCandidates(tiedBulkRankThree, tiedBulkRankOne, sortKey, "desc")).toBeGreaterThan(0);
      expect(compareResultCandidates(tiedBulkRankThree, tiedBulkRankOne, sortKey, "asc")).toBeGreaterThan(0);
    }
  });

  it("labels failed scenario results as FAIL", () => {
    expect(formatScenarioResultStatusLabel(true)).toBe("PASS");
    expect(formatScenarioResultStatusLabel(false)).toBe("FAIL");
  });

  it("localizes Smogon damage descriptions for the selected candidate detail", () => {
    expect(formatLocalizedDamageDescription(
      "252+ Atk Kingambit Sucker Punch vs. 92 HP / 52 Def Starmie-Mega: 122-146 (82.9 - 99.3%) -- guaranteed 2HKO",
    )).toBe("A32+ ドドゲザン ふいうち → H12 / B7 メガスターミー : 122-146 (82.9-99.3%) / 確定2発");
    expect(formatLocalizedDamageDescription(
      "252+ Atk Kingambit Sucker Punch vs. 68 HP / 236 Def Delphox-Mega: 134-158 (84.2 - 99.3%) -- guaranteed 2HKO",
    )).toBe("A32+ ドドゲザン ふいうち → H9 / B30 メガマフォクシー : 134-158 (84.2-99.3%) / 確定2発");
    expect(formatLocalizedDamageDescription(
      "252 SpA Raichu Grass Knot (120 BP) vs. 0 HP / 0 SpD Snorlax: 186-220 (79.1 - 93.6%) -- guaranteed 2HKO",
    )).toBe("C32 ライチュウ くさむすび (威力120) → H0 / D0 カビゴン : 186-220 (79.1-93.6%) / 確定2発");
    expect(formatLocalizedDamageDescription(
      "0 Atk Mew Knock Off (97.5 BP) vs. 0 HP / 0 Def Mew: 140-166 (41 - 48.6%) -- guaranteed 3HKO",
    )).toContain("(威力97.5)");
  });

  it("localizes the reported burn and Leftovers annotations with battle terminology", () => {
    expect(formatLocalizedDamageDescription(
      "252 Atk Adaptability Basculegion Last Respects vs. 0 HP / 0 Def Garchomp: 56-66 (30.6 - 36%) -- guaranteed 3HKO after burn damage",
    )).toBe(
      "A32 てきおうりょく イダイトウ オスのすがた おはかまいり → H0 / B0 ガブリアス : 56-66 (30.6-36%) / 確定3発（やけどダメージ込み）",
    );
    expect(formatLocalizedDamageDescription(
      "252 Atk Garchomp Earthquake vs. 0 HP / 0 Def Garchomp: 90-106 (49.1 - 57.9%) -- 57.4% chance to 2HKO after Leftovers recovery",
    )).toBe(
      "A32 ガブリアス じしん → H0 / B0 ガブリアス : 90-106 (49.1-57.9%) / 乱数2発（57.4%・たべのこし回復込み）",
    );
  });

  it.each([
    ["Dry Skin damage", "かんそうはだダメージ"],
    ["Solar Power damage", "サンパワーダメージ"],
    ["Dry Skin recovery", "かんそうはだ回復"],
    ["Rain Dish recovery", "あめうけざら回復"],
    ["sandstorm damage", "すなあらしダメージ"],
    ["Ice Body recovery", "アイスボディ回復"],
    ["Leftovers recovery", "たべのこし回復"],
    ["Black Sludge recovery", "くろいヘドロ回復"],
    ["Black Sludge damage", "くろいヘドロダメージ"],
    ["Sticky Barb damage", "くっつきバリダメージ"],
    ["Grassy Terrain recovery", "グラスフィールド回復"],
    ["Poison Heal", "ポイズンヒール"],
    ["poison damage", "どくダメージ"],
    ["toxic damage", "もうどくダメージ"],
    ["reduced burn damage", "やけどダメージ（たいねつ）"],
    ["burn damage", "やけどダメージ"],
    ["Bad Dreams", "ナイトメア"],
    ["trapping damage", "バインドダメージ"],
    ["Vine Lash damage", "キョダイベンタツダメージ"],
    ["Wildfire damage", "キョダイゴクエンダメージ"],
    ["Cannonade damage", "キョダイホウゲキダメージ"],
    ["Volcalith damage", "キョダイフンセキダメージ"],
  ])("localizes the reachable residual annotation %s", (english, japanese) => {
    expect(formatLocalizedDamageDescription(
      `252 Atk Mew Earthquake vs. 0 HP / 0 Def Garchomp: 90-106 (49.1 - 57.9%) -- guaranteed 2HKO after ${english}`,
    )).toContain(`/ 確定2発（${japanese}込み）`);
  });

  it("localizes combined, approximate, and nested KO annotations", () => {
    expect(formatLocalizedDamageDescription(
      "252 Atk Mew Earthquake vs. 0 HP / 0 Def Garchomp: 40-48 (21.8 - 26.2%) -- possible 5HKO",
    )).toContain("/ 乱数5発");
    expect(formatLocalizedDamageDescription(
      "252 Atk Mew Earthquake vs. 0 HP / 0 Def Garchomp: 90-106 (49.1 - 57.9%) -- 30.5% chance to 2HKO",
    )).toContain("/ 乱数2発（30.5%）");
    expect(formatLocalizedDamageDescription(
      "252 Atk Mew Earthquake vs. 0 HP / 0 Def Garchomp: 90-106 (49.1 - 57.9%) -- 8.9% chance to 4HKO after sandstorm damage, Leftovers recovery, Grassy Terrain recovery, and burn damage",
    )).toContain(
      "/ 乱数4発（8.9%・すなあらしダメージ・たべのこし回復・グラスフィールド回復・やけどダメージ込み）",
    );
    expect(formatLocalizedDamageDescription(
      "252 Atk Mew Bullet Seed (5 hits) vs. 0 HP / 0 Def Garchomp: 15-20 (46.8 - 62.5%) -- approx. possible 8HKO",
    )).toContain("/ 乱数8発（概算）");
    expect(formatLocalizedDamageDescription(
      "252 Atk Mew Bullet Seed (5 hits) vs. 0 HP / 0 Def Garchomp: 15-20 (46.8 - 62.5%) -- approx. 95.6% chance to 2HKO after sandstorm damage and poison damage",
    )).toContain("/ 乱数2発（95.6%・すなあらしダメージ・どくダメージ込み・概算）");
    expect(formatLocalizedDamageDescription(
      "252 Atk Mew Earthquake vs. 0 HP / 0 Def Garchomp: 90-106 (49.1 - 57.9%) -- 81.3% chance to OHKO (guaranteed OHKO after burn damage)",
    )).toContain("/ 乱数1発（81.3%・やけどダメージ込みで確定1発）");
    expect(formatLocalizedDamageDescription(
      "252 Atk Mew Earthquake vs. 0 HP / 0 Def Garchomp: 90-106 (49.1 - 57.9%) -- 25% chance to OHKO (62.5% chance to OHKO after burn damage)",
    )).toContain("/ 乱数1発（25%・やけどダメージ込みで62.5%）");
    expect(formatLocalizedDamageDescription(
      "252 Atk Mew Bullet Seed (5 hits) vs. 0 HP / 0 Def Garchomp: 90-106 (49.1 - 57.9%) -- approx. 25% chance to OHKO (approx. 62.5% chance to OHKO after burn damage)",
    )).toContain("/ 乱数1発（25%・やけどダメージ込みで62.5%・概算）");
  });

  it("localizes reachable Smogon description modifiers without changing entity names", () => {
    const formatted = formatLocalizedDamageDescription(
      "252 Atk Rivalry buffed burned Tera Fire Mew Battery boosted with an ally's Flower Gift Earthquake (100 BP Water) (3 hits) vs. 0 HP / 0 Def Dynamax Tera Steel Garchomp in Sun and Electric Terrain through Reflect with an ally's Friend Guard on a critical hit: 90-106 (49.1 - 57.9%) -- guaranteed 2HKO",
    );
    for (const expected of [
      "とうそうしん（強化）",
      "やけど状態",
      "テラスタル（ほのお）",
      "味方のバッテリー補正",
      "味方のフラワーギフト補正",
      "（威力100・みず）",
      "（3ヒット）",
      "ダイマックス",
      "テラスタル（はがね）",
      "（晴れ・エレキフィールド）",
      "（リフレクター）",
      "味方のフレンドガード補正",
      "（急所）",
    ]) {
      expect(formatted).toContain(expected);
    }
    expect(formatted).not.toMatch(/\b(?:Rivalry|buffed|burned|Tera|Battery|boosted|with|ally|BP|hits|Dynamax|Sun|Electric|Terrain|through|Reflect|critical)\b/);
  });

  it.each([
    ["Rivalry nerfed Mew Earthquake", "とうそうしん（弱化）"],
    ["Mew Power Spot boosted Earthquake", "味方のパワースポット補正"],
    ["Mew with an ally's Steely Spirit Iron Head", "味方のはがねのせいしん補正"],
    ["Mew Earthquake vs. 0 HP / 0 Def Garchomp with an ally's Aurora Veil", "オーロラベール"],
    ["Mew Psychic vs. 0 HP / 0 SpD Garchomp through Light Screen", "ひかりのかべ"],
  ])("localizes the remaining description modifier in %s", (body, expected) => {
    const description = body.includes(" vs. ")
      ? `252 Atk ${body}: 90-106 (49.1 - 57.9%) -- guaranteed 2HKO`
      : `252 Atk ${body} vs. 0 HP / 0 Def Garchomp: 90-106 (49.1 - 57.9%) -- guaranteed 2HKO`;
    expect(formatLocalizedDamageDescription(description)).toContain(expected);
  });

  it.each([
    ["Sun", "晴れ"],
    ["Rain", "雨"],
    ["Sand", "砂"],
    ["Snow", "雪"],
    ["Electric Terrain", "エレキフィールド"],
    ["Grassy Terrain", "グラスフィールド"],
    ["Misty Terrain", "ミストフィールド"],
    ["Psychic Terrain", "サイコフィールド"],
  ])("localizes the field condition %s", (english, japanese) => {
    expect(formatLocalizedDamageDescription(
      `252 Atk Mew Earthquake vs. 0 HP / 0 Def Garchomp in ${english}: 90-106 (49.1 - 57.9%) -- guaranteed 2HKO`,
    )).toContain(`ガブリアス（${japanese}）`);
  });

  it("localizes manual levels and preserves unknown future residual text", () => {
    const levels = formatLocalizedDamageDescription(
      "Lvl 73 252 Atk Mew Earthquake vs. Lvl 50 0 HP / 0 Def Garchomp: 90-106 (49.1 - 57.9%) -- guaranteed 2HKO",
    );
    expect(levels).toContain("Lv.73");
    expect(levels).toContain("Lv.50");
    expect(levels).not.toContain("Lvl");

    expect(formatLocalizedDamageDescription(
      "252 Atk Mew Earthquake vs. 0 HP / 0 Def Garchomp: 90-106 (49.1 - 57.9%) -- guaranteed 2HKO after future effect",
    )).toContain("-- guaranteed 2HKO after future effect");
  });

  it("does not treat canonical move names as standalone Tera or Dynamax modifiers", () => {
    const dynamaxCannon = formatLocalizedDamageDescription(
      "252 SpA Eternatus Dynamax Cannon vs. 0 HP / 0 SpD Garchomp: 90-106 (49.1 - 57.9%) -- guaranteed 2HKO",
    );
    expect(dynamaxCannon).toContain("ムゲンダイナ ダイマックスほう");
    expect(dynamaxCannon).not.toContain("ダイマックス Cannon");

    const teraBlast = formatLocalizedDamageDescription(
      "252 SpA Mew Tera Blast vs. 0 HP / 0 SpD Garchomp: 90-106 (49.1 - 57.9%) -- guaranteed 2HKO",
    );
    expect(teraBlast).toContain("ミュウ テラバースト");
    expect(teraBlast).not.toContain("テラスタル（Blast）");
  });

  it("integrates the selected candidate detail into the candidate list", () => {
    const candidate: CandidateResult = {
      id: "candidate-2",
      rank: 2,
      candidate: { hp: 6, def: 13, spd: 0 },
      bulkScore: { overallBulk: 1234, physicalBulk: 2345, specialBulk: 3456 },
      appliedStatPoints: { hp: 6, atk: 0, def: 13, spa: 0, spd: 0, spe: 0 },
      appliedEvs: { hp: 44, atk: 0, def: 100, spa: 0, spd: 0, spe: 0 },
      usedStatPointBudget: 19,
      remainingStatPointBudget: 47,
      usedEvBudget: 144,
      remainingEvBudget: 366,
      passed: true,
      bottleneckLabel: "シナリオA +0.0%",
      scenarioResults: [{
        scenarioId: "scenario-a",
        passed: true,
        survivalProbability: 1,
        requiredSurvivedHits: 1,
        minSurvivalProbability: 1,
        bottleneckLabel: "シナリオA +0.0%",
        hitEvaluations: [{
          hitId: "hit-a",
          damageRolls: [122, 146],
          damageRange: { min: 122, max: 146, percentMin: 82.9, percentMax: 99.3 },
          description: "252+ Atk Kingambit Sucker Punch vs. 92 HP / 52 Def Starmie-Mega: 122-146 (82.9 - 99.3%) -- guaranteed 2HKO",
          movePower: {
            catalogBasePower: 70,
            appliedBasePower: 70,
            source: "standard" as const,
          },
        }],
      }],
    };
    const [scenario] = createDefaultScenarioForms();
    const offenseScenario = {
      ...scenario,
      id: "scenario-offense-test",
      label: "シナリオ2",
      adjustmentType: "offense" as const,
      attacks: [{
        ...scenario.attacks[0],
        id: "attack-offense-test",
        label: "火力調整A",
        attackerPokemonInput: "メガゲンガー",
        moveInput: "サイコキネシス",
      }],
    };
    const offenseResults = [{
      id: "scenario-offense-test:attack-offense-test:spa",
      scenarioId: "scenario-offense-test",
      scenarioLabel: "シナリオ2",
      attackId: "attack-offense-test",
      attackLabel: "火力調整A",
      result: {
        id: "offense-result-test",
        status: "pass" as const,
        passed: true,
        label: "Cライン",
        owner: "attacker" as const,
        stat: "spa" as const,
        role: "damage" as const,
        canApply: false,
        requiredStatPoints: 7,
        actualStat: 186,
        koProbability: 1,
        targetKoProbability: 1,
        damageRange: { min: 168, max: 198, percentMin: 100.6, percentMax: 118.6 },
        movePower: {
          catalogBasePower: 90,
          appliedBasePower: 90,
          source: "standard" as const,
        },
        hpEventEvaluations: [
          {
            cardId: "offense-adjustment-card",
            eventId: "sand-ko",
            effectId: "sandstorm-damage",
            label: "すなあらしダメージ",
            subject: "defender" as const,
            subjectBuildId: "offense-defender",
            timing: "endOfTurn" as const,
            frequency: "perTurn" as const,
            sequenceContext: "currentMove" as const,
            occurrence: 1,
            damage: 10,
            applied: true,
            activationProbability: 1,
            supported: true,
          },
          {
            cardId: "offense-adjustment-card",
            eventId: "substitute-cost",
            effectId: "move-hp-cost:substitute",
            label: "みがわりのHP消費",
            subject: "attacker" as const,
            subjectBuildId: "offense-attacker",
            timing: "beforeMove" as const,
            frequency: "perMove" as const,
            sequenceContext: "currentMove" as const,
            occurrence: 1,
            damage: 25,
            changeKind: "hpCost" as const,
            applied: true,
            activationProbability: 1,
            supported: true,
          },
          {
            cardId: "offense-adjustment-card",
            eventId: "wild-charge-recoil",
            effectId: "move-damage-recoil",
            label: "ワイルドボルトの反動",
            subject: "attacker" as const,
            subjectBuildId: "offense-attacker",
            timing: "afterMove" as const,
            frequency: "perMove" as const,
            sequenceContext: "currentMove" as const,
            occurrence: 1,
            damage: 12,
            damageRange: { min: 12, max: 15 },
            changeKind: "recoil" as const,
            applied: true,
            activationProbability: 1,
            supported: true,
          },
          {
            cardId: "offense-adjustment-card",
            eventId: "final-gambit-faint",
            effectId: "move-forced-faint:final-gambit",
            label: "いのちがけの使用者ひんし",
            subject: "attacker" as const,
            subjectBuildId: "offense-attacker",
            timing: "afterHit" as const,
            frequency: "once" as const,
            sequenceContext: "currentMove" as const,
            occurrence: 1,
            damage: 173,
            changeKind: "forcedFaint" as const,
            applied: true,
            activationProbability: 1,
            supported: true,
          },
        ],
        reason: "PASS",
      },
    }];
    const resultsPanelBaseProps = {
      offenseResults,
      speedResults: [],
      strictestFailureLabel: null,
      targetLabel: "メガマフォクシー",
      resultAlertMessage: null,
    };
    const closedHtml = renderToStaticMarkup(
      <ResultsPanel
        {...resultsPanelBaseProps}
        candidates={[candidate]}
        selectedCandidateId={null}
        appliedCandidateId={null}
        scenarios={[{ ...scenario, id: "scenario-a", label: "シナリオA" }, offenseScenario]}
        status="complete"
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );
    const html = renderToStaticMarkup(
      <ResultsPanel
        {...resultsPanelBaseProps}
        candidates={[candidate]}
        selectedCandidateId={candidate.id}
        appliedCandidateId={null}
        scenarios={[{ ...scenario, id: "scenario-a", label: "シナリオA" }, offenseScenario]}
        status="complete"
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).toContain(">最厳条件<");
    expect(html).toContain(">H/A/B/C/D/S<");
    expect(html).toContain('class="candidate-budget-value used"');
    expect(html).toContain('class="candidate-budget-value remaining has-remaining"');
    expect(html).toContain('class="candidate-bottleneck"');
    expect(html).toContain("シナリオA +0.0%");
    expect(html).toContain("最厳条件: シナリオA +0.0%");
    expect(html).toContain('class="candidate-sp-bars"');
    expect(html).toContain('aria-label="SPバー: H 6 / A 0 / B 13 / C 0 / D 0 / S 0"');
    expect(html).toContain(">H</span><span>6</span>");
    expect(html).toContain(">A</span><span>0</span>");
    expect(html).toContain(">B</span><span>13</span>");
    expect(html).toContain(">適用<");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('data-state="open"');
    expect(html).toContain('class="candidate-disclosure"');
    expect(html).not.toContain("▼");
    expect(html).not.toContain("▲");
    expect(html).toContain("シナリオA / 耐久調整A</strong><span>威力 70 / A32+ ドドゲザン ふいうち → H12 / B7 メガスターミー : 122-146 (82.9-99.3%) / 確定2発");
    expect(html).toContain("シナリオ2</strong><span>KO率 100.0%");
    expect(html).toContain("シナリオ2</strong><span>威力 90 / C7 メガマフォクシー サイコキネシス → メガゲンガー : 168-198 (100.6-118.6%) / KO率 100.0%");
    expect(html).toContain("シナリオ2 / 定数ダメージ・回復</strong><span>すなあらしダメージ / 仮想敵 / ターン終了時・ターンごと: 10ダメージ");
    expect(html).toContain("みがわりのHP消費 / 調整対象 / 技使用前・技ごと: 25消費");
    expect(html).toContain("ワイルドボルトの反動 / 調整対象 / 技使用後・技ごと: 12-15反動");
    expect(html).toContain("いのちがけの使用者ひんし / 調整対象 / ヒット後・1回: ひんし");
    expect(html).not.toContain("火力ライン結果");
    expect(closedHtml).toContain('aria-expanded="false"');
    expect(closedHtml).toContain('data-state="closed"');
    expect(closedHtml).not.toContain("▼");
    expect(closedHtml).not.toContain("▲");
    expect(closedHtml).not.toContain("A32+ ドドゲザン ふいうち");
    expect(closedHtml).not.toContain("C7 メガマフォクシー サイコキネシス");
  });

  it("shows standalone firepower line results when no defence scenario is enabled", () => {
    const [scenario] = createDefaultScenarioForms();
    const offenseScenario = {
      ...scenario,
      id: "scenario-offense-only",
      label: "火力のみ",
      enabled: true,
      adjustmentType: "offense" as const,
      attacks: [{
        ...scenario.attacks[0],
        id: "attack-grass-knot",
        label: "くさむすび",
        attackerPokemonInput: "カビゴン",
        moveInput: "くさむすび",
      }],
    };
    const offenseResults = [{
      id: "scenario-offense-only-attack-grass-knot-spa",
      scenarioId: "scenario-offense-only",
      scenarioLabel: "火力のみ",
      attackId: "attack-grass-knot",
      attackLabel: "くさむすび",
      result: {
        id: "spa-line",
        status: "pass" as const,
        passed: true,
        label: "Cライン",
        owner: "attacker" as const,
        stat: "spa" as const,
        role: "damage" as const,
        canApply: true,
        requiredStatPoints: 12,
        actualStat: 156,
        koProbability: 1,
        targetKoProbability: 1,
        damageRange: { min: 180, max: 216, percentMin: 102.8, percentMax: 123.4 },
        hpEventEvaluations: [],
        reason: "Cライン 12 SPでKO条件を満たします",
      },
    }];

    const html = renderToStaticMarkup(
      <ResultsPanel
        candidates={[]}
        selectedCandidateId={null}
        appliedCandidateId={null}
        scenarios={[offenseScenario]}
        status="idle"
        offenseResults={offenseResults}
        speedResults={[]}
        strictestFailureLabel={null}
        targetLabel="メガライチュウ"
        resultAlertMessage={null}
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).toContain("火力・素早さライン結果");
    expect(html).toContain(">Cライン</strong>");
    expect(html).toContain("火力のみ / くさむすび");
    expect(html).toContain("KO 100.0%");
    expect(html).toContain('aria-label="Cラインを調整対象へ適用"');
    expect(html).toContain(">適用</button>");
    expect(html).not.toContain(">計算結果</div>");
  });

  it("labels each expanded damage line with its attack card inside multi-attack scenarios", () => {
    const candidate: CandidateResult = {
      id: "candidate-multi",
      rank: 1,
      candidate: { hp: 8, def: 12, spd: 4 },
      bulkScore: { overallBulk: 4567, physicalBulk: 5678, specialBulk: 6789 },
      appliedStatPoints: { hp: 8, atk: 0, def: 12, spa: 0, spd: 4, spe: 0 },
      appliedEvs: { hp: 60, atk: 0, def: 92, spa: 0, spd: 28, spe: 0 },
      usedStatPointBudget: 24,
      remainingStatPointBudget: 42,
      usedEvBudget: 180,
      remainingEvBudget: 328,
      passed: true,
      bottleneckLabel: "連続被弾 +1.0%",
      scenarioResults: [{
        scenarioId: "scenario-multi",
        passed: true,
        survivalProbability: 1,
        requiredSurvivedHits: 2,
        minSurvivalProbability: 1,
        bottleneckLabel: "連続被弾 +1.0%",
        hitEvaluations: [
          {
            hitId: "scenario-multi-hit-1",
            damageRolls: [40],
            damageRange: { min: 40, max: 40, percentMin: 25, percentMax: 25 },
          },
          {
            hitId: "scenario-multi-hit-2",
            damageRolls: [50],
            damageRange: { min: 50, max: 50, percentMin: 31.3, percentMax: 31.3 },
          },
        ],
        hpEventEvaluations: [{
          cardId: "scenario-multi-hit-1",
          eventId: "sand-after-first-hit",
          effectId: "sandstorm-damage",
          label: "すなあらしダメージ",
          subject: "defender",
          subjectBuildId: "target",
          timing: "endOfTurn",
          frequency: "perTurn",
          sequenceContext: "currentMove",
          occurrence: 1,
          damage: 11,
          applied: true,
          activationProbability: 1,
          supported: true,
        }],
      }],
    };
    const [baseScenario] = createDefaultScenarioForms();
    const scenario = {
      ...baseScenario,
      id: "scenario-multi",
      label: "連続被弾",
      attacks: [
        { ...baseScenario.attacks[0], id: "attack-a", label: "攻撃A", moveInput: "" },
        { ...baseScenario.attacks[0], id: "attack-b", label: "攻撃B", moveInput: "ふいうち" },
        { ...baseScenario.attacks[0], id: "attack-c", label: "攻撃C", moveInput: "サイコキネシス" },
      ],
    };
    const html = renderToStaticMarkup(
      <ResultsPanel
        candidates={[candidate]}
        selectedCandidateId={candidate.id}
        appliedCandidateId={null}
        scenarios={[scenario]}
        status="complete"
        offenseResults={[]}
        speedResults={[]}
        strictestFailureLabel={null}
        targetLabel="メガマフォクシー"
        resultAlertMessage={null}
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).toContain("連続被弾 / 耐久調整B</strong><span>被ダメージ 40 (25.0-25.0%)");
    expect(html).toContain("連続被弾 / 耐久調整B / 定数ダメージ・回復</strong><span>すなあらしダメージ / 調整対象 / ターン終了時・ターンごと: 11ダメージ");
    expect(html).toContain("連続被弾 / 耐久調整C</strong><span>被ダメージ 50 (31.3-31.3%)");
  });

  it("places integrated firepower failures in the candidate list", () => {
    const [scenario] = createDefaultScenarioForms();
    const html = renderToStaticMarkup(
      <ResultsPanel
        candidates={[]}
        selectedCandidateId={null}
        appliedCandidateId={null}
        scenarios={[scenario]}
        status="idle"
        offenseResults={[]}
        speedResults={[]}
        strictestFailureLabel="シナリオ1 -6.3%"
        targetLabel="メガマフォクシー"
        resultAlertMessage="火力調整条件を候補一覧へ統合できません: シナリオ2 / 火力調整A: 最大SPでも指定KO率に届きません"
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).toContain("候補一覧");
    expect(html).toContain(">FAIL</strong>");
    expect(html).toContain("すべてのシナリオを満たす候補を作れません");
    expect(html).toContain("最厳条件: シナリオ2 / 火力調整A: 最大SPでも指定KO率に届きません");
    expect(html).not.toContain("最厳条件: シナリオ1 -6.3%");
    expect(html).not.toContain("火力ライン結果");
  });

  it("shows the strictest condition when a completed search has no candidates", () => {
    const [scenario] = createDefaultScenarioForms();
    const html = renderToStaticMarkup(
      <ResultsPanel
        candidates={[]}
        selectedCandidateId={null}
        appliedCandidateId={null}
        scenarios={[scenario]}
        status="complete"
        offenseResults={[]}
        speedResults={[]}
        strictestFailureLabel="シナリオ1 -6.3%"
        targetLabel="メガマフォクシー"
        resultAlertMessage={null}
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).toContain(">FAIL</strong>");
    expect(html).toContain("すべてのシナリオを満たす候補が見つかりません");
    expect(html).not.toContain("必要耐久・生存率・固定SPをゆるめてください");
    expect(html).toContain("最厳条件: シナリオ1 -6.3%");
  });

  it("keeps speed line details inside expanded candidates without the separate result panel", () => {
    const [scenario] = createDefaultScenarioForms();
    const speedScenario = {
      ...scenario,
      id: "scenario-speed-test",
      label: "素早さ調整",
      adjustmentType: "speed" as const,
      attacks: [{
        ...scenario.attacks[0],
        id: "attack-speed-test",
        label: "最速ピカチュウ",
        attackerPokemonInput: "ピカチュウ",
        speedTargetMode: "manual" as const,
        speedTargetValue: 150,
      }],
    };
    const candidate: CandidateResult = {
      id: "candidate-speed",
      rank: 1,
      candidate: { hp: 3, def: 32, spd: 0 },
      bulkScore: { overallBulk: 7890, physicalBulk: 8901, specialBulk: 9012 },
      appliedStatPoints: { hp: 3, atk: 0, def: 32, spa: 2, spd: 0, spe: 12 },
      appliedEvs: { hp: 20, atk: 0, def: 252, spa: 12, spd: 0, spe: 92 },
      usedStatPointBudget: 49,
      remainingStatPointBudget: 17,
      usedEvBudget: 376,
      remainingEvBudget: 132,
      passed: true,
      bottleneckLabel: "シナリオ1 +3.7%",
      scenarioResults: [],
    };
    const html = renderToStaticMarkup(
      <ResultsPanel
        candidates={[candidate]}
        selectedCandidateId={candidate.id}
        appliedCandidateId={null}
        scenarios={[speedScenario]}
        status="idle"
        offenseResults={[]}
        speedResults={[{
          id: "scenario-speed-test-attack-speed-test-speed-line",
          scenarioId: "scenario-speed-test",
          scenarioLabel: "素早さ調整",
          attackId: "attack-speed-test",
          attackLabel: "最速ピカチュウ",
          result: {
            id: "speed-line",
            status: "pass",
            passed: true,
            canApply: true,
            label: "Sライン",
            comparison: "outspeed",
            orderMode: "normal",
            relation: "outspeed",
            requiredStatPoints: 12,
            actualSpeed: 151,
            targetSpeed: 150,
            requiredSpeed: 151,
            targetStatPoints: 0,
            notes: ["こだわりスカーフ 1.5倍"],
            reason: "確定抜きは S12 SPで達成します",
          },
        }]}
        strictestFailureLabel={null}
        targetLabel="メガマフォクシー"
        resultAlertMessage={null}
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).not.toContain("Sライン結果");
    expect(html).not.toContain("候補一覧の固定Sへ自動統合されます");
    expect(html).not.toContain("S適用");
    expect(html).toContain("素早さ調整</strong>");
    expect(html).toContain("相手S 150");
    expect(html).toContain(">PASS</em>");
    expect(html).toContain("S12 メガマフォクシー → 任意S150 : 自分 151 / 相手 150 / 抜ける / こだわりスカーフ 1.5倍");
    expect(html).toContain('aria-label="SPバー: H 3 / A 0 / B 32 / C 2 / D 0 / S 12"');
    expect(html).toContain("シナリオ1 +3.7%");
    expect(html).toContain("最厳条件: シナリオ1 +3.7%");
    expect(html).toContain("自分 151");
    expect(html).toContain("相手 150");
    expect(html).toContain("抜ける");
    expect(html).toContain("こだわりスカーフ 1.5倍");
  });

  it("omits speed note text when no speed modifiers are applied", () => {
    const [scenario] = createDefaultScenarioForms();
    const speedScenario = {
      ...scenario,
      id: "scenario-speed-no-note",
      label: "素早さ調整",
      adjustmentType: "speed" as const,
      attacks: [{
        ...scenario.attacks[0],
        id: "attack-speed-no-note",
        label: "最速ゲンガー",
        attackerPokemonInput: "メガゲンガー",
        speedTargetMode: "manual" as const,
        speedTargetValue: 200,
      }],
    };
    const html = renderToStaticMarkup(
      <ResultsPanel
        candidates={[]}
        selectedCandidateId={null}
        appliedCandidateId={null}
        scenarios={[speedScenario]}
        status="idle"
        offenseResults={[]}
        speedResults={[{
          id: "scenario-speed-no-note-attack-speed-no-note-speed-line",
          scenarioId: "scenario-speed-no-note",
          scenarioLabel: "素早さ調整",
          attackId: "attack-speed-no-note",
          attackLabel: "最速ゲンガー",
          result: {
            id: "speed-line",
            status: "pass",
            passed: true,
            canApply: true,
            label: "Sライン",
            comparison: "outspeed",
            orderMode: "normal",
            relation: "outspeed",
            requiredStatPoints: 29,
            actualSpeed: 201,
            targetSpeed: 200,
            requiredSpeed: 201,
            targetStatPoints: 0,
            notes: [],
            reason: "確定抜きは S29 SPで達成します",
          },
        }]}
        strictestFailureLabel={null}
        targetLabel="メガマフォクシー"
        resultAlertMessage={null}
        onSelectCandidate={() => undefined}
        onApplyCandidate={() => undefined}
      />,
    );

    expect(html).not.toContain("Sライン結果");
    expect(html).not.toContain("自動補正なし");
    expect(html).not.toContain("抜ける /");
    expect(html).toContain('aria-label="Sラインを調整対象へ適用"');
  });

  it("wires resolver-backed datalist candidates to free-text entity fields", () => {
    const html = renderExampleApp();

    expect(html).toContain('value="ドドゲザン"');
    expect(html).toContain('value="メガマフォクシー"');
    expect(html).toContain('value="メガゲンガー"');
    expect(html).toContain('value="サイコキネシス"');
    expect(html).toContain('aria-label="火力調整A 仮想敵H SP"');
    expect(html).toContain('aria-label="火力調整A 仮想敵H SP" placeholder="H SP"');
    expect(html).toContain('value="32"');
    expect(html).not.toContain('value="Dragonite"');
    expect(html).not.toContain('label="Dragonite"');
    expect(html).not.toContain("calc: Delphox-Mega");
    expect(html).not.toContain("名前を解決できません");
    expect(html).not.toContain(">Delphox-Mega<");
    expect(html).not.toContain(">Illuminate<");
    expect(html).not.toContain('list="entity-options-pokemon');
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).not.toContain('list="entity-options-move');
    expect(html).toContain('class="nature-trigger"');
    expect(html).toContain('aria-label="性格: おくびょう"');
    expect(html).toContain('class="disclosure-chevron"');
    expect(html).not.toContain("▾");
    expect(html).not.toContain("C↑ / A↓");
    expect(html).not.toContain("A↑ / C↓");
    expect(html).not.toContain('list="entity-options-ability');
    expect(html).toContain('class="dropdown-menu-trigger"');
    expect(html).toContain('aria-label="特性候補を開く"');
    expect(html).toContain('aria-label="持ち物候補を開く"');
    expect(html).toContain('aria-label="技候補を開く"');
    expect(html).toContain('class="scenario-defender-status"');
    expect(html).toContain(">耐久調整A 調整対象の状態異常</span>");
    expect(html).toContain(">なし</span>");
    expect(html).not.toContain('aria-label="状態異常: なし"');
    expect(html).toContain(">耐久調整A 調整対象の状態異常</span>");
    expect(html).not.toContain('value="まけんき"');
    expect(html).not.toContain('value="もうか"');
    expect(html).not.toContain('list="entity-options-item');
    expect(html).not.toContain('list="entity-options-type');
    expect(html).toContain('aria-label="テラスタル"');
    expect(html).toContain('aria-label="攻撃テラス"');
    expect(html).toContain("tera-off.svg");
    expect(html).toContain("mega-off.svg");
    expect(html).toContain("dmax-off.svg");
  });
});
