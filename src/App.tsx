import { Fragment, createContext, type ChangeEvent, type CSSProperties, type FocusEvent, type KeyboardEvent, type PointerEvent, type Ref, useContext, useEffect, useId, useMemo, useReducer, useRef, useState } from "react";
import * as Collapsible from "@radix-ui/react-collapsible";
import { ChevronRightIcon } from "@radix-ui/react-icons";
import {
  CHAMPIONS_MAX_STAT_POINTS_PER_STAT,
  CHAMPIONS_TOTAL_STAT_POINTS,
  clampStatPointValue,
  smogonEvToStatPoints,
  sumStatPoints,
} from "./domain/championsStats";
import type { StatPointMarkerRow, StatPointMarkerTable } from "./calc/statPointMarkers";
import { isActiveAllyAbilityCanonicalName } from "./domain/allyAbilitySupport";
import { getMovePowerCatalogEntry, type MovePowerCatalogEntry } from "./domain/movePowerCatalog";
import { getHpEventRuleDefinition } from "./calc/hpEventRules";
import {
  toEntityRef,
  type CandidateResult,
  type GameType,
  type MovePowerEvaluation,
  type PokemonStatus,
  type ScenarioHit,
  type StatBoostTable,
  type StatKey,
  type StatTable,
  type Terrain,
  type Weather,
} from "./domain/model";
import type {
  HpEventEvaluation,
  HpEventFrequency,
  HpEventTiming,
  SupportedHpEventEffectId,
} from "./domain/hpEvents";
import type { EntityKind } from "./data/localizationTypes";
import { appVersionInfo, formatAppVersionLabel } from "./appVersion";
import {
  formatUsageDataDateJst,
  getUsageMatchingEntityInputOptions,
  getNatureUsageState,
  loadChampionsUsageData,
  loadSuggestionFormat,
  saveSuggestionFormat,
  type ChampionsUsageData,
  type NatureUsageState,
  type SuggestionFormat,
  type UsageRankingCategory,
} from "./usage";
import {
  getEntityInputOptions,
  getMatchingEntityInputOptions,
  getPokemonAbilityInputOptions,
  resolveEntity,
  type EntityInputOption,
} from "./localization/resolver";
import {
  applyCandidateToTarget,
  applyMaximizeRemainingBulkToTarget,
  applyOffenseAdjustmentToTarget,
  applySpeedAdjustmentToTarget,
  applyAttackerLevelMode,
  applyTargetLevelMode,
  applyMoveInputDefaults,
  applyBeatUpGameTypeDefaults,
  applyBeatUpParticipants,
  buildScenarioAttackBuildFromUi,
  buildIntegratedDefenceSearchInput,
  buildMovePowerPreviewInputFromUi,
  buildTargetBuildFromUi,
  bulkMaximizeUiReducer,
  calculateOffenseAdjustmentsForCandidateRanking,
  calculateSpeedAdjustmentsForCandidateRanking,
  createDefaultAttackerStatPoints,
  createDefaultScenarioAttackForm,
  createDefaultScenarioForms,
  createDefaultTargetForm,
  createInitialBulkMaximizeUiState,
  createInitialSearchUiState,
  formatScenarioAttackLabel,
  getTargetSpeedOverrideCounts,
  searchUiReducer,
  startDefenceSearchFromUi,
  startMaximizeRemainingBulkFromUi,
  type BulkMaximizeUiState,
  type LevelInputMode,
  type BeatUpParticipantFormState,
  type HpEventFormState,
  type MovePowerMode,
  type OffenseScenarioResult,
  type ScenarioAdjustmentType,
  type ScenarioAttackFormState,
  type ScenarioFormState,
  type SearchStatus,
  type SpeedScenarioResult,
  type TargetFormState,
  type TargetSpeedOverrideCounts,
} from "./ui/defenceSearchUi";
import {
  BEAT_UP_CANONICAL_NAME,
  getBeatUpBasePowerForPokemon,
  getBeatUpParticipantLimit,
} from "./calc/beatUp";
import { calculateSmogonHit } from "./calc/smogonAdapter";
import {
  getMovePowerAssistRule,
  isSinglePowerMoveUnsupported,
  isMovePowerOverrideAllowed,
  type MovePowerAssistRule,
} from "./calc/movePowerRules";
import type { MaximizeRemainingBulkResult } from "./search/maximizeRemainingBulk";
import {
  getAutomaticSpeedModifierSources,
  type SpeedAdjustmentResult,
  type SpeedManualMultiplier,
} from "./search/speedAdjustment";
import { getMoveDefenderStatKeys, getMoveStatReferencePlan } from "./ui/moveStatReference";
import { findPokemonArtwork, type PokemonArtworkMatch } from "./ui/pokemonArtwork";
import { getPublicAssetUrl } from "./ui/publicAssetUrl";
import {
  getPokemonBaseFormValue,
  getPokemonFormVariantOptions,
  isPokemonFormVariant,
  type PokemonFormVariantKind,
  type PokemonFormVariantOption,
} from "./ui/pokemonFormVariants";
import {
  createBoxBackupFileName,
  createBoxEntryFromState,
  createBoxEntrySummary,
  duplicateBoxEntry,
  loadBoxEntriesFromBrowser,
  parseBoxBackupDocument,
  saveBoxEntriesToBrowser,
  stringifyBoxBackupDocument,
  type BoxEntry,
  type BoxEntrySummary,
} from "./ui/boxStorage";
import {
  createEnemyBoxBackupFileName,
  createEnemyBoxEntryFromScenarios,
  createEnemyBoxEntrySummary,
  duplicateEnemyBoxEntry,
  loadEnemyBoxEntriesFromBrowser,
  parseEnemyBoxBackupDocument,
  saveEnemyBoxEntriesToBrowser,
  stringifyEnemyBoxBackupDocument,
  type EnemyBoxEntry,
} from "./ui/enemyBoxStorage";
import { BackupImportDialog, type BackupImportDecision } from "./ui/BackupImportDialog";
import {
  planBoxBackupImport,
  planEnemyBoxBackupImport,
} from "./ui/boxBackupImport";
import {
  DRAFT_STORAGE_KEY,
  createDraftFingerprint,
  discardDraftFromBrowser,
  loadDraftFromBrowser,
  parseDraftStorageDocument,
  saveDraftToBrowser,
  scheduleDraftAutosave,
  type DraftLoadResult,
  type DraftStorageDocument,
} from "./ui/draftStorage";
import { persistCurrentWorkToBoxAndDiscardDraft } from "./ui/currentWorkPersistence";
import {
  clearSyncBoxRepositoryCache,
  useOptionalSyncBox,
} from "./sync/SyncBoxProvider";
import { CloudDraftDialog } from "./sync/CloudDraftDialog";
import {
  AccountSyncDialog,
  type AccountConflictAction,
  type AccountDeletionState,
  type AccountMigrationState,
} from "./sync/AccountSyncDialog";
import { useOptionalAuthSession } from "./sync/authSessionContext";
import {
  clearSyncMigrationControllerCache,
  useSyncMigrationControl,
  useSyncMigrationReadiness,
} from "./sync/SyncMigrationGate";
import {
  deriveAccountSyncStatus,
  getAccountSyncStatusLabel,
  type AccountSyncStatus as AccountSyncStatusKey,
} from "./sync/accountSyncStatus";
import {
  downloadAccountExport,
  exportAccountData,
} from "./sync/accountDataExport";
import {
  AccountDeletionError,
  deleteAccount as deleteAccountAndCloudData,
} from "./sync/accountDeletion";
import { getFirebaseClient } from "./sync/firebaseClient";
import { createFirestoreSyncRepository } from "./sync/firestoreSyncRepository";
import { createFirestoreCloudDraftRepository } from "./sync/firestoreCloudDraftRepository";
import {
  clearCloudDraftRuntimeCache,
  useOptionalCloudDraft,
  type CloudDraftContextValue,
  type CloudDraftRuntimeStatus,
} from "./sync/CloudDraftProvider";
import type { CloudDraftRecord } from "./sync/cloudDraftTypes";
import natureOptionsData from "./data/generated/nature-options.gen.json";
import { Button, SelectField, StatusBadge, StepperControl, UiPopover } from "./ui/primitives";
import {
  DefenceSearchWorkerClient,
  type ActiveDefenceSearchRequest,
} from "./worker/defenceSearchWorkerClient";
import {
  getAutomaticMoveHpNotices,
} from "./calc/hpSequenceMoveUses";
import { isCurrentHpDependentMoveCanonicalName } from "./calc/moveHpMechanics";

const statLabels: Record<StatKey, string> = {
  hp: "H",
  atk: "A",
  def: "B",
  spa: "C",
  spd: "D",
  spe: "S",
};

const statIconFiles: Record<StatKey, string> = {
  hp: "H.svg",
  atk: "A.svg",
  def: "B.svg",
  spa: "C.svg",
  spd: "D.svg",
  spe: "S.svg",
};

const statKeys = ["hp", "atk", "def", "spa", "spd", "spe"] as const satisfies readonly StatKey[];
const defenceStatKeys = ["hp", "def", "spd"] as const satisfies readonly StatKey[];
const natureMatrixKeys = ["atk", "def", "spa", "spd", "spe"] as const satisfies readonly StatKey[];
const RESULTS_PAGE_SIZE = 20;
const MOBILE_RESULTS_PAGE_SIZE = 5;

type CandidateSortKey =
  | "recommended"
  | "used"
  | "remaining"
  | "margin"
  | "overallBulk"
  | "physicalBulk"
  | "specialBulk"
  | StatKey;
type CandidateSortDirection = "asc" | "desc";

const candidateSortOptions: Array<{ value: CandidateSortKey; label: string }> = [
  { value: "recommended", label: "推奨順" },
  { value: "used", label: "使用SP" },
  { value: "remaining", label: "残りSP" },
  { value: "margin", label: "余裕" },
  { value: "overallBulk", label: "総合耐久指数" },
  { value: "physicalBulk", label: "物理耐久指数" },
  { value: "specialBulk", label: "特殊耐久指数" },
  { value: "hp", label: "H" },
  { value: "atk", label: "A" },
  { value: "def", label: "B" },
  { value: "spa", label: "C" },
  { value: "spd", label: "D" },
  { value: "spe", label: "S" },
];

const candidateSortDirectionOptions: Array<{ value: CandidateSortDirection; label: string }> = [
  { value: "asc", label: "昇順" },
  { value: "desc", label: "降順" },
];

const getDefaultCandidateSortDirection = (sortKey: CandidateSortKey): CandidateSortDirection =>
  sortKey === "recommended" || sortKey === "used" ? "asc" : "desc";

const getCandidateWorstMargin = (candidate: CandidateResult): number => {
  if (candidate.scenarioResults.length === 0) {
    return 0;
  }

  return candidate.scenarioResults.reduce((worstMargin, result) => (
    Math.min(worstMargin, result.survivalProbability - result.minSurvivalProbability)
  ), Number.POSITIVE_INFINITY);
};

const getCandidateSortValue = (candidate: CandidateResult, sortKey: CandidateSortKey): number => {
  switch (sortKey) {
    case "recommended":
      return candidate.rank;
    case "used":
      return candidate.usedStatPointBudget;
    case "remaining":
      return candidate.remainingStatPointBudget;
    case "margin":
      return getCandidateWorstMargin(candidate);
    case "overallBulk":
      return candidate.bulkScore.overallBulk;
    case "physicalBulk":
      return candidate.bulkScore.physicalBulk;
    case "specialBulk":
      return candidate.bulkScore.specialBulk;
    default:
      return candidate.appliedStatPoints[sortKey];
  }
};

export const compareResultCandidates = (
  left: CandidateResult,
  right: CandidateResult,
  sortKey: CandidateSortKey,
  sortDirection: CandidateSortDirection,
): number => {
  const leftValue = getCandidateSortValue(left, sortKey);
  const rightValue = getCandidateSortValue(right, sortKey);
  const valueComparison = leftValue === rightValue ? 0 : leftValue - rightValue;
  const directedComparison = sortDirection === "asc" ? valueComparison : -valueComparison;
  return directedComparison || left.rank - right.rank;
};

const getOffenseDefenderStatKeysFromMoveContext = (
  moveInput: string,
  options: { teraEnabled?: boolean },
  targetReferenceKeys: ReadonlySet<StatKey>,
): StatKey[] => {
  const visibleKeys = new Set<StatKey>(getMoveDefenderStatKeys(moveInput, options));
  targetReferenceKeys.forEach((key) => visibleKeys.add(key));
  return statKeys.filter((key) => visibleKeys.has(key));
};

export const getOffenseDefenderStatKeys = (
  moveInput: string,
  options: { teraEnabled?: boolean } = {},
): StatKey[] => {
  const targetReferenceKeys = new Set(
    getMoveStatReferencePlan(moveInput, options).references
      .filter((reference) => reference.owner === "target")
      .map((reference) => reference.stat),
  );
  return getOffenseDefenderStatKeysFromMoveContext(moveInput, options, targetReferenceKeys);
};

type NatureMatrixStatKey = (typeof natureMatrixKeys)[number];

type NatureOption = {
  id: string;
  label: string;
  showdownName: string;
  plus: NatureMatrixStatKey;
  minus: NatureMatrixStatKey;
};

const natureOptions = natureOptionsData.entries as NatureOption[];
const natureOptionsByLabel = new Map(natureOptions.map((option) => [option.label, option]));
const natureOptionsByCell = new Map(natureOptions.map((option) => [`${option.plus}:${option.minus}`, option]));

const getNatureCellOption = (plus: NatureMatrixStatKey, minus: NatureMatrixStatKey): NatureOption | undefined =>
  natureOptionsByCell.get(`${plus}:${minus}`);

export const getNatureModifierDirection = (
  natureLabel: string,
  stat: StatKey,
): "up" | "down" | null => {
  if (stat === "hp") {
    return null;
  }

  const nature = natureOptionsByLabel.get(natureLabel);
  if (!nature || nature.plus === nature.minus) {
    return null;
  }
  if (nature.plus === stat) {
    return "up";
  }
  if (nature.minus === stat) {
    return "down";
  }
  return null;
};

const statusOptions: Array<{ value: PokemonStatus; label: string }> = [
  { value: "none", label: "なし" },
  { value: "brn", label: "やけど" },
  { value: "psn", label: "どく" },
  { value: "tox", label: "もうどく" },
  { value: "par", label: "まひ" },
  { value: "slp", label: "ねむり" },
  { value: "frz", label: "こおり" },
];

const gameTypeOptions: Array<{ value: GameType; label: string }> = [
  { value: "singles", label: "シングル" },
  { value: "doubles", label: "ダブル" },
];

const rankOptions = Array.from({ length: 13 }, (_value, index) => index - 6);

const rankSelectOptions = rankOptions.map((rank) => ({
  value: String(rank),
  label: rank > 0 ? `+${rank}` : String(rank),
}));

const weatherOptions: Array<{ value: Weather; label: string }> = [
  { value: "none", label: "なし" },
  { value: "sun", label: "晴れ" },
  { value: "rain", label: "雨" },
  { value: "sand", label: "砂" },
  { value: "snow", label: "雪" },
];

const terrainOptions: Array<{ value: Terrain; label: string }> = [
  { value: "none", label: "なし" },
  { value: "electric", label: "エレキ" },
  { value: "grassy", label: "グラス" },
  { value: "misty", label: "ミスト" },
  { value: "psychic", label: "サイコ" },
];

const speedMultiplierOptions: Array<{ value: SpeedManualMultiplier; label: string }> = [
  { value: "auto", label: "自動" },
  { value: "2", label: "2倍" },
  { value: "1.5", label: "1.5倍" },
  { value: "0.5", label: "0.5倍" },
];

const speedOrderModeOptions = [
  { value: "normal", label: "通常" },
  { value: "trick-room", label: "トリックルーム" },
] as const;

const speedTailwindOptions = [
  { value: "off", label: "なし" },
  { value: "on", label: "あり" },
] as const;

type HpEventPresetId = SupportedHpEventEffectId;

const hpEventPresetOptions: Array<{ value: HpEventPresetId; label: string }> = [
  { value: "life-orb-recoil", label: "いのちのたま反動" },
  { value: "sandstorm-damage", label: "すなあらしダメージ" },
  { value: "poison-damage", label: "どくダメージ" },
  { value: "toxic-damage", label: "もうどくダメージ" },
  { value: "burn-damage", label: "やけどダメージ" },
  { value: "stealth-rock-damage", label: "ステルスロック" },
  { value: "spikes-damage", label: "まきびし" },
  { value: "salt-cure-damage", label: "しおづけダメージ" },
  { value: "sitrus-berry-heal", label: "オボンのみ回復" },
  { value: "leftovers-heal", label: "たべのこし回復" },
  { value: "rocky-helmet-damage", label: "ゴツゴツメット" },
  { value: "rough-skin-damage", label: "さめはだ／てつのトゲ" },
];

const hpEventTimingLabels: Partial<Record<HpEventTiming, string>> = {
  onEntry: "登場時・攻撃前",
  beforeMove: "技使用前",
  afterHit: "ヒット後",
  afterMove: "技使用後",
  endOfTurn: "ターン終了時",
};

const hpEventFrequencyLabels: Record<HpEventFrequency, string> = {
  once: "1回",
  perMove: "技ごと",
  perHit: "ヒットごと",
  perTurn: "ターンごと",
};

const hpEventPresetLabels: Record<HpEventPresetId, string> = Object.fromEntries(
  hpEventPresetOptions.map((option) => [option.value, option.label]),
) as Record<HpEventPresetId, string>;
const hpEventPresetIds = new Set<HpEventPresetId>(
  hpEventPresetOptions.map((option) => option.value),
);

const resolveCanonicalEntityName = (kind: EntityKind, input: string): string | undefined => {
  const result = resolveEntity(kind, input);
  return result.status === "exact" || result.status === "alias" ? result.canonicalName : undefined;
};

const hasHpDependentMoveCalculationFromForm = (
  attack: ScenarioAttackFormState,
  adjustmentType: ScenarioAdjustmentType,
  targetForm: TargetFormState,
  scenarioId: string,
): boolean => {
  const move = toEntityRef(resolveEntity("move", attack.moveInput), "move");
  if (!move || adjustmentType === "speed") {
    return false;
  }

  try {
    const attacker = adjustmentType === "offense"
      ? buildTargetBuildFromUi(targetForm, `${scenarioId}-${attack.id}-automatic-attacker`)
      : buildScenarioAttackBuildFromUi(
        attack,
        `${scenarioId}-${attack.id}-automatic-attacker`,
      );
    const emptySide = {
      reflect: false,
      lightScreen: false,
      auroraVeil: false,
      helpingHand: false,
    };
    const hit: ScenarioHit = {
      id: `${scenarioId}-${attack.id}-automatic-notice`,
      attacker,
      move,
      repeat: 1,
      critical: attack.critical,
      attackerBoosts: attack.attackerBoosts,
      defenderBoosts: attack.defenderBoosts,
      attackerSide: { ...emptySide },
      defenderSide: { ...emptySide },
    };
    return getAutomaticMoveHpNotices(hit, {
      includeAttackerAutomaticHpEffects: false,
    }).some((notice) => notice.id.startsWith("current-hp:"));
  } catch {
    // 入力途中は既存 resolver の警告に任せ、解決できた時点で補足を表示する。
    return false;
  }
};

export const isAbilitySupportCard = (
  adjustmentType: ScenarioAdjustmentType,
  moveInput: string,
  abilityInput: string,
): boolean => (
  adjustmentType === "defence"
  && !moveInput.trim()
  && isActiveAllyAbilityCanonicalName(resolveCanonicalEntityName("ability", abilityInput))
);

export const isUnresolvedEntityInput = (kind: EntityKind, input: string): boolean => {
  if (!input.trim()) {
    return false;
  }
  const result = resolveEntity(kind, input);
  return result.status !== "exact" && result.status !== "alias";
};

const isCanonicalResolutionMessage = (message: string | null): boolean =>
  Boolean(message?.includes("canonical name に解決できません"));

export const normalizeNumericInputText = (value: string): string =>
  value
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[．]/g, ".")
    .replace(/[－]/g, "-")
    .replace(/[＋]/g, "+")
    .trim();

const numericInputProps = {
  type: "text",
  inputMode: "numeric",
  pattern: "[0-9]*",
} as const;

const toNumber = (value: string, fallback = 0): number => {
  const parsed = Number(normalizeNumericInputText(value));
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clampNumberInput = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.trunc(value)));

const toStatPointInput = (value: string): number => {
  const parsed = toNumber(value, 0);
  if (parsed > CHAMPIONS_MAX_STAT_POINTS_PER_STAT) {
    return smogonEvToStatPoints(parsed);
  }
  return clampStatPointValue(parsed);
};

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`;

const formatDamageRange = (min: number, max: number): string =>
  min === max ? String(min) : `${min}-${max}`;

const getHpEventSubjectLabel = (
  subject: HpEventEvaluation["subject"],
  adjustmentType: ScenarioAdjustmentType,
): string => {
  if (adjustmentType === "offense") {
    return subject === "attacker" ? "調整対象" : "仮想敵";
  }
  return subject === "defender" ? "調整対象" : "仮想敵";
};

const formatHpEventEvaluation = (
  evaluation: HpEventEvaluation,
  adjustmentType: ScenarioAdjustmentType,
): string => {
  const subjectLabel = getHpEventSubjectLabel(evaluation.subject, adjustmentType);
  const timingLabel = hpEventTimingLabels[evaluation.timing] ?? evaluation.timing;
  const orderLabel = evaluation.sequenceContext === "priorMove"
    ? `直前の${timingLabel}（今回の攻撃前・1回）`
    : `${timingLabel}・${hpEventFrequencyLabels[evaluation.frequency]}`;
  if (!evaluation.applied) {
    return `${evaluation.label} / ${subjectLabel} / ${orderLabel}: ${evaluation.reason ?? "発生なし"}`;
  }

  const probabilityLabel = evaluation.activationProbability < 1 - 1e-12
    ? ` / 発動 ${formatPercent(evaluation.activationProbability)}`
    : "";
  const damageAmountLabel = evaluation.damageRange
    ? formatDamageRange(evaluation.damageRange.min, evaluation.damageRange.max)
    : String(evaluation.damage);
  const hpChangeLabel = evaluation.changeKind === "forcedFaint"
    ? "ひんし"
    : evaluation.changeKind === "hpCost"
      ? `${damageAmountLabel}消費`
      : evaluation.changeKind === "recoil"
        ? `${damageAmountLabel}反動`
        : (evaluation.healing ?? 0) > 0
          ? `${evaluation.healing}回復`
          : `${damageAmountLabel}ダメージ`;
  return `${evaluation.label} / ${subjectLabel} / ${orderLabel}: ${hpChangeLabel}${probabilityLabel}`;
};

const formatBulkIndex = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

const damageDescriptionEntityKinds = ["pokemon", "move", "item", "ability", "type"] as const satisfies readonly EntityKind[];

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const damageDescriptionNameReplacements = damageDescriptionEntityKinds
  .flatMap((kind) => getEntityInputOptions(kind))
  .filter((option) => option.canonicalName !== option.displayNameJa)
  .sort((a, b) => b.canonicalName.length - a.canonicalName.length)
  .map((option) => ({
    pattern: new RegExp(`(^|[^A-Za-z0-9-])(${escapeRegExp(option.canonicalName)})(?=$|[^A-Za-z0-9-])`, "g"),
    label: option.displayNameJa,
  }));

const damageDescriptionStatCodes = {
  HP: "H",
  Atk: "A",
  Def: "B",
  SpA: "C",
  SpD: "D",
  Spe: "S",
} satisfies Record<string, string>;

type DamageDescriptionStat = keyof typeof damageDescriptionStatCodes;

const damageDescriptionPattern = /^(\d+)([+-]?)\s+(Atk|Def|SpA|SpD|Spe)\s+(.+?)\s+vs\.\s+(\d+)\s+HP\s+\/\s+(\d+)([+-]?)\s+(Def|SpD|Atk|SpA|Spe)\s+([^:]+):\s+(.+)$/u;

const formatDamageDescriptionStatCode = (stat: string): string =>
  damageDescriptionStatCodes[stat as DamageDescriptionStat] ?? stat;

const formatDamageDescriptionStatPoint = (investment: string): string =>
  String(smogonEvToStatPoints(Number(investment)));

const formatKoPhraseJa = (count: string): string => (
  count === "O" ? "1発" : `${count}発`
);

const damageDescriptionResidualLabels = {
  "Dry Skin damage": "かんそうはだダメージ",
  "Solar Power damage": "サンパワーダメージ",
  "Dry Skin recovery": "かんそうはだ回復",
  "Rain Dish recovery": "あめうけざら回復",
  "sandstorm damage": "すなあらしダメージ",
  "Ice Body recovery": "アイスボディ回復",
  "Leftovers recovery": "たべのこし回復",
  "Black Sludge recovery": "くろいヘドロ回復",
  "Black Sludge damage": "くろいヘドロダメージ",
  "Sticky Barb damage": "くっつきバリダメージ",
  "Grassy Terrain recovery": "グラスフィールド回復",
  "Poison Heal": "ポイズンヒール",
  "poison damage": "どくダメージ",
  "toxic damage": "もうどくダメージ",
  "reduced burn damage": "やけどダメージ（たいねつ）",
  "burn damage": "やけどダメージ",
  "Bad Dreams": "ナイトメア",
  "trapping damage": "バインドダメージ",
  "Vine Lash damage": "キョダイベンタツダメージ",
  "Wildfire damage": "キョダイゴクエンダメージ",
  "Cannonade damage": "キョダイホウゲキダメージ",
  "Volcalith damage": "キョダイフンセキダメージ",
} as const satisfies Record<string, string>;

type LocalizedKoClause = {
  readonly kind: "guaranteed" | "possible" | "chance";
  readonly hitCount: string;
  readonly chance?: string;
  readonly residualLabel?: string;
  readonly approximate: boolean;
};

const formatDamageDescriptionResidualList = (value: string): string | undefined => {
  const atoms = value
    .replace(/,\s+and\s+/g, ", ")
    .replace(/\s+and\s+/g, ", ")
    .split(/,\s*/)
    .map((atom) => atom.trim())
    .filter(Boolean);
  if (atoms.length === 0) return undefined;

  const translated: string[] = [];
  for (const atom of atoms) {
    const label = damageDescriptionResidualLabels[
      atom as keyof typeof damageDescriptionResidualLabels
    ];
    if (!label) return undefined;
    translated.push(label);
  }
  return translated.join("・");
};

const parseLocalizedKoClause = (value: string): LocalizedKoClause | undefined => {
  const approximate = value.startsWith("approx. ");
  const withoutApproximation = approximate ? value.slice("approx. ".length) : value;
  const afterIndex = withoutApproximation.lastIndexOf(" after ");
  const clause = afterIndex >= 0
    ? withoutApproximation.slice(0, afterIndex)
    : withoutApproximation;
  const residualLabel = afterIndex >= 0
    ? formatDamageDescriptionResidualList(withoutApproximation.slice(afterIndex + " after ".length))
    : undefined;
  if (afterIndex >= 0 && !residualLabel) return undefined;

  const guaranteed = /^guaranteed\s+(O|\d+)HKO$/i.exec(clause);
  if (guaranteed) {
    return { kind: "guaranteed", hitCount: guaranteed[1], residualLabel, approximate };
  }

  const possible = /^possible\s+(O|\d+)HKO$/i.exec(clause);
  if (possible) {
    return { kind: "possible", hitCount: possible[1], residualLabel, approximate };
  }

  const chance = /^(\d+(?:\.\d+)?)%\s+chance\s+to\s+(O|\d+)HKO$/i.exec(clause);
  if (chance) {
    return {
      kind: "chance",
      hitCount: chance[2],
      chance: chance[1],
      residualLabel,
      approximate,
    };
  }

  return undefined;
};

const formatLocalizedSimpleKoClause = (clause: LocalizedKoClause): string => {
  const hitLabel = formatKoPhraseJa(clause.hitCount);
  if (clause.kind === "guaranteed") {
    const annotation = clause.residualLabel ? `${clause.residualLabel}込み` : "";
    return `確定${hitLabel}${annotation ? `（${annotation}）` : ""}`;
  }

  const annotations = [
    ...(clause.kind === "chance" && clause.chance ? [`${clause.chance}%`] : []),
    ...(clause.residualLabel ? [`${clause.residualLabel}込み`] : []),
    ...(clause.approximate ? ["概算"] : []),
  ];
  return `乱数${hitLabel}${annotations.length > 0 ? `（${annotations.join("・")}）` : ""}`;
};

const formatLocalizedKoText = (value: string): string | undefined => {
  const parenthetical = /^(.+?)\s+\((.+)\)$/.exec(value);
  if (parenthetical) {
    const outer = parseLocalizedKoClause(parenthetical[1]);
    const inner = parseLocalizedKoClause(parenthetical[2]);
    if (
      outer?.kind === "chance"
      && outer.chance
      && formatKoPhraseJa(outer.hitCount) === "1発"
      && inner?.residualLabel
      && formatKoPhraseJa(inner.hitCount) === "1発"
    ) {
      const innerOutcome = inner.kind === "guaranteed"
        ? "確定1発"
        : inner.kind === "chance" && inner.chance
          ? `${inner.chance}%`
          : undefined;
      if (innerOutcome) {
        const annotations = [
          `${outer.chance}%`,
          `${inner.residualLabel}込みで${innerOutcome}`,
          ...(outer.approximate || inner.approximate ? ["概算"] : []),
        ];
        return `乱数1発（${annotations.join("・")}）`;
      }
    }
  }

  const clause = parseLocalizedKoClause(value);
  return clause ? formatLocalizedSimpleKoClause(clause) : undefined;
};

const localizeDamageDescriptionNames = (description: string): string =>
  damageDescriptionNameReplacements.reduce(
    (current, replacement) => current.replace(replacement.pattern, (_match, prefix: string) => `${prefix}${replacement.label}`),
    description,
  );

const formatDamageDescriptionPowerLabels = (description: string): string =>
  description.replace(/\((\d+(?:\.\d+)?)\s+BP\)/g, "(威力$1)");

const damageDescriptionWeatherLabels = {
  Sun: "晴れ",
  Rain: "雨",
  Sand: "砂",
  Snow: "雪",
} as const satisfies Record<string, string>;

const formatLocalizedDamageDescriptionBody = (description: string): string => {
  const localizedNames = localizeDamageDescriptionNames(description);
  return formatDamageDescriptionPowerLabels(localizedNames)
    .replace(/\bLvl\s+(\d+)\b/g, "Lv.$1")
    .replace(/\bburned\b/g, "やけど状態")
    .replace(/\s+buffed\b/g, "（強化）")
    .replace(/\s+nerfed\b/g, "（弱化）")
    .replace(/\bTera\s+([^\s]+)/g, "テラスタル（$1）")
    .replace(/\bDynamax\b/g, "ダイマックス")
    .replace(/\((\d+(?:\.\d+)?)\s+BP\s+([^)]+)\)/g, "（威力$1・$2）")
    .replace(/\((\d+)\s+hits\)/g, "（$1ヒット）")
    .replace(/バッテリー\s+boosted/g, "味方のバッテリー補正")
    .replace(/パワースポット\s+boosted/g, "味方のパワースポット補正")
    .replace(/with an ally's\s+フラワーギフト/g, "味方のフラワーギフト補正")
    .replace(/with an ally's\s+はがねのせいしん/g, "味方のはがねのせいしん補正")
    .replace(/with an ally's\s+フレンドガード/g, "味方のフレンドガード補正")
    .replace(/with an ally's\s+オーロラベール/g, "オーロラベール")
    .replace(
      /\s+in\s+(Sun|Rain|Sand|Snow)\s+and\s+(エレキフィールド|グラスフィールド|ミストフィールド|サイコフィールド)/g,
      (_match, weather: keyof typeof damageDescriptionWeatherLabels, terrain: string) => (
        `（${damageDescriptionWeatherLabels[weather]}・${terrain}）`
      ),
    )
    .replace(
      /\s+in\s+(Sun|Rain|Sand|Snow)/g,
      (_match, weather: keyof typeof damageDescriptionWeatherLabels) => `（${damageDescriptionWeatherLabels[weather]}）`,
    )
    .replace(
      /\s+in\s+(エレキフィールド|グラスフィールド|ミストフィールド|サイコフィールド)/g,
      (_match, terrain: string) => `（${terrain}）`,
    )
    .replace(/\s+through\s+リフレクター/g, "（リフレクター）")
    .replace(/\s+through\s+ひかりのかべ/g, "（ひかりのかべ）")
    .replace(/\s+on a critical hit/g, "（急所）");
};

const stripLocalizedDamagePowerLabel = (description: string): string =>
  description.replace(/\s*\(威力\d+(?:\.\d+)?\)/g, "");

export const formatMovePowerEvaluation = (
  evaluation: MovePowerEvaluation | undefined,
  options: { hpDependent?: boolean } = {},
): string => {
  if (!evaluation) {
    return "威力 未計算";
  }
  if (evaluation.source === "status") {
    return "変化技（数値威力なし）";
  }
  if (evaluation.source === "fixed-damage") {
    return options.hpDependent
      ? "固定ダメージ（数値威力なし・各攻撃直前のHPで自動計算）"
      : "固定ダメージ（数値威力なし）";
  }
  if (evaluation.source === "unsupported") {
    return "個別威力（現在の計算には未対応）";
  }

  const perHitBasePowers = evaluation.perHitBasePowers;
  if (perHitBasePowers && perHitBasePowers.length > 0) {
    const uniquePowers = new Set(perHitBasePowers);
    if (perHitBasePowers.length === 1) {
      return `威力 ${perHitBasePowers[0]}（1ヒット）`;
    }
    if (uniquePowers.size > 1) {
      return `威力 ${perHitBasePowers.join("→")}（各ヒット）`;
    }
    return `威力 ${perHitBasePowers[0]}（1ヒットあたり・${perHitBasePowers.length}ヒット）`;
  }

  const appliedPower = evaluation.appliedBasePower;
  if (appliedPower === undefined) {
    return "威力 未計算";
  }
  if (evaluation.source === "assisted") {
    return `威力 ${appliedPower}（条件: ${evaluation.detailLabel ?? "指定値"}）`;
  }
  if (evaluation.source === "manual") {
    return `威力 ${appliedPower}（手動）`;
  }
  if (options.hpDependent) {
    return `HP依存威力（満タン時 ${appliedPower}・各攻撃直前に自動計算）`;
  }
  if (
    evaluation.source === "automatic"
    && evaluation.catalogBasePower > 0
    && evaluation.catalogBasePower !== appliedPower
  ) {
    return `基礎威力 ${evaluation.catalogBasePower} → 適用威力 ${appliedPower}（自動計算）`;
  }
  if (evaluation.source === "automatic") {
    return `威力 ${appliedPower}（自動計算）`;
  }
  return `威力 ${appliedPower}`;
};

export const resolveDraftStorageScope = (
  cloudDraft: Pick<CloudDraftContextValue, "sourceKey" | "localDraftStorageKey"> | null,
): { readonly sourceKey: string; readonly storageKey: string | null } => cloudDraft
  ? { sourceKey: cloudDraft.sourceKey, storageKey: cloudDraft.localDraftStorageKey }
  : { sourceKey: "device", storageKey: DRAFT_STORAGE_KEY };

export type DraftAutosaveDecision = "skip" | "discard-box" | "unchanged" | "save";

export const getDraftAutosaveDecision = (input: {
  readonly variant: "default" | "tutorial";
  readonly hasRecovery: boolean;
  readonly sourceMatches: boolean;
  readonly fingerprint: string;
  readonly boxBaselineFingerprint: string | null;
  readonly lastDraftFingerprint: string | null;
}): DraftAutosaveDecision => {
  if (input.variant !== "default" || input.hasRecovery || !input.sourceMatches) return "skip";
  if (input.fingerprint === input.boxBaselineFingerprint) return "discard-box";
  if (input.fingerprint === input.lastDraftFingerprint) return "unchanged";
  return "save";
};

export const attemptCloudDraftQueue = (
  draft: DraftStorageDocument,
  cloudDraft: Pick<CloudDraftContextValue, "queueCurrentDraft"> | null,
): { readonly status: "success" } | { readonly status: "error"; readonly message: string } => {
  if (!cloudDraft) return { status: "success" };
  const message = cloudDraft.queueCurrentDraft(draft);
  return message ? { status: "error", message } : { status: "success" };
};

export const isCurrentAccountOperation = (
  operation: number,
  currentOperation: number,
  expectedUid: string | null,
  currentUid: string | null,
): boolean => operation === currentOperation && expectedUid === currentUid;

export const shouldInvalidateAccountOperationOnUidChange = (
  expectedUid: string | null | undefined,
  nextUid: string | null,
): boolean => expectedUid === undefined || expectedUid !== nextUid;

const formatLocalizedDamageResult = (resultText: string): string => {
  const normalized = resultText.replace(/\s+-\s+/g, "-");
  const separator = normalized.indexOf(" -- ");
  if (separator < 0) return normalized;

  const damageText = normalized.slice(0, separator);
  const koText = normalized.slice(separator + " -- ".length);
  const localizedKoText = formatLocalizedKoText(koText);
  return localizedKoText ? `${damageText} / ${localizedKoText}` : normalized;
};

const formatFallbackLocalizedDamageDescription = (description: string): string => {
  const separator = description.lastIndexOf(": ");
  const bodyText = separator >= 0 ? description.slice(0, separator) : description;
  const resultText = separator >= 0 ? description.slice(separator + 2) : undefined;
  const localizedBody = Object.entries(damageDescriptionStatCodes)
    .reduce(
      (current, [english, japanese]) => current.replace(new RegExp(`\\b${english}\\b`, "g"), japanese),
      formatLocalizedDamageDescriptionBody(bodyText),
    )
    .replace(/\s+vs\.\s+/g, " → ");
  return resultText
    ? `${localizedBody} : ${formatLocalizedDamageResult(resultText)}`
    : localizedBody;
};

export const formatLocalizedDamageDescription = (description: string): string => {
  const match = damageDescriptionPattern.exec(description);
  if (!match) {
    return formatLocalizedDamageResult(formatFallbackLocalizedDamageDescription(description));
  }

  const [
    ,
    attackInvestment,
    attackNature,
    attackStat,
    attackerAndMove,
    defenderHpInvestment,
    defenderInvestment,
    defenderNature,
    defenderStat,
    defenderPokemon,
    resultText,
  ] = match;

  return [
    `${formatDamageDescriptionStatCode(attackStat)}${formatDamageDescriptionStatPoint(attackInvestment)}${attackNature}`,
    formatLocalizedDamageDescriptionBody(attackerAndMove),
    "→",
    `H${formatDamageDescriptionStatPoint(defenderHpInvestment)}`,
    "/",
    `${formatDamageDescriptionStatCode(defenderStat)}${formatDamageDescriptionStatPoint(defenderInvestment)}${defenderNature}`,
    formatLocalizedDamageDescriptionBody(defenderPokemon.trim()),
    ":",
    formatLocalizedDamageResult(resultText),
  ].join(" ");
};

const statPointCells = Array.from({ length: CHAMPIONS_MAX_STAT_POINTS_PER_STAT }, (_value, index) => index + 1);

export const formatScenarioResultStatusLabel = (passed: boolean): "PASS" | "FAIL" =>
  passed ? "PASS" : "FAIL";

const formatStatPointSpreadLabel = (statPoints: StatTable): string =>
  statKeys.map((key) => `${statLabels[key]} ${statPoints[key]}`).join(" / ");

type MobileSheet = "target" | "scenarios";

const selectInputValueOnFocus = (event: FocusEvent<HTMLInputElement>) => {
  try {
    event.currentTarget.select();
  } catch {
    // Some input types do not expose text selection consistently.
  }
};

export const clampTargetStatPointChange = (statPoints: StatTable, key: StatKey, value: number): number => {
  const usedByOtherStats = sumStatPoints(statPoints) - clampStatPointValue(statPoints[key]);
  const maxForStat = Math.max(0, CHAMPIONS_TOTAL_STAT_POINTS - usedByOtherStats);
  return Math.min(clampStatPointValue(value), maxForStat);
};

const getStatIconSrc = (key: StatKey): string => {
  return getPublicAssetUrl(`assets/stat-icons/${statIconFiles[key]}`);
};

const getAssetSrc = (path: string): string => getPublicAssetUrl(path);

const accountSyncStatusIconPaths = {
  "local-only": "assets/ui/sync-local-only.svg",
  unsynced: "assets/ui/sync-unsynced.svg",
  syncing: "assets/ui/sync-syncing.svg",
  synced: "assets/ui/sync-synced.svg",
  offline: "assets/ui/sync-offline.svg",
  conflict: "assets/ui/sync-conflict.svg",
  error: "assets/ui/sync-error.svg",
} satisfies Record<AccountSyncStatusKey, string>;

export const getAccountSyncStatusIconPath = (status: AccountSyncStatusKey): string =>
  accountSyncStatusIconPaths[status];

const getBattleIconSrc = (name: string): string => getAssetSrc(`assets/battle-icons/${name}.svg`);
const getNatureModifierIconSrc = (name: "up" | "down"): string =>
  getAssetSrc(`assets/nature-modifiers/nature-${name}.svg`);

function StatIcon({ stat, className = "" }: { stat: StatKey; className?: string }) {
  return (
    <img
      className={`stat-icon ${className}`.trim()}
      src={getStatIconSrc(stat)}
      alt={statLabels[stat]}
      loading="lazy"
      decoding="async"
    />
  );
}

function NatureModifierIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <img
      className="nature-modifier-icon"
      src={getNatureModifierIconSrc(direction)}
      alt={direction === "up" ? "上昇" : "下降"}
      loading="lazy"
      decoding="async"
    />
  );
}

function NatureStatModifier({
  natureLabel,
  stat,
}: {
  natureLabel: string;
  stat: StatKey;
}) {
  const direction = getNatureModifierDirection(natureLabel, stat);

  return (
    <span
      className={`nature-stat-modifier${direction ? ` ${direction}` : ""}`}
      aria-label={direction ? `${statLabels[stat]} ${direction === "up" ? "上昇" : "下降"}` : undefined}
      aria-hidden={direction ? undefined : true}
    >
      {direction ? <NatureModifierIcon direction={direction} /> : null}
    </span>
  );
}

export const applyScenarioAdjustmentTypeDefaults = (
  scenario: ScenarioFormState,
  adjustmentType: ScenarioAdjustmentType,
): ScenarioFormState => ({
  ...scenario,
  adjustmentType,
  attacks: scenario.attacks.map((attack) => ({
    ...attack,
    attackerStatPoints: adjustmentType === "speed" && attack.attackerStatPoints.spe === 0
      ? { ...attack.attackerStatPoints, spe: CHAMPIONS_MAX_STAT_POINTS_PER_STAT }
      : attack.attackerStatPoints,
    speedOrderMode: "normal",
    speedTargetTailwind: false,
    speedOpponentTailwind: false,
  })),
});

export const toScenarioGameType = (format: SuggestionFormat): GameType => (
  format === "Doubles" ? "doubles" : "singles"
);

export const syncScenarioGameTypesToSuggestionFormat = (
  scenarios: ScenarioFormState[],
  format: SuggestionFormat,
): ScenarioFormState[] => {
  const gameType = toScenarioGameType(format);
  return scenarios.map((scenario) => {
    let changed = false;
    const attacks = scenario.attacks.map((attack) => {
      if (attack.gameType === gameType) {
        return attack;
      }

      changed = true;
      return applyBeatUpGameTypeDefaults(attack, gameType);
    });

    return changed ? { ...scenario, attacks } : scenario;
  });
};

export const applySpeedOrderModeDefaults = (
  attack: ScenarioAttackFormState,
  speedOrderMode: ScenarioAttackFormState["speedOrderMode"],
): ScenarioAttackFormState => {
  const currentSpe = attack.attackerStatPoints.spe;
  const nextDefaultSpe = speedOrderMode === "trick-room"
    ? 0
    : CHAMPIONS_MAX_STAT_POINTS_PER_STAT;
  const shouldApplyDefault = speedOrderMode === "trick-room"
    ? currentSpe === CHAMPIONS_MAX_STAT_POINTS_PER_STAT
    : currentSpe === 0;

  return {
    ...attack,
    speedOrderMode,
    attackerStatPoints: shouldApplyDefault
      ? { ...attack.attackerStatPoints, spe: nextDefaultSpe }
      : attack.attackerStatPoints,
  };
};

const createBlankAttack = (index: number, gameType: GameType = "singles"): ScenarioAttackFormState => ({
  ...createDefaultScenarioAttackForm(`attack-${Date.now()}-${index}`, `攻撃${String.fromCharCode(65 + index)}`),
  attackerPokemonInput: "",
  attackerNatureInput: "",
  attackerAbilityInput: "",
  attackerItemInput: "",
  attackerTeraTypeInput: "",
  attackerTeraEnabled: false,
  attackerDmaxEnabled: false,
  attackerStatus: "none",
  attackerLevel: 50,
  attackerLevelMode: "auto",
  attackerStatPoints: createDefaultAttackerStatPoints(),
  attackerBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  defenderBoosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  moveInput: "",
  repeat: 1,
  requiredSurvivedHits: Math.min(10, index + 1),
  minSurvivalProbabilityPercent: 100,
  targetKoProbabilityPercent: 100,
  gameType,
  weather: "none",
  terrain: "none",
  critical: false,
  reflect: false,
  lightScreen: false,
  auroraVeil: false,
  helpingHand: false,
  friendGuard: false,
  speedTargetMode: "opponent",
  speedComparison: "outspeed",
  speedRequiredOffset: 1,
  speedTargetValue: 0,
  speedItemMultiplier: "auto",
  speedAbilityMultiplier: "auto",
  speedTargetStatus: "none",
  speedTargetItemMultiplier: "auto",
  speedTargetAbilityMultiplier: "auto",
  speedTargetTailwind: false,
  speedOpponentTailwind: false,
  speedOrderMode: "normal",
});

const createBlankTargetForm = (): TargetFormState => ({
  ...createDefaultTargetForm(),
  pokemonInput: "",
  natureInput: "",
  abilityInput: "",
  itemInput: "",
  teraTypeInput: "",
  teraEnabled: false,
  dmaxEnabled: false,
  level: 50,
  statPoints: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  boosts: { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
});

const createBlankScenario = (index: number, gameType: GameType = "singles"): ScenarioFormState => ({
  ...createDefaultScenarioForms()[0],
  id: `scenario-${Date.now()}-${index}`,
  label: `シナリオ${index + 1}`,
  enabled: true,
  attacks: [createBlankAttack(0, gameType)],
});

export const createAccountBoundaryForms = (
  format: SuggestionFormat,
): { readonly target: TargetFormState; readonly scenarios: readonly [ScenarioFormState] } => ({
  target: createBlankTargetForm(),
  scenarios: [createBlankScenario(0, toScenarioGameType(format))],
});

export const createScenario = (index: number, gameType: GameType = "singles"): ScenarioFormState => ({
  ...createBlankScenario(index, gameType),
  id: `scenario-${Date.now()}-${index}`,
  label: `シナリオ${index + 1}`,
});

const BLANK_BOX_SLOT_ID = "blank-box-slot";
const BLANK_ENEMY_BOX_SLOT_ID = "blank-enemy-box-slot";

export const isBoxStorageSourceReady = (
  renderedSourceKey: string,
  activeSourceKey: string,
  isAvailable: boolean,
): boolean => isAvailable && renderedSourceKey === activeSourceKey;

type SuggestionUsageContextValue = {
  data: ChampionsUsageData | null;
  format: SuggestionFormat;
  enabled: boolean;
  ownerAliases: Readonly<Record<string, string>>;
};

const SuggestionUsageContext = createContext<SuggestionUsageContextValue>({
  data: null,
  format: "Singles",
  enabled: false,
  ownerAliases: {},
});

export const resolveUsageSuggestionOwner = (
  ownerPokemonCanonicalName: string | undefined,
  ownerAliases: Readonly<Record<string, string>>,
): string | undefined => ownerPokemonCanonicalName
  ? ownerAliases[ownerPokemonCanonicalName] ?? ownerPokemonCanonicalName
  : undefined;

const useUsageSuggestionOptions = (
  category: UsageRankingCategory,
  input: string,
  ownerPokemonCanonicalName: string | undefined,
  baseOptions: readonly EntityInputOption[] = getEntityInputOptions(category),
  limit = 40,
): EntityInputOption[] => {
  const { data, format, ownerAliases } = useContext(SuggestionUsageContext);
  return getUsageMatchingEntityInputOptions(
    baseOptions,
    input,
    data,
    format,
    resolveUsageSuggestionOwner(ownerPokemonCanonicalName, ownerAliases),
    category,
    limit,
  );
};

export const getAttackSuggestionRankingOwners = (
  adjustmentType: ScenarioAdjustmentType,
  targetPokemonCanonicalName: string | undefined,
  attackerPokemonCanonicalName: string | undefined,
): Record<UsageRankingCategory, string | undefined> => ({
  move: adjustmentType === "offense"
    ? targetPokemonCanonicalName
    : attackerPokemonCanonicalName,
  ability: attackerPokemonCanonicalName,
  item: attackerPokemonCanonicalName,
});

type SuggestionFormatToggleProps = {
  value?: SuggestionFormat;
  onChange?: (format: SuggestionFormat) => void;
};

export function SuggestionFormatToggle({ value, onChange }: SuggestionFormatToggleProps) {
  const [internalValue, setInternalValue] = useState<SuggestionFormat>("Singles");
  const selectedValue = value ?? internalValue;
  const options: Array<{ format: SuggestionFormat; label: string; assetPath: string }> = [
    { format: "Singles", label: "シングル", assetPath: "assets/ui/single.svg" },
    { format: "Doubles", label: "ダブル", assetPath: "assets/ui/double.svg" },
  ];

  return (
    <div className="suggestion-format-toggle" role="radiogroup" aria-label="バトル形式とサジェスト基準">
      {options.map(({ format, label, assetPath }) => {
        const checked = selectedValue === format;
        const iconStyle = {
          WebkitMaskImage: `url("${getAssetSrc(assetPath)}")`,
          maskImage: `url("${getAssetSrc(assetPath)}")`,
        } satisfies CSSProperties;
        return (
          <label
            className="suggestion-format-option"
            data-checked={checked ? "true" : "false"}
            key={format}
          >
            <input
              type="radio"
              name="suggestion-format"
              value={format}
              checked={checked}
              aria-label={label}
              onChange={() => {
                if (value === undefined) setInternalValue(format);
                onChange?.(format);
              }}
            />
            <span className="suggestion-format-option-content">
              <span className="suggestion-format-icon" style={iconStyle} aria-hidden="true" />
              <span className="suggestion-format-option-label">{label}</span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

type DraftRecoveryState =
  | Extract<DraftLoadResult, { status: "success" }>
  | (Extract<DraftLoadResult, { status: "error" }> & { canRetryDiscard?: boolean });

type DraftSaveUiState =
  | { status: "idle" | "saving" | "saved" | "box-saved" }
  | { status: "error"; operation: "save" | "cloud-save" | "discard" | "commit"; message: string };

type DraftBaselineKind = "draft" | "box" | null;

type PendingBackupImport =
  | {
      kind: "target";
      importedEntries: readonly BoxEntry[];
      warnings: readonly string[];
      warningsBlockReplace: boolean;
    }
  | {
      kind: "enemy";
      importedEntries: readonly EnemyBoxEntry[];
      warnings: readonly string[];
      warningsBlockReplace: boolean;
    };

export const getDraftSaveStatusLabel = (
  state: DraftSaveUiState,
  cloudStatus?: CloudDraftRuntimeStatus | null,
): string => {
  switch (state.status) {
    case "idle":
      return "";
    case "saving":
      return "下書きを保存中…";
    case "saved":
      switch (cloudStatus) {
        case "queued":
        case "idle":
          return "ブラウザ保存済み";
        case "syncing":
          return "クラウドへ保存中…";
        case "synced":
          return "クラウド保存済み";
        case "offline":
          return "オフライン（ブラウザ保存済み）";
        case "error":
          return "同期エラー（ブラウザ保存済み）";
        default:
          return "このブラウザに下書き保存済み";
      }
    case "box-saved":
      return "ボックスに保存済み";
    case "error":
      if (state.operation === "save") return "下書き保存エラー";
      if (state.operation === "cloud-save") return "同期エラー（ブラウザ保存済み）";
      return state.operation === "commit"
        ? "ボックス保存後の下書き削除エラー"
        : "下書き削除エラー";
  }
};

const formatDraftSavedAt = (savedAt: string): string => new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
}).format(new Date(savedAt));

type DraftRecoveryDialogProps = {
  recovery: DraftRecoveryState;
  onRestore: () => void;
  onDiscard: () => void;
  onDismissUnavailable: () => void;
};

export function DraftRecoveryDialog({
  recovery,
  onRestore,
  onDiscard,
  onDismissUnavailable,
}: DraftRecoveryDialogProps) {
  const dialogRef = useRef<HTMLElement | null>(null);
  const canRestore = recovery.status === "success";
  const canDiscard = canRestore
    || recovery.reason === "corrupt"
    || recovery.canRetryDiscard === true;
  const title = canRestore ? "保存した下書きがあります" : "下書きを読み込めませんでした";
  const description = canRestore
    ? "前回の入力条件をこのブラウザから復元できます。"
    : recovery.message;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return undefined;
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    ));
    focusable[0]?.focus();

    const keepFocusInside = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Tab" || focusable.length === 0) {
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    dialog.addEventListener("keydown", keepFocusInside);

    return () => {
      dialog.removeEventListener("keydown", keepFocusInside);
      previouslyFocused?.focus();
    };
  }, [canDiscard, canRestore]);

  return (
    <div className="draft-recovery-overlay">
      <div className="draft-recovery-backdrop" aria-hidden="true" />
      <section
        ref={dialogRef}
        className="draft-recovery-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="draft-recovery-title"
        aria-describedby="draft-recovery-description"
        tabIndex={-1}
      >
        <div className="draft-recovery-copy">
          <span className="draft-recovery-kicker">このブラウザの作業中データ</span>
          <h2 id="draft-recovery-title">{title}</h2>
          <p id="draft-recovery-description">{description}</p>
          {canRestore ? (
            <dl className="draft-recovery-summary">
              <div>
                <dt>調整対象</dt>
                <dd>{recovery.draft.payload.target.pokemonInput.trim() || "未入力"}</dd>
              </div>
              <div>
                <dt>シナリオ</dt>
                <dd>{recovery.draft.payload.scenarios.length}件</dd>
              </div>
              <div>
                <dt>保存日時</dt>
                <dd>{formatDraftSavedAt(recovery.draft.savedAt)}</dd>
              </div>
            </dl>
          ) : null}
        </div>
        <div className="draft-recovery-actions">
          {canRestore ? (
            <Button variant="primary" onClick={onRestore}>
              下書きを復元
            </Button>
          ) : null}
          {canDiscard ? (
            <Button variant="danger" onClick={onDiscard}>
              下書きを破棄
            </Button>
          ) : (
            <Button variant="primary" onClick={onDismissUnavailable}>
              閉じる
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

type AppProps = {
  initialTargetForm?: TargetFormState;
  initialScenarioForms?: ScenarioFormState[];
  variant?: "default" | "tutorial";
  suggestionFormat?: SuggestionFormat;
  onSuggestionFormatChange?: (format: SuggestionFormat) => void;
  usageData?: ChampionsUsageData | null;
  usagePokemonAliases?: Readonly<Record<string, string>>;
  usageSourceGeneratedAt?: string | null;
  onSearchStatusChange?: (status: SearchStatus) => void;
  onCandidateApplied?: () => void;
};

export function App({
  initialTargetForm,
  initialScenarioForms,
  variant = "default",
  suggestionFormat,
  onSuggestionFormatChange,
  usageData,
  usagePokemonAliases,
  usageSourceGeneratedAt,
  onSearchStatusChange,
  onCandidateApplied,
}: AppProps = {}) {
  const authSession = useOptionalAuthSession();
  const migrationReadiness = useSyncMigrationReadiness();
  const migrationControl = useSyncMigrationControl();
  const syncBox = useOptionalSyncBox();
  const cloudDraft = useOptionalCloudDraft();
  const draftStorageScope = resolveDraftStorageScope(cloudDraft);
  const activeDraftStorageKey = draftStorageScope.storageKey;
  const activeDraftSourceKey = draftStorageScope.sourceKey;
  const unavailableDraftStorageMessage = cloudDraft?.lastError
    ?? "アカウントの下書き保存を利用できません";
  const loadActiveDraftFromBrowser = (): DraftLoadResult => activeDraftStorageKey
    ? loadDraftFromBrowser({ storageKey: activeDraftStorageKey })
    : {
        status: "error",
        reason: "unavailable",
        message: unavailableDraftStorageMessage,
      };
  const [savedSuggestionFormat, setSavedSuggestionFormat] = useState<SuggestionFormat>(
    () => variant === "tutorial" ? "Singles" : loadSuggestionFormat(),
  );
  const [loadedUsageData, setLoadedUsageData] = useState<ChampionsUsageData | null>(null);
  const activeSuggestionFormat = suggestionFormat ?? savedSuggestionFormat;
  const activeUsageData = usageData === undefined
    ? loadedUsageData
    : usageData;
  const [targetForm, setTargetForm] = useState<TargetFormState>(
    () => initialTargetForm ?? createBlankTargetForm(),
  );
  const [scenarioForms, setScenarioForms] = useState<ScenarioFormState[]>(
    () => initialScenarioForms ?? [createBlankScenario(0, toScenarioGameType(activeSuggestionFormat))],
  );
  const [searchState, dispatchSearch] = useReducer(searchUiReducer, undefined, createInitialSearchUiState);
  const [bulkMaximizeState, dispatchBulkMaximize] = useReducer(
    bulkMaximizeUiReducer,
    undefined,
    createInitialBulkMaximizeUiState,
  );
  const [allowBulkNatureChange, setAllowBulkNatureChange] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [appliedCandidateId, setAppliedCandidateId] = useState<string | null>(null);
  const [appliedAdjustmentId, setAppliedAdjustmentId] = useState<string | null>(null);
  const [actualStats, setActualStats] = useState<StatTable | null>(null);
  const [statPointMarkers, setStatPointMarkers] = useState<StatPointMarkerTable | null>(null);
  const [attackerActualStats, setAttackerActualStats] = useState<Record<string, StatTable>>({});
  const [boxOpen, setBoxOpen] = useState(false);
  const [enemyBoxOpen, setEnemyBoxOpen] = useState(false);
  const [mobileSheet, setMobileSheet] = useState<MobileSheet | null>(null);
  const [mobileScenarioDetailId, setMobileScenarioDetailId] = useState<string | null>(null);
  const [mobileFocusedAttackId, setMobileFocusedAttackId] = useState<string | null>(null);
  const [boxEntries, setBoxEntries] = useState<BoxEntry[]>(
    () => variant === "tutorial" ? [] : loadBoxEntriesFromBrowser(),
  );
  const [selectedBoxEntryId, setSelectedBoxEntryId] = useState<string | null>(null);
  const [boxMessage, setBoxMessage] = useState<string | null>(null);
  const [enemyBoxEntries, setEnemyBoxEntries] = useState<EnemyBoxEntry[]>(
    () => variant === "tutorial" ? [] : loadEnemyBoxEntriesFromBrowser(),
  );
  const [selectedEnemyBoxEntryId, setSelectedEnemyBoxEntryId] = useState<string | null>(null);
  const [enemyBoxMessage, setEnemyBoxMessage] = useState<string | null>(null);
  const [pendingBackupImport, setPendingBackupImport] = useState<PendingBackupImport | null>(null);
  const [cloudDraftOpen, setCloudDraftOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountMessage, setAccountMessage] = useState<string | null>(null);
  const [logoutPending, setLogoutPending] = useState(false);
  const [accountDeletion, setAccountDeletion] = useState<AccountDeletionState>({ stage: "idle" });
  const [isOnline, setIsOnline] = useState(() => (
    typeof navigator === "undefined" ? true : navigator.onLine !== false
  ));
  const [draftRecovery, setDraftRecovery] = useState<DraftRecoveryState | null>(() => {
    if (variant !== "default") {
      return null;
    }
    const result = loadActiveDraftFromBrowser();
    return result.status === "empty" ? null : result;
  });
  const [draftSaveState, setDraftSaveState] = useState<DraftSaveUiState>({ status: "idle" });
  const draftBaselineKindRef = useRef<DraftBaselineKind>(
    draftRecovery?.status === "success" ? "draft" : null,
  );
  const previousVariantRef = useRef(variant);
  const workerClientRef = useRef<DefenceSearchWorkerClient | null>(null);
  const activeRequestRef = useRef<ActiveDefenceSearchRequest | null>(null);
  const applyTimerRef = useRef<number | null>(null);
  const boxImportInputRef = useRef<HTMLInputElement | null>(null);
  const enemyBoxImportInputRef = useRef<HTMLInputElement | null>(null);
  const mobileScenarioPanelRef = useRef<HTMLElement | null>(null);
  const cancelDraftSaveRef = useRef<(() => void) | null>(null);
  const lastDraftFingerprintRef = useRef<string | null>(null);
  const boxBaselineFingerprintRef = useRef<string | null>(null);
  const pendingBoxCommitFingerprintRef = useRef<string | null>(null);
  const pendingCloudDraftRef = useRef<{
    readonly sourceKey: string;
    readonly fingerprint: string;
    readonly draft: DraftStorageDocument;
  } | null>(null);
  const accountOperationRef = useRef(0);
  const accountAuthUid = authSession?.state.user?.uid ?? null;
  const previousAccountAuthUidRef = useRef(accountAuthUid);
  const accountExpectedAuthUidRef = useRef<string | null | undefined>(undefined);
  const accountDeletionLockedRef = useRef(false);
  const suspendDraftPersistenceRef = useRef(false);
  const boxSourceKeyRef = useRef("device");
  const draftSourceKeyRef = useRef(activeDraftSourceKey);
  const cloudDraftRef = useRef(cloudDraft);
  cloudDraftRef.current = cloudDraft;
  if (lastDraftFingerprintRef.current === null) {
    lastDraftFingerprintRef.current = createDraftFingerprint(targetForm, scenarioForms);
  }

  useEffect(() => {
    if (previousAccountAuthUidRef.current === accountAuthUid) return;
    previousAccountAuthUidRef.current = accountAuthUid;
    const expectedUid = accountExpectedAuthUidRef.current;
    accountExpectedAuthUidRef.current = undefined;
    // The provider callback is the account namespace authority. Invalidate
    // every older UI operation so its eventual Promise cannot annotate the
    // newly signed-in, signed-out, or switched account.
    if (shouldInvalidateAccountOperationOnUidChange(expectedUid, accountAuthUid)) {
      accountOperationRef.current += 1;
    }
    setAccountBusy(false);
    setAccountError(null);
    setAccountMessage(null);
    setLogoutPending(false);
    accountDeletionLockedRef.current = false;
    setAccountDeletion({ stage: "idle" });
    setAccountOpen(false);
    activeRequestRef.current?.cancel();
    activeRequestRef.current = null;
    setSelectedCandidateId(null);
    setAppliedCandidateId(null);
    if (applyTimerRef.current !== null) {
      window.clearTimeout(applyTimerRef.current);
      applyTimerRef.current = null;
    }
    dispatchSearch({ type: "reset" });
    dispatchBulkMaximize({ type: "reset" });
    cancelDraftSaveRef.current?.();
    cancelDraftSaveRef.current = null;
    pendingCloudDraftRef.current = null;
    boxBaselineFingerprintRef.current = null;
    pendingBoxCommitFingerprintRef.current = null;
    draftBaselineKindRef.current = null;
    const blank = createAccountBoundaryForms(activeSuggestionFormat);
    setTargetForm(blank.target);
    setScenarioForms([...blank.scenarios]);
    setDraftSaveState({ status: "idle" });
  }, [accountAuthUid, activeSuggestionFormat]);

  const previewInput = useMemo(() => {
    try {
      return { input: buildIntegratedDefenceSearchInput(targetForm, scenarioForms), error: null };
    } catch (error) {
      return { input: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [targetForm, scenarioForms]);

  const targetBuildPreview = useMemo(() => {
    try {
      return buildTargetBuildFromUi(targetForm);
    } catch {
      return null;
    }
  }, [targetForm]);

  const targetArtwork = useMemo(() => findPokemonArtwork({
    input: targetForm.pokemonInput,
    canonicalName: targetBuildPreview?.pokemon.canonicalName,
  }), [targetForm.pokemonInput, targetBuildPreview?.pokemon.canonicalName]);

  const currentBoxSummary = useMemo(
    () => createBoxEntrySummary(targetForm, scenarioForms),
    [targetForm, scenarioForms],
  );
  const currentEnemyBoxSummary = useMemo(
    () => createEnemyBoxEntrySummary(scenarioForms),
    [scenarioForms],
  );

  const offenseResults = useMemo(
    () => calculateOffenseAdjustmentsForCandidateRanking(targetForm, scenarioForms),
    [targetForm, scenarioForms],
  );
  const speedResults = useMemo(
    () => calculateSpeedAdjustmentsForCandidateRanking(targetForm, scenarioForms),
    [targetForm, scenarioForms],
  );
  const targetSpeedOverrideCounts = useMemo(
    () => getTargetSpeedOverrideCounts(targetForm, scenarioForms),
    [targetForm, scenarioForms],
  );

  const hasEnabledDefenceScenario = scenarioForms.some((scenario) => (
    scenario.enabled && scenario.adjustmentType === "defence"
  ));
  const hasStandaloneAdjustmentResults = offenseResults.length > 0 || speedResults.length > 0;
  const canRunAdjustment = hasEnabledDefenceScenario || hasStandaloneAdjustmentResults;
  const runButtonLabel = hasEnabledDefenceScenario
    ? "計算開始"
    : hasStandaloneAdjustmentResults
      ? "結果確認"
      : "シナリオなし";

  const resultAlertMessage =
    (hasEnabledDefenceScenario && previewInput.error && !isCanonicalResolutionMessage(previewInput.error))
      ? previewInput.error
      : searchState.errorMessage && !isCanonicalResolutionMessage(searchState.errorMessage)
        ? searchState.errorMessage
        : null;

  useEffect(() => {
    if (usageData !== undefined) {
      return undefined;
    }

    const controller = new AbortController();
    void loadChampionsUsageData({ signal: controller.signal }).then((result) => {
      if (result.data) {
        setLoadedUsageData(result.data);
      }
    });

    return () => controller.abort();
  }, [usageData]);

  useEffect(() => {
    if (variant !== "default") return undefined;
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    globalThis.addEventListener?.("online", handleOnline);
    globalThis.addEventListener?.("offline", handleOffline);
    return () => {
      globalThis.removeEventListener?.("online", handleOnline);
      globalThis.removeEventListener?.("offline", handleOffline);
    };
  }, [variant]);

  useEffect(() => {
    if (suspendDraftPersistenceRef.current) {
      return undefined;
    }
    const fingerprint = createDraftFingerprint(targetForm, scenarioForms);
    const decision = getDraftAutosaveDecision({
      variant,
      hasRecovery: draftRecovery !== null,
      sourceMatches: draftSourceKeyRef.current === activeDraftSourceKey,
      fingerprint,
      boxBaselineFingerprint: boxBaselineFingerprintRef.current,
      lastDraftFingerprint: lastDraftFingerprintRef.current,
    });
    if (decision === "skip") {
      return undefined;
    }

    if (!activeDraftStorageKey) {
      setDraftSaveState({
        status: "error",
        operation: "save",
        message: unavailableDraftStorageMessage,
      });
      return undefined;
    }

    if (decision === "discard-box") {
      const result = discardCurrentDraftFromActiveStorage();
      if (result.status === "success") {
        lastDraftFingerprintRef.current = fingerprint;
        draftBaselineKindRef.current = "box";
        pendingBoxCommitFingerprintRef.current = null;
        setDraftSaveState({ status: "box-saved" });
      } else {
        pendingBoxCommitFingerprintRef.current = fingerprint;
        setDraftSaveState({
          status: "error",
          operation: "commit",
          message: `ボックスへ保存済みの内容ですが、${result.message}`,
        });
      }
      return undefined;
    }
    if (decision === "unchanged") {
      setDraftSaveState((current) => (
        current.status === "saving"
        || (current.status === "error" && current.operation === "save")
          ? {
              status: draftBaselineKindRef.current === "draft"
                ? "saved"
                : draftBaselineKindRef.current === "box"
                  ? "box-saved"
                  : "idle",
            }
          : current
      ));
      return undefined;
    }

    setDraftSaveState({ status: "saving" });
    const cancelScheduledSave = scheduleDraftAutosave(() => {
      cancelDraftSaveRef.current = null;
      const result = saveDraftToBrowser(targetForm, scenarioForms, {
        storageKey: activeDraftStorageKey,
      });
      applyCurrentDraftSaveResult(fingerprint, result);
    });
    cancelDraftSaveRef.current = cancelScheduledSave;

    return () => {
      cancelScheduledSave();
      if (cancelDraftSaveRef.current === cancelScheduledSave) {
        cancelDraftSaveRef.current = null;
      }
    };
  }, [activeDraftSourceKey, activeDraftStorageKey, draftRecovery, scenarioForms, targetForm, variant]);

  useEffect(() => {
    if (variant !== "default" || draftSourceKeyRef.current === activeDraftSourceKey) {
      return;
    }
    cancelDraftSaveRef.current?.();
    cancelDraftSaveRef.current = null;
    draftSourceKeyRef.current = activeDraftSourceKey;
    // Treat the already-visible form as an uncommitted transition baseline.
    // It must not be copied automatically from the previous UID/guest slot;
    // only a later explicit edit or restore may save it into this namespace.
    lastDraftFingerprintRef.current = createDraftFingerprint(targetForm, scenarioForms);
    pendingCloudDraftRef.current = null;
    draftBaselineKindRef.current = null;
    pendingBoxCommitFingerprintRef.current = null;
    suspendDraftPersistenceRef.current = false;
    setCloudDraftOpen(false);
    setDraftSaveState({ status: "idle" });
    const result = loadActiveDraftFromBrowser();
    draftBaselineKindRef.current = result.status === "success" ? "draft" : null;
    setDraftRecovery(result.status === "empty" ? null : result);
  }, [activeDraftSourceKey, activeDraftStorageKey, scenarioForms, targetForm, variant]);

  useEffect(() => {
    const previousVariant = previousVariantRef.current;
    previousVariantRef.current = variant;
    if (previousVariant === variant) {
      return;
    }

    lastDraftFingerprintRef.current = createDraftFingerprint(targetForm, scenarioForms);
    pendingCloudDraftRef.current = null;
    setDraftSaveState({ status: "idle" });
    boxBaselineFingerprintRef.current = null;
    pendingBoxCommitFingerprintRef.current = null;
    if (variant === "tutorial") {
      draftBaselineKindRef.current = null;
      setDraftRecovery(null);
      return;
    }

    const result = loadActiveDraftFromBrowser();
    draftBaselineKindRef.current = result.status === "success" ? "draft" : null;
    setDraftRecovery(result.status === "empty" ? null : result);
  }, [activeDraftStorageKey, scenarioForms, targetForm, variant]);

  useEffect(() => {
    return () => {
      activeRequestRef.current?.cancel();
      workerClientRef.current?.dispose();
      if (applyTimerRef.current !== null) {
        window.clearTimeout(applyTimerRef.current);
      }
      cancelDraftSaveRef.current?.();
    };
  }, []);

  useEffect(() => {
    onSearchStatusChange?.(searchState.status);
  }, [onSearchStatusChange, searchState.status]);

  useEffect(() => {
    if (mobileSheet !== "scenarios") {
      return;
    }

    const panel = mobileScenarioPanelRef.current;
    if (!panel) {
      return;
    }

    panel.scrollTop = 0;
    const scenarioStack = panel.querySelector<HTMLElement>(".scenario-stack");
    if (scenarioStack) {
      scenarioStack.scrollTop = 0;
    }
  }, [mobileFocusedAttackId, mobileScenarioDetailId, mobileSheet]);

  useEffect(() => {
    let canceled = false;

    if (!targetBuildPreview) {
      setActualStats(null);
      setStatPointMarkers(null);
      setAttackerActualStats({});
      return () => {
        canceled = true;
      };
    }

    void Promise.all([
      import("./calc/smogonAdapter"),
      import("./calc/statPointMarkers"),
    ]).then(([{ toSmogonPokemon }, { calculateStatPointMarkerTable }]) => {
      if (!canceled) {
        const pokemon = toSmogonPokemon(targetBuildPreview);
        setActualStats({ ...pokemon.stats, hp: pokemon.maxHP() });
        setStatPointMarkers(calculateStatPointMarkerTable(targetBuildPreview));
        setAttackerActualStats(Object.fromEntries(
          scenarioForms.flatMap((scenario) => scenario.attacks.flatMap((attack) => {
            try {
              const build = buildScenarioAttackBuildFromUi(
                attack,
                `${scenario.id}-${attack.id}-attacker`,
              );
              const attacker = toSmogonPokemon(build);
              return [[build.id, { ...attacker.stats, hp: attacker.maxHP() }]];
            } catch {
              return [];
            }
          })),
        ));
      }
    }).catch(() => {
      if (!canceled) {
        setActualStats(null);
        setStatPointMarkers(null);
        setAttackerActualStats({});
      }
    });

    return () => {
      canceled = true;
    };
  }, [scenarioForms, targetBuildPreview]);

  const resetActiveSearch = () => {
    activeRequestRef.current?.cancel();
    activeRequestRef.current = null;
    setSelectedCandidateId(null);
    setAppliedCandidateId(null);
    if (applyTimerRef.current !== null) {
      window.clearTimeout(applyTimerRef.current);
      applyTimerRef.current = null;
    }
    dispatchSearch({ type: "reset" });
    dispatchBulkMaximize({ type: "reset" });
  };

  const cancelPendingDraftSave = () => {
    cancelDraftSaveRef.current?.();
    cancelDraftSaveRef.current = null;
  };

  const discardCurrentDraftFromActiveStorage = () => {
    if (!activeDraftStorageKey) {
      return {
        status: "error" as const,
        reason: "unavailable" as const,
        message: unavailableDraftStorageMessage,
      };
    }
    const result = discardDraftFromBrowser({ storageKey: activeDraftStorageKey });
    if (result.status === "success") {
      const currentDeviceId = cloudDraftRef.current?.deviceId;
      if (currentDeviceId) {
        const cloudError = cloudDraftRef.current?.deleteDraft(currentDeviceId);
        if (cloudError) {
          return {
            status: "error" as const,
            reason: "unavailable" as const,
            message: `クラウド下書きを削除待ちにできませんでした: ${cloudError}`,
          };
        }
      }
      pendingCloudDraftRef.current = null;
    }
    return result;
  };

  const applyCurrentDraftSaveResult = (
    fingerprint: string,
    result: ReturnType<typeof saveDraftToBrowser>,
  ) => {
    if (result.status === "success") {
      lastDraftFingerprintRef.current = fingerprint;
      draftBaselineKindRef.current = "draft";
      pendingBoxCommitFingerprintRef.current = null;
      if (result.draft) {
        const cloudAttempt = attemptCloudDraftQueue(result.draft, cloudDraftRef.current);
        if (cloudAttempt.status === "error") {
          pendingCloudDraftRef.current = {
            sourceKey: cloudDraftRef.current?.sourceKey ?? activeDraftSourceKey,
            fingerprint,
            draft: result.draft,
          };
          setDraftSaveState({
            status: "error",
            operation: "cloud-save",
            message: `このブラウザには保存済みですが、クラウド送信を準備できませんでした: ${cloudAttempt.message}`,
          });
          return;
        }
      }
      pendingCloudDraftRef.current = null;
      setDraftSaveState({ status: "saved" });
      return;
    }
    setDraftSaveState({ status: "error", operation: "save", message: result.message });
  };

  const retryCloudDraftQueue = () => {
    const pending = pendingCloudDraftRef.current;
    if (!pending) {
      saveCurrentDraftNow();
      return;
    }
    if (
      pending.sourceKey !== activeDraftSourceKey
      || cloudDraftRef.current?.sourceKey !== pending.sourceKey
    ) {
      pendingCloudDraftRef.current = null;
      setDraftSaveState({
        status: "error",
        operation: "cloud-save",
        message: "下書きの保存先が切り替わりました。現在の入力を変更してから保存し直してください",
      });
      return;
    }
    const cloudAttempt = attemptCloudDraftQueue(pending.draft, cloudDraftRef.current);
    if (cloudAttempt.status === "error") {
      setDraftSaveState({
        status: "error",
        operation: "cloud-save",
        message: `このブラウザには保存済みですが、クラウド送信を準備できませんでした: ${cloudAttempt.message}`,
      });
      return;
    }
    lastDraftFingerprintRef.current = pending.fingerprint;
    pendingCloudDraftRef.current = null;
    setDraftSaveState({ status: "saved" });
  };

  const saveCurrentDraftNow = () => {
    cancelPendingDraftSave();
    if (!activeDraftStorageKey) {
      setDraftSaveState({
        status: "error",
        operation: "save",
        message: unavailableDraftStorageMessage,
      });
      return;
    }
    const fingerprint = createDraftFingerprint(targetForm, scenarioForms);
    setDraftSaveState({ status: "saving" });
    applyCurrentDraftSaveResult(
      fingerprint,
      saveDraftToBrowser(targetForm, scenarioForms, {
        storageKey: activeDraftStorageKey,
      }),
    );
  };

  const applyCurrentBoxCommitResult = (
    fingerprint: string,
    result: ReturnType<typeof discardDraftFromBrowser>,
  ) => {
    boxBaselineFingerprintRef.current = fingerprint;
    if (result.status === "success") {
      pendingBoxCommitFingerprintRef.current = null;
      const currentFingerprint = createDraftFingerprint(targetForm, scenarioForms);
      if (currentFingerprint === fingerprint) {
        lastDraftFingerprintRef.current = fingerprint;
        draftBaselineKindRef.current = "box";
        setDraftSaveState({ status: "box-saved" });
      } else {
        saveCurrentDraftNow();
      }
      return;
    }
    pendingBoxCommitFingerprintRef.current = fingerprint;
    setDraftSaveState({
      status: "error",
      operation: "commit",
      message: `ボックスへ保存しましたが、${result.message}`,
    });
  };

  const retryCommitDraftCleanup = () => {
    const fingerprint = pendingBoxCommitFingerprintRef.current;
    if (fingerprint === null) {
      return;
    }
    cancelPendingDraftSave();
    applyCurrentBoxCommitResult(
      fingerprint,
      discardCurrentDraftFromActiveStorage(),
    );
  };

  const retryDiscardCurrentDraft = () => {
    const result = discardCurrentDraftFromActiveStorage();
    if (result.status === "success") {
      draftBaselineKindRef.current = null;
      setDraftSaveState({ status: "idle" });
      return;
    }
    setDraftSaveState({
      status: "error",
      operation: "discard",
      message: result.message,
    });
  };

  const handleRestoreDraft = () => {
    if (draftRecovery?.status !== "success") {
      return;
    }

    cancelPendingDraftSave();
    const { target, scenarios } = draftRecovery.draft.payload;
    const fingerprint = createDraftFingerprint(target, scenarios);
    resetActiveSearch();
    setTargetForm(target);
    setScenarioForms(scenarios);
    applyCurrentDraftSaveResult(fingerprint, {
      status: "success",
      draft: draftRecovery.draft,
    });
    setDraftRecovery(null);
  };

  const handleDiscardDraft = () => {
    const result = discardCurrentDraftFromActiveStorage();
    if (result.status === "error") {
      setDraftRecovery({
        status: "error",
        reason: "unavailable",
        message: result.message,
        canRetryDiscard: true,
      });
      return;
    }

    cancelPendingDraftSave();
    lastDraftFingerprintRef.current = createDraftFingerprint(targetForm, scenarioForms);
    draftBaselineKindRef.current = null;
    setDraftRecovery(null);
    setDraftSaveState({ status: "idle" });
  };

  const handleDismissUnavailableDraft = () => {
    lastDraftFingerprintRef.current = createDraftFingerprint(targetForm, scenarioForms);
    setDraftRecovery(null);
  };

  const handleRestoreCloudDraft = (record: CloudDraftRecord) => {
    let draft;
    try {
      draft = parseDraftStorageDocument(record.payload);
    } catch (error) {
      setDraftSaveState({
        status: "error",
        operation: "save",
        message: error instanceof Error
          ? `クラウド下書きを復元できませんでした: ${error.message}`
          : "クラウド下書きを復元できませんでした",
      });
      return;
    }
    if (!activeDraftStorageKey) {
      setDraftSaveState({
        status: "error",
        operation: "save",
        message: unavailableDraftStorageMessage,
      });
      return;
    }
    cancelPendingDraftSave();
    const { target, scenarios } = draft.payload;
    const fingerprint = createDraftFingerprint(target, scenarios);
    const saveResult = saveDraftToBrowser(target, scenarios, {
      storageKey: activeDraftStorageKey,
    });
    if (saveResult.status === "error") {
      setDraftSaveState({ status: "error", operation: "save", message: saveResult.message });
      return;
    }
    resetActiveSearch();
    setTargetForm(target);
    setScenarioForms(scenarios);
    applyCurrentDraftSaveResult(fingerprint, saveResult);
    setDraftRecovery(null);
    setCloudDraftOpen(false);
  };

  const handleDeleteCloudDraft = (record: CloudDraftRecord) => {
    if (!cloudDraftRef.current) return;
    if (record.deviceId === cloudDraftRef.current.deviceId) {
      const result = discardCurrentDraftFromActiveStorage();
      if (result.status === "error") {
        setDraftSaveState({ status: "error", operation: "discard", message: result.message });
        return;
      }
      draftBaselineKindRef.current = null;
      setDraftSaveState({ status: "idle" });
      return;
    }
    cloudDraftRef.current.deleteDraft(record.deviceId);
  };

  const prepareAccountBoundaryChange = () => {
    suspendDraftPersistenceRef.current = true;
    cancelPendingDraftSave();
    pendingCloudDraftRef.current = null;
    resetActiveSearch();
    setDraftRecovery(null);
    setCloudDraftOpen(false);
    setPendingBackupImport(null);
    setBoxOpen(false);
    setEnemyBoxOpen(false);
    closeMobileSheet();
  };

  const handleAccountSignIn = async () => {
    if (!authSession) return;
    const operation = ++accountOperationRef.current;
    const startingUid = authSession.getCurrentUserUid();
    setAccountBusy(true);
    setAccountError(null);
    setAccountMessage(null);
    try {
      const user = await authSession.signInWithGoogle();
      if (isCurrentAccountOperation(
        operation,
        accountOperationRef.current,
        user.uid,
        authSession.getCurrentUserUid(),
      )) {
        setAccountOpen(false);
      }
    } catch (error) {
      if (isCurrentAccountOperation(
        operation,
        accountOperationRef.current,
        startingUid,
        authSession.getCurrentUserUid(),
      )) {
        setAccountError(error instanceof Error ? error.message : "Google ログインに失敗しました");
      }
    } finally {
      if (operation === accountOperationRef.current) setAccountBusy(false);
    }
  };

  const handleAccountSignOut = async () => {
    if (!authSession) return;
    const operation = ++accountOperationRef.current;
    const startingUid = authSession.getCurrentUserUid();
    setLogoutPending(false);
    setAccountBusy(true);
    setAccountError(null);
    setAccountMessage(null);
    prepareAccountBoundaryChange();
    try {
      await Promise.all([
        syncBox?.prepareAccountDeletion() ?? Promise.resolve(),
        cloudDraft?.prepareAccountDeletion() ?? Promise.resolve(),
      ]);
      accountExpectedAuthUidRef.current = null;
      try {
        await authSession.signOut();
      } catch (error) {
        if (accountExpectedAuthUidRef.current === null) {
          accountExpectedAuthUidRef.current = undefined;
        }
        throw error;
      }
      if (isCurrentAccountOperation(
        operation,
        accountOperationRef.current,
        null,
        authSession.getCurrentUserUid(),
      )) {
        setAccountMessage("ログアウトしました。ブラウザのみの保存領域へ切り替えました");
        setAccountOpen(false);
      }
    } catch (error) {
      if (isCurrentAccountOperation(
        operation,
        accountOperationRef.current,
        startingUid,
        authSession.getCurrentUserUid(),
      )) {
        suspendDraftPersistenceRef.current = false;
        syncBox?.resumeAccountOperations();
        cloudDraft?.resumeAccountOperations();
        setAccountError(error instanceof Error ? error.message : "ログアウトに失敗しました");
      }
    } finally {
      if (operation === accountOperationRef.current) setAccountBusy(false);
    }
  };

  const handleRequestAccountLogout = () => {
    const pendingCount = (syncBox?.snapshot.outboxCount ?? 0)
      + (cloudDraft?.snapshot.outboxCount ?? 0);
    if (pendingCount > 0 || (syncBox?.snapshot.conflictCount ?? 0) > 0) {
      setLogoutPending(true);
      return;
    }
    void handleAccountSignOut();
  };

  const handleManualAccountSync = async () => {
    if (migrationReadiness.status !== "ready") {
      migrationControl.resumeMigration();
      setAccountOpen(false);
      return;
    }
    const user = authSession?.state.user;
    if (!authSession || !user) {
      setAccountError("同期するアカウントを確認できません");
      return;
    }
    const operation = ++accountOperationRef.current;
    setAccountBusy(true);
    setAccountError(null);
    setAccountMessage(null);
    try {
      const [boxResult, draftResult] = await Promise.all([
        syncBox?.synchronize("manual") ?? Promise.resolve(null),
        cloudDraft?.synchronize("manual") ?? Promise.resolve(null),
      ]);
      const syncError = boxResult?.status === "error"
        ? boxResult.error.message
        : draftResult?.status === "error"
          ? draftResult.error.message
          : syncBox && boxResult === null
            ? syncBox.lastSyncError ?? "ボックスを同期できませんでした"
            : cloudDraft && draftResult === null
              ? cloudDraft.lastError ?? (isOnline
                ? "下書きを同期できませんでした"
                : "オフラインのため同期できません")
              : null;
      if (syncError) throw new Error(syncError);
      if (isCurrentAccountOperation(
        operation,
        accountOperationRef.current,
        user.uid,
        authSession.getCurrentUserUid(),
      )) {
        setAccountMessage("同期状態を更新しました");
      }
    } catch (error) {
      if (isCurrentAccountOperation(
        operation,
        accountOperationRef.current,
        user.uid,
        authSession.getCurrentUserUid(),
      )) {
        setAccountError(error instanceof Error ? error.message : "同期状態を更新できませんでした");
      }
    } finally {
      if (operation === accountOperationRef.current) setAccountBusy(false);
    }
  };

  const handleAccountExport = async () => {
    const user = authSession?.state.user;
    const client = getFirebaseClient();
    if (!user || client.status !== "ready") {
      setAccountError("アカウントデータを書き出せません");
      return;
    }
    const operation = ++accountOperationRef.current;
    let providersSuspended = false;
    setAccountBusy(true);
    setAccountError(null);
    setAccountMessage(null);
    try {
      cancelPendingDraftSave();
      saveCurrentDraftNow();
      const [boxResult, draftResult] = await Promise.all([
        syncBox?.synchronize("manual") ?? Promise.resolve(null),
        cloudDraft?.synchronize("manual") ?? Promise.resolve(null),
      ]);
      const syncError = boxResult?.status === "error"
        ? boxResult.error.message
        : draftResult?.status === "error"
          ? draftResult.error.message
          : syncBox && boxResult === null
            ? syncBox.lastSyncError ?? "ボックスを同期できませんでした"
            : cloudDraft && draftResult === null
              ? cloudDraft.lastError ?? "下書きを同期できませんでした"
              : null;
      if (syncError) throw new Error(syncError);
      if (operation !== accountOperationRef.current || authSession.getCurrentUserUid() !== user.uid) {
        throw new Error("アカウントが切り替わったため、書き出しを中止しました");
      }
      await Promise.all([
        syncBox?.prepareAccountDeletion() ?? Promise.resolve(),
        cloudDraft?.prepareAccountDeletion() ?? Promise.resolve(),
      ]);
      providersSuspended = true;
      if (operation !== accountOperationRef.current || authSession.getCurrentUserUid() !== user.uid) {
        throw new Error("アカウントが切り替わったため、書き出しを中止しました");
      }
      const result = await exportAccountData({
        uid: user.uid,
        profile: user,
        syncRepository: createFirestoreSyncRepository({ client, uid: user.uid }),
        draftRepository: createFirestoreCloudDraftRepository({ client, uid: user.uid }),
        synchronize: async () => ({
          status: "success" as const,
          outboxCount: (boxResult?.snapshot?.outboxCount ?? syncBox?.snapshot.outboxCount ?? 0)
            + (draftResult?.snapshot?.outboxCount ?? cloudDraft?.snapshot.outboxCount ?? 0),
          conflictCount: boxResult?.snapshot?.conflictCount ?? syncBox?.snapshot.conflictCount ?? 0,
          issues: [
            ...(boxResult?.issues ?? []),
            ...(draftResult?.issues ?? []),
          ],
        }),
      });
      if (result.status === "error") throw result.error;
      if (operation !== accountOperationRef.current || authSession.getCurrentUserUid() !== user.uid) {
        throw new Error("アカウントが切り替わったため、書き出しを中止しました");
      }
      const stamp = result.document.exportedAt.slice(0, 10).replaceAll("-", "");
      downloadAccountExport(result, {
        filename: `championcreator-account-export-${stamp}.json`,
      });
      setAccountMessage(result.status === "partial"
        ? "未同期または確認が必要なデータを明記して書き出しました"
        : "アカウントデータを書き出しました");
    } catch (error) {
      if (isCurrentAccountOperation(
        operation,
        accountOperationRef.current,
        user.uid,
        authSession.getCurrentUserUid(),
      )) {
        setAccountError(error instanceof Error ? error.message : "アカウントデータを書き出せませんでした");
      }
    } finally {
      if (providersSuspended && operation === accountOperationRef.current) {
        syncBox?.resumeAccountOperations();
        cloudDraft?.resumeAccountOperations();
      }
      if (operation === accountOperationRef.current) setAccountBusy(false);
    }
  };

  const handleResolveAccountConflict = (action: AccountConflictAction) => {
    const conflict = syncBox?.conflicts[0];
    if (!syncBox || !conflict) return;
    const decision = action === "local"
      ? "keep-local"
      : action === "remote"
        ? "keep-remote"
        : "keep-both";
    const error = syncBox.resolveConflict(conflict.kind, conflict.entryId, decision);
    if (error) {
      setAccountError(error);
      return;
    }
    setAccountError(null);
    setAccountMessage("競合を解決しました。残りの競合も順番に確認できます");
  };

  const handleDeleteAccount = async () => {
    const user = authSession?.state.user;
    const client = getFirebaseClient();
    if (!authSession || !user || client.status !== "ready") {
      setAccountError("削除するアカウントを確認できません");
      return;
    }
    const operation = ++accountOperationRef.current;
    setAccountBusy(true);
    setAccountError(null);
    setAccountMessage(null);
    setAccountDeletion({ stage: "deleting", busy: true });
    try {
      await deleteAccountAndCloudData({
        uid: user.uid,
        auth: {
          reauthenticateWithGoogle: async (expectedUid) => (
            authSession.session.reauthenticateWithGoogle(expectedUid)
          ),
          deleteAccount: async (expectedUid) => {
            accountExpectedAuthUidRef.current = null;
            try {
              await authSession.session.deleteAccount(expectedUid);
            } catch (error) {
              if (accountExpectedAuthUidRef.current === null) {
                accountExpectedAuthUidRef.current = undefined;
              }
              throw error;
            }
          },
          getCurrentUserUid: authSession.getCurrentUserUid,
        },
        firestore: client.firestore,
        deviceId: cloudDraft?.deviceId,
        prepareAccountDeletion: async () => {
          prepareAccountBoundaryChange();
          await Promise.all([
            syncBox?.prepareAccountDeletion() ?? Promise.resolve(),
            cloudDraft?.prepareAccountDeletion() ?? Promise.resolve(),
          ]);
        },
        resumeAccountOperations: () => {
          if (accountDeletionLockedRef.current) return;
          syncBox?.resumeAccountOperations();
          cloudDraft?.resumeAccountOperations();
        },
        isCurrent: () => operation === accountOperationRef.current,
      });
      if (operation !== accountOperationRef.current) return;
      clearSyncBoxRepositoryCache();
      clearCloudDraftRuntimeCache();
      clearSyncMigrationControllerCache();
      accountDeletionLockedRef.current = false;
      suspendDraftPersistenceRef.current = true;
      const blank = createAccountBoundaryForms(activeSuggestionFormat);
      setTargetForm(blank.target);
      setScenarioForms([...blank.scenarios]);
      setDraftSaveState({ status: "idle" });
      setAccountDeletion({ stage: "complete", message: "アカウントを削除しました" });
      setAccountMessage("アカウントとクラウドデータを削除しました");
      setAccountOpen(false);
    } catch (error) {
      const currentUid = authSession.getCurrentUserUid();
      if (
        operation === accountOperationRef.current
        && (currentUid === user.uid || currentUid === null)
      ) {
        const destructive = error instanceof AccountDeletionError && error.destructive;
        const keepLocked = accountDeletionLockedRef.current || destructive;
        accountDeletionLockedRef.current = keepLocked;
        if (!keepLocked) {
          suspendDraftPersistenceRef.current = false;
        } else if (error instanceof AccountDeletionError && error.code === "delete-account-failed") {
          // Cloud and UID-local data are already gone. Remove stale snapshots
          // from the visible providers while keeping mutations suspended until
          // the final Auth deletion is retried.
          syncBox?.discardAccountData();
          cloudDraft?.discardAccountData();
          clearSyncBoxRepositoryCache();
          clearCloudDraftRuntimeCache();
        }
        const message = error instanceof Error ? error.message : "アカウントを削除できませんでした";
        setAccountError(message);
        setAccountDeletion({
          stage: "error",
          message,
          onRetry: () => void handleDeleteAccount(),
          canCancel: !keepLocked,
        });
      }
    } finally {
      if (operation === accountOperationRef.current) setAccountBusy(false);
    }
  };

  const handleSuggestionFormatChange = (format: SuggestionFormat) => {
    resetActiveSearch();
    setScenarioForms((current) => syncScenarioGameTypesToSuggestionFormat(current, format));
    if (suggestionFormat === undefined) {
      setSavedSuggestionFormat(format);
    }
    saveSuggestionFormat(format);
    onSuggestionFormatChange?.(format);
  };

  const updateTargetField = <K extends keyof TargetFormState>(key: K, value: TargetFormState[K]) => {
    resetActiveSearch();
    setTargetForm((current) => (
      key === "levelMode"
        ? applyTargetLevelMode(current, value as TargetFormState["levelMode"])
        : { ...current, [key]: value }
    ));
  };

  const updateTargetEv = (key: StatKey, value: number) => {
    resetActiveSearch();
    setTargetForm((current) => {
      const nextValue = clampTargetStatPointChange(current.statPoints, key, value);
      return {
        ...current,
        statPoints: { ...current.statPoints, [key]: nextValue },
      };
    });
  };

  const updateScenario = <K extends keyof ScenarioFormState>(
    id: string,
    key: K,
    value: ScenarioFormState[K],
  ) => {
    resetActiveSearch();
    setScenarioForms((current) => current.map((scenario) => (
      scenario.id === id
        ? key === "adjustmentType"
          ? applyScenarioAdjustmentTypeDefaults(scenario, value as ScenarioAdjustmentType)
          : { ...scenario, [key]: value }
        : scenario
    )));
  };

  const toggleScenarioAdjustmentFromDirection = (id: string) => {
    resetActiveSearch();
    setScenarioForms((current) => current.map((scenario) => {
      if (scenario.id !== id) {
        return scenario;
      }

      return applyScenarioAdjustmentTypeDefaults(scenario, nextScenarioAdjustmentType(scenario.adjustmentType));
    }));
  };

  const updateScenarioAttackerEv = (id: string, key: StatKey, value: number) => {
    resetActiveSearch();
    const [scenarioId, attackId] = id.split(":");
    setScenarioForms((current) => current.map((scenario) => (
      scenario.id === scenarioId
        ? {
            ...scenario,
            attacks: scenario.attacks.map((attack) => (
              attack.id === attackId
                ? { ...attack, attackerStatPoints: { ...attack.attackerStatPoints, [key]: value } }
                : attack
            )),
          }
        : scenario
    )));
  };

  const updateScenarioAttack = <K extends keyof ScenarioAttackFormState>(
    scenarioId: string,
    attackId: string,
    key: K,
    value: ScenarioAttackFormState[K],
  ) => {
    resetActiveSearch();
    setScenarioForms((current) => current.map((scenario) => (
      scenario.id === scenarioId
        ? {
            ...scenario,
            attacks: scenario.attacks.map((attack) => (
              attack.id === attackId
                ? key === "moveInput"
                  ? applyMoveInputDefaults(
                      attack,
                      String(value),
                      scenario.adjustmentType === "defence",
                    )
                  : key === "beatUpParticipants"
                    ? applyBeatUpParticipants(
                        attack,
                        value as ScenarioAttackFormState["beatUpParticipants"],
                      )
                  : key === "gameType"
                    ? applyBeatUpGameTypeDefaults(
                        attack,
                        value as ScenarioAttackFormState["gameType"],
                      )
                  : key === "speedOrderMode"
                    ? applySpeedOrderModeDefaults(
                        attack,
                        value as ScenarioAttackFormState["speedOrderMode"],
                      )
                  : key === "attackerLevelMode"
                    ? applyAttackerLevelMode(
                        attack,
                        value as ScenarioAttackFormState["attackerLevelMode"],
                      )
                  : { ...attack, [key]: value }
                : attack
            )),
          }
        : scenario
    )));
  };

  const handleAddAttack = (scenarioId: string) => {
    resetActiveSearch();
    const scenarioToExtend = scenarioForms.find((scenario) => scenario.id === scenarioId);
    if (!scenarioToExtend) {
      return null;
    }

    const nextAttack = createBlankAttack(scenarioToExtend.attacks.length);
    setScenarioForms((current) => current.map((scenario) => (
      scenario.id === scenarioId
        ? (() => {
            const requiredSurvivedHits = Math.min(
              10,
              scenario.attacks.reduce((total, attack) => total + Math.max(1, Math.trunc(attack.repeat)), 0) + 1,
            );
            return {
              ...scenario,
              attacks: [
                ...scenario.attacks,
                {
                  ...nextAttack,
                  requiredSurvivedHits,
                  gameType: scenario.attacks[0]?.gameType ?? nextAttack.gameType,
                },
              ],
            };
          })()
        : scenario
    )));
    return nextAttack.id;
  };

  const handleRemoveAttack = (scenarioId: string, attackId: string) => {
    resetActiveSearch();
    const scenario = scenarioForms.find((item) => item.id === scenarioId);
    const attackIndex = scenario?.attacks.findIndex((attack) => attack.id === attackId) ?? -1;
    const nextFocusedAttackId = scenario
      ? scenario.attacks.filter((attack) => attack.id !== attackId)[Math.max(0, attackIndex - 1)]?.id ?? null
      : null;

    setScenarioForms((current) => current.map((scenario) => (
      scenario.id === scenarioId
        ? {
            ...scenario,
            attacks: scenario.attacks.length <= 1
              ? scenario.attacks
              : scenario.attacks.filter((attack) => attack.id !== attackId),
          }
        : scenario
    )));
    setMobileFocusedAttackId((current) => (current === attackId ? nextFocusedAttackId : current));
  };

  const handleAddScenario = (): ScenarioFormState => {
    resetActiveSearch();
    const nextScenario = createScenario(
      scenarioForms.length,
      toScenarioGameType(activeSuggestionFormat),
    );
    setScenarioForms((current) => [...current, nextScenario]);
    return nextScenario;
  };

  const handleRemoveScenario = (id: string) => {
    resetActiveSearch();
    setScenarioForms((current) => (
      current.length <= 1 ? current : current.filter((scenario) => scenario.id !== id)
    ));
  };

  const handleRun = () => {
    if (searchState.status === "running") {
      return;
    }

    if (!hasEnabledDefenceScenario) {
      setSelectedCandidateId(null);
      return;
    }

    try {
      workerClientRef.current ??= new DefenceSearchWorkerClient();
      const { request } = startDefenceSearchFromUi(
        workerClientRef.current,
        targetForm,
        scenarioForms,
        dispatchSearch,
      );
      activeRequestRef.current = request;
      setSelectedCandidateId(null);
    } catch (error) {
      dispatchSearch({
        type: "validationError",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleCancel = () => {
    const activeRequest = activeRequestRef.current;
    activeRequest?.cancel();
    if (activeRequest) {
      dispatchSearch({ type: "cancel", requestId: activeRequest.requestId });
    }
    activeRequestRef.current = null;
  };

  const handleAllowBulkNatureChange = (value: boolean) => {
    const activeRequest = activeRequestRef.current;
    activeRequest?.cancel();
    if (activeRequest) {
      dispatchSearch({ type: "cancel", requestId: activeRequest.requestId });
    }
    activeRequestRef.current = null;
    dispatchBulkMaximize({ type: "reset" });
    setAllowBulkNatureChange(value);
  };

  const handleRunBulkMaximize = () => {
    if (bulkMaximizeState.status === "running") {
      return;
    }

    const activeRequest = activeRequestRef.current;
    activeRequest?.cancel();
    if (activeRequest) {
      dispatchSearch({ type: "cancel", requestId: activeRequest.requestId });
    }

    try {
      workerClientRef.current ??= new DefenceSearchWorkerClient();
      const { request } = startMaximizeRemainingBulkFromUi(
        workerClientRef.current,
        targetForm,
        scenarioForms,
        dispatchBulkMaximize,
        { allowNatureChange: allowBulkNatureChange },
      );
      activeRequestRef.current = request;
      setSelectedCandidateId(null);
      setAppliedCandidateId(null);
      setAppliedAdjustmentId(null);
    } catch (error) {
      dispatchBulkMaximize({
        type: "validationError",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleCancelBulkMaximize = () => {
    activeRequestRef.current?.cancel();
    dispatchBulkMaximize({ type: "cancel", requestId: activeRequestRef.current?.requestId });
    activeRequestRef.current = null;
  };

  const reconcileBoxBaselineAfterEntriesChange = (nextEntries: BoxEntry[]) => {
    const baselineFingerprint = boxBaselineFingerprintRef.current;
    if (baselineFingerprint === null) {
      return;
    }
    const baselineStillSaved = nextEntries.some((entry) => (
      createDraftFingerprint(entry.payload.target, entry.payload.scenarios) === baselineFingerprint
    ));
    if (baselineStillSaved) {
      return;
    }

    boxBaselineFingerprintRef.current = null;
    pendingBoxCommitFingerprintRef.current = null;
    if (
      draftBaselineKindRef.current === "box"
      && createDraftFingerprint(targetForm, scenarioForms) === baselineFingerprint
    ) {
      saveCurrentDraftNow();
    }
  };

  const activeBoxSourceKey = syncBox?.sourceKey ?? "device";
  const isBoxSourceReady = isBoxStorageSourceReady(
    boxSourceKeyRef.current,
    activeBoxSourceKey,
    syncBox?.isAvailable ?? true,
  );
  const boxSourceUnavailableMessage = syncBox?.lastSyncError
    ?? "保存先を切り替えています。少し待ってからもう一度操作してください";

  const saveTargetBoxEntries = (nextEntries: BoxEntry[]): string | null => {
    if (!isBoxSourceReady) return boxSourceUnavailableMessage;
    return syncBox?.mode === "account"
      ? syncBox.saveTargetEntries(nextEntries, boxEntries)
      : saveBoxEntriesToBrowser(nextEntries);
  };

  const saveEnemyEntries = (nextEntries: EnemyBoxEntry[]): string | null => {
    if (!isBoxSourceReady) return boxSourceUnavailableMessage;
    return syncBox?.mode === "account"
      ? syncBox.saveEnemyEntries(nextEntries, enemyBoxEntries)
      : saveEnemyBoxEntriesToBrowser(nextEntries);
  };

  useEffect(() => {
    if (variant !== "default") return;

    const sourceKey = syncBox?.sourceKey ?? "device";
    const sourceChanged = boxSourceKeyRef.current !== sourceKey;
    if (!syncBox && !sourceChanged) return;
    if (syncBox && !syncBox.isAvailable) {
      setPendingBackupImport(null);
      setBoxOpen(false);
      setEnemyBoxOpen(false);
      setBoxMessage(syncBox.lastSyncError ?? "アカウントの保存一覧を読み込めません");
      setEnemyBoxMessage(syncBox.lastSyncError ?? "アカウントの保存一覧を読み込めません");
      return;
    }

    const nextTargetEntries = syncBox
      ? [...syncBox.snapshot.targetEntries]
      : loadBoxEntriesFromBrowser();
    const nextEnemyEntries = syncBox
      ? [...syncBox.snapshot.enemyEntries]
      : loadEnemyBoxEntriesFromBrowser();
    boxSourceKeyRef.current = sourceKey;
    setBoxEntries(nextTargetEntries);
    setEnemyBoxEntries(nextEnemyEntries);
    setSelectedBoxEntryId((current) => (
      current && nextTargetEntries.some((entry) => entry.id === current)
        ? current
        : nextTargetEntries[0]?.id ?? BLANK_BOX_SLOT_ID
    ));
    setSelectedEnemyBoxEntryId((current) => (
      current && nextEnemyEntries.some((entry) => entry.id === current)
        ? current
        : nextEnemyEntries[0]?.id ?? BLANK_ENEMY_BOX_SLOT_ID
    ));
    if (sourceChanged) {
      boxBaselineFingerprintRef.current = null;
      pendingBoxCommitFingerprintRef.current = null;
      if (draftBaselineKindRef.current === "box") {
        draftBaselineKindRef.current = null;
      }
      setPendingBackupImport(null);
      setBoxOpen(false);
      setEnemyBoxOpen(false);
      setBoxMessage(null);
      setEnemyBoxMessage(null);
    } else {
      reconcileBoxBaselineAfterEntriesChange(nextTargetEntries);
    }
  }, [
    syncBox?.isAvailable,
    syncBox?.lastSyncError,
    syncBox?.sourceKey,
    syncBox?.snapshot,
    variant,
  ]);

  const ensureBoxSourceReady = (kind: "target" | "enemy"): boolean => {
    if (isBoxSourceReady) return true;
    if (kind === "target") {
      setBoxMessage(boxSourceUnavailableMessage);
    } else {
      setEnemyBoxMessage(boxSourceUnavailableMessage);
    }
    return false;
  };

  const persistBoxEntries = (nextEntries: BoxEntry[], message: string): boolean => {
    const error = saveTargetBoxEntries(nextEntries);
    if (error) {
      setBoxMessage(error);
      return false;
    }

    setBoxEntries(nextEntries);
    setBoxMessage(message);
    reconcileBoxBaselineAfterEntriesChange(nextEntries);
    return true;
  };

  const persistCurrentBoxEntries = (nextEntries: BoxEntry[], message: string): boolean => {
    const fingerprint = createDraftFingerprint(targetForm, scenarioForms);
    const result = persistCurrentWorkToBoxAndDiscardDraft(
      nextEntries,
      {
        saveBoxEntries: saveTargetBoxEntries,
        discardDraft: discardCurrentDraftFromActiveStorage,
      },
    );
    if (result.status === "box-error") {
      setBoxMessage(result.message);
      return false;
    }

    cancelPendingDraftSave();
    setBoxEntries(nextEntries);
    setBoxMessage(message);
    applyCurrentBoxCommitResult(fingerprint, result.discardResult);
    return true;
  };

  const toggleBoxPanel = () => {
    if (!ensureBoxSourceReady("target")) {
      setEnemyBoxOpen(false);
      setBoxOpen(true);
      return;
    }
    if (!boxOpen && !selectedBoxEntryId) {
      setSelectedBoxEntryId(BLANK_BOX_SLOT_ID);
    }
    setBoxMessage(null);
    setEnemyBoxOpen(false);
    setBoxOpen((current) => !current);
  };

  const handleSaveCurrentBox = () => {
    const entry = createBoxEntryFromState(targetForm, scenarioForms);
    if (persistCurrentBoxEntries([entry, ...boxEntries], "今の条件を保存しました")) {
      setSelectedBoxEntryId(entry.id);
    }
  };

  const handleLoadBoxEntry = (entryId: string) => {
    if (!ensureBoxSourceReady("target")) return;
    if (entryId === BLANK_BOX_SLOT_ID) {
      const blankTarget = createBlankTargetForm();
      const blankScenarios = [createBlankScenario(0, toScenarioGameType(activeSuggestionFormat))];
      cancelPendingDraftSave();
      lastDraftFingerprintRef.current = createDraftFingerprint(blankTarget, blankScenarios);
      const discardResult = discardCurrentDraftFromActiveStorage();
      if (discardResult.status === "success") {
        draftBaselineKindRef.current = null;
        setDraftSaveState({ status: "idle" });
      } else {
        setDraftSaveState({
          status: "error",
          operation: "discard",
          message: discardResult.message,
        });
      }
      resetActiveSearch();
      setTargetForm(blankTarget);
      setScenarioForms(blankScenarios);
      setBoxMessage(null);
      setBoxOpen(false);
      return;
    }

    const entry = boxEntries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      setBoxMessage("保存スロットが見つかりません");
      return;
    }

    resetActiveSearch();
    setTargetForm(entry.payload.target);
    setScenarioForms(entry.payload.scenarios);
    setBoxMessage(null);
    setBoxOpen(false);
  };

  const handleOverwriteBoxEntry = (entryId: string) => {
    if (entryId === BLANK_BOX_SLOT_ID) {
      setBoxMessage("空スロットは上書きできません");
      return;
    }

    const entry = boxEntries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      setBoxMessage("保存スロットが見つかりません");
      return;
    }

    const updatedEntry = createBoxEntryFromState(targetForm, scenarioForms, {
      id: entry.id,
      name: entry.name,
      createdAt: entry.createdAt,
    });
    const nextEntries = boxEntries.map((candidate) => (
      candidate.id === entryId ? updatedEntry : candidate
    ));
    if (persistCurrentBoxEntries(nextEntries, "選択中の保存を上書きしました")) {
      setSelectedBoxEntryId(entryId);
    }
  };

  const handleRenameBoxEntry = (entryId: string, name: string) => {
    if (entryId === BLANK_BOX_SLOT_ID) {
      return;
    }

    const now = new Date().toISOString();
    const nextEntries = boxEntries.map((entry) => (
      entry.id === entryId
        ? { ...entry, name, updatedAt: now }
        : entry
    ));
    const error = saveTargetBoxEntries(nextEntries);
    if (error) {
      setBoxMessage(error);
      return;
    }

    setBoxEntries(nextEntries);
  };

  const handleDuplicateBoxEntry = (entryId: string) => {
    if (entryId === BLANK_BOX_SLOT_ID) {
      setBoxMessage("空スロットは複製できません");
      return;
    }

    const entry = boxEntries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      setBoxMessage("保存スロットが見つかりません");
      return;
    }

    const duplicatedEntry = duplicateBoxEntry(entry);
    if (persistBoxEntries([duplicatedEntry, ...boxEntries], "保存を複製しました")) {
      setSelectedBoxEntryId(duplicatedEntry.id);
    }
  };

  const handleDeleteBoxEntry = (entryId: string) => {
    if (!ensureBoxSourceReady("target")) return;
    if (entryId === BLANK_BOX_SLOT_ID) {
      setBoxMessage("空スロットは削除できません");
      return;
    }

    const entry = boxEntries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      setBoxMessage("保存スロットが見つかりません");
      return;
    }
    if (typeof window !== "undefined" && !window.confirm(`${entry.name} を削除しますか？`)) {
      return;
    }

    const nextEntries = boxEntries.filter((candidate) => candidate.id !== entryId);
    if (persistBoxEntries(nextEntries, "保存を削除しました")) {
      setSelectedBoxEntryId(nextEntries[0]?.id ?? null);
    }
  };

  const handleExportBoxBackup = () => {
    if (!ensureBoxSourceReady("target")) return;
    if (boxEntries.length === 0) {
      setBoxMessage("書き出せる保存がありません");
      return;
    }

    const backupJson = stringifyBoxBackupDocument(boxEntries);
    const blob = new Blob([backupJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = createBoxBackupFileName();
    link.rel = "noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setBoxMessage(`保存${boxEntries.length}件のバックアップを書き出しました`);
  };

  const handleRequestImportBoxBackup = () => {
    if (!ensureBoxSourceReady("target")) return;
    boxImportInputRef.current?.click();
  };

  const handleImportBoxBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    if (!ensureBoxSourceReady("target")) {
      input.value = "";
      return;
    }

    try {
      const result = parseBoxBackupDocument(await file.text());
      if (result.status === "error") {
        setBoxMessage(result.message);
        return;
      }

      setPendingBackupImport({
        kind: "target",
        importedEntries: result.entries,
        warnings: result.warnings,
        warningsBlockReplace: result.skippedCount > 0,
      });
    } catch {
      setBoxMessage("バックアップの読み込みに失敗しました");
    } finally {
      input.value = "";
    }
  };

  const persistEnemyBoxEntries = (
    nextEntries: EnemyBoxEntry[],
    message: string,
  ): boolean => {
    const error = saveEnemyEntries(nextEntries);
    if (error) {
      setEnemyBoxMessage(error);
      return false;
    }

    setEnemyBoxEntries(nextEntries);
    setEnemyBoxMessage(message);
    return true;
  };

  const toggleEnemyBoxPanel = () => {
    if (!ensureBoxSourceReady("enemy")) {
      setBoxOpen(false);
      setEnemyBoxOpen(true);
      return;
    }
    if (!enemyBoxOpen && !selectedEnemyBoxEntryId) {
      setSelectedEnemyBoxEntryId(BLANK_ENEMY_BOX_SLOT_ID);
    }
    setEnemyBoxMessage(null);
    setBoxOpen(false);
    setEnemyBoxOpen((current) => !current);
  };

  const handleSaveCurrentEnemyBox = () => {
    const entry = createEnemyBoxEntryFromScenarios(scenarioForms);
    if (persistEnemyBoxEntries([entry, ...enemyBoxEntries], "今の仮想敵を保存しました")) {
      setSelectedEnemyBoxEntryId(entry.id);
    }
  };

  const handleLoadEnemyBoxEntry = (entryId: string) => {
    if (!ensureBoxSourceReady("enemy")) return;
    if (entryId === BLANK_ENEMY_BOX_SLOT_ID) {
      resetActiveSearch();
      setScenarioForms([createBlankScenario(0, toScenarioGameType(activeSuggestionFormat))]);
      setEnemyBoxMessage(null);
      setEnemyBoxOpen(false);
      return;
    }

    const entry = enemyBoxEntries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      setEnemyBoxMessage("仮想敵スロットが見つかりません");
      return;
    }

    resetActiveSearch();
    setScenarioForms(entry.payload.scenarios);
    setEnemyBoxMessage(null);
    setEnemyBoxOpen(false);
  };

  const handleOverwriteEnemyBoxEntry = (entryId: string) => {
    if (entryId === BLANK_ENEMY_BOX_SLOT_ID) {
      setEnemyBoxMessage("空スロットは上書きできません");
      return;
    }

    const entry = enemyBoxEntries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      setEnemyBoxMessage("仮想敵スロットが見つかりません");
      return;
    }

    const updatedEntry = createEnemyBoxEntryFromScenarios(scenarioForms, {
      id: entry.id,
      name: entry.name,
      createdAt: entry.createdAt,
    });
    const nextEntries = enemyBoxEntries.map((candidate) => (
      candidate.id === entryId ? updatedEntry : candidate
    ));
    if (persistEnemyBoxEntries(nextEntries, "選択中の仮想敵を上書きしました")) {
      setSelectedEnemyBoxEntryId(entryId);
    }
  };

  const handleRenameEnemyBoxEntry = (entryId: string, name: string) => {
    if (entryId === BLANK_ENEMY_BOX_SLOT_ID) {
      return;
    }

    const now = new Date().toISOString();
    const nextEntries = enemyBoxEntries.map((entry) => (
      entry.id === entryId
        ? { ...entry, name, updatedAt: now }
        : entry
    ));
    const error = saveEnemyEntries(nextEntries);
    if (error) {
      setEnemyBoxMessage(error);
      return;
    }

    setEnemyBoxEntries(nextEntries);
  };

  const handleDuplicateEnemyBoxEntry = (entryId: string) => {
    if (entryId === BLANK_ENEMY_BOX_SLOT_ID) {
      setEnemyBoxMessage("空スロットは複製できません");
      return;
    }

    const entry = enemyBoxEntries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      setEnemyBoxMessage("仮想敵スロットが見つかりません");
      return;
    }

    const duplicatedEntry = duplicateEnemyBoxEntry(entry);
    if (persistEnemyBoxEntries([duplicatedEntry, ...enemyBoxEntries], "仮想敵を複製しました")) {
      setSelectedEnemyBoxEntryId(duplicatedEntry.id);
    }
  };

  const handleDeleteEnemyBoxEntry = (entryId: string) => {
    if (!ensureBoxSourceReady("enemy")) return;
    if (entryId === BLANK_ENEMY_BOX_SLOT_ID) {
      setEnemyBoxMessage("空スロットは削除できません");
      return;
    }

    const entry = enemyBoxEntries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      setEnemyBoxMessage("仮想敵スロットが見つかりません");
      return;
    }
    if (typeof window !== "undefined" && !window.confirm(`${entry.name} を削除しますか？`)) {
      return;
    }

    const nextEntries = enemyBoxEntries.filter((candidate) => candidate.id !== entryId);
    if (persistEnemyBoxEntries(nextEntries, "仮想敵を削除しました")) {
      setSelectedEnemyBoxEntryId(nextEntries[0]?.id ?? BLANK_ENEMY_BOX_SLOT_ID);
    }
  };

  const handleExportEnemyBoxBackup = () => {
    if (!ensureBoxSourceReady("enemy")) return;
    if (enemyBoxEntries.length === 0) {
      setEnemyBoxMessage("書き出せる仮想敵がありません");
      return;
    }

    const backupJson = stringifyEnemyBoxBackupDocument(enemyBoxEntries);
    const blob = new Blob([backupJson], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = createEnemyBoxBackupFileName();
    link.rel = "noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setEnemyBoxMessage(`仮想敵${enemyBoxEntries.length}件のバックアップを書き出しました`);
  };

  const handleRequestImportEnemyBoxBackup = () => {
    if (!ensureBoxSourceReady("enemy")) return;
    enemyBoxImportInputRef.current?.click();
  };

  const handleImportEnemyBoxBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    if (!ensureBoxSourceReady("enemy")) {
      input.value = "";
      return;
    }

    try {
      const result = parseEnemyBoxBackupDocument(await file.text());
      if (result.status === "error") {
        setEnemyBoxMessage(result.message);
        return;
      }

      setPendingBackupImport({
        kind: "enemy",
        importedEntries: result.entries,
        warnings: result.warnings,
        warningsBlockReplace: result.skippedCount > 0,
      });
    } catch {
      setEnemyBoxMessage("仮想敵バックアップの読み込みに失敗しました");
    } finally {
      input.value = "";
    }
  };

  const restoreBackupImportButtonFocus = (kind: PendingBackupImport["kind"]) => {
    if (typeof window === "undefined") return;
    window.setTimeout(() => {
      const panelId = kind === "target" ? "target-box-title" : "enemy-box-title";
      const panel = document.getElementById(panelId)?.closest<HTMLElement>(".box-window");
      panel?.querySelector<HTMLButtonElement>('[aria-label="バックアップを読み込む"]')?.focus();
    }, 0);
  };

  const closePendingBackupImport = () => {
    const kind = pendingBackupImport?.kind;
    setPendingBackupImport(null);
    if (kind) restoreBackupImportButtonFocus(kind);
  };

  const handleApplyBackupImport = (decision: BackupImportDecision) => {
    if (!pendingBackupImport) return;
    const plans = pendingBackupImport.kind === "target"
      ? planBoxBackupImport(boxEntries, pendingBackupImport.importedEntries)
      : planEnemyBoxBackupImport(enemyBoxEntries, pendingBackupImport.importedEntries);
    const plan = plans[decision];
    const { added, updated, removed, unchanged } = plan.impact;
    const actionLabel = decision === "merge" ? "統合" : "置き換え";
    const detail = [
      `追加${added}件`,
      `更新${updated}件`,
      `削除${removed}件`,
      `変更なし${unchanged}件`,
      plan.conflictCopyCount > 0 ? `競合コピー${plan.conflictCopyCount}件` : null,
      plan.deduplicatedCount > 0 ? `重複除外${plan.deduplicatedCount}件` : null,
      ...pendingBackupImport.warnings,
    ].filter(Boolean).join(" / ");
    const message = `バックアップを${actionLabel}しました（${detail}）`;

    if (pendingBackupImport.kind === "target") {
      const nextEntries = [...plan.entries] as BoxEntry[];
      if (!persistBoxEntries(nextEntries, message)) {
        closePendingBackupImport();
        return;
      }
      setSelectedBoxEntryId(nextEntries[0]?.id ?? BLANK_BOX_SLOT_ID);
    } else {
      const nextEntries = [...plan.entries] as EnemyBoxEntry[];
      if (!persistEnemyBoxEntries(nextEntries, message)) {
        closePendingBackupImport();
        return;
      }
      setSelectedEnemyBoxEntryId(nextEntries[0]?.id ?? BLANK_ENEMY_BOX_SLOT_ID);
    }

    const kind = pendingBackupImport.kind;
    setPendingBackupImport(null);
    restoreBackupImportButtonFocus(kind);
  };

  const handleSelectCandidate = (id: string) => {
    setSelectedCandidateId((current) => current === id ? null : id);
  };

  const clearAppliedMarkerAfterDelay = () => {
    if (applyTimerRef.current !== null) {
      window.clearTimeout(applyTimerRef.current);
    }
    applyTimerRef.current = window.setTimeout(() => {
      setAppliedCandidateId(null);
      setAppliedAdjustmentId(null);
    }, 1200);
  };

  const handleApplyCandidate = (candidate: CandidateResult) => {
    setTargetForm((current) => applyCandidateToTarget(current, candidate));
    setAppliedCandidateId(candidate.id);
    setAppliedAdjustmentId(null);
    onCandidateApplied?.();
    clearAppliedMarkerAfterDelay();
  };

  const handleApplyOffenseAdjustment = (entry: OffenseScenarioResult) => {
    setTargetForm((current) => applyOffenseAdjustmentToTarget(current, entry.result));
    setAppliedCandidateId(null);
    setAppliedAdjustmentId(entry.id);
    clearAppliedMarkerAfterDelay();
  };

  const handleApplySpeedAdjustment = (entry: SpeedScenarioResult) => {
    setTargetForm((current) => applySpeedAdjustmentToTarget(current, entry.result));
    setAppliedCandidateId(null);
    setAppliedAdjustmentId(entry.id);
    clearAppliedMarkerAfterDelay();
  };

  const handleApplyBulkMaximize = () => {
    setTargetForm((current) => applyMaximizeRemainingBulkToTarget(current, bulkMaximizeState.result));
    setAppliedCandidateId(null);
    setAppliedAdjustmentId("bulk-maximize");
    clearAppliedMarkerAfterDelay();
  };

  const closeMobileSheet = () => {
    setMobileSheet(null);
    setMobileScenarioDetailId(null);
    setMobileFocusedAttackId(null);
  };
  const openMobileScenarioDetail = (scenarioId: string, attackId?: string) => {
    const scenario = scenarioForms.find((item) => item.id === scenarioId);
    setMobileScenarioDetailId(scenarioId);
    setMobileFocusedAttackId(attackId ?? scenario?.attacks[0]?.id ?? null);
    setMobileSheet("scenarios");
  };

  const boxStorageLabel = syncBox?.mode === "account"
    ? "このブラウザに保存・クラウド同期"
    : "ブラウザに保存";
  const authState = authSession?.state ?? null;
  const isSignedIn = Boolean(authState?.user);
  const accountPendingCount = (syncBox?.snapshot.outboxCount ?? 0)
    + (cloudDraft?.snapshot.outboxCount ?? 0);
  const accountConflictCount = syncBox?.snapshot.conflictCount ?? 0;
  const derivedProviderStatus = deriveAccountSyncStatus({
    authenticated: isSignedIn,
    migrationReady: migrationReadiness.status === "ready",
    authStatus: authState?.status,
    migrationStatus: migrationReadiness.status,
    online: isOnline,
    box: syncBox ? {
      status: syncBox.isSynchronizing
        ? "syncing"
        : syncBox.lastSyncError
          ? "error"
          : "synced",
      outboxCount: syncBox.snapshot.outboxCount,
      conflictCount: syncBox.snapshot.conflictCount,
      issueCount: syncBox.issueCount,
    } : undefined,
    draft: cloudDraft ? {
      status: !isOnline
        ? "offline"
        : cloudDraft.status === "idle"
          ? "unsynced"
          : cloudDraft.status,
      outboxCount: cloudDraft.snapshot.outboxCount,
      issueCount: cloudDraft.issueCount,
    } : undefined,
  });
  const accountSyncStatus: AccountSyncStatusKey = derivedProviderStatus;
  const accountSyncLabel = getAccountSyncStatusLabel(accountSyncStatus);
  const accountSyncIconPath = getAccountSyncStatusIconPath(accountSyncStatus);
  const accountSyncIconStyle = {
    WebkitMaskImage: `url("${getAssetSrc(accountSyncIconPath)}")`,
    maskImage: `url("${getAssetSrc(accountSyncIconPath)}")`,
  } satisfies CSSProperties;
  const firstConflict = syncBox?.conflicts[0] ?? null;
  const firstConflictName = firstConflict
    ? firstConflict.localEntry?.name
      ?? firstConflict.remoteEntry?.name
      ?? firstConflict.entryId
    : null;
  const accountMigration: AccountMigrationState | null = isSignedIn
    && migrationReadiness.status !== "ready"
    && migrationReadiness.status !== "guest"
    ? {
        status: migrationReadiness.status,
        message: migrationReadiness.status === "deferred"
          ? "初回統合は保留中です。同期を始める前に保存先を選んでください。"
          : migrationReadiness.status === "error"
            ? "初回統合の確認に失敗しました。元データは保持しています。"
            : undefined,
        onRetry: () => {
          migrationControl.resumeMigration();
          setAccountOpen(false);
        },
      }
    : null;
  const accountStatusMessage = accountMessage ?? (isSignedIn
    ? `調整対象${syncBox?.snapshot.targetEntries.length ?? 0}件 / 仮想敵${syncBox?.snapshot.enemyEntries.length ?? 0}件 / 下書き${cloudDraft?.snapshot.records.length ?? 0}件 / 未送信${accountPendingCount}件`
    : "ログインしない場合は、このブラウザだけに保存します");
  const accountStatusError = accountError
    ?? authState?.error?.message
    ?? (accountSyncStatus === "error"
      ? syncBox?.lastSyncError ?? cloudDraft?.lastError ?? "同期処理に失敗しました"
      : null);
  const targetConflictCount = syncBox?.snapshot.targetConflictCount ?? 0;
  const enemyConflictCount = syncBox?.snapshot.enemyConflictCount ?? 0;
  const getSyncNotice = (conflictCount: number): string | null => {
    if (!syncBox) return null;
    if (conflictCount > 0) {
      return `同期競合を${conflictCount}件保持しています。対象の保存は上書き・削除せず残しています`;
    }
    if (syncBox.lastSyncError) {
      return syncBox.snapshot.outboxCount > 0
        ? `このブラウザには保存済みです。クラウド同期はあとで再試行します（${syncBox.lastSyncError}）`
        : syncBox.lastSyncError;
    }
    return null;
  };
  const combineBoxMessages = (message: string | null, notice: string | null): string | null => (
    [...new Set([message, notice].filter((value): value is string => Boolean(value)))].join(" / ") || null
  );
  const visibleBoxEntries = isBoxSourceReady ? boxEntries : [];
  const visibleEnemyBoxEntries = isBoxSourceReady ? enemyBoxEntries : [];
  const unavailableBoxMessage = "保存一覧を読み込めないため、操作を停止しています";
  const displayedCloudDraftStatus = draftSaveState.status === "saved"
    ? cloudDraft?.status ?? null
    : null;
  const draftStatusClass = displayedCloudDraftStatus === "offline"
    || displayedCloudDraftStatus === "error"
    || displayedCloudDraftStatus === "syncing"
    || displayedCloudDraftStatus === "queued"
    || displayedCloudDraftStatus === "synced"
    ? displayedCloudDraftStatus
    : draftSaveState.status;
  const cloudDraftStatusMessage = (() => {
    switch (cloudDraft?.status) {
      case "queued":
        return "ブラウザ保存済み。クラウド送信を待っています。";
      case "syncing":
        return "クラウドへ保存中…";
      case "synced":
        return "クラウド保存済み";
      case "offline":
        return "オフラインです。未送信の下書きはこのブラウザに保持しています。";
      case "error":
        return "同期エラー。未送信の下書きはこのブラウザに保持しています。";
      default:
        return null;
    }
  })();

  return (
    <SuggestionUsageContext.Provider value={{
      data: activeUsageData,
      format: activeSuggestionFormat,
      enabled: variant !== "tutorial",
      ownerAliases: usagePokemonAliases ?? {},
    }}>
      <div
        className={[
          "app-shell",
          variant === "tutorial" ? "app-shell--tutorial" : "",
          searchState.status === "running" ? "is-running" : "",
          mobileSheet ? `mobile-sheet-open mobile-${mobileSheet}-open` : "",
        ].filter(Boolean).join(" ")}
      >
      {variant === "default" ? (
        <header className={draftSaveState.status === "idle" ? "topbar" : "topbar has-draft-status"}>
        <div className="brand-title">
          <div className="brand-line">
            <h1>
              <img
                src={getAssetSrc("assets/brand/championcreator-title.svg")}
                alt="ChampionCreator"
              />
            </h1>
            <p className="brand-description">
              ポケモンチャンピオンズ 耐久・火力・素早さ自動調整ツール
            </p>
          </div>
        </div>
        <div className="topbar-meta">
          <div className="topbar-action-row">
            <SuggestionFormatToggle
              value={activeSuggestionFormat}
              onChange={handleSuggestionFormatChange}
            />
            <button
              type="button"
              className={`account-sync-trigger ${accountSyncStatus}`}
              aria-label={`アカウントと同期: ${accountSyncLabel}`}
              aria-haspopup="dialog"
              aria-expanded={accountOpen}
              data-sync-status={accountSyncStatus}
              onClick={() => {
                setAccountError(null);
                setAccountMessage(null);
                setAccountOpen(true);
              }}
            >
              <span
                className="account-sync-trigger-icon"
                style={accountSyncIconStyle}
                aria-hidden="true"
              />
              <span className="account-sync-trigger-label">{accountSyncLabel}</span>
              {accountConflictCount > 0 ? <strong>{accountConflictCount}</strong> : null}
            </button>
            <a
              className="readme-link"
              href="/guide/"
              aria-label="使い方ガイドを開く"
            >
              <img src={getAssetSrc("assets/ui/info.svg")} alt="" aria-hidden="true" />
            </a>
          </div>
          <p className="brand-version">
            app v{appVersionInfo.appVersion}
            {" / "}
            calc {appVersionInfo.smogonCalcVersion}
            {" / "}
            data {appVersionInfo.localizationEntries}
          </p>
          {draftSaveState.status !== "idle" ? (
            <div className="topbar-draft-row">
              <p
                className={`draft-save-status ${draftStatusClass}`}
                data-draft-status={draftStatusClass}
              role="status"
              aria-live="polite"
            >
                {getDraftSaveStatusLabel(draftSaveState, displayedCloudDraftStatus)}
              </p>
            </div>
          ) : null}
        </div>
        </header>
      ) : null}

      {variant === "default" && accountOpen ? (
        <AccountSyncDialog
          mode={isSignedIn ? "signed-in" : "signed-out"}
          user={authState?.user}
          status={accountSyncLabel}
          statusMessage={accountStatusMessage}
          busy={accountBusy
            || authState?.status === "loading"
            || authState?.status === "signing-in"
            || authState?.status === "signing-out"}
          errorMessage={accountStatusError}
          migration={accountMigration}
          draftsCount={cloudDraft?.snapshot.records.length ?? 0}
          onOpenDrafts={cloudDraft ? () => {
            setAccountOpen(false);
            setCloudDraftOpen(true);
          } : undefined}
          onExport={isSignedIn && migrationReadiness.status === "ready"
            ? () => void handleAccountExport()
            : undefined}
          onSync={isSignedIn ? () => void handleManualAccountSync() : undefined}
          conflicts={accountConflictCount > 0 ? {
            count: accountConflictCount,
            message: firstConflict
              ? `${firstConflict.kind === "target-box" ? "調整対象" : "仮想敵"}「${firstConflictName}」で、このブラウザとクラウドの変更が競合しています。`
              : undefined,
            onAction: handleResolveAccountConflict,
            busy: accountBusy,
          } : null}
          deletion={accountDeletion}
          onSignIn={authSession?.state.availability === "available"
            ? () => handleAccountSignIn()
            : undefined}
          onRequestLogout={handleRequestAccountLogout}
          onConfirmLogout={() => handleAccountSignOut()}
          onCancelLogout={() => setLogoutPending(false)}
          logoutPending={logoutPending}
          pendingCount={accountPendingCount}
          conflictCount={accountConflictCount}
          onDeleteAccount={isSignedIn ? () => handleDeleteAccount() : undefined}
          onCancelDeleteAccount={accountDeletion.canCancel === false
            ? undefined
            : () => setAccountDeletion({ stage: "idle" })}
          onClose={accountDeletion.stage === "deleting" || accountDeletion.canCancel === false ? undefined : () => {
            setAccountOpen(false);
            setLogoutPending(false);
            setAccountDeletion({ stage: "idle" });
          }}
        />
      ) : null}

      {variant === "default" && draftRecovery ? (
        <DraftRecoveryDialog
          recovery={draftRecovery}
          onRestore={handleRestoreDraft}
          onDiscard={handleDiscardDraft}
          onDismissUnavailable={handleDismissUnavailableDraft}
        />
      ) : null}

      {variant === "default" && cloudDraftOpen && cloudDraft ? (
        <CloudDraftDialog
          records={cloudDraft.snapshot.records}
          currentDeviceId={cloudDraft.deviceId ?? ""}
          busy={cloudDraft.status === "syncing"}
          statusMessage={cloudDraftStatusMessage}
          errorMessage={cloudDraft.lastError}
          canRestore={cloudDraft.isAvailable}
          canDelete={cloudDraft.isAvailable}
          onRefresh={() => void cloudDraft.synchronize("manual")}
          onRestore={handleRestoreCloudDraft}
          onDelete={handleDeleteCloudDraft}
          onClose={() => setCloudDraftOpen(false)}
        />
      ) : null}

      {variant === "default" && draftSaveState.status === "error" ? (
        <div className="draft-save-error" role="alert">
          <span>{draftSaveState.message}</span>
          <Button
            variant="ghost"
            size="small"
            onClick={draftSaveState.operation === "discard"
              ? retryDiscardCurrentDraft
              : draftSaveState.operation === "commit"
                ? retryCommitDraftCleanup
                : draftSaveState.operation === "cloud-save"
                  ? retryCloudDraftQueue
                  : saveCurrentDraftNow}
          >
            再試行
          </Button>
        </div>
      ) : null}

      {variant === "default" && pendingBackupImport ? (
        <BackupImportDialog
          kind={pendingBackupImport.kind}
          plans={pendingBackupImport.kind === "target"
            ? planBoxBackupImport(boxEntries, pendingBackupImport.importedEntries)
            : planEnemyBoxBackupImport(enemyBoxEntries, pendingBackupImport.importedEntries)}
          scope={syncBox?.mode === "account" ? "account" : "device"}
          warnings={pendingBackupImport.warnings}
          warningsBlockReplace={pendingBackupImport.warningsBlockReplace}
          onDecision={handleApplyBackupImport}
          onCancel={closePendingBackupImport}
        />
      ) : null}

      {variant === "default" && boxOpen ? (
        <BoxPanel
          title="調整対象ボックス"
          storageLabel={boxStorageLabel}
          dialogId="target-box-title"
          blankSlotId={BLANK_BOX_SLOT_ID}
          currentLabel="編集中の調整条件"
          currentRowAriaLabel="編集中の調整条件"
          gridAriaLabel="保存済み調整対象ボックス"
          emptyMessage={isBoxSourceReady
            ? "今の調整条件を保存するとここに表示されます"
            : unavailableBoxMessage}
          entries={visibleBoxEntries}
          selectedEntryId={isBoxSourceReady ? selectedBoxEntryId : null}
          currentSummary={currentBoxSummary}
          message={combineBoxMessages(boxMessage, getSyncNotice(targetConflictCount))}
          disabled={!isBoxSourceReady}
          onClose={() => setBoxOpen(false)}
          onSaveCurrent={handleSaveCurrentBox}
          onSelectEntry={setSelectedBoxEntryId}
          onLoadEntry={handleLoadBoxEntry}
          onOverwriteEntry={handleOverwriteBoxEntry}
          onRenameEntry={handleRenameBoxEntry}
          onDuplicateEntry={handleDuplicateBoxEntry}
          onDeleteEntry={handleDeleteBoxEntry}
          onExportEntries={handleExportBoxBackup}
          onRequestImport={handleRequestImportBoxBackup}
        />
      ) : null}
      {variant === "default" && enemyBoxOpen ? (
        <BoxPanel
          title="仮想敵ボックス"
          storageLabel={boxStorageLabel}
          dialogId="enemy-box-title"
          blankSlotId={BLANK_ENEMY_BOX_SLOT_ID}
          currentLabel="編集中の仮想敵"
          currentRowAriaLabel="編集中の仮想敵"
          gridAriaLabel="保存済み仮想敵ボックス"
          emptyMessage={isBoxSourceReady
            ? "今の仮想敵シナリオを保存するとここに表示されます"
            : unavailableBoxMessage}
          entries={visibleEnemyBoxEntries}
          selectedEntryId={isBoxSourceReady ? selectedEnemyBoxEntryId : null}
          currentSummary={currentEnemyBoxSummary}
          message={combineBoxMessages(enemyBoxMessage, getSyncNotice(enemyConflictCount))}
          disabled={!isBoxSourceReady}
          onClose={() => setEnemyBoxOpen(false)}
          onSaveCurrent={handleSaveCurrentEnemyBox}
          onSelectEntry={setSelectedEnemyBoxEntryId}
          onLoadEntry={handleLoadEnemyBoxEntry}
          onOverwriteEntry={handleOverwriteEnemyBoxEntry}
          onRenameEntry={handleRenameEnemyBoxEntry}
          onDuplicateEntry={handleDuplicateEnemyBoxEntry}
          onDeleteEntry={handleDeleteEnemyBoxEntry}
          onExportEntries={handleExportEnemyBoxBackup}
          onRequestImport={handleRequestImportEnemyBoxBackup}
        />
      ) : null}
      <input
        ref={boxImportInputRef}
        className="visually-hidden"
        type="file"
        accept="application/json,.json"
        aria-label="ボックスバックアップを読み込む"
        onChange={handleImportBoxBackup}
      />
      <input
        ref={enemyBoxImportInputRef}
        className="visually-hidden"
        type="file"
        accept="application/json,.json"
        aria-label="仮想敵ボックスバックアップを読み込む"
        onChange={handleImportEnemyBoxBackup}
      />

      {mobileSheet ? (
        <button
          className="mobile-sheet-backdrop"
          type="button"
          aria-label="詳細シートを閉じる"
          onClick={closeMobileSheet}
        />
      ) : null}

      <MobileOverview
        targetForm={targetForm}
        targetArtwork={targetArtwork}
        totalStatPoints={sumStatPoints(targetForm.statPoints)}
        scenarios={scenarioForms}
        candidates={searchState.candidates}
        passingCandidateCount={searchState.passingCandidateCount}
        selectedCandidateId={selectedCandidateId}
        appliedCandidateId={appliedCandidateId}
        appliedAdjustmentId={appliedAdjustmentId}
        searchStatus={searchState.status}
        searchProgress={searchState.progress}
        searchedCandidates={searchState.searchedCandidates}
        totalCandidates={searchState.totalCandidates}
        offenseResults={offenseResults}
        speedResults={speedResults}
        strictestFailureLabel={searchState.strictestFailureLabel}
        targetLabel={targetBuildPreview?.pokemon.displayNameJa ?? targetForm.pokemonInput}
        resultAlertMessage={resultAlertMessage}
        canRunAdjustment={canRunAdjustment}
        runButtonLabel={runButtonLabel}
        isBoxPanelOpen={boxOpen}
        onOpenBoxPanel={toggleBoxPanel}
        isEnemyBoxPanelOpen={enemyBoxOpen}
        onOpenEnemyBoxPanel={toggleEnemyBoxPanel}
        onOpenTarget={() => {
          setMobileScenarioDetailId(null);
          setMobileFocusedAttackId(null);
          setMobileSheet("target");
        }}
        onOpenScenarioDetail={openMobileScenarioDetail}
        onToggleScenarioAdjustmentFromDirection={toggleScenarioAdjustmentFromDirection}
        onToggleScenarioEnabled={(scenarioId, enabled) => updateScenario(scenarioId, "enabled", enabled)}
        onAddScenario={() => {
          const nextScenario = handleAddScenario();
          openMobileScenarioDetail(nextScenario.id, nextScenario.attacks[0]?.id);
        }}
        onRemoveScenario={handleRemoveScenario}
        onAddAttack={(scenarioId) => {
          const nextAttackId = handleAddAttack(scenarioId);
          openMobileScenarioDetail(scenarioId, nextAttackId ?? undefined);
          return nextAttackId;
        }}
        onRun={handleRun}
        onCancel={handleCancel}
        onSelectCandidate={handleSelectCandidate}
        onApplyCandidate={handleApplyCandidate}
        onApplyOffenseResult={handleApplyOffenseAdjustment}
        onApplySpeedResult={handleApplySpeedAdjustment}
      />

      <main className="workbench">
        <TargetPanel
          targetForm={targetForm}
          onUpdateField={updateTargetField}
          onUpdateEv={updateTargetEv}
          canonicalPokemon={targetBuildPreview?.pokemon.canonicalName}
          artwork={targetArtwork}
          actualStats={actualStats}
          statPointMarkers={statPointMarkers}
          totalStatPoints={sumStatPoints(targetForm.statPoints)}
          speedOverrideCounts={targetSpeedOverrideCounts}
          bulkMaximizeState={bulkMaximizeState}
          allowBulkNatureChange={allowBulkNatureChange}
          bulkMaximizeApplied={appliedAdjustmentId === "bulk-maximize"}
          isBoxPanelOpen={boxOpen}
          onOpenBoxPanel={toggleBoxPanel}
          onAllowBulkNatureChange={handleAllowBulkNatureChange}
          onRunBulkMaximize={handleRunBulkMaximize}
          onCancelBulkMaximize={handleCancelBulkMaximize}
          onApplyBulkMaximize={handleApplyBulkMaximize}
          onCloseMobileSheet={closeMobileSheet}
        />
        <ScenarioPanel
          panelRef={mobileScenarioPanelRef}
          scenarios={scenarioForms}
          attackerActualStats={attackerActualStats}
          targetForm={targetForm}
          targetActualStats={actualStats}
          onAddScenario={handleAddScenario}
          onRemoveScenario={handleRemoveScenario}
          onUpdateScenario={updateScenario}
          onToggleScenarioAdjustmentFromDirection={toggleScenarioAdjustmentFromDirection}
          onAddAttack={handleAddAttack}
          onRemoveAttack={handleRemoveAttack}
          onUpdateAttack={updateScenarioAttack}
          onUpdateAttackerEv={updateScenarioAttackerEv}
          mobileFocusedScenarioId={mobileSheet === "scenarios" ? mobileScenarioDetailId : null}
          mobileFocusedAttackId={mobileSheet === "scenarios" ? mobileFocusedAttackId : null}
          onFocusMobileAttack={setMobileFocusedAttackId}
          onShowMobileScenarioList={() => {
            setMobileScenarioDetailId(null);
            setMobileFocusedAttackId(null);
          }}
          isEnemyBoxPanelOpen={enemyBoxOpen}
          onOpenEnemyBoxPanel={toggleEnemyBoxPanel}
          onCloseMobileSheet={closeMobileSheet}
        />
        <section className="search-control-bar" aria-label="探索操作">
          <div
            className="search-progress"
            role="progressbar"
            aria-label="探索進捗"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(searchState.progress * 100)}
          >
            <span
              className="search-progress-fill"
              style={{ width: `${Math.round(searchState.progress * 100)}%` }}
              aria-hidden="true"
            />
            <span className="search-progress-label" aria-live="polite">
              <strong>{Math.round(searchState.progress * 100)}%</strong>
              <span>評価 {searchState.searchedCandidates} / {searchState.totalCandidates || "-"}</span>
            </span>
          </div>
          <Button
            variant="ghost"
            onClick={handleCancel}
            disabled={searchState.status !== "running"}
          >
            キャンセル
          </Button>
          <Button
            variant="primary"
            id="runButton"
            onClick={handleRun}
            disabled={searchState.status === "running" || !canRunAdjustment}
          >
            {searchState.status === "running"
              ? "計算中..."
              : runButtonLabel}
          </Button>
        </section>
        <ResultsPanel
          candidates={searchState.candidates}
          passingCandidateCount={searchState.passingCandidateCount}
          selectedCandidateId={selectedCandidateId}
          appliedCandidateId={appliedCandidateId}
          appliedAdjustmentId={appliedAdjustmentId}
          scenarios={scenarioForms}
          status={searchState.status}
          offenseResults={offenseResults}
          speedResults={speedResults}
          strictestFailureLabel={searchState.strictestFailureLabel}
          targetLabel={targetBuildPreview?.pokemon.displayNameJa ?? targetForm.pokemonInput}
          resultAlertMessage={resultAlertMessage}
          onSelectCandidate={handleSelectCandidate}
          onApplyCandidate={handleApplyCandidate}
          onApplyOffenseResult={handleApplyOffenseAdjustment}
          onApplySpeedResult={handleApplySpeedAdjustment}
          onCloseMobileSheet={closeMobileSheet}
        />
      </main>
      {variant === "default" ? <footer className="app-footer" aria-label="サイトフッター">
        <div className="app-footer-copy">
          <span>© 2026 suisui-swimmy</span>
          <span>
            本ツールは非公式のファンツールであり、画像、名称などに関する著作権は 任天堂 / クリーチャーズ / ゲームフリーク に帰属します
          </span>
        </div>
        <nav className="app-footer-links app-footer-page-links" aria-label="ページリンク">
          <span className="app-footer-link-item">
            <a className="app-footer-contact" href="/" aria-current="page">アプリ</a>
          </span>
          <span className="app-footer-link-item">
            <span className="app-footer-separator" aria-hidden="true"> | </span>
            <a className="app-footer-contact" href="/guide/">使い方ガイド</a>
          </span>
          <span className="app-footer-link-item">
            <span className="app-footer-separator" aria-hidden="true"> | </span>
            <a className="app-footer-contact" href="/privacy/">プライバシー</a>
          </span>
        </nav>
        <nav className="app-footer-links app-footer-support-links" aria-label="サポート・関連リンク">
          <span className="app-footer-link-item">
            <a
              className="app-footer-contact"
              href="https://docs.google.com/forms/d/e/1FAIpQLSdTUyrAmTwrcarMfMt56RrcwH_g4r4WhowW0i60HDK5BflylQ/viewform?usp=header"
              target="_blank"
              rel="noreferrer"
            >
              不具合報告
            </a>
          </span>
          <span className="app-footer-link-item">
            <span className="app-footer-separator" aria-hidden="true"> | </span>
            <a
              className="app-footer-contact"
              href="https://x.com/peixe0307"
              target="_blank"
              rel="noreferrer"
              aria-label="お問い合わせ: X @peixe0307"
            >
              <span>お問い合わせ</span>
              <img src={getAssetSrc("assets/social/x-logo.svg")} alt="X" />
            </a>
          </span>
          <span className="app-footer-link-item">
            <span className="app-footer-separator" aria-hidden="true"> | </span>
            <a
              className="app-footer-contact app-footer-icon-link"
              href="https://github.com/suisui-swimmy/ChampionCreator"
              target="_blank"
              rel="noreferrer"
              aria-label="ChampionCreator GitHub リポジトリ"
            >
              <img src={getAssetSrc("assets/social/github-invertocat-white.svg")} alt="" />
            </a>
          </span>
        </nav>
        <div className="app-footer-source">
          <span className="app-footer-link-item">
            <a
              className="app-footer-source-link"
              href="https://championsbattledata.com/"
              target="_blank"
              rel="noreferrer"
            >
              使用率データ提供元: Pokemon Champions Battle Data
            </a>
          </span>
          <span className="app-footer-link-item">
            <span className="app-footer-separator" aria-hidden="true"> | </span>
            <span className="app-footer-source-date">
              データ更新日: {formatUsageDataDateJst(
                usageSourceGeneratedAt === undefined
                  ? activeUsageData?.dataVersion === "empty"
                    ? undefined
                    : activeUsageData?.sourceGeneratedAt
                  : usageSourceGeneratedAt ?? undefined,
              )}
            </span>
          </span>
        </div>
        <p className="app-footer-version">{formatAppVersionLabel()}</p>
      </footer> : null}
      </div>
    </SuggestionUsageContext.Provider>
  );
}

type EntityTextFieldProps = {
  kind: EntityKind;
  label: string;
  value: string;
  className?: string;
  description?: string;
  options?: EntityInputOption[];
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectValue?: (value: string) => void;
};

export function getDropdownEntityOptions(
  kind: EntityKind,
  value: string,
  suggestedOptions?: EntityInputOption[],
): EntityInputOption[] {
  return suggestedOptions ?? getMatchingEntityInputOptions(kind, value);
}

function EntityTextField({
  kind,
  label,
  value,
  className,
  description,
  options: suggestedOptions,
  onChange,
  onSelectValue,
}: EntityTextFieldProps) {
  const datalistId = `entity-options-${kind}-${useId()}`;
  const invalid = isUnresolvedEntityInput(kind, value);

  if (kind === "pokemon" && onSelectValue) {
    return (
      <PokemonAutocompleteField
        className={className}
        label={label}
        value={value}
        invalid={invalid}
        onChange={onChange}
        onSelectValue={onSelectValue}
      />
    );
  }

  if ((kind === "item" || kind === "type") && onSelectValue) {
    return (
      <DropdownTextField
        className={className}
        label={label}
        value={value}
        kind={kind}
        options={getDropdownEntityOptions(kind, value, suggestedOptions)}
        description={description}
        onChange={onChange}
        onSelectValue={onSelectValue}
      />
    );
  }

  const options = suggestedOptions ?? getMatchingEntityInputOptions(kind, value);
  const labelClassName = ["placeholder-field", invalid && "is-invalid", className].filter(Boolean).join(" ");

  return (
    <label className={labelClassName}>
      <input
        value={value}
        placeholder={label}
        list={datalistId}
        autoComplete="off"
        title={description}
        onFocus={selectInputValueOnFocus}
        onChange={onChange}
      />
      <datalist id={datalistId}>
        {options.map((option) => (
          <option
            value={option.value}
            key={option.value}
          />
        ))}
      </datalist>
    </label>
  );
}

type PokemonAutocompleteFieldProps = {
  label: string;
  value: string;
  className?: string;
  invalid?: boolean;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectValue: (value: string) => void;
};

type PokemonSuggestionKeyAction =
  | { type: "move"; index: number }
  | { type: "select" }
  | { type: "close" }
  | { type: "none" };

export const getPokemonSuggestionKeyAction = (
  key: string,
  activeIndex: number,
  optionCount: number,
): PokemonSuggestionKeyAction => {
  if (optionCount <= 0) {
    return { type: "none" };
  }

  if (key === "ArrowDown") {
    return { type: "move", index: (activeIndex + 1) % optionCount };
  }

  if (key === "ArrowUp") {
    return { type: "move", index: (activeIndex - 1 + optionCount) % optionCount };
  }

  if (key === "Tab" || key === "Enter") {
    return { type: "select" };
  }

  if (key === "Escape") {
    return { type: "close" };
  }

  return { type: "none" };
};

function PokemonAutocompleteField({
  label,
  value,
  className,
  invalid = false,
  onChange,
  onSelectValue,
}: PokemonAutocompleteFieldProps) {
  const listboxId = `pokemon-suggestions-${useId()}`;
  const [focused, setFocused] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const options = useMemo(
    () => value.trim() ? getMatchingEntityInputOptions("pokemon", value, 8) : [],
    [value],
  );
  const open = focused && options.length > 0;
  const activeOption = options[Math.min(activeIndex, options.length - 1)];
  const fieldClassName = ["pokemon-autocomplete-field", "placeholder-field", invalid && "is-invalid", className].filter(Boolean).join(" ");

  const selectOption = (option: EntityInputOption) => {
    onSelectValue(option.value);
    setActiveIndex(0);
    setFocused(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const action = getPokemonSuggestionKeyAction(event.key, activeIndex, open ? options.length : 0);
    if (action.type === "none") {
      return;
    }

    if (action.type === "move") {
      event.preventDefault();
      setActiveIndex(action.index);
      return;
    }

    if (action.type === "select" && activeOption) {
      if (event.key === "Enter") {
        event.preventDefault();
      }
      selectOption(activeOption);
      return;
    }

    if (action.type === "close") {
      event.preventDefault();
      setFocused(false);
    }
  };

  return (
    <UiPopover.Root open={open}>
      <UiPopover.Anchor asChild>
        <input
          className={fieldClassName}
          value={value}
          placeholder={label}
          autoComplete="off"
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open && activeOption ? `${listboxId}-${Math.min(activeIndex, options.length - 1)}` : undefined}
          onFocus={(event) => {
            selectInputValueOnFocus(event);
            setFocused(true);
          }}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            setActiveIndex(0);
            setFocused(true);
            onChange(event);
          }}
          onKeyDown={handleKeyDown}
        />
      </UiPopover.Anchor>
      <UiPopover.Portal>
        <UiPopover.Content
          className="pokemon-suggestion-popover"
          sideOffset={4}
          align="start"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <div className="pokemon-suggestion-list" id={listboxId} role="listbox" aria-label={`${label}候補`}>
            {options.map((option, index) => (
              <button
                className={`pokemon-suggestion-option${index === activeIndex ? " active" : ""}`}
                id={`${listboxId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                key={option.canonicalName}
                onPointerDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(option)}
              >
                <span>{option.value}</span>
              </button>
            ))}
          </div>
        </UiPopover.Content>
      </UiPopover.Portal>
    </UiPopover.Root>
  );
}

type DropdownTextFieldProps = {
  kind: EntityKind;
  label: string;
  value: string;
  options: EntityInputOption[];
  className?: string;
  description?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectValue: (value: string) => void;
};

function DropdownTextField({
  kind,
  label,
  value,
  options,
  className,
  description,
  onChange,
  onSelectValue,
}: DropdownTextFieldProps) {
  const listboxId = `dropdown-options-${useId()}`;
  const labelId = useId();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const fieldRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeOption = options[Math.min(activeIndex, options.length - 1)];
  const listOpen = open && options.length > 0;
  const invalid = isUnresolvedEntityInput(kind, value);
  const fieldClassName = ["dropdown-text-field", "placeholder-field", invalid && "is-invalid", className].filter(Boolean).join(" ");

  const selectOption = (option: EntityInputOption) => {
    onSelectValue(option.value);
    setActiveIndex(0);
    setOpen(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const action = getPokemonSuggestionKeyAction(event.key, activeIndex, listOpen ? options.length : 0);
    if (action.type === "move") {
      event.preventDefault();
      setActiveIndex(action.index);
    } else if (action.type === "select" && activeOption) {
      event.preventDefault();
      selectOption(activeOption);
    } else if (action.type === "close") {
      event.preventDefault();
      setOpen(false);
    }
  };

  return (
    <div
      className={fieldClassName}
      title={description}
      ref={fieldRef}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null;
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
          setOpen(false);
        }
      }}
    >
      <span className="visually-hidden" id={labelId}>{label}</span>
      {description ? <span className="visually-hidden" id={descriptionId}>{description}</span> : null}
      <div className="dropdown-input-row">
        <input
          ref={inputRef}
          value={value}
          placeholder={label}
          autoComplete="off"
          role="combobox"
          aria-labelledby={labelId}
          aria-describedby={description ? descriptionId : undefined}
          aria-autocomplete="list"
          aria-expanded={listOpen}
          aria-controls={listOpen ? listboxId : undefined}
          onFocus={(event) => {
            selectInputValueOnFocus(event);
            setOpen(true);
          }}
          onChange={(event) => {
            setActiveIndex(0);
            setOpen(true);
            onChange(event);
          }}
          onKeyDown={handleKeyDown}
        />
        <button
          className="dropdown-menu-trigger"
          type="button"
          data-state={listOpen ? "open" : "closed"}
          aria-label={`${label}候補を開く`}
          aria-expanded={listOpen}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            setOpen((current) => !current);
            inputRef.current?.focus();
          }}
        >
          <ChevronRightIcon className="disclosure-chevron" />
        </button>
      </div>
      {listOpen ? (
        <div className="dropdown-options-popover">
          <div className="dropdown-option-list" id={listboxId} role="listbox" aria-label={`${label}候補`}>
            {options.map((option, index) => (
              <button
                className={`dropdown-option${index === activeIndex ? " active" : ""}${option.value === value ? " selected" : ""}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                key={option.canonicalName}
                onPointerDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(option)}
              >
                {option.value}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

type AbilityTextFieldProps = {
  label: string;
  value: string;
  className?: string;
  description?: string;
  pokemonAbilityOptions?: EntityInputOption[];
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectAbility: (value: string) => void;
};

function AbilityTextField({
  label,
  value,
  className,
  description,
  pokemonAbilityOptions = [],
  onChange,
  onSelectAbility,
}: AbilityTextFieldProps) {
  const matchingPokemonOptions = pokemonAbilityOptions.filter((option) =>
    !value.trim() || option.value.startsWith(value.trim()),
  );
  const options = matchingPokemonOptions.length > 0
    ? matchingPokemonOptions
    : getMatchingEntityInputOptions("ability", value);

  return (
    <DropdownTextField
      kind="ability"
      className={className}
      label={label}
      value={value}
      options={options}
      description={description}
      onChange={onChange}
      onSelectValue={onSelectAbility}
    />
  );
}

type NatureMatrixFieldProps = {
  label: string;
  value: string;
  ownerPokemonCanonicalName?: string;
  className?: string;
  onChange: (value: string) => void;
};

export const formatNatureModifierLabel = (
  option: Pick<NatureOption, "plus" | "minus">,
): string => option.plus === option.minus
  ? "補正なし"
  : `${statLabels[option.plus]}↑ ${statLabels[option.minus]}↓`;

export const getNatureUsageOverlayOpacity = (
  state: NatureUsageState,
): number | null => {
  if (state.kind !== "listed" || state.percentage === null || !Number.isFinite(state.percentage)) {
    return null;
  }

  return Math.max(0, Math.min(100, state.percentage)) / 100;
};

export const formatNatureUsageAriaLabel = (
  option: Pick<NatureOption, "label" | "plus" | "minus">,
  format: SuggestionFormat,
  state: NatureUsageState,
): string => {
  if (state.kind === "unavailable") {
    return `${option.label}｜${formatNatureModifierLabel(option)}｜使用率データなし`;
  }

  if (state.kind === "unlisted") {
    return `${option.label}｜${formatNatureModifierLabel(option)}｜${format === "Doubles" ? "ダブル" : "シングル"}使用率 上位外／データなし`;
  }

  const rankLabel = `${Math.max(1, Math.round(state.rank))}位`;
  const usageLabel = state.percentage === null
    ? rankLabel
    : `${Math.max(0, state.percentage).toFixed(1)}%（${rankLabel}）`;
  return `${option.label}｜${formatNatureModifierLabel(option)}｜${format === "Doubles" ? "ダブル" : "シングル"}使用率 ${usageLabel}`;
};

function NatureMatrixField({
  label,
  value,
  ownerPokemonCanonicalName,
  className,
  onChange,
}: NatureMatrixFieldProps) {
  const labelClassName = ["nature-field", isUnresolvedEntityInput("nature", value) && "is-invalid", className].filter(Boolean).join(" ");
  const {
    data,
    format,
    enabled: usageEnabled,
    ownerAliases,
  } = useContext(SuggestionUsageContext);

  const getUsageState = (option: NatureOption): NatureUsageState => (
    getNatureUsageState(
      data,
      format,
      resolveUsageSuggestionOwner(ownerPokemonCanonicalName, ownerAliases),
      option.showdownName,
    )
  );

  return (
    <div className={labelClassName}>
      <UiPopover.Root>
        <UiPopover.Trigger asChild>
          <button className="nature-trigger" type="button" aria-label={`${label}: ${value || "未選択"}`}>
            <span className={`nature-trigger-main${value ? "" : " placeholder"}`}>{value || label}</span>
            <span className="nature-trigger-icon" aria-hidden="true">
              <ChevronRightIcon className="disclosure-chevron" />
            </span>
          </button>
        </UiPopover.Trigger>
        <UiPopover.Portal>
          <UiPopover.Content className="nature-popover" sideOffset={6} align="start">
            <div className="nature-matrix" role="grid" aria-label={`${label}を能力補正表から選択`}>
              <div className="nature-matrix-row" role="row">
                <div className="nature-matrix-corner" aria-hidden="true">性格</div>
                {natureMatrixKeys.map((minusKey) => (
                  <div className="nature-matrix-header" role="columnheader" key={`minus-${minusKey}`} aria-label={`${statLabels[minusKey]}下降`}>
                    <StatIcon stat={minusKey} />
                    <NatureModifierIcon direction="down" />
                  </div>
                ))}
              </div>
              {natureMatrixKeys.map((plusKey) => (
                <div className="nature-matrix-row" role="row" key={`plus-${plusKey}`}>
                  <div className="nature-matrix-side" role="rowheader" aria-label={`${statLabels[plusKey]}上昇`}>
                    <StatIcon stat={plusKey} />
                    <NatureModifierIcon direction="up" />
                  </div>
                  {natureMatrixKeys.map((minusKey) => {
                    const option = getNatureCellOption(plusKey, minusKey);
                    const selected = option?.label === value;
                    const usageState = usageEnabled && option ? getUsageState(option) : null;
                    const usageOpacity = usageState ? getNatureUsageOverlayOpacity(usageState) : null;
                    const usageStyle = usageOpacity === null
                      ? undefined
                      : { "--nature-usage-opacity": String(usageOpacity) } as CSSProperties;

                    return (
                      <div className="nature-matrix-cell" role="gridcell" key={`${plusKey}-${minusKey}`}>
                        {option ? (
                          <UiPopover.Close asChild>
                            <button
                              className={`nature-option${selected ? " selected" : ""}${plusKey === minusKey ? " neutral" : ""}`}
                              type="button"
                              aria-pressed={selected}
                              aria-label={usageEnabled
                                ? formatNatureUsageAriaLabel(option, format, usageState!)
                                : `${option.label}: ${plusKey === minusKey ? "補正なし" : `${statLabels[plusKey]}上昇 ${statLabels[minusKey]}下降`}`}
                              data-usage-kind={usageState?.kind}
                              data-usage-percentage={usageState?.kind === "listed" && usageState.percentage !== null
                                ? usageState.percentage.toFixed(1)
                                : undefined}
                              style={usageStyle}
                              onClick={() => onChange(option.label)}
                            >
                              <span className="nature-option-label">{option.label}</span>
                            </button>
                          </UiPopover.Close>
                        ) : (
                          <span className="nature-option empty" aria-hidden="true" />
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </UiPopover.Content>
        </UiPopover.Portal>
      </UiPopover.Root>
    </div>
  );
}

type MechanicControlsProps = {
  pokemonInput: string;
  teraEnabled: boolean;
  dmaxEnabled: boolean;
  teraTypeInput: string;
  teraLabel: string;
  onPokemonInputChange: (value: string) => void;
  onTeraEnabledChange: (value: boolean) => void;
  onDmaxEnabledChange: (value: boolean) => void;
  onTeraTypeInputChange: (value: string) => void;
};

function MechanicControls({
  pokemonInput,
  teraEnabled,
  dmaxEnabled,
  teraTypeInput,
  teraLabel,
  onPokemonInputChange,
  onTeraEnabledChange,
  onDmaxEnabledChange,
  onTeraTypeInputChange,
}: MechanicControlsProps) {
  const [choiceKind, setChoiceKind] = useState<PokemonFormVariantKind | null>(null);
  const megaOptions = getPokemonFormVariantOptions(pokemonInput, "mega");
  const gmaxOptions = getPokemonFormVariantOptions(pokemonInput, "gmax");
  const megaActive = isPokemonFormVariant(pokemonInput, "mega");
  const gmaxActive = isPokemonFormVariant(pokemonInput, "gmax");
  const dmaxActive = dmaxEnabled || gmaxActive;
  const activeChoices = choiceKind === "mega" ? megaOptions : choiceKind === "gmax" ? gmaxOptions : [];

  const applyBaseForm = () => {
    const baseValue = getPokemonBaseFormValue(pokemonInput);
    if (baseValue) {
      onPokemonInputChange(baseValue);
    }
    setChoiceKind(null);
  };

  const applyVariant = (kind: PokemonFormVariantKind, option: PokemonFormVariantOption) => {
    onPokemonInputChange(option.value);
    setChoiceKind(null);
    if (kind === "mega") {
      onTeraEnabledChange(false);
      onDmaxEnabledChange(false);
    } else {
      onDmaxEnabledChange(true);
      onTeraEnabledChange(false);
    }
  };

  const handleVariantClick = (kind: PokemonFormVariantKind, options: PokemonFormVariantOption[]) => {
    const isActive = kind === "mega" ? megaActive : gmaxActive;
    if (isActive) {
      applyBaseForm();
      if (kind === "gmax") {
        onDmaxEnabledChange(false);
      }
      return;
    }
    if (options.length === 0) {
      setChoiceKind(null);
      return;
    }
    if (options.length === 1) {
      applyVariant(kind, options[0]);
      return;
    }
    setChoiceKind((current) => (current === kind ? null : kind));
  };

  const handleTeraClick = () => {
    const nextTeraEnabled = !teraEnabled;
    onTeraEnabledChange(nextTeraEnabled);
    if (nextTeraEnabled) {
      if (dmaxEnabled || gmaxActive) {
        onDmaxEnabledChange(false);
        if (gmaxActive) {
          applyBaseForm();
        }
      }
      setChoiceKind(null);
    }
  };

  const handleDmaxClick = () => {
    if (dmaxEnabled || gmaxActive) {
      onDmaxEnabledChange(false);
      if (gmaxActive) {
        applyBaseForm();
      } else {
        setChoiceKind(null);
      }
      return;
    }

    onDmaxEnabledChange(true);
    onTeraEnabledChange(false);
    if (megaActive) {
      applyBaseForm();
    }
    setChoiceKind(gmaxOptions.length > 0 ? "gmax" : null);
  };

  return (
    <div className="mechanic-block">
      <div className="mechanic-toggle-row" aria-label="特殊フォーム">
        <IconToggleButton
          active={teraEnabled}
          iconName={teraEnabled ? "tera" : "tera-off"}
          label={teraLabel}
          onClick={handleTeraClick}
        />
        <IconToggleButton
          active={megaActive}
          disabled={!megaActive && megaOptions.length === 0}
          iconName={megaActive ? "mega" : "mega-off"}
          label={megaActive ? "メガ解除" : "メガ候補"}
          onClick={() => handleVariantClick("mega", megaOptions)}
        />
        <IconToggleButton
          active={dmaxActive}
          iconName={dmaxActive ? "dmax" : "dmax-off"}
          label={dmaxActive ? "ダイマックス解除" : "ダイマックス"}
          onClick={handleDmaxClick}
        />
      </div>
      {teraEnabled ? (
        <EntityTextField
          className="tera-type-field"
          kind="type"
          label="テラスタイプ"
          value={teraTypeInput}
          onChange={(event) => onTeraTypeInputChange(event.target.value)}
          onSelectValue={onTeraTypeInputChange}
        />
      ) : null}
      {activeChoices.length > 0 ? (
        <div className="variant-choice-row" aria-label={`${choiceKind === "mega" ? "メガ" : "キョダイマックス"}候補`}>
          {activeChoices.map((option) => (
            <button
              className="variant-choice"
              type="button"
              key={option.id}
              onClick={() => choiceKind && applyVariant(choiceKind, option)}
            >
              {option.value}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type IconToggleButtonProps = {
  active: boolean;
  disabled?: boolean;
  iconName: string;
  label: string;
  onClick: () => void;
};

function IconToggleButton({ active, disabled = false, iconName, label, onClick }: IconToggleButtonProps) {
  return (
    <button
      className={`mechanic-icon-button${active ? " active" : ""}`}
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <img src={getBattleIconSrc(iconName)} alt="" aria-hidden="true" />
    </button>
  );
}

type NumberStepperProps = {
  className?: string;
  inputId?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
};

function NumberStepper({ className, inputId, label, value, min, max, disabled = false, onChange }: NumberStepperProps) {
  const normalizedValue = clampNumberInput(value, min, max);
  const updateValue = (nextValue: number) => onChange(clampNumberInput(nextValue, min, max));

  return (
    <StepperControl
      className={`number-stepper${className ? ` ${className}` : ""}`}
      ariaLabel={`${label}ステッパー`}
      lowerAction={{
        ariaLabel: `${label}を1下げる`,
        disabled: disabled || normalizedValue <= min,
        onClick: () => updateValue(normalizedValue - 1),
      }}
      upperAction={{
        ariaLabel: `${label}を1上げる`,
        disabled: disabled || normalizedValue >= max,
        onClick: () => updateValue(normalizedValue + 1),
      }}
    >
      <input
        {...numericInputProps}
        id={inputId}
        value={normalizedValue}
        aria-label={label}
        disabled={disabled}
        onFocus={selectInputValueOnFocus}
        onChange={(event) => updateValue(toNumber(event.target.value, normalizedValue))}
      />
    </StepperControl>
  );
}

type ScenarioStepperFieldProps = {
  className?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onChange: (value: number) => void;
};

function ScenarioStepperField({
  className,
  label,
  value,
  min,
  max,
  disabled = false,
  onChange,
}: ScenarioStepperFieldProps) {
  const inputId = useId();

  return (
    <div className={["scenario-cell number-cell number-labeled-field scenario-stepper-field", className].filter(Boolean).join(" ")}>
      <label className="row-label" htmlFor={inputId}>{label}</label>
      <NumberStepper
        inputId={inputId}
        label={label}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onChange={onChange}
      />
    </div>
  );
}

type RankSelectFieldProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
};

function RankSelectField({ label, value, onChange }: RankSelectFieldProps) {
  return (
    <SelectField
      compact
      placeholderLabel
      placeholderValue=""
      className="target-rank-field"
      label={label}
      value={String(value)}
      options={rankSelectOptions}
      onChange={(nextValue) => onChange(toNumber(nextValue, 0))}
    />
  );
}

type TargetPanelProps = {
  targetForm: TargetFormState;
  canonicalPokemon?: string;
  artwork: PokemonArtworkMatch | null;
  actualStats: StatTable | null;
  statPointMarkers: StatPointMarkerTable | null;
  totalStatPoints: number;
  speedOverrideCounts: TargetSpeedOverrideCounts;
  bulkMaximizeState: BulkMaximizeUiState;
  allowBulkNatureChange: boolean;
  bulkMaximizeApplied: boolean;
  isBoxPanelOpen: boolean;
  onUpdateField: <K extends keyof TargetFormState>(key: K, value: TargetFormState[K]) => void;
  onUpdateEv: (key: StatKey, value: number) => void;
  onAllowBulkNatureChange: (value: boolean) => void;
  onRunBulkMaximize: () => void;
  onCancelBulkMaximize: () => void;
  onApplyBulkMaximize: () => void;
  onOpenBoxPanel: () => void;
  onCloseMobileSheet?: () => void;
};

type MobileOverviewProps = {
  targetForm: TargetFormState;
  targetArtwork: PokemonArtworkMatch | null;
  totalStatPoints: number;
  scenarios: ScenarioFormState[];
  candidates: CandidateResult[];
  passingCandidateCount: number;
  selectedCandidateId: string | null;
  appliedCandidateId: string | null;
  appliedAdjustmentId: string | null;
  searchStatus: string;
  searchProgress: number;
  searchedCandidates: number;
  totalCandidates: number;
  offenseResults: OffenseScenarioResult[];
  speedResults: SpeedScenarioResult[];
  strictestFailureLabel: string | null;
  targetLabel: string;
  resultAlertMessage: string | null;
  canRunAdjustment: boolean;
  runButtonLabel: string;
  isBoxPanelOpen: boolean;
  onOpenBoxPanel: () => void;
  isEnemyBoxPanelOpen: boolean;
  onOpenEnemyBoxPanel: () => void;
  onOpenTarget: () => void;
  onOpenScenarioDetail: (scenarioId: string, attackId?: string) => void;
  onToggleScenarioAdjustmentFromDirection: (scenarioId: string) => void;
  onToggleScenarioEnabled: (scenarioId: string, enabled: boolean) => void;
  onAddScenario: () => void;
  onRemoveScenario: (scenarioId: string) => void;
  onAddAttack: (scenarioId: string) => string | null;
  onRun: () => void;
  onCancel: () => void;
  onSelectCandidate: (id: string) => void;
  onApplyCandidate: (candidate: CandidateResult) => void;
  onApplyOffenseResult: (entry: OffenseScenarioResult) => void;
  onApplySpeedResult: (entry: SpeedScenarioResult) => void;
};

type BulkMaximizeResultPreviewProps = {
  state: BulkMaximizeUiState;
  applied: boolean;
  onApply: () => void;
};

function formatBulkStatSpread(result: MaximizeRemainingBulkResult): string {
  const { statPoints } = result.candidate;
  return `H${statPoints.hp} / B${statPoints.def} / D${statPoints.spd}`;
}

function formatBulkDerivedSpread(result: MaximizeRemainingBulkResult): string {
  const { derivedStats } = result.candidate;
  return `H${derivedStats.hp} / B${derivedStats.def} / D${derivedStats.spd}`;
}

function formatBulkGain(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${formatBulkIndex(value)}`;
}

function BulkMaximizeResultPreview({
  state,
  applied,
  onApply,
}: BulkMaximizeResultPreviewProps) {
  if (state.status === "idle") {
    return null;
  }

  if (state.status === "running") {
    return (
      <div className="bulk-maximize-preview" aria-live="polite">
        <div className="bulk-maximize-preview-header">
          <strong>耐久最大化を計算中</strong>
          <span>{Math.round(state.progress * 100)}%</span>
        </div>
        <div className="bulk-maximize-meter" aria-hidden="true">
          <span style={{ width: `${Math.round(state.progress * 100)}%` }} />
        </div>
        <p>評価 {state.searchedCandidates} / {state.totalCandidates || "-"}</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="bulk-maximize-preview error" role="alert">
        {state.errorMessage ?? "耐久最大化に失敗しました"}
      </div>
    );
  }

  if (state.status === "canceled") {
    return (
      <div className="bulk-maximize-preview muted" aria-live="polite">
        耐久最大化を中止しました
      </div>
    );
  }

  if (!state.result) {
    return (
      <div className="bulk-maximize-preview muted" aria-live="polite">
        現在の物理耐久・特殊耐久を両方維持できる再配分がありません
      </div>
    );
  }

  const result = state.result;
  const sideEffectNotes = result.natureChangeImpact.notes;

  return (
    <div className="bulk-maximize-preview" aria-live="polite">
      <div className="bulk-maximize-preview-header">
        <strong>耐久最大化候補</strong>
        <Button
          variant="primary"
          size="small"
          onClick={onApply}
        >
          {applied ? "適用済み" : "適用"}
        </Button>
      </div>
      <dl className="bulk-maximize-grid">
        <div>
          <dt>推奨性格</dt>
          <dd>{result.candidate.nature}</dd>
        </div>
        <div>
          <dt>推奨SP</dt>
          <dd>{formatBulkStatSpread(result)}</dd>
        </div>
        <div>
          <dt>実数値</dt>
          <dd>{formatBulkDerivedSpread(result)}</dd>
        </div>
        <div>
          <dt>物理耐久</dt>
          <dd>{formatBulkIndex(result.score.physicalBulk)}</dd>
        </div>
        <div>
          <dt>特殊耐久</dt>
          <dd>{formatBulkIndex(result.score.specialBulk)}</dd>
        </div>
        <div>
          <dt>総合耐久</dt>
          <dd>
            {formatBulkIndex(result.score.overallBulk)}
            <span>{formatBulkGain(result.score.overallBulkGain)}</span>
          </dd>
        </div>
      </dl>
      <p>{result.explanation}</p>
      {sideEffectNotes.length > 0 ? (
        <p className="bulk-maximize-warning">{sideEffectNotes.join(" / ")}</p>
      ) : null}
    </div>
  );
}

function formatMobileAttackMeta(
  attack: ScenarioAttackFormState,
  adjustmentType: ScenarioAdjustmentType,
): string {
  if (adjustmentType === "speed") {
    return attack.speedTargetMode === "manual"
      ? `任意S ${attack.speedTargetValue}`
      : `${attack.speedOrderMode === "trick-room" ? "トリル" : "抜き"} +${attack.speedRequiredOffset}`;
  }

  const hpEventCount = attack.hpEvents?.length ?? 0;
  const hpEventMeta = hpEventCount > 0
    ? ` · 効果${hpEventCount}`
    : "";

  if (adjustmentType === "offense") {
    return `KO ${attack.targetKoProbabilityPercent}%${hpEventMeta}`;
  }

  return `${attack.requiredSurvivedHits}/${attack.repeat}耐え ${attack.minSurvivalProbabilityPercent}%${hpEventMeta}`;
}

type MobileFlowEdgeGeometry = {
  id: string;
  path: string;
  color: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  pathStartX: number;
  pathStartY: number;
  pathEndX: number;
  pathEndY: number;
  smallNodeX: number;
  smallNodeY: number;
  capsuleX: number;
  capsuleY: number;
  ariaLabel: string;
};

type MobileFlowGeometry = {
  width: number;
  height: number;
  edges: MobileFlowEdgeGeometry[];
  signature: string;
};

const emptyMobileFlowGeometry: MobileFlowGeometry = {
  width: 0,
  height: 0,
  edges: [],
  signature: "",
};

function getMobileFlowPalette(adjustmentType: ScenarioAdjustmentType, isTrickRoom: boolean) {
  if (adjustmentType === "offense") {
    return { color: "#ff0000" };
  }

  if (adjustmentType === "speed") {
    return isTrickRoom
      ? { color: "#b56cff" }
      : { color: "#00d8f0" };
  }

  return { color: "#00ff72" };
}

function shouldPlaceMobileFlowCapsuleAtTarget(adjustmentType: ScenarioAdjustmentType, isTrickRoom: boolean): boolean {
  return adjustmentType === "defence" || isTrickRoom;
}

export function getMobileScenarioDirectionIconPath(adjustmentType: ScenarioAdjustmentType, isTrickRoom: boolean): string {
  if (isTrickRoom) {
    return "assets/ui/arrow-down-circle.svg";
  }

  if (adjustmentType === "defence") {
    return "assets/ui/arrow-left-circle.svg";
  }

  if (adjustmentType === "offense") {
    return "assets/ui/arrow-right-circle.svg";
  }

  return "assets/ui/arrow-up-circle.svg";
}

function MobileOverview({
  targetForm,
  targetArtwork,
  totalStatPoints,
  scenarios,
  candidates,
  passingCandidateCount,
  selectedCandidateId,
  appliedCandidateId,
  appliedAdjustmentId,
  searchStatus,
  searchProgress,
  searchedCandidates,
  totalCandidates,
  offenseResults,
  speedResults,
  strictestFailureLabel,
  targetLabel,
  resultAlertMessage,
  canRunAdjustment,
  runButtonLabel,
  isBoxPanelOpen,
  onOpenBoxPanel,
  isEnemyBoxPanelOpen,
  onOpenEnemyBoxPanel,
  onOpenTarget,
  onOpenScenarioDetail,
  onToggleScenarioAdjustmentFromDirection,
  onToggleScenarioEnabled,
  onAddScenario,
  onRemoveScenario,
  onAddAttack,
  onRun,
  onCancel,
  onSelectCandidate,
  onApplyCandidate,
  onApplyOffenseResult,
  onApplySpeedResult,
}: MobileOverviewProps) {
  const boardRef = useRef<HTMLElement | null>(null);
  const targetMiniRef = useRef<HTMLButtonElement | null>(null);
  const scenarioCardRefs = useRef(new Map<string, HTMLElement>());
  const [flowGeometry, setFlowGeometry] = useState<MobileFlowGeometry>(emptyMobileFlowGeometry);

  useEffect(() => {
    const board = boardRef.current;
    const targetMini = targetMiniRef.current;
    if (!board || !targetMini) {
      return undefined;
    }

    let frameId = 0;

    const measure = () => {
      const boardRect = board.getBoundingClientRect();
      const targetRect = targetMini.getBoundingClientRect();
      const edgeCount = scenarios.length;
      const targetTop = targetRect.top - boardRect.top;
      const targetRight = targetRect.right - boardRect.left - 1;
      const anchorStartY = targetTop + Math.min(Math.max(targetRect.height * 0.11, 26), 42);
      const requestedBand = Math.max(30 * Math.max(edgeCount - 1, 1), 60);
      const maxBand = Math.max(0, targetRect.height * 0.34);
      const anchorBand = edgeCount <= 1 ? 0 : Math.min(requestedBand, maxBand);

      const edges = scenarios.flatMap((scenario, index) => {
        const card = scenarioCardRefs.current.get(scenario.id);
        if (!card) {
          return [];
        }

        const cardRect = card.getBoundingClientRect();
        const isTrickRoom = scenario.adjustmentType === "speed"
          && scenario.attacks.some((attack) => attack.speedOrderMode === "trick-room");
        const fromX = targetRight;
        const fromY = anchorStartY + (edgeCount <= 1 ? 0 : (anchorBand * index) / (edgeCount - 1));
        const toX = cardRect.left - boardRect.left + 1;
        const toY = cardRect.top - boardRect.top + cardRect.height / 2;
        const gap = Math.max(toX - fromX, 24);
        const palette = getMobileFlowPalette(scenario.adjustmentType, isTrickRoom);
        const capsuleAtTarget = shouldPlaceMobileFlowCapsuleAtTarget(scenario.adjustmentType, isTrickRoom);
        const pathStart = capsuleAtTarget ? { x: toX, y: toY } : { x: fromX, y: fromY };
        const pathEnd = capsuleAtTarget ? { x: fromX, y: fromY } : { x: toX, y: toY };
        const controlA = capsuleAtTarget
          ? { x: toX - gap * 0.46, y: toY }
          : { x: fromX + gap * 0.58, y: fromY };
        const controlB = capsuleAtTarget
          ? { x: fromX + gap * 0.58, y: fromY }
          : { x: toX - gap * 0.46, y: toY };
        const currentAdjustmentLabel = getScenarioAdjustmentTypeLabel(scenario.adjustmentType);
        const nextAdjustmentLabel = getScenarioAdjustmentTypeLabel(nextScenarioAdjustmentType(scenario.adjustmentType));

        return [{
          id: scenario.id,
          path: `M ${pathStart.x.toFixed(1)} ${pathStart.y.toFixed(1)} C ${controlA.x.toFixed(1)} ${controlA.y.toFixed(1)}, ${controlB.x.toFixed(1)} ${controlB.y.toFixed(1)}, ${pathEnd.x.toFixed(1)} ${pathEnd.y.toFixed(1)}`,
          color: palette.color,
          fromX,
          fromY,
          toX,
          toY,
          pathStartX: pathStart.x,
          pathStartY: pathStart.y,
          pathEndX: pathEnd.x,
          pathEndY: pathEnd.y,
          smallNodeX: pathStart.x,
          smallNodeY: pathStart.y,
          capsuleX: pathEnd.x,
          capsuleY: pathEnd.y,
          ariaLabel: `${scenario.label}: ${currentAdjustmentLabel}。タップで${nextAdjustmentLabel}に切り替え`,
        }];
      });

      const nextGeometry: MobileFlowGeometry = {
        width: boardRect.width,
        height: boardRect.height,
        edges,
        signature: [
          Math.round(boardRect.width),
          Math.round(boardRect.height),
          ...edges.map((edge) => [
            edge.id,
            edge.path,
            Math.round(edge.fromY),
            Math.round(edge.toY),
            Math.round(edge.capsuleX),
            Math.round(edge.capsuleY),
            edge.color,
          ].join(":")),
        ].join("|"),
      };

      setFlowGeometry((previous) => (previous.signature === nextGeometry.signature ? previous : nextGeometry));
    };

    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(measure);
    };

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleMeasure);
    resizeObserver?.observe(board);
    resizeObserver?.observe(targetMini);
    scenarioCardRefs.current.forEach((card) => resizeObserver?.observe(card));
    window.addEventListener("resize", scheduleMeasure);
    scheduleMeasure();

    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [scenarios]);

  return (
    <section className="mobile-overview" aria-label="スマホ用調整ボード">
      <section className="mobile-symmetric-board" aria-label="ノード接続調整ボード" ref={boardRef}>
        <div className="mobile-target-column">
          <div className="mobile-target-heading">
            <h2>調整対象</h2>
            <button
              className={`box-access-button mobile-box-access-button${isBoxPanelOpen ? " active" : ""}`}
              type="button"
              aria-label={isBoxPanelOpen ? "調整対象ボックスを閉じる" : "調整対象ボックスを開く"}
              aria-expanded={isBoxPanelOpen}
              onClick={onOpenBoxPanel}
            >
              <img src={getAssetSrc("assets/ui/box.svg")} alt="" aria-hidden="true" />
            </button>
          </div>
          <button className="mobile-target-mini" type="button" onClick={onOpenTarget} ref={targetMiniRef}>
            <PokemonArtworkFrame
              match={targetArtwork}
              fallbackLabel={targetForm.pokemonInput}
              variant="target"
              dynamaxEffect={targetForm.dmaxEnabled || isPokemonFormVariant(targetForm.pokemonInput, "gmax")}
            />
            <span className="mobile-target-mini-main">
              <strong>{targetForm.pokemonInput || "調整対象"}</strong>
              <span>Lv{targetForm.level}</span>
            </span>
            <span className="mobile-target-mini-spread">
              合計SP {totalStatPoints} / {CHAMPIONS_TOTAL_STAT_POINTS}
            </span>
            <span className="mobile-target-stat-list" aria-label="調整対象の主要SP">
              {statKeys.map((key) => (
                <span key={key}>
                  <StatIcon stat={key} />
                  <b>{statLabels[key]}</b>
                  <span className={`mobile-target-stat-meter ${key}`} aria-hidden="true">
                    <i style={{ width: `${(targetForm.statPoints[key] / CHAMPIONS_MAX_STAT_POINTS_PER_STAT) * 100}%` }} />
                  </span>
                  <em>{targetForm.statPoints[key]}</em>
                </span>
              ))}
            </span>
          </button>
        </div>

        <svg
          className="mobile-flow-edge-layer"
          aria-label="シナリオ調整種別エッジ"
          role="img"
          viewBox={`0 0 ${Math.max(flowGeometry.width, 1)} ${Math.max(flowGeometry.height, 1)}`}
          preserveAspectRatio="none"
        >
          <defs>
            {flowGeometry.edges.map((edge) => (
              <filter
                id={`mobile-flow-glow-${edge.id}`}
                key={edge.id}
                x="-35%"
                y="-35%"
                width="170%"
                height="170%"
                colorInterpolationFilters="sRGB"
              >
                <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor={edge.color} floodOpacity="0.42" />
              </filter>
            ))}
          </defs>
          {flowGeometry.edges.map((edge) => (
            <g
              className="mobile-flow-edge"
              key={edge.id}
              role="button"
              tabIndex={0}
              aria-label={edge.ariaLabel}
              onClick={() => onToggleScenarioAdjustmentFromDirection(edge.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onToggleScenarioAdjustmentFromDirection(edge.id);
                }
              }}
            >
              <path className="mobile-flow-edge-hit" d={edge.path} />
              <path
                className="mobile-flow-edge-line"
                d={edge.path}
                stroke={edge.color}
                filter={`url(#mobile-flow-glow-${edge.id})`}
              />
              <circle className="mobile-flow-edge-small-node" cx={edge.smallNodeX} cy={edge.smallNodeY} r="5" fill={edge.color} />
              <rect
                className="mobile-flow-edge-capsule-node"
                x={edge.capsuleX - 3}
                y={edge.capsuleY - 13}
                width="6"
                height="26"
                rx="3"
                fill={edge.color}
              />
            </g>
          ))}
        </svg>

        <section className="mobile-scenario-board" aria-labelledby="mobile-scenario-title">
          <div className="mobile-board-heading">
            <h2 id="mobile-scenario-title">仮想敵シナリオ</h2>
            <button
              className={`box-access-button mobile-box-access-button${isEnemyBoxPanelOpen ? " active" : ""}`}
              type="button"
              aria-label={isEnemyBoxPanelOpen ? "仮想敵ボックスを閉じる" : "仮想敵ボックスを開く"}
              aria-expanded={isEnemyBoxPanelOpen}
              onClick={onOpenEnemyBoxPanel}
            >
              <img src={getAssetSrc("assets/ui/box.svg")} alt="" aria-hidden="true" />
            </button>
          </div>

          <div className="mobile-scenario-flow-list" aria-label="シナリオ調整種別">
            {scenarios.map((scenario) => {
              const isTrickRoomSpeedScenario = scenario.adjustmentType === "speed"
                && scenario.attacks.some((attack) => attack.speedOrderMode === "trick-room");
              const currentAdjustmentLabel = getScenarioAdjustmentTypeLabel(scenario.adjustmentType);
              const currentAdjustmentAriaLabel = isTrickRoomSpeedScenario
                ? `${currentAdjustmentLabel}（トリックルーム）`
                : currentAdjustmentLabel;
              const directionIconPath = getMobileScenarioDirectionIconPath(scenario.adjustmentType, isTrickRoomSpeedScenario);

              return (
                <div
                  className={`mobile-scenario-flow-row ${scenario.adjustmentType}${isTrickRoomSpeedScenario ? " trick-room" : ""}`}
                  key={scenario.id}
                >
                  <article
                    className={`mobile-scenario-summary ${scenario.adjustmentType}${scenario.enabled ? "" : " disabled"}`}
                    ref={(node) => {
                      if (node) {
                        scenarioCardRefs.current.set(scenario.id, node);
                      } else {
                        scenarioCardRefs.current.delete(scenario.id);
                      }
                    }}
                  >
                    <div className="mobile-scenario-summary-header">
                      <button
                        className={`mobile-scenario-state ${scenario.enabled ? "on" : "off"}`}
                        type="button"
                        role="switch"
                        aria-checked={scenario.enabled}
                        aria-label={`${scenario.label}を${scenario.enabled ? "無効化" : "有効化"}`}
                        onClick={() => onToggleScenarioEnabled(scenario.id, !scenario.enabled)}
                      >
                        <span aria-hidden="true" />
                      </button>
                      <button
                        className="mobile-scenario-summary-main"
                        type="button"
                        onClick={() => onOpenScenarioDetail(scenario.id)}
                      >
                        <span className="mobile-scenario-title">
                          <strong>{scenario.label}</strong>
                        </span>
                      </button>
                      <button
                        className="icon-button scenario-remove-button mobile-scenario-remove-button"
                        type="button"
                        aria-label={`${scenario.label}を削除`}
                        onClick={() => onRemoveScenario(scenario.id)}
                      >
                        <img className="ui-button-icon" src={getAssetSrc("assets/ui/trash-2.svg")} alt="" aria-hidden="true" />
                      </button>
                    </div>

                    <button
                      className="mobile-scenario-adjustment-row"
                      type="button"
                      aria-label={`${scenario.label}: ${currentAdjustmentAriaLabel}。タップで次の調整種別に切り替え`}
                      onClick={() => onToggleScenarioAdjustmentFromDirection(scenario.id)}
                    >
                      <span
                        className="mobile-scenario-direction-icon"
                        aria-hidden="true"
                        style={{ backgroundImage: `url("${getAssetSrc(directionIconPath)}")` }}
                      />
                      <span className="mobile-scenario-adjustment-label">{currentAdjustmentLabel}</span>
                    </button>

                    <div className="mobile-attack-rail" aria-label={`${scenario.label}の攻撃一覧`}>
                      {scenario.attacks.map((attack, attackIndex) => {
                        const attackerArtwork = findPokemonArtwork({ input: attack.attackerPokemonInput });
                        return (
                          <button
                            className="mobile-attack-summary"
                            type="button"
                            key={attack.id}
                            onClick={() => onOpenScenarioDetail(scenario.id, attack.id)}
                          >
                            <PokemonArtworkFrame
                              match={attackerArtwork}
                              fallbackLabel={attack.attackerPokemonInput}
                              variant="attack"
                              dynamaxEffect={attack.attackerDmaxEnabled || isPokemonFormVariant(attack.attackerPokemonInput, "gmax")}
                            />
                            <span>
                              <strong>{formatScenarioAttackLabel(scenario.adjustmentType, attackIndex, attack.label)}</strong>
                              <small>{attack.moveInput || attack.attackerPokemonInput || "未設定"}</small>
                              <em>{formatMobileAttackMeta(
                                attack,
                                scenario.adjustmentType,
                              )}</em>
                            </span>
                          </button>
                        );
                      })}
                      <button
                        className="mobile-attack-add"
                        type="button"
                        aria-label={`${scenario.label}に攻撃を追加`}
                        onClick={() => onAddAttack(scenario.id)}
                      >
                        +
                      </button>
                    </div>
                  </article>
                </div>
              );
            })}
            <button
              className="mobile-scenario-add-card"
              type="button"
              aria-label="シナリオを追加"
              onClick={onAddScenario}
            >
              <span aria-hidden="true">+</span>
            </button>
          </div>
        </section>
      </section>

      <section className="mobile-candidate-dock" aria-label="候補一覧と探索操作">
        <div
          className="mobile-progress-line"
          role="progressbar"
          aria-label="探索進捗"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(searchProgress * 100)}
        >
          <span style={{ width: `${Math.round(searchProgress * 100)}%` }} aria-hidden="true" />
        </div>
        <div className="mobile-candidate-actions">
          <span className="mobile-search-counts">
            <span>評価 {searchedCandidates}/{totalCandidates || "-"}</span>
            <span>合格 {passingCandidateCount}</span>
          </span>
          <Button
            variant="ghost"
            size="small"
            onClick={onCancel}
            disabled={searchStatus !== "running"}
          >
            キャンセル
          </Button>
          <Button
            variant="primary"
            size="small"
            onClick={onRun}
            disabled={searchStatus === "running" || !canRunAdjustment}
          >
            {searchStatus === "running" ? "計算中..." : runButtonLabel}
          </Button>
        </div>
        <ResultsPanel
          displayMode="mobile-inline"
          pageSize={MOBILE_RESULTS_PAGE_SIZE}
          candidates={candidates}
          passingCandidateCount={passingCandidateCount}
          selectedCandidateId={selectedCandidateId}
          appliedCandidateId={appliedCandidateId}
          appliedAdjustmentId={appliedAdjustmentId}
          scenarios={scenarios}
          status={searchStatus}
          offenseResults={offenseResults}
          speedResults={speedResults}
          strictestFailureLabel={strictestFailureLabel}
          targetLabel={targetLabel}
          resultAlertMessage={resultAlertMessage}
          onSelectCandidate={onSelectCandidate}
          onApplyCandidate={onApplyCandidate}
          onApplyOffenseResult={onApplyOffenseResult}
          onApplySpeedResult={onApplySpeedResult}
        />
      </section>
    </section>
  );
}

type BoxPanelEntry = {
  id: string;
  name: string;
  summary: BoxEntrySummary;
};

type BoxPanelProps = {
  title: string;
  storageLabel: string;
  dialogId: string;
  blankSlotId: string;
  currentLabel: string;
  currentRowAriaLabel: string;
  gridAriaLabel: string;
  emptyMessage: string;
  entries: BoxPanelEntry[];
  selectedEntryId: string | null;
  currentSummary: BoxEntrySummary;
  message: string | null;
  disabled?: boolean;
  onClose: () => void;
  onSaveCurrent: () => void;
  onSelectEntry: (entryId: string) => void;
  onLoadEntry: (entryId: string) => void;
  onOverwriteEntry: (entryId: string) => void;
  onRenameEntry: (entryId: string, name: string) => void;
  onDuplicateEntry: (entryId: string) => void;
  onDeleteEntry: (entryId: string) => void;
  onExportEntries: () => void;
  onRequestImport: () => void;
};

function BoxSlotArtwork({ entry }: { entry: BoxPanelEntry }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const artwork = findPokemonArtwork({ input: entry.summary.pokemonName });
  const canShowImage = artwork && failedSrc !== artwork.artworkUrl;
  const fallbackInitial = (entry.summary.pokemonName.trim() || "?").slice(0, 1);

  return (
    <span className="box-slot-art" aria-hidden="true">
      {canShowImage ? (
        <img
          src={artwork.artworkUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(artwork.artworkUrl)}
        />
      ) : (
        <strong>{fallbackInitial}</strong>
      )}
    </span>
  );
}

function BoxPanel({
  title,
  storageLabel,
  dialogId,
  blankSlotId,
  currentLabel,
  currentRowAriaLabel,
  gridAriaLabel,
  emptyMessage,
  entries,
  selectedEntryId,
  currentSummary,
  message,
  disabled = false,
  onClose,
  onSaveCurrent,
  onSelectEntry,
  onLoadEntry,
  onOverwriteEntry,
  onRenameEntry,
  onDuplicateEntry,
  onDeleteEntry,
  onExportEntries,
  onRequestImport,
}: BoxPanelProps) {
  const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) ?? null;
  const isBlankSlotSelected = selectedEntryId === blankSlotId;
  const hasSelectedSlot = isBlankSlotSelected || selectedEntry !== null;

  return (
    <div className="box-overlay">
      <div className="box-backdrop" aria-hidden="true" onClick={onClose} />
      <section className="box-window" role="dialog" aria-modal="true" aria-labelledby={dialogId}>
        <header className="box-window-header">
          <div>
            <h2 id={dialogId}>{title}</h2>
            <span>{storageLabel}</span>
          </div>
          <div className="box-window-actions">
            <Button variant="ghost" size="small" aria-label="バックアップを書き出す" disabled={disabled} onClick={onExportEntries}>
              <img className="box-window-action-icon" src={getAssetSrc("assets/ui/download.svg")} alt="" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="small" aria-label="バックアップを読み込む" disabled={disabled} onClick={onRequestImport}>
              <img className="box-window-action-icon" src={getAssetSrc("assets/ui/upload.svg")} alt="" aria-hidden="true" />
            </Button>
            <button className="box-close-button" type="button" aria-label="閉じる" onClick={onClose}>
              <img className="box-window-action-icon" src={getAssetSrc("assets/ui/close.svg")} alt="" aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="box-current-row" aria-label={currentRowAriaLabel}>
          <div>
            <span>{currentLabel}</span>
            <strong>{currentSummary.pokemonName}</strong>
          </div>
          <small>{currentSummary.conditionSummary}</small>
          <Button variant="primary" size="small" disabled={disabled} onClick={onSaveCurrent}>
            保存
          </Button>
        </div>

        <div className="box-grid" aria-label={gridAriaLabel}>
          <button
            className={`box-slot blank${isBlankSlotSelected ? " selected" : ""}`}
            type="button"
            disabled={disabled}
            aria-pressed={isBlankSlotSelected}
            onClick={() => onSelectEntry(blankSlotId)}
          >
            <span className="box-slot-art blank" aria-hidden="true">
              <strong>+</strong>
            </span>
            <strong>空スロット</strong>
            <span>リセット</span>
          </button>
          {entries.map((entry) => {
            const selected = entry.id === selectedEntry?.id;
            return (
              <button
                className={`box-slot${selected ? " selected" : ""}`}
                type="button"
                disabled={disabled}
                aria-pressed={selected}
                key={entry.id}
                onClick={() => onSelectEntry(entry.id)}
              >
                <BoxSlotArtwork entry={entry} />
                <strong>{entry.name}</strong>
                <span>{entry.summary.statPointSummary}</span>
              </button>
            );
          })}
        </div>

        {entries.length === 0 ? (
          <div className="box-empty-note" role="status">
            {emptyMessage}
          </div>
        ) : null}

        <footer className="box-action-row">
          {hasSelectedSlot ? (
            <>
              <div className="box-selected-label">
                <span>選択中</span>
                {selectedEntry ? (
                  <input
                    className="box-name-input"
                    value={selectedEntry.name}
                    placeholder={selectedEntry.summary.pokemonName}
                    aria-label="保存名"
                    disabled={disabled}
                    onChange={(event) => onRenameEntry(selectedEntry.id, event.target.value)}
                  />
                ) : (
                  <strong>空スロット</strong>
                )}
              </div>
              <div className="box-action-buttons">
                <Button variant="primary" size="small" disabled={disabled} onClick={() => onLoadEntry(selectedEntry?.id ?? blankSlotId)}>
                  読込
                </Button>
                {selectedEntry ? (
                  <>
                    <Button variant="ghost" size="small" disabled={disabled} onClick={() => onOverwriteEntry(selectedEntry.id)}>
                      上書き
                    </Button>
                    <Button variant="ghost" size="small" disabled={disabled} onClick={() => onDuplicateEntry(selectedEntry.id)}>
                      複製
                    </Button>
                    <Button variant="danger" size="small" disabled={disabled} onClick={() => onDeleteEntry(selectedEntry.id)}>
                      削除
                    </Button>
                  </>
                ) : null}
              </div>
            </>
          ) : (
            <span className="box-action-placeholder">保存スロットを選んでください</span>
          )}
        </footer>

        {message ? <p className="box-message">{message}</p> : null}
      </section>
    </div>
  );
}

function TargetPanel({
  targetForm,
  canonicalPokemon,
  artwork,
  actualStats,
  statPointMarkers,
  totalStatPoints,
  speedOverrideCounts,
  bulkMaximizeState,
  allowBulkNatureChange,
  bulkMaximizeApplied,
  isBoxPanelOpen,
  onUpdateField,
  onUpdateEv,
  onAllowBulkNatureChange,
  onRunBulkMaximize,
  onCancelBulkMaximize,
  onApplyBulkMaximize,
  onOpenBoxPanel,
  onCloseMobileSheet,
}: TargetPanelProps) {
  const isSpLimitReached = totalStatPoints >= CHAMPIONS_TOTAL_STAT_POINTS;
  const rankingOwnerPokemon = canonicalPokemon
    ?? resolveCanonicalEntityName("pokemon", targetForm.pokemonInput);
  const pokemonAbilityOptions = getPokemonAbilityInputOptions(rankingOwnerPokemon);
  const itemOptions = useUsageSuggestionOptions(
    "item",
    targetForm.itemInput,
    rankingOwnerPokemon,
  );
  const abilityOptions = useUsageSuggestionOptions(
    "ability",
    targetForm.abilityInput,
    rankingOwnerPokemon,
    pokemonAbilityOptions ?? getEntityInputOptions("ability"),
  );
  const itemSpeedOverrideDescription = speedOverrideCounts.item > 0
    ? `${speedOverrideCounts.item}件の素早さ条件で持ち物のS補正を手動倍率に上書き中`
    : undefined;
  const abilitySpeedOverrideDescription = speedOverrideCounts.ability > 0
    ? `${speedOverrideCounts.ability}件の素早さ条件で特性のS補正を手動倍率に上書き中`
    : undefined;

  return (
    <section className="target-panel" aria-labelledby="target-title">
      <div className="section-heading">
        <div>
          <h2 id="target-title">調整対象</h2>
        </div>
        <div className="mobile-sheet-heading-actions">
          <button
            className={`box-access-button${isBoxPanelOpen ? " active" : ""}`}
            type="button"
            aria-label={isBoxPanelOpen ? "調整対象ボックスを閉じる" : "調整対象ボックスを開く"}
            aria-expanded={isBoxPanelOpen}
            onClick={onOpenBoxPanel}
          >
            <img src={getAssetSrc("assets/ui/box.svg")} alt="" aria-hidden="true" />
          </button>
          <button className="mobile-sheet-close mobile-sheet-icon-button" type="button" aria-label="閉じる" onClick={onCloseMobileSheet}>
            <img className="mobile-sheet-action-icon" src={getAssetSrc("assets/ui/close.svg")} alt="" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="target-sheet-body">
        <div className="target-identity">
          <PokemonArtworkFrame
            match={artwork}
            fallbackLabel={targetForm.pokemonInput}
            variant="target"
            dynamaxEffect={targetForm.dmaxEnabled || isPokemonFormVariant(targetForm.pokemonInput, "gmax")}
          />
          <div className="target-summary compact">
            <EntityTextField
              kind="pokemon"
              label="ポケモン"
              value={targetForm.pokemonInput}
              onChange={(event) => onUpdateField("pokemonInput", event.target.value)}
              onSelectValue={(value) => onUpdateField("pokemonInput", value)}
            />
            <NatureMatrixField
              label="性格"
              value={targetForm.natureInput}
              ownerPokemonCanonicalName={rankingOwnerPokemon}
              onChange={(value) => onUpdateField("natureInput", value)}
            />
            <EntityTextField
              kind="item"
              label="持ち物"
              className={itemSpeedOverrideDescription ? "speed-source-overridden" : undefined}
              description={itemSpeedOverrideDescription}
              value={targetForm.itemInput}
              options={itemOptions}
              onChange={(event) => onUpdateField("itemInput", event.target.value)}
              onSelectValue={(value) => onUpdateField("itemInput", value)}
            />
            <AbilityTextField
              label="特性"
              className={abilitySpeedOverrideDescription ? "speed-source-overridden" : undefined}
              description={abilitySpeedOverrideDescription}
              value={targetForm.abilityInput}
              pokemonAbilityOptions={abilityOptions}
              onChange={(event) => onUpdateField("abilityInput", event.target.value)}
              onSelectAbility={(value) => onUpdateField("abilityInput", value)}
            />
            <LevelLockField
              ownerLabel="調整対象"
              className="placeholder-field target-level-field"
              mode={targetForm.levelMode}
              value={targetForm.level}
              onModeChange={(mode) => onUpdateField("levelMode", mode)}
              onChange={(value) => onUpdateField("level", value)}
            />
            <MechanicControls
              pokemonInput={targetForm.pokemonInput}
              teraEnabled={targetForm.teraEnabled}
              dmaxEnabled={targetForm.dmaxEnabled}
              teraTypeInput={targetForm.teraTypeInput}
              teraLabel={targetForm.teraEnabled ? "テラスタル解除" : "テラスタル"}
              onPokemonInputChange={(value) => onUpdateField("pokemonInput", value)}
              onTeraEnabledChange={(value) => onUpdateField("teraEnabled", value)}
              onDmaxEnabledChange={(value) => onUpdateField("dmaxEnabled", value)}
              onTeraTypeInputChange={(value) => onUpdateField("teraTypeInput", value)}
            />
          </div>
        </div>

        <div className={`ev-table${isSpLimitReached ? " is-sp-max" : ""}`} aria-label="調整対象のSP">
          <div className="ev-header">
            <span>能力</span>
            <span aria-hidden="true" />
            <span>実数値</span>
            <span>現在SP</span>
            <span>SP配分</span>
            <span>ランク</span>
          </div>
          {statKeys.map((key) => (
            <div className={`ev-row ${key}`} key={key}>
              <strong><StatIcon stat={key} /></strong>
              <NatureStatModifier natureLabel={targetForm.natureInput} stat={key} />
              <span className="actual-stat">{actualStats?.[key] ?? "-"}</span>
              <input
                {...numericInputProps}
                value={targetForm.statPoints[key]}
                aria-label={`${statLabels[key]} SP`}
                onChange={(event) => onUpdateEv(key, toStatPointInput(event.target.value))}
              />
              <StatPointCellBar
                stat={key}
                value={targetForm.statPoints[key]}
                markers={statPointMarkers?.[key]}
                onChange={(value) => onUpdateEv(key, value)}
              />
              {key === "hp" ? (
                <span className="target-rank-placeholder" aria-hidden="true" />
              ) : (
                <RankSelectField
                  label={`${statLabels[key]}ランク`}
                  value={targetForm.boosts[key] ?? 0}
                  onChange={(value) => onUpdateField("boosts", {
                    ...targetForm.boosts,
                    [key]: value,
                  })}
                />
              )}
            </div>
          ))}
        </div>

        <div className={`sp-summary${isSpLimitReached ? " is-sp-max" : ""}`}>
          <div className="sp-summary-actions">
            <Button
              variant="ghost"
              size="small"
              className="bulk-maximize-button"
              onClick={onRunBulkMaximize}
              disabled={bulkMaximizeState.status === "running"}
            >
              {bulkMaximizeState.status === "running" ? "計算中..." : "残りSPで耐久最大化"}
            </Button>
            {bulkMaximizeState.status === "running" ? (
              <Button variant="ghost" size="small" onClick={onCancelBulkMaximize}>
                中止
              </Button>
            ) : null}
            <label className="bulk-nature-toggle">
              <input
                type="checkbox"
                checked={allowBulkNatureChange}
                onChange={(event) => onAllowBulkNatureChange(event.target.checked)}
              />
              <span>性格変更を許可する</span>
            </label>
          </div>
          <div className="sp-summary-total">
            <span>合計SP</span>
            <strong>{totalStatPoints} / {CHAMPIONS_TOTAL_STAT_POINTS}</strong>
          </div>
        </div>
        <BulkMaximizeResultPreview
          state={bulkMaximizeState}
          applied={bulkMaximizeApplied}
          onApply={onApplyBulkMaximize}
        />
      </div>
    </section>
  );
}

type StatPointCellBarProps = {
  stat: StatKey;
  value: number;
  markers?: StatPointMarkerRow;
  onChange: (value: number) => void;
};

export function StatPointCellBar({ stat, value, markers, onChange }: StatPointCellBarProps) {
  const pointerIdRef = useRef<number | null>(null);
  const normalizedValue = clampStatPointValue(value);
  const markerDescription = (["red", "blue"] as const).flatMap((marker) => {
    const positions = statPointCells.filter((statPoints) => markers?.[statPoints] === marker);
    if (positions.length === 0) {
      return [];
    }
    return [`${marker === "red" ? "赤" : "青"}マーク位置: ${positions.join("、")} SP`];
  }).join("。") || undefined;

  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
    const nextValue = clampStatPointValue(Math.ceil(ratio * CHAMPIONS_MAX_STAT_POINTS_PER_STAT));
    onChange(nextValue);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    pointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateFromPointer(event);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== event.pointerId) {
      return;
    }
    updateFromPointer(event);
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current === event.pointerId) {
      pointerIdRef.current = null;
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      onChange(clampStatPointValue(normalizedValue + 1));
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      onChange(clampStatPointValue(normalizedValue - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      onChange(0);
    } else if (event.key === "End") {
      event.preventDefault();
      onChange(CHAMPIONS_MAX_STAT_POINTS_PER_STAT);
    }
  };

  return (
    <div
      className={`sp-cell-bar ${stat}`}
      role="slider"
      tabIndex={0}
      aria-label={`${statLabels[stat]} SP配分`}
      aria-valuemin={0}
      aria-valuemax={CHAMPIONS_MAX_STAT_POINTS_PER_STAT}
      aria-valuenow={normalizedValue}
      aria-description={markerDescription}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onKeyDown={handleKeyDown}
    >
      {statPointCells.map((cellValue) => {
        const marker = markers?.[cellValue] ?? null;
        const markerState = marker
          ? cellValue <= normalizedValue ? "reached" : "pending"
          : undefined;
        return (
          <span
            className={cellValue <= normalizedValue ? "active" : ""}
            data-marker={marker ?? undefined}
            data-marker-state={markerState}
            key={cellValue}
            aria-hidden="true"
          />
        );
      })}
    </div>
  );
}

type PokemonArtworkFrameProps = {
  match: PokemonArtworkMatch | null;
  fallbackLabel: string;
  variant: "target" | "attack";
  dynamaxEffect?: boolean;
};

function PokemonArtworkFrame({
  match,
  fallbackLabel,
  variant,
  dynamaxEffect = false,
}: PokemonArtworkFrameProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const canShowImage = match && failedSrc !== match.artworkUrl;
  const fallbackInitial = (fallbackLabel.trim() || "?").slice(0, 1);

  return (
    <div
      className={`pokemon-artwork ${variant}${dynamaxEffect ? " is-dynamax" : ""}`}
      aria-label={match?.label ?? fallbackLabel}
    >
      {canShowImage ? (
        <img
          src={match.artworkUrl}
          alt={match.label}
          loading="lazy"
          decoding="async"
          onError={() => setFailedSrc(match.artworkUrl)}
        />
      ) : (
        <strong>{fallbackInitial}</strong>
      )}
    </div>
  );
}

type ScenarioPanelProps = {
  panelRef?: Ref<HTMLElement>;
  scenarios: ScenarioFormState[];
  attackerActualStats: Record<string, StatTable>;
  targetForm: TargetFormState;
  targetActualStats: StatTable | null;
  onAddScenario: () => void;
  onRemoveScenario: (id: string) => void;
  onToggleScenarioAdjustmentFromDirection: (id: string) => void;
  onUpdateScenario: <K extends keyof ScenarioFormState>(
    id: string,
    key: K,
    value: ScenarioFormState[K],
  ) => void;
  onAddAttack: (scenarioId: string) => string | null;
  onRemoveAttack: (scenarioId: string, attackId: string) => void;
  onUpdateAttack: <K extends keyof ScenarioAttackFormState>(
    scenarioId: string,
    attackId: string,
    key: K,
    value: ScenarioAttackFormState[K],
  ) => void;
  onUpdateAttackerEv: (id: string, key: StatKey, value: number) => void;
  mobileFocusedScenarioId?: string | null;
  mobileFocusedAttackId?: string | null;
  onFocusMobileAttack?: (id: string) => void;
  onShowMobileScenarioList?: () => void;
  isEnemyBoxPanelOpen: boolean;
  onOpenEnemyBoxPanel: () => void;
  onCloseMobileSheet?: () => void;
};

export const getScenarioPanelVisibleScenarios = (
  scenarios: ScenarioFormState[],
  mobileFocusedScenarioId?: string | null,
): ScenarioFormState[] => {
  if (!mobileFocusedScenarioId) {
    return scenarios;
  }

  const focusedScenarios = scenarios.filter((scenario) => scenario.id === mobileFocusedScenarioId);
  return focusedScenarios.length > 0 ? focusedScenarios : scenarios;
};

export const getMobileAttackNavigationTargets = (
  scenario: ScenarioFormState,
  mobileFocusedAttackId?: string | null,
) => {
  if (scenario.attacks.length === 0) {
    return null;
  }

  const requestedIndex = mobileFocusedAttackId
    ? scenario.attacks.findIndex((attack) => attack.id === mobileFocusedAttackId)
    : 0;
  const currentIndex = requestedIndex >= 0 ? requestedIndex : 0;
  const nextIndex = currentIndex + 1;

  return {
    currentIndex,
    currentId: scenario.attacks[currentIndex].id,
    currentLabel: formatScenarioAttackLabel(scenario.adjustmentType, currentIndex, scenario.attacks[currentIndex].label),
    total: scenario.attacks.length,
    previousId: scenario.attacks[currentIndex - 1]?.id ?? null,
    nextId: scenario.attacks[nextIndex]?.id ?? null,
    nextLabel: formatScenarioAttackLabel(scenario.adjustmentType, nextIndex, `攻撃${String.fromCharCode(65 + nextIndex)}`),
  };
};

function ScenarioPanel({
  panelRef,
  scenarios,
  attackerActualStats,
  targetForm,
  targetActualStats,
  onAddScenario,
  onRemoveScenario,
  onToggleScenarioAdjustmentFromDirection,
  onUpdateScenario,
  onAddAttack,
  onRemoveAttack,
  onUpdateAttack,
  onUpdateAttackerEv,
  mobileFocusedScenarioId,
  mobileFocusedAttackId,
  onFocusMobileAttack,
  onShowMobileScenarioList,
  isEnemyBoxPanelOpen,
  onOpenEnemyBoxPanel,
  onCloseMobileSheet,
}: ScenarioPanelProps) {
  const visibleScenarios = getScenarioPanelVisibleScenarios(scenarios, mobileFocusedScenarioId);
  const isMobileFocusedScenario = Boolean(
    mobileFocusedScenarioId && visibleScenarios.length === 1 && visibleScenarios[0].id === mobileFocusedScenarioId,
  );
  const focusedScenario = isMobileFocusedScenario ? visibleScenarios[0] : null;
  const mobileAttackNavigation = focusedScenario
    ? getMobileAttackNavigationTargets(focusedScenario, mobileFocusedAttackId)
    : null;
  const headingLabel = isMobileFocusedScenario ? visibleScenarios[0].label : "仮想敵シナリオ";

  return (
    <section
      ref={panelRef}
      className={`scenario-panel${isMobileFocusedScenario ? " mobile-scenario-detail-panel" : ""}`}
      aria-labelledby="scenario-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="scenario-title">{headingLabel}</h2>
        </div>
        <div className="mobile-sheet-heading-actions">
          <button
            className={`box-access-button${isEnemyBoxPanelOpen ? " active" : ""}`}
            type="button"
            aria-label={isEnemyBoxPanelOpen ? "仮想敵ボックスを閉じる" : "仮想敵ボックスを開く"}
            aria-expanded={isEnemyBoxPanelOpen}
            onClick={onOpenEnemyBoxPanel}
          >
            <img src={getAssetSrc("assets/ui/box.svg")} alt="" aria-hidden="true" />
          </button>
          {isMobileFocusedScenario ? (
            <Button
              variant="ghost"
              size="small"
              className="mobile-sheet-list-button mobile-sheet-icon-button"
              aria-label="一覧"
              onClick={onShowMobileScenarioList}
            >
              <img className="mobile-sheet-action-icon" src={getAssetSrc("assets/ui/list.svg")} alt="" aria-hidden="true" />
            </Button>
          ) : null}
          <button className="mobile-sheet-close mobile-sheet-icon-button" type="button" aria-label="閉じる" onClick={onCloseMobileSheet}>
            <img className="mobile-sheet-action-icon" src={getAssetSrc("assets/ui/close.svg")} alt="" aria-hidden="true" />
          </button>
        </div>
      </div>

      {isMobileFocusedScenario && mobileAttackNavigation ? (
        <div className="mobile-sheet-scenario-nav" aria-label="同一シナリオ内の攻撃移動">
          <Button
            variant="ghost"
            size="small"
            disabled={!mobileAttackNavigation.previousId || !onFocusMobileAttack}
            onClick={() => {
              if (mobileAttackNavigation.previousId) {
                onFocusMobileAttack?.(mobileAttackNavigation.previousId);
              }
            }}
          >
            前へ
          </Button>
          <span>{mobileAttackNavigation.currentIndex + 1} / {mobileAttackNavigation.total}</span>
          <Button
            variant="ghost"
            size="small"
            disabled={!onFocusMobileAttack}
            onClick={() => {
              if (mobileAttackNavigation.nextId) {
                onFocusMobileAttack?.(mobileAttackNavigation.nextId);
                return;
              }

              if (focusedScenario) {
                const nextAttackId = onAddAttack(focusedScenario.id);
                if (nextAttackId) {
                  onFocusMobileAttack?.(nextAttackId);
                }
              }
            }}
          >
            {mobileAttackNavigation.nextId ? "次へ" : "追加"}
          </Button>
        </div>
      ) : null}

      <div className="scenario-stack" aria-label="仮想敵シナリオ行">
        {visibleScenarios.map((scenario) => (
          <ScenarioRow
            key={scenario.id}
            scenario={scenario}
            attackerActualStats={attackerActualStats}
            targetForm={targetForm}
            targetActualStats={targetActualStats}
            onAddAttack={onAddAttack}
            onRemoveAttack={onRemoveAttack}
            onRemoveScenario={onRemoveScenario}
            onToggleScenarioAdjustmentFromDirection={onToggleScenarioAdjustmentFromDirection}
            onUpdateScenario={onUpdateScenario}
            onUpdateAttack={onUpdateAttack}
            onUpdateAttackerEv={onUpdateAttackerEv}
            mobileFocusedAttackId={isMobileFocusedScenario ? mobileAttackNavigation?.currentId ?? null : null}
            hideAttackAddCard={isMobileFocusedScenario}
            hideScenarioRemoveButton={isMobileFocusedScenario}
          />
        ))}
        {isMobileFocusedScenario ? null : (
          <button className="scenario-add-row ui-button" type="button" onClick={onAddScenario}>
            シナリオを追加
          </button>
        )}
      </div>
    </section>
  );
}

type ScenarioRowProps = {
  scenario: ScenarioFormState;
  attackerActualStats: Record<string, StatTable>;
  targetForm: TargetFormState;
  targetActualStats: StatTable | null;
  onAddAttack: (scenarioId: string) => string | null;
  onRemoveAttack: (scenarioId: string, attackId: string) => void;
  onRemoveScenario: (id: string) => void;
  onToggleScenarioAdjustmentFromDirection: (id: string) => void;
  onUpdateScenario: <K extends keyof ScenarioFormState>(
    id: string,
    key: K,
    value: ScenarioFormState[K],
  ) => void;
  onUpdateAttack: <K extends keyof ScenarioAttackFormState>(
    scenarioId: string,
    attackId: string,
    key: K,
    value: ScenarioAttackFormState[K],
  ) => void;
  onUpdateAttackerEv: (id: string, key: StatKey, value: number) => void;
  mobileFocusedAttackId?: string | null;
  hideAttackAddCard?: boolean;
  hideScenarioRemoveButton?: boolean;
};

const scenarioAdjustmentTypeOptions: Array<{ value: ScenarioAdjustmentType; label: string }> = [
  { value: "defence", label: "耐久調整" },
  { value: "offense", label: "火力調整" },
  { value: "speed", label: "素早さ調整" },
];

type ScenarioAdjustmentTypeCardsProps = {
  scenario: ScenarioFormState;
  onChange: (value: ScenarioAdjustmentType) => void;
};

function ScenarioAdjustmentTypeCards({ scenario, onChange }: ScenarioAdjustmentTypeCardsProps) {
  return (
    <div className="scenario-adjustment-cards" role="radiogroup" aria-label={`${scenario.label} 調整種別`}>
      {scenarioAdjustmentTypeOptions.map((option) => (
        <label
          className={`scenario-adjustment-card${scenario.adjustmentType === option.value ? " selected" : ""}`}
          key={option.value}
        >
          <input
            type="radio"
            name={`${scenario.id}-adjustment-type`}
            value={option.value}
            checked={scenario.adjustmentType === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </div>
  );
}

const nextScenarioAdjustmentType = (value: ScenarioAdjustmentType): ScenarioAdjustmentType => {
  switch (value) {
    case "defence":
      return "offense";
    case "offense":
      return "speed";
    case "speed":
    default:
      return "defence";
  }
};

const getScenarioAdjustmentTypeLabel = (value: ScenarioAdjustmentType): string =>
  scenarioAdjustmentTypeOptions.find((option) => option.value === value)?.label ?? value;

function ScenarioRow({
  scenario,
  attackerActualStats,
  targetForm,
  targetActualStats,
  onAddAttack,
  onRemoveAttack,
  onRemoveScenario,
  onToggleScenarioAdjustmentFromDirection,
  onUpdateScenario,
  onUpdateAttack,
  onUpdateAttackerEv,
  mobileFocusedAttackId,
  hideAttackAddCard = false,
  hideScenarioRemoveButton = false,
}: ScenarioRowProps) {
  const isTrickRoomSpeedScenario = scenario.adjustmentType === "speed"
    && scenario.attacks.some((attack) => attack.speedOrderMode === "trick-room");
  const visibleAttacks = mobileFocusedAttackId
    ? scenario.attacks.filter((attack) => attack.id === mobileFocusedAttackId)
    : scenario.attacks;
  const attacksToRender = visibleAttacks.length > 0 ? visibleAttacks : scenario.attacks.slice(0, 1);

  return (
    <article
      className={`scenario-row ${scenario.adjustmentType}${isTrickRoomSpeedScenario ? " trick-room" : ""}${scenario.enabled ? "" : " disabled"}`}
      aria-label={scenario.label}
    >
      <div className="scenario-row-header">
        <div className="scenario-row-title">
          <label className="switch" aria-label={`${scenario.label}を有効化`}>
            <input
              type="checkbox"
              checked={scenario.enabled}
              onChange={(event) => onUpdateScenario(scenario.id, "enabled", event.target.checked)}
            />
            <span />
          </label>
          <input
            className="inline-title-input"
            value={scenario.label}
            aria-label="シナリオ名"
            onChange={(event) => onUpdateScenario(scenario.id, "label", event.target.value)}
          />
        </div>
        <div className={`scenario-row-actions${hideScenarioRemoveButton ? " no-scenario-remove" : ""}`}>
          <ScenarioAdjustmentTypeCards
            scenario={scenario}
            onChange={(value) => onUpdateScenario(scenario.id, "adjustmentType", value)}
          />
          {hideScenarioRemoveButton ? null : (
            <Button
              variant="ghost"
              size="icon"
              className="icon-button scenario-remove-button"
              aria-label={`${scenario.label}を削除`}
              onClick={() => onRemoveScenario(scenario.id)}
            >
              <img className="ui-button-icon" src={getAssetSrc("assets/ui/trash-2.svg")} alt="" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      <div className="scenario-attack-lane">
        {attacksToRender.map((attack) => {
          const attackIndex = scenario.attacks.findIndex((item) => item.id === attack.id);
          return (
            <AttackCard
              key={attack.id}
              attack={attack}
              attackIndex={attackIndex >= 0 ? attackIndex : 0}
              scenarioId={scenario.id}
              adjustmentType={scenario.adjustmentType}
              actualStats={attackerActualStats[`${scenario.id}-${attack.id}-attacker`]}
              targetForm={targetForm}
              targetActualStats={targetActualStats}
              supportsDoublesAttack={scenario.attacks.some((otherAttack) => (
                otherAttack.id !== attack.id &&
                Boolean(otherAttack.moveInput.trim()) &&
                otherAttack.gameType === "doubles"
              ))}
              canRemove={scenario.attacks.length > 1}
              onRemoveAttack={onRemoveAttack}
              onToggleAdjustmentType={() => onToggleScenarioAdjustmentFromDirection(scenario.id)}
              onUpdateAttack={onUpdateAttack}
              onUpdateAttackerEv={onUpdateAttackerEv}
            />
          );
        })}
        {hideAttackAddCard ? null : (
          <button
            className="attack-add-card ui-button"
            type="button"
            aria-label={`${scenario.label}に攻撃を追加`}
            onClick={() => onAddAttack(scenario.id)}
          >
            <span>+</span>
          </button>
        )}
      </div>
    </article>
  );
}

type AttackCardProps = {
  attack: ScenarioAttackFormState;
  attackIndex: number;
  scenarioId: string;
  adjustmentType: ScenarioAdjustmentType;
  actualStats?: StatTable;
  targetForm: TargetFormState;
  targetActualStats: StatTable | null;
  supportsDoublesAttack: boolean;
  canRemove: boolean;
  onRemoveAttack: (scenarioId: string, attackId: string) => void;
  onToggleAdjustmentType: () => void;
  onUpdateAttack: <K extends keyof ScenarioAttackFormState>(
    scenarioId: string,
    attackId: string,
    key: K,
    value: ScenarioAttackFormState[K],
  ) => void;
  onUpdateAttackerEv: (id: string, key: StatKey, value: number) => void;
};

const isHpEventPresetId = (value: string): value is HpEventPresetId =>
  hpEventPresetIds.has(value as HpEventPresetId);

const getHpEventPresetLabel = (effectId: string): string =>
  isHpEventPresetId(effectId) ? hpEventPresetLabels[effectId] : "未対応の効果";

const getHpEventFormulaLabel = (event: HpEventFormState): string => {
  const formula = getHpEventRuleDefinition(event.effectId)?.formulaLabel
    ?? "現在のアプリでは計算されません";
  if (event.effectId === "toxic-damage") {
    return `${formula}（開始${clampNumberInput(event.toxicStage ?? 1, 1, 15)}段階）`;
  }
  if (event.effectId === "spikes-damage") {
    return `${formula}（${clampNumberInput(event.spikesLayers ?? 1, 1, 3)}層）`;
  }
  return formula;
};

const getHpEventRuleTimingLabel = (effectId: string): string => {
  const definition = getHpEventRuleDefinition(effectId);
  if (!definition) {
    return "未対応";
  }
  const timingLabel = hpEventTimingLabels[definition.timing] ?? definition.timing;
  return `${timingLabel}・${hpEventFrequencyLabels[definition.frequency]}`;
};

const getHpEventAutomaticSubjectLabel = (
  effectId: string,
  adjustmentType: ScenarioAdjustmentType,
): string => {
  const definition = getHpEventRuleDefinition(effectId);
  if (!definition) {
    return "未対応";
  }

  const subjectLabel = getHpEventSubjectLabel(definition.subject, adjustmentType);
  const roleLabel = definition.subject === "attacker" ? "技使用者" : "被弾側";
  return `${subjectLabel}（${roleLabel}）`;
};

type HpEventsEditorProps = {
  attack: ScenarioAttackFormState;
  adjustmentType: ScenarioAdjustmentType;
  scenarioId: string;
  targetForm: TargetFormState;
  onUpdateAttack: AttackCardProps["onUpdateAttack"];
};

function HpEventsEditor({
  attack,
  adjustmentType,
  scenarioId,
  targetForm,
  onUpdateAttack,
}: HpEventsEditorProps) {
  const [presetId, setPresetId] = useState<HpEventPresetId>("life-orb-recoil");
  const hpEvents = attack.hpEvents ?? [];
  const hasHpDependentMoveCalculation = hasHpDependentMoveCalculationFromForm(
    attack,
    adjustmentType,
    targetForm,
    scenarioId,
  );

  const updateEvents = (nextEvents: HpEventFormState[]) => {
    onUpdateAttack(scenarioId, attack.id, "hpEvents", nextEvents);
  };

  const addEvent = () => {
    const nextEvent: HpEventFormState = {
      id: `hp-event-${Date.now()}-${hpEvents.length}`,
      effectId: presetId,
      enabled: true,
      ...(presetId === "toxic-damage" ? { toxicStage: 1 } : {}),
      ...(presetId === "spikes-damage" ? { spikesLayers: 1 } : {}),
    };

    updateEvents([...hpEvents, nextEvent]);
    if (presetId === "sandstorm-damage" && attack.weather !== "sand") {
      onUpdateAttack(scenarioId, attack.id, "weather", "sand");
    }
    const statusByEffect: Partial<Record<HpEventPresetId, PokemonStatus>> = {
      "poison-damage": "psn",
      "toxic-damage": "tox",
      "burn-damage": "brn",
    };
    const status = statusByEffect[presetId];
    if (status) {
      const statusKey = adjustmentType === "offense" ? "attackerStatus" : "defenderStatus";
      onUpdateAttack(scenarioId, attack.id, statusKey, status);
    }
  };

  return (
    <details className="attack-advanced-settings hp-events-settings">
      <summary>
        <ChevronRightIcon className="disclosure-chevron" />
        <span>定数ダメージ・回復</span>
        {hpEvents.length > 0 ? (
          <span className="active-adjustment-count">{hpEvents.length}件</span>
        ) : (
          <span className="active-adjustment-empty">なし</span>
        )}
      </summary>
      <div className="attack-advanced-content hp-events-content">
        {hpEvents.length > 0 ? (
          <ol className="hp-event-list">
            {hpEvents.map((hpEvent) => {
              const supported = isHpEventPresetId(hpEvent.effectId);
              const moveUserItemInput = adjustmentType === "offense"
                ? targetForm.itemInput
                : attack.attackerItemInput;
              const moveDefenderItemInput = adjustmentType === "offense"
                ? attack.attackerItemInput
                : targetForm.itemInput;
              const moveDefenderAbilityInput = adjustmentType === "offense"
                ? attack.attackerAbilityInput
                : targetForm.abilityInput;
              const moveDefenderStatus = adjustmentType === "offense"
                ? attack.attackerStatus
                : attack.defenderStatus;
              const hasLifeOrb = resolveCanonicalEntityName("item", moveUserItemInput) === "Life Orb";
              const defenderItem = resolveCanonicalEntityName("item", moveDefenderItemInput);
              const defenderAbility = resolveCanonicalEntityName("ability", moveDefenderAbilityInput);
              const mismatchMessage = !supported
                ? `未対応の効果です: ${hpEvent.effectId}`
                : hpEvent.effectId === "life-orb-recoil" && !hasLifeOrb
                  ? "技使用者の持ち物が「いのちのたま」ではありません。発動前提で計算します"
                  : hpEvent.effectId === "sandstorm-damage" && attack.weather !== "sand"
                    ? "天候が「砂」ではありません。発動前提で計算します"
                    : hpEvent.effectId === "poison-damage" && moveDefenderStatus !== "psn"
                      ? "効果対象が通常の「どく」状態ではありません。発動前提で計算します"
                      : hpEvent.effectId === "toxic-damage" && moveDefenderStatus !== "tox"
                        ? "効果対象が「もうどく」状態ではありません。発動前提で計算します"
                        : hpEvent.effectId === "burn-damage" && moveDefenderStatus !== "brn"
                          ? "効果対象が「やけど」状態ではありません。発動前提で計算します"
                          : hpEvent.effectId === "sitrus-berry-heal" && defenderItem !== "Sitrus Berry"
                            ? "効果対象の持ち物が「オボンのみ」ではありません。発動前提で計算します"
                            : hpEvent.effectId === "leftovers-heal" && defenderItem !== "Leftovers"
                              ? "効果対象の持ち物が「たべのこし」ではありません。発動前提で計算します"
                              : hpEvent.effectId === "rocky-helmet-damage" && defenderItem !== "Rocky Helmet"
                                ? "被弾側の持ち物が「ゴツゴツメット」ではありません。発動前提で計算します"
                                : hpEvent.effectId === "rough-skin-damage"
                                  && defenderAbility !== "Rough Skin"
                                  && defenderAbility !== "Iron Barbs"
                                  ? "被弾側の特性が「さめはだ／てつのトゲ」ではありません。発動前提で計算します"
                                  : null;

              return (
                <li className={`hp-event-row${supported ? "" : " unsupported"}`} key={hpEvent.id}>
                  <div className="hp-event-row-heading">
                    <label className="hp-event-enable">
                      <input
                        type="checkbox"
                        checked={supported && hpEvent.enabled}
                        disabled={!supported}
                        onChange={(event) => updateEvents(hpEvents.map((candidate) => (
                          candidate.id === hpEvent.id
                            ? { ...candidate, enabled: event.target.checked }
                            : candidate
                        )))}
                      />
                      <span>{getHpEventPresetLabel(hpEvent.effectId)}</span>
                    </label>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="icon-button scenario-remove-button hp-event-remove-button"
                      aria-label={`${supported ? getHpEventPresetLabel(hpEvent.effectId) : hpEvent.effectId || "未対応の効果"}を削除`}
                      onClick={() => updateEvents(hpEvents.filter((candidate) => candidate.id !== hpEvent.id))}
                    >
                      <img className="ui-button-icon" src={getAssetSrc("assets/ui/trash-2.svg")} alt="" aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="hp-event-rule-meta">
                    <small>
                      <strong>対象</strong>
                      <span>{getHpEventAutomaticSubjectLabel(hpEvent.effectId, adjustmentType)}</span>
                    </small>
                    <small>
                      <strong>発動</strong>
                      <span>{getHpEventRuleTimingLabel(hpEvent.effectId)}</span>
                    </small>
                  </div>
                  {hpEvent.effectId === "toxic-damage" ? (
                    <label className="hp-event-parameter">
                      <span>開始段階</span>
                      <NumberStepper
                        label="もうどく開始段階"
                        value={hpEvent.toxicStage ?? 1}
                        min={1}
                        max={15}
                        onChange={(value) => updateEvents(hpEvents.map((candidate) => (
                          candidate.id === hpEvent.id
                            ? { ...candidate, toxicStage: value }
                            : candidate
                        )))}
                      />
                    </label>
                  ) : null}
                  {hpEvent.effectId === "spikes-damage" ? (
                    <label className="hp-event-parameter">
                      <span>層数</span>
                      <NumberStepper
                        label="まきびしの層数"
                        value={hpEvent.spikesLayers ?? 1}
                        min={1}
                        max={3}
                        onChange={(value) => updateEvents(hpEvents.map((candidate) => (
                          candidate.id === hpEvent.id
                            ? { ...candidate, spikesLayers: value }
                            : candidate
                        )))}
                      />
                    </label>
                  ) : null}
                  <small className="hp-event-formula">{getHpEventFormulaLabel(hpEvent)}</small>
                  {mismatchMessage ? <small className="hp-event-warning">{mismatchMessage}</small> : null}
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="hp-events-empty">追加した効果はありません</p>
        )}
        {hasHpDependentMoveCalculation ? (
          <p className="hp-dependent-move-note">
            HP依存技は、変化後のHPから自動計算されます。
          </p>
        ) : null}
        <div className="hp-event-add-row">
          <SelectField
            compact
            label="追加する効果"
            value={presetId}
            options={hpEventPresetOptions}
            onChange={setPresetId}
          />
          <Button variant="ghost" size="small" onClick={addEvent}>
            追加
          </Button>
        </div>
        <p className="hp-event-help">
          対象・発動順・頻度などの詳しい仕様は
          <a
            href="/guide/#constant-damage"
          >
            ガイドの定数ダメージ・回復
          </a>
          を確認してください。
        </p>
      </div>
    </details>
  );
}

type MovePowerFieldProps = {
  attackLabel: string;
  hasMove: boolean;
  mode: MovePowerMode;
  value: number;
  evaluation?: MovePowerEvaluation;
  catalogEntry?: MovePowerCatalogEntry;
  assistRule?: MovePowerAssistRule;
  hpDependent: boolean;
  manualAllowed: boolean;
  unsupported: boolean;
  onCommit: (mode: MovePowerMode, value: number) => void;
};

type LevelLockFieldProps = {
  ownerLabel: string;
  className: string;
  labelClassName?: string;
  mode: LevelInputMode;
  value: number;
  onModeChange: (mode: LevelInputMode) => void;
  onChange: (value: number) => void;
};

function LevelLockField({
  ownerLabel,
  className,
  labelClassName,
  mode,
  value,
  onModeChange,
  onChange,
}: LevelLockFieldProps) {
  const isManual = mode === "manual";

  return (
    <div className={className}>
      <span className={labelClassName}>レベル</span>
      <div className={`move-power-inline-control level-inline-control ${isManual ? "is-manual" : "is-automatic"}`}>
        {isManual ? (
          <input
            {...numericInputProps}
            value={value}
            min={1}
            max={100}
            aria-label="レベル"
            onFocus={selectInputValueOnFocus}
            onChange={(event) => onChange(clampNumberInput(toNumber(event.target.value, 50), 1, 100))}
          />
        ) : (
          <strong>{value}</strong>
        )}
        <button
          className={`move-power-lock-toggle ${isManual ? "is-open" : "is-closed"}`}
          type="button"
          aria-label={isManual
            ? `${ownerLabel} レベルを50に戻して固定`
            : `${ownerLabel} レベルの固定を解除`}
          onClick={() => onModeChange(isManual ? "auto" : "manual")}
        >
          <img
            src={getAssetSrc(isManual ? "assets/ui/lock-open.svg" : "assets/ui/lock.svg")}
            alt=""
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
}

const isValidManualMovePower = (value: number): boolean =>
  Number.isInteger(value) && value >= 1 && value <= 10_000;

type BeatUpPowerFieldProps = {
  attackLabel: string;
  attackerPokemonInput: string;
  participants: BeatUpParticipantFormState[];
  gameType: GameType;
  evaluation?: MovePowerEvaluation;
  onChange: (participants: BeatUpParticipantFormState[]) => void;
};

const getBeatUpParticipantPower = (
  participant: BeatUpParticipantFormState,
  attackerPokemonInput: string,
): number | undefined => {
  if (participant.powerMode === "manual" && isValidManualMovePower(participant.powerValue)) {
    return participant.powerValue;
  }
  const pokemonInput = participant.source === "attacker"
    ? attackerPokemonInput
    : participant.pokemonInput;
  const canonicalName = resolveCanonicalEntityName("pokemon", pokemonInput);
  return canonicalName ? getBeatUpBasePowerForPokemon(canonicalName) : undefined;
};

function BeatUpPowerField({
  attackLabel,
  attackerPokemonInput,
  participants,
  gameType,
  evaluation,
  onChange,
}: BeatUpPowerFieldProps) {
  const limit = getBeatUpParticipantLimit(gameType);
  const displayedPowers = evaluation?.perHitBasePowers
    ?? participants.map((participant) => getBeatUpParticipantPower(
      participant,
      attackerPokemonInput,
    ));
  const compactPower = displayedPowers.length > 0
    ? displayedPowers.map((power) => power ?? "?").join("/")
    : "—";
  const updateParticipant = (
    index: number,
    patch: Partial<BeatUpParticipantFormState>,
  ) => onChange(participants.map((participant, participantIndex) => (
    participantIndex === index ? { ...participant, ...patch } : participant
  )));
  const moveParticipant = (index: number, offset: -1 | 1) => {
    const nextIndex = index + offset;
    if (nextIndex < 0 || nextIndex >= participants.length) {
      return;
    }
    const nextParticipants = [...participants];
    [nextParticipants[index], nextParticipants[nextIndex]] = [
      nextParticipants[nextIndex],
      nextParticipants[index],
    ];
    onChange(nextParticipants);
  };
  const removeParticipant = (index: number) => {
    if (participants[index]?.source === "attacker") {
      return;
    }
    onChange(participants.filter((_participant, participantIndex) => participantIndex !== index));
  };
  const addParticipant = () => {
    if (participants.length >= limit) {
      return;
    }
    onChange([...participants, {
      id: `beat-up-party-${Date.now()}-${participants.length}`,
      source: "party",
      pokemonInput: "",
      powerMode: "auto",
      powerValue: 0,
    }]);
  };

  return (
    <div className="move-power-field beat-up-power-field" role="group" aria-label={`${attackLabel} 威力`}>
      <span className="move-power-label">威力</span>
      <UiPopover.Root>
        <UiPopover.Trigger asChild>
          <button
            className="move-power-trigger"
            type="button"
            aria-label={`${attackLabel} ふくろだたき参加ポケモンを設定。威力 ${compactPower}`}
          >
            <strong className={compactPower.length >= 7 ? "long" : undefined}>{compactPower}</strong>
          </button>
        </UiPopover.Trigger>
        <UiPopover.Portal>
          <UiPopover.Content
            className="move-power-popover beat-up-popover"
            sideOffset={6}
            align="end"
            collisionPadding={8}
            aria-label={`${attackLabel} ふくろだたき参加ポケモン`}
          >
            <div className="beat-up-popover-header">
              <strong>参加ポケモン</strong>
              <span>{participants.length} / {limit}</span>
            </div>
            <ol className="beat-up-participant-list">
              {participants.map((participant, index) => {
                const automaticPower = getBeatUpParticipantPower(
                  { ...participant, powerMode: "auto", powerValue: 0 },
                  attackerPokemonInput,
                );
                const isManual = participant.powerMode === "manual";
                return (
                  <li className="beat-up-participant-row" key={participant.id}>
                    <div className="beat-up-order-controls" aria-label={`${index + 1}番目の並び順`}>
                      <button
                        type="button"
                        aria-label={`${index + 1}番目を前へ`}
                        disabled={index === 0}
                        onClick={() => moveParticipant(index, -1)}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`${index + 1}番目を後ろへ`}
                        disabled={index === participants.length - 1}
                        onClick={() => moveParticipant(index, 1)}
                      >
                        ↓
                      </button>
                    </div>
                    <div className="beat-up-participant-pokemon">
                      {participant.source === "attacker" ? (
                        <span className="beat-up-attacker-label">
                          <strong>{attackerPokemonInput || "使用者"}</strong>
                          <small>使用者</small>
                        </span>
                      ) : (
                        <ScenarioTextField
                          kind="pokemon"
                          label={`参加ポケモン${index + 1}`}
                          showLabel={false}
                          value={participant.pokemonInput}
                          onChange={(event) => updateParticipant(index, { pokemonInput: event.target.value })}
                          onSelectValue={(pokemonInput) => updateParticipant(index, { pokemonInput })}
                        />
                      )}
                    </div>
                    <div className={`move-power-inline-control beat-up-participant-power ${isManual ? "is-manual" : "is-automatic"}`}>
                      {isManual ? (
                        <input
                          {...numericInputProps}
                          value={participant.powerValue}
                          min={1}
                          max={10_000}
                          aria-label={`${index + 1}番目の任意威力`}
                          onFocus={selectInputValueOnFocus}
                          onChange={(event) => updateParticipant(index, {
                            powerValue: clampNumberInput(toNumber(event.target.value, 1), 1, 10_000),
                          })}
                        />
                      ) : (
                        <strong>{automaticPower ?? "?"}</strong>
                      )}
                      <button
                        className={`move-power-lock-toggle ${isManual ? "is-open" : "is-closed"}`}
                        type="button"
                        disabled={!isManual && automaticPower === undefined}
                        aria-label={isManual
                          ? `${index + 1}番目の威力を自動入力に戻す`
                          : `${index + 1}番目の威力の自動入力を解除`}
                        onClick={() => updateParticipant(index, isManual
                          ? { powerMode: "auto", powerValue: 0 }
                          : { powerMode: "manual", powerValue: automaticPower ?? 1 })}
                      >
                        <img
                          src={getAssetSrc(isManual ? "assets/ui/lock-open.svg" : "assets/ui/lock.svg")}
                          alt=""
                          aria-hidden="true"
                        />
                      </button>
                    </div>
                    <button
                      className="beat-up-remove-participant"
                      type="button"
                      aria-label={`${index + 1}番目の参加ポケモンを削除`}
                      disabled={participant.source === "attacker"}
                      onClick={() => removeParticipant(index)}
                    >
                      <img src={getAssetSrc("assets/ui/trash-2.svg")} alt="" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ol>
            <Button
              variant="ghost"
              size="small"
              disabled={participants.length >= limit}
              onClick={addParticipant}
            >
              参加ポケモンを追加
            </Button>
            <UiPopover.Arrow className="move-power-popover-arrow" />
          </UiPopover.Content>
        </UiPopover.Portal>
      </UiPopover.Root>
    </div>
  );
}

function MovePowerField({
  attackLabel,
  hasMove,
  mode,
  value,
  evaluation,
  catalogEntry,
  assistRule,
  hpDependent,
  manualAllowed,
  unsupported,
  onCommit,
}: MovePowerFieldProps) {
  const defaultPower = assistRule?.defaultPower ?? 0;
  const selectedPower = mode === "assisted" && isValidManualMovePower(value)
    ? value
    : defaultPower;
  const selectedOptionIndex = Math.max(
    0,
    assistRule?.options.findIndex((option) => option.power === selectedPower) ?? 0,
  );
  const selectedOption = assistRule?.options[selectedOptionIndex];
  const [showManualEditor, setShowManualEditor] = useState(mode === "manual");
  const manualErrorId = useId();
  const [manualDraft, setManualDraft] = useState(String(
    mode === "manual" && isValidManualMovePower(value)
      ? value
      : selectedOption?.power ?? 1,
  ));

  useEffect(() => {
    if (mode === "manual" && isValidManualMovePower(value)) {
      setManualDraft(String(value));
      setShowManualEditor(true);
    } else {
      setShowManualEditor(false);
    }
  }, [mode, value]);

  const compactPower = (() => {
    if (evaluation?.source === "status") {
      return "—";
    }
    if (evaluation?.source === "fixed-damage") {
      return "固定";
    }
    if (unsupported || evaluation?.source === "unsupported") {
      return "個別";
    }
    if (evaluation?.perHitBasePowers && evaluation.perHitBasePowers.length > 1) {
      const uniquePowers = new Set(evaluation.perHitBasePowers);
      return uniquePowers.size > 1
        ? evaluation.perHitBasePowers.join("/")
        : `${evaluation.perHitBasePowers[0]}×${evaluation.perHitBasePowers.length}`;
    }
    if (evaluation?.appliedBasePower !== undefined) {
      return String(evaluation.appliedBasePower);
    }
    if ((mode === "assisted" || mode === "manual") && isValidManualMovePower(value)) {
      return String(value);
    }
    if (assistRule) {
      return String(selectedOption?.power ?? assistRule.defaultPower);
    }
    if (catalogEntry?.category === "Status") {
      return "—";
    }
    if ((catalogEntry?.basePower ?? 0) > 0) {
      return String(catalogEntry?.basePower);
    }
    if (hpDependent) {
      return "自動";
    }
    return hasMove ? "自動" : "—";
  })();

  const summary = (() => {
    if (evaluation) {
      return formatMovePowerEvaluation(evaluation, { hpDependent });
    }
    if (unsupported) {
      return "個別威力（現在の計算には未対応）";
    }
    if (mode === "manual" && isValidManualMovePower(value)) {
      return `威力 ${value}（手動・計算前）`;
    }
    if (assistRule) {
      return `威力 ${selectedOption?.power ?? assistRule.defaultPower}（条件: ${selectedOption?.label ?? "基本値"}）`;
    }
    if (catalogEntry?.category === "Status") {
      return "変化技（数値威力なし）";
    }
    if (hpDependent) {
      return (catalogEntry?.basePower ?? 0) > 0
        ? `HP依存威力（満タン時 ${catalogEntry?.basePower}・各攻撃直前に自動計算）`
        : "HP依存威力（各攻撃直前に自動計算）";
    }
    if ((catalogEntry?.basePower ?? 0) > 0) {
      return `威力 ${catalogEntry?.basePower}（基礎値・計算前）`;
    }
    return hasMove
      ? "計算条件が揃うと、実際に使う威力を表示します。"
      : "技を選ぶと威力を表示します。";
  })();
  const summaryForAria = summary.replace(/。$/u, "");
  const manualValue = Number(manualDraft);
  const manualValueIsValid = isValidManualMovePower(manualValue);
  const canStepDown = Boolean(assistRule && selectedOptionIndex > 0 && mode !== "manual");
  const canStepUp = Boolean(
    assistRule
    && selectedOptionIndex < assistRule.options.length - 1
    && mode !== "manual",
  );
  const commitOption = (index: number) => {
    const option = assistRule?.options[index];
    if (option) {
      onCommit("assisted", option.power);
    }
  };
  const automaticPowerForUnlock = evaluation?.appliedBasePower
    ?? ((catalogEntry?.basePower ?? 0) > 0 ? catalogEntry?.basePower : undefined);
  const canUseInlinePowerLock = Boolean(
    manualAllowed
    && !assistRule
    && automaticPowerForUnlock !== undefined
    && isValidManualMovePower(automaticPowerForUnlock)
    && evaluation?.source !== "fixed-damage"
    && evaluation?.source !== "status"
    && evaluation?.source !== "unsupported"
    && catalogEntry?.category !== "Status"
    && !unsupported,
  );
  const updateInlineManualDraft = (nextDraft: string) => {
    setManualDraft(nextDraft);
    const nextValue = Number(nextDraft);
    if (isValidManualMovePower(nextValue)) {
      onCommit("manual", nextValue);
    }
  };
  const unlockInlineManualPower = () => {
    const nextValue = automaticPowerForUnlock;
    if (nextValue !== undefined && isValidManualMovePower(nextValue)) {
      setManualDraft(String(nextValue));
      onCommit("manual", nextValue);
    }
  };
  const restoreAutomaticPower = () => {
    onCommit("auto", 0);
  };
  const assistedPowerTrigger = (
    <UiPopover.Trigger asChild>
      <button
        className="move-power-trigger"
        type="button"
        aria-label={`${attackLabel} ${summaryForAria}。条件を開く`}
      >
        <strong className={compactPower.length >= 7 ? "long" : undefined}>{compactPower}</strong>
      </button>
    </UiPopover.Trigger>
  );

  return (
    <div
      className={`move-power-field${assistRule && mode !== "manual" ? " steppable" : ""}`}
      role="group"
      aria-label={`${attackLabel} 威力`}
    >
      <span className="move-power-label">威力</span>
      {assistRule ? (
        <UiPopover.Root
          onOpenChange={(open) => {
            if (open) {
              setShowManualEditor(mode === "manual");
              setManualDraft(String(
                mode === "manual" && isValidManualMovePower(value)
                  ? value
                  : selectedOption?.power ?? 1,
              ));
            }
          }}
        >
          <div className="move-power-control">
            {mode !== "manual" ? (
              <StepperControl
                className="move-power-condition-stepper"
                ariaLabel={`${attackLabel} 威力条件ステッパー`}
                lowerAction={{
                  ariaLabel: `${attackLabel} 威力条件を下げる${canStepDown ? `: ${assistRule.options[selectedOptionIndex - 1]?.label}` : ""}`,
                  disabled: !canStepDown,
                  onClick: () => commitOption(selectedOptionIndex - 1),
                }}
                upperAction={{
                  ariaLabel: `${attackLabel} 威力条件を上げる${canStepUp ? `: ${assistRule.options[selectedOptionIndex + 1]?.label}` : ""}`,
                  disabled: !canStepUp,
                  onClick: () => commitOption(selectedOptionIndex + 1),
                }}
              >
                {assistedPowerTrigger}
              </StepperControl>
            ) : assistedPowerTrigger}
          </div>
          <UiPopover.Portal>
            <UiPopover.Content
              className="move-power-popover"
              sideOffset={6}
              align="end"
              collisionPadding={8}
              aria-label={`${attackLabel} 威力条件`}
            >
              <div className="move-power-option-group" aria-label={`${attackLabel} 威力条件`}>
                {assistRule.options.map((option, optionIndex) => (
                  <UiPopover.Close asChild key={`${option.power}-${option.label}`}>
                    <button
                      className={`move-power-option${mode !== "manual" && optionIndex === selectedOptionIndex ? " selected" : ""}`}
                      type="button"
                      aria-pressed={mode !== "manual" && optionIndex === selectedOptionIndex}
                      onClick={() => onCommit("assisted", option.power)}
                    >
                      <strong>{option.power}</strong>
                      <span>{option.label}</span>
                    </button>
                  </UiPopover.Close>
                ))}
              </div>
              <div className="move-power-manual">
                {showManualEditor ? (
                  <>
                    <label>
                      <span>任意の威力</span>
                      <input
                        {...numericInputProps}
                        value={manualDraft}
                        min={1}
                        max={10_000}
                        aria-label={`${attackLabel} 任意威力`}
                        aria-invalid={!manualValueIsValid}
                        aria-describedby={!manualValueIsValid ? manualErrorId : undefined}
                        onFocus={selectInputValueOnFocus}
                        onChange={(event) => setManualDraft(event.target.value)}
                      />
                    </label>
                    <div className="move-power-manual-actions">
                      <Button
                        variant="ghost"
                        size="small"
                        onClick={() => {
                          onCommit("assisted", selectedOption?.power ?? defaultPower);
                          setShowManualEditor(false);
                        }}
                      >
                        条件指定に戻す
                      </Button>
                      <UiPopover.Close asChild>
                        <Button
                          variant="primary"
                          size="small"
                          disabled={!manualValueIsValid}
                          onClick={() => onCommit("manual", manualValue)}
                        >
                          適用
                        </Button>
                      </UiPopover.Close>
                    </div>
                    {!manualValueIsValid ? (
                      <small id={manualErrorId} role="alert">1〜10000の整数で入力してください。</small>
                    ) : null}
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => {
                      setManualDraft(String(
                        selectedOption?.power ?? (isValidManualMovePower(value) ? value : 1),
                      ));
                      setShowManualEditor(true);
                    }}
                  >
                    任意の威力を入力
                  </Button>
                )}
              </div>
              <UiPopover.Arrow className="move-power-popover-arrow" />
            </UiPopover.Content>
          </UiPopover.Portal>
        </UiPopover.Root>
      ) : canUseInlinePowerLock ? (
        mode === "manual" ? (
          <div className="move-power-inline-control is-manual">
            <input
              {...numericInputProps}
              value={manualDraft}
              min={1}
              max={10_000}
              aria-label={`${attackLabel} 任意威力`}
              aria-invalid={!manualValueIsValid}
              onFocus={selectInputValueOnFocus}
              onChange={(event) => updateInlineManualDraft(event.target.value)}
              onBlur={() => {
                if (!manualValueIsValid) {
                  setManualDraft(String(value));
                }
              }}
            />
            <button
              className="move-power-lock-toggle is-open"
              type="button"
              aria-label={`${attackLabel} 威力を自動入力に戻す`}
              title="自動入力に戻す"
              onClick={restoreAutomaticPower}
            >
              <img src={getAssetSrc("assets/ui/lock-open.svg")} alt="" aria-hidden="true" />
            </button>
          </div>
        ) : (
          <div className="move-power-inline-control is-automatic">
            <strong className={compactPower.length >= 7 ? "long" : undefined}>{compactPower}</strong>
            <button
              className="move-power-lock-toggle is-closed"
              type="button"
              aria-label={`${attackLabel} 威力の自動入力を解除`}
              title="手動入力へ切り替え"
              onClick={unlockInlineManualPower}
            >
              <img src={getAssetSrc("assets/ui/lock.svg")} alt="" aria-hidden="true" />
            </button>
          </div>
        )
      ) : (
        <div className="move-power-inline-control is-readonly" aria-label={summaryForAria}>
          <strong className={compactPower.length >= 7 ? "long" : undefined}>{compactPower}</strong>
        </div>
      )}
    </div>
  );
}

type SpeedMultiplierControlProps = {
  label: string;
  ariaLabel: string;
  value: SpeedManualMultiplier;
  onChange: (value: SpeedManualMultiplier) => void;
};

function SpeedMultiplierControl({
  label,
  ariaLabel,
  value,
  onChange,
}: SpeedMultiplierControlProps) {
  const isManual = value !== "auto";

  return (
    <div className={`speed-multiplier-control${isManual ? " is-manual" : ""}`}>
      <SelectField
        label={label}
        ariaLabel={isManual ? `${ariaLabel} 手動` : ariaLabel}
        value={value}
        options={speedMultiplierOptions}
        onChange={onChange}
        valueBadge={isManual ? <span className="speed-manual-badge">手動</span> : undefined}
      />
    </div>
  );
}

function AttackCard({
  attack,
  attackIndex,
  scenarioId,
  adjustmentType,
  actualStats,
  targetForm,
  targetActualStats,
  supportsDoublesAttack,
  canRemove,
  onRemoveAttack,
  onToggleAdjustmentType,
  onUpdateAttack,
  onUpdateAttackerEv,
}: AttackCardProps) {
  const onInput = <K extends keyof ScenarioAttackFormState>(key: K) => (
    event: ChangeEvent<HTMLInputElement>,
  ) => onUpdateAttack(scenarioId, attack.id, key, event.target.value as ScenarioAttackFormState[K]);
  const isOffenseAdjustment = adjustmentType === "offense";
  const isSpeedAdjustment = adjustmentType === "speed";
  const isManualSpeedTarget = attack.speedTargetMode === "manual";
  const isTrickRoomSpeed = attack.speedOrderMode === "trick-room";
  const speedPrimaryConditionLabel = isTrickRoomSpeed ? "確定トリル先制" : "確定抜き";
  const attackLabel = formatScenarioAttackLabel(adjustmentType, attackIndex, attack.label);
  const adjustmentDirection = isOffenseAdjustment ? "right" : isSpeedAdjustment ? "speed" : "left";
  const directionIconPath = isSpeedAdjustment
    ? isTrickRoomSpeed
      ? "assets/ui/arrow-down-circle.svg"
      : "assets/ui/arrow-up-circle.svg"
    : isOffenseAdjustment
      ? "assets/ui/arrow-right-circle.svg"
      : "assets/ui/arrow-left-circle.svg";
  const nextAdjustmentLabel = getScenarioAdjustmentTypeLabel(nextScenarioAdjustmentType(adjustmentType));
  const currentAdjustmentLabel = getScenarioAdjustmentTypeLabel(adjustmentType);
  const isAbilitySupport = isAbilitySupportCard(
    adjustmentType,
    attack.moveInput,
    attack.attackerAbilityInput,
  );
  const attackerArtwork = findPokemonArtwork({ input: attack.attackerPokemonInput });
  const attackerCanonicalPokemon = resolveCanonicalEntityName("pokemon", attack.attackerPokemonInput);
  const targetCanonicalPokemon = resolveCanonicalEntityName("pokemon", targetForm.pokemonInput);
  const suggestionRankingOwners = getAttackSuggestionRankingOwners(
    adjustmentType,
    targetCanonicalPokemon,
    attackerCanonicalPokemon,
  );
  const pokemonAbilityOptions = getPokemonAbilityInputOptions(attackerCanonicalPokemon);
  const moveOptions = useUsageSuggestionOptions(
    "move",
    attack.moveInput,
    suggestionRankingOwners.move,
  );
  const attackerAbilityOptions = useUsageSuggestionOptions(
    "ability",
    attack.attackerAbilityInput,
    suggestionRankingOwners.ability,
    pokemonAbilityOptions ?? getEntityInputOptions("ability"),
  );
  const attackerItemOptions = useUsageSuggestionOptions(
    "item",
    attack.attackerItemInput,
    suggestionRankingOwners.item,
  );
  const statReferencePlan = getMoveStatReferencePlan(attack.moveInput, {
    teraEnabled: isOffenseAdjustment ? targetForm.teraEnabled : attack.attackerTeraEnabled,
  });
  const targetReferenceKeySet = new Set(statReferencePlan.references
    .filter((reference) => reference.owner === "target")
    .map((reference) => reference.stat));
  const targetReferenceKeys = Array.from(targetReferenceKeySet);
  const moveStatReferenceOptions = {
    teraEnabled: isOffenseAdjustment ? targetForm.teraEnabled : attack.attackerTeraEnabled,
  };
  const offenseDefenderStatKeys = getOffenseDefenderStatKeysFromMoveContext(
    attack.moveInput,
    moveStatReferenceOptions,
    targetReferenceKeySet,
  );
  const defenderRankKeys = Array.from(new Set<Exclude<StatKey, "hp">>([
    "def",
    "spd",
    ...targetReferenceKeys.filter((key): key is Exclude<StatKey, "hp"> => key !== "hp"),
  ]));
  const moveCanonicalName = resolveCanonicalEntityName("move", attack.moveInput);
  const isBeatUp = moveCanonicalName === BEAT_UP_CANONICAL_NAME;
  const movePowerAssistRule = moveCanonicalName
    ? getMovePowerAssistRule(moveCanonicalName)
    : undefined;
  const hpDependentMovePower = moveCanonicalName
    ? isCurrentHpDependentMoveCanonicalName(moveCanonicalName)
    : false;
  const movePowerEvaluation = useMemo(() => {
    const preview = buildMovePowerPreviewInputFromUi(targetForm, adjustmentType, attack);
    if (!preview) {
      return undefined;
    }
    try {
      return calculateSmogonHit(preview.defenderBuild, preview.hit, preview.field).movePower;
    } catch {
      return undefined;
    }
  }, [adjustmentType, attack, targetForm]);
  const opponentSpeedModifierSources = useMemo(() => {
    if (!isSpeedAdjustment || isManualSpeedTarget) {
      return { item: undefined, ability: undefined };
    }

    try {
      const sources = getAutomaticSpeedModifierSources(
        buildScenarioAttackBuildFromUi(attack, "speed-opponent-source"),
        {
          gameType: attack.gameType,
          weather: attack.weather,
          terrain: attack.terrain,
        },
      );
      return { item: sources.item, ability: sources.ability };
    } catch {
      return { item: undefined, ability: undefined };
    }
  }, [attack, isManualSpeedTarget, isSpeedAdjustment]);
  const opponentItemSpeedOverridden = isSpeedAdjustment
    && attack.speedItemMultiplier !== "auto"
    && Boolean(opponentSpeedModifierSources.item);
  const opponentAbilitySpeedOverridden = isSpeedAdjustment
    && attack.speedAbilityMultiplier !== "auto"
    && Boolean(opponentSpeedModifierSources.ability);
  const opponentItemSpeedOverrideDescription = opponentItemSpeedOverridden
    ? "この素早さ条件では持ち物のS補正を手動倍率に上書き中"
    : undefined;
  const opponentAbilitySpeedOverrideDescription = opponentAbilitySpeedOverridden
    ? "この素早さ条件では特性のS補正を手動倍率に上書き中"
    : undefined;
  const speedOpponentStatSection = (
    <section className="attack-stat-section attack-setting-section-body speed-opponent-stat-section" aria-label={`${attackLabel} 相手S能力`}>
      <div className="ev-table attacker-stat-table speed-stat-table" aria-label={`${attackLabel} 相手S能力`}>
        <div className="ev-header attacker-stat-header">
          <span>能力</span>
          <span>実数値</span>
          <span>SP</span>
          <span>ランク</span>
        </div>
        <div className="ev-row attacker-stat-row spe">
          <strong>
            <StatIcon stat="spe" />
            <span>相手</span>
          </strong>
          <span className="actual-stat-with-modifier">
            <NatureStatModifier natureLabel={attack.attackerNatureInput} stat="spe" />
            <span className="actual-stat">{actualStats?.spe ?? "-"}</span>
          </span>
          <input
            {...numericInputProps}
            value={attack.attackerStatPoints.spe}
            aria-label={`${attackLabel} 相手S SP`}
            placeholder="S SP"
            onFocus={selectInputValueOnFocus}
            onChange={(event) => onUpdateAttackerEv(`${scenarioId}:${attack.id}`, "spe", toStatPointInput(event.target.value))}
          />
          <RankSelectField
            label={`${attackLabel} 相手Sランク`}
            value={attack.attackerBoosts.spe ?? 0}
            onChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerBoosts", {
              ...attack.attackerBoosts,
              spe: value,
            })}
          />
        </div>
      </div>
    </section>
  );
  const battleModifiersSection = (
    <section
      className="attack-setting-section attack-battle-modifiers"
      aria-labelledby={`${scenarioId}-${attack.id}-battle-modifiers-title`}
    >
      <h3 id={`${scenarioId}-${attack.id}-battle-modifiers-title`}>戦闘補正</h3>
      <div className="scenario-options">
        <label><input type="checkbox" checked={attack.critical} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "critical", event.target.checked)} /> 急所</label>
        <label><input type="checkbox" checked={attack.helpingHand} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "helpingHand", event.target.checked)} /> てだすけ</label>
        <label><input type="checkbox" checked={attack.reflect} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "reflect", event.target.checked)} /> リフレクター</label>
        <label><input type="checkbox" checked={attack.lightScreen} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "lightScreen", event.target.checked)} /> ひかりのかべ</label>
        <label><input type="checkbox" checked={attack.auroraVeil} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "auroraVeil", event.target.checked)} /> オーロラベール</label>
        <label><input type="checkbox" checked={attack.friendGuard} onChange={(event) => onUpdateAttack(scenarioId, attack.id, "friendGuard", event.target.checked)} /> フレンドガード</label>
      </div>
    </section>
  );
  return (
    <section className="attack-condition-card" aria-label={attackLabel}>
      <div className="attack-card-header">
        <button
          className={`attack-direction-button ${adjustmentDirection}`}
          type="button"
          aria-label={`${attackLabel} ${currentAdjustmentLabel}。クリックで${nextAdjustmentLabel}に切り替え`}
          onClick={onToggleAdjustmentType}
        >
          <span
            className="attack-direction-icon"
            aria-hidden="true"
            style={{ backgroundImage: `url("${getAssetSrc(directionIconPath)}")` }}
          />
        </button>
        <PokemonArtworkFrame
          match={attackerArtwork}
          fallbackLabel={attack.attackerPokemonInput}
          variant="attack"
          dynamaxEffect={attack.attackerDmaxEnabled || isPokemonFormVariant(attack.attackerPokemonInput, "gmax")}
        />
        <input
          className="inline-title-input"
          value={attackLabel}
          aria-label="攻撃名"
          onChange={onInput("label")}
        />
        <Button
          variant="ghost"
          size="icon"
          className="icon-button attack-remove-button"
          aria-label={`${attackLabel}を削除`}
          disabled={!canRemove}
          onClick={() => onRemoveAttack(scenarioId, attack.id)}
        >
          <img className="ui-button-icon" src={getAssetSrc("assets/ui/trash-2.svg")} alt="" aria-hidden="true" />
        </Button>
      </div>

      <div className={`attack-card-fields${isAbilitySupport ? " support-mode" : ""}`}>
        <div className={`attack-card-field-row attack-card-identity-row${isAbilitySupport ? " single" : ""}`}>
          <ScenarioTextField
            kind="pokemon"
            label={isOffenseAdjustment || isSpeedAdjustment ? "仮想敵" : "ポケモン"}
            showLabel
            value={attack.attackerPokemonInput}
            onChange={onInput("attackerPokemonInput")}
            onSelectValue={(value) => onUpdateAttack(scenarioId, attack.id, "attackerPokemonInput", value)}
          />
          {!isAbilitySupport ? (
            <LevelLockField
              ownerLabel={attackLabel}
              className="scenario-cell number-cell number-labeled-field attack-level-field"
              labelClassName="row-label"
              mode={attack.attackerLevelMode}
              value={attack.attackerLevel}
              onModeChange={(mode) => onUpdateAttack(scenarioId, attack.id, "attackerLevelMode", mode)}
              onChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerLevel", value)}
            />
          ) : null}
        </div>
        {!isSpeedAdjustment ? (
          <div className="attack-card-field-row attack-move-power-cell">
            <ScenarioTextField
              kind="move"
              label="技"
              showLabel
              value={attack.moveInput}
              options={moveOptions}
              onChange={onInput("moveInput")}
              onSelectValue={(value) => onUpdateAttack(scenarioId, attack.id, "moveInput", value)}
            />
            {isBeatUp ? (
              <BeatUpPowerField
                attackLabel={attackLabel}
                attackerPokemonInput={isOffenseAdjustment
                  ? targetForm.pokemonInput
                  : attack.attackerPokemonInput}
                participants={attack.beatUpParticipants}
                gameType={attack.gameType}
                evaluation={movePowerEvaluation}
                onChange={(participants) => onUpdateAttack(
                  scenarioId,
                  attack.id,
                  "beatUpParticipants",
                  participants,
                )}
              />
            ) : (
              <MovePowerField
                attackLabel={attackLabel}
                hasMove={Boolean(moveCanonicalName)}
                mode={attack.movePowerMode}
                value={attack.movePowerValue}
                evaluation={movePowerEvaluation}
                catalogEntry={moveCanonicalName ? getMovePowerCatalogEntry(moveCanonicalName) : undefined}
                assistRule={movePowerAssistRule}
                hpDependent={hpDependentMovePower}
                manualAllowed={Boolean(
                  moveCanonicalName
                  && isMovePowerOverrideAllowed(moveCanonicalName)
                  && movePowerEvaluation?.source !== "fixed-damage",
                )}
                unsupported={Boolean(
                  moveCanonicalName && isSinglePowerMoveUnsupported(moveCanonicalName),
                )}
                onCommit={(mode, value) => {
                  onUpdateAttack(scenarioId, attack.id, "movePowerMode", mode);
                  onUpdateAttack(scenarioId, attack.id, "movePowerValue", value);
                }}
              />
            )}
          </div>
        ) : null}
        <div className={`attack-card-field-row attack-card-details-row${isAbilitySupport ? " single" : ""}`}>
          {!isAbilitySupport ? (
            <NatureMatrixField
              className="scenario-cell"
              label="性格"
              value={attack.attackerNatureInput}
              ownerPokemonCanonicalName={attackerCanonicalPokemon}
              onChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerNatureInput", value)}
            />
          ) : null}
          <AbilityTextField
            className={`scenario-cell${opponentAbilitySpeedOverridden ? " speed-source-overridden" : ""}`}
            label="特性"
            description={opponentAbilitySpeedOverrideDescription}
            value={attack.attackerAbilityInput}
            pokemonAbilityOptions={attackerAbilityOptions}
            onChange={onInput("attackerAbilityInput")}
            onSelectAbility={(value) => onUpdateAttack(scenarioId, attack.id, "attackerAbilityInput", value)}
          />
        </div>
        {!isAbilitySupport ? (
          <div className="attack-card-field-row attack-card-item-row">
            <ScenarioTextField
              kind="item"
              label="持ち物"
              showLabel
              className={opponentItemSpeedOverridden ? "speed-source-overridden" : undefined}
              description={opponentItemSpeedOverrideDescription}
              value={attack.attackerItemInput}
              placeholder="任意"
              options={attackerItemOptions}
              onChange={onInput("attackerItemInput")}
              onSelectValue={(value) => onUpdateAttack(scenarioId, attack.id, "attackerItemInput", value)}
            />
          </div>
        ) : null}
        {!isAbilitySupport ? (
          <MechanicControls
            pokemonInput={attack.attackerPokemonInput}
            teraEnabled={attack.attackerTeraEnabled}
            dmaxEnabled={attack.attackerDmaxEnabled}
            teraTypeInput={attack.attackerTeraTypeInput}
            teraLabel={
              isOffenseAdjustment
                ? attack.attackerTeraEnabled ? "仮想敵テラス解除" : "仮想敵テラス"
                : attack.attackerTeraEnabled ? "攻撃テラス解除" : "攻撃テラス"
            }
            onPokemonInputChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerPokemonInput", value)}
            onTeraEnabledChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerTeraEnabled", value)}
            onDmaxEnabledChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerDmaxEnabled", value)}
            onTeraTypeInputChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerTeraTypeInput", value)}
          />
        ) : null}
      </div>

      {isAbilitySupport ? (
        <div className={`attack-support-note${supportsDoublesAttack ? "" : " inactive"}`} role="status">
          <strong>{supportsDoublesAttack ? "特性サポート有効" : "特性サポート待機中"}</strong>
          <span>
            {supportsDoublesAttack
              ? "同じ行のダブル攻撃へ、影響する特性を自動反映します"
              : "同じ行の攻撃ルールをダブルにすると、この特性が反映されます"}
          </span>
        </div>
      ) : isSpeedAdjustment ? (
        <>
          <section className="attack-setting-section attack-setting-section--indented" aria-labelledby={`${scenarioId}-${attack.id}-speed-title`}>
            <h3 id={`${scenarioId}-${attack.id}-speed-title`}>素早さ条件</h3>
            {!isManualSpeedTarget ? speedOpponentStatSection : null}
            <div className={`speed-condition-grid attack-setting-section-body${isManualSpeedTarget ? " manual" : ""}`}>
              <div className="speed-target-mode" role="radiogroup" aria-label={`${attackLabel} 素早さ条件`}>
                <div className="speed-target-mode-option speed-target-mode-primary">
                  <label className="speed-target-radio-label">
                    <input
                      type="radio"
                      name={`${scenarioId}-${attack.id}-speed-target-mode`}
                      checked={attack.speedTargetMode === "opponent"}
                      onChange={() => onUpdateAttack(scenarioId, attack.id, "speedTargetMode", "opponent")}
                    />
                    <span>{speedPrimaryConditionLabel}</span>
                  </label>
                  <span className="speed-target-mode-control">
                    <span className="speed-target-mode-operator" aria-hidden="true">
                      {isTrickRoomSpeed ? "-" : "+"}
                    </span>
                    <NumberStepper
                      className="speed-offset-input"
                      value={attack.speedRequiredOffset}
                      label={`${attackLabel} ${speedPrimaryConditionLabel}差分値`}
                      min={0}
                      max={10000}
                      disabled={isManualSpeedTarget}
                      onChange={(value) => onUpdateAttack(scenarioId, attack.id, "speedRequiredOffset", value)}
                    />
                  </span>
                </div>
                <div className="speed-target-mode-option speed-target-mode-manual">
                  <label className="speed-target-radio-label">
                    <input
                      type="radio"
                      name={`${scenarioId}-${attack.id}-speed-target-mode`}
                      checked={attack.speedTargetMode === "manual"}
                      onChange={() => onUpdateAttack(scenarioId, attack.id, "speedTargetMode", "manual")}
                    />
                    <span>任意S値</span>
                  </label>
                  <span className="speed-target-mode-control">
                    <span className="speed-target-mode-control-label">S値</span>
                    <ScenarioNumberField
                      className="speed-manual-target-input"
                      label={`${attackLabel} 任意S値`}
                      showLabel={false}
                      value={attack.speedTargetValue}
                      min={0}
                      max={10000}
                      onFocus={() => onUpdateAttack(scenarioId, attack.id, "speedTargetMode", "manual")}
                      onChange={(value) => onUpdateAttack(scenarioId, attack.id, "speedTargetValue", value)}
                    />
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section
            className="attack-setting-section attack-setting-section--indented speed-condition-section"
            aria-labelledby={`${scenarioId}-${attack.id}-speed-common-title`}
          >
            <h3 id={`${scenarioId}-${attack.id}-speed-common-title`}>共通S条件</h3>
            <div className="attack-field-grid speed-field-grid attack-setting-section-body">
              <SelectField
                label="ルール"
                ariaLabel={`${attackLabel} 共通S条件 ルール`}
                value={attack.gameType}
                options={gameTypeOptions}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "gameType", value)}
              />
              <SelectField
                label="天候"
                ariaLabel={`${attackLabel} 共通S条件 天候`}
                value={attack.weather}
                options={weatherOptions}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "weather", value)}
              />
              <SelectField
                label="フィールド"
                ariaLabel={`${attackLabel} 共通S条件 フィールド`}
                value={attack.terrain}
                options={terrainOptions}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "terrain", value)}
              />
              <SelectField
                label="行動順"
                ariaLabel={`${attackLabel} 共通S条件 行動順`}
                value={attack.speedOrderMode}
                options={[...speedOrderModeOptions]}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "speedOrderMode", value)}
              />
            </div>
          </section>

          {!isManualSpeedTarget ? (
            <section
              className="attack-setting-section attack-setting-section--indented speed-condition-section"
              aria-labelledby={`${scenarioId}-${attack.id}-speed-opponent-title`}
            >
              <h3 id={`${scenarioId}-${attack.id}-speed-opponent-title`}>相手S条件</h3>
              <div className="attack-field-grid speed-field-grid attack-setting-section-body">
                <SelectField
                  label="状態異常"
                  ariaLabel={`${attackLabel} 相手S条件 状態異常`}
                  value={attack.attackerStatus}
                  options={statusOptions}
                  onChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerStatus", value)}
                />
                <SpeedMultiplierControl
                  label="道具倍率"
                  ariaLabel={`${attackLabel} 相手S条件 道具倍率`}
                  value={attack.speedItemMultiplier}
                  onChange={(value) => onUpdateAttack(scenarioId, attack.id, "speedItemMultiplier", value)}
                />
                <SpeedMultiplierControl
                  label="特性倍率"
                  ariaLabel={`${attackLabel} 相手S条件 特性倍率`}
                  value={attack.speedAbilityMultiplier}
                  onChange={(value) => onUpdateAttack(scenarioId, attack.id, "speedAbilityMultiplier", value)}
                />
                <SelectField
                  label="おいかぜ"
                  ariaLabel={`${attackLabel} 相手S条件 おいかぜ`}
                  value={attack.speedOpponentTailwind ? "on" : "off"}
                  options={[...speedTailwindOptions]}
                  onChange={(value) => onUpdateAttack(scenarioId, attack.id, "speedOpponentTailwind", value === "on")}
                />
              </div>
            </section>
          ) : null}

          <section
            className="attack-setting-section attack-setting-section--indented speed-condition-section"
            aria-labelledby={`${scenarioId}-${attack.id}-speed-target-title`}
          >
            <h3 id={`${scenarioId}-${attack.id}-speed-target-title`}>調整対象S条件</h3>
            <div className="attack-field-grid speed-field-grid attack-setting-section-body">
              <SelectField
                label="状態異常"
                ariaLabel={`${attackLabel} 調整対象S条件 状態異常`}
                value={attack.speedTargetStatus}
                options={statusOptions}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "speedTargetStatus", value)}
              />
              <SpeedMultiplierControl
                label="道具倍率"
                ariaLabel={`${attackLabel} 調整対象S条件 道具倍率`}
                value={attack.speedTargetItemMultiplier}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "speedTargetItemMultiplier", value)}
              />
              <SpeedMultiplierControl
                label="特性倍率"
                ariaLabel={`${attackLabel} 調整対象S条件 特性倍率`}
                value={attack.speedTargetAbilityMultiplier}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "speedTargetAbilityMultiplier", value)}
              />
              <SelectField
                label="おいかぜ"
                ariaLabel={`${attackLabel} 調整対象S条件 おいかぜ`}
                value={attack.speedTargetTailwind ? "on" : "off"}
                options={[...speedTailwindOptions]}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "speedTargetTailwind", value === "on")}
              />
            </div>
          </section>
        </>
      ) : isOffenseAdjustment ? (
        <>
          <section className="attack-setting-section attack-setting-section--indented" aria-labelledby={`${scenarioId}-${attack.id}-ko-title`}>
            <h3 id={`${scenarioId}-${attack.id}-ko-title`}>火力条件</h3>
            <div className="attack-number-grid attack-setting-section-body">
              <ScenarioNumberField
                label="KO率"
                showLabel
                value={attack.targetKoProbabilityPercent}
                min={0}
                max={100}
                suffix="%"
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "targetKoProbabilityPercent", value)}
              />
            </div>
          </section>

          <section
            className="attack-setting-section attack-setting-section--indented"
            aria-labelledby={`${scenarioId}-${attack.id}-environment-title`}
          >
            <h3 id={`${scenarioId}-${attack.id}-environment-title`}>状況条件</h3>
            <div className="attack-field-grid attack-setting-section-body">
              <SelectField
                label="ルール"
                value={attack.gameType}
                options={gameTypeOptions}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "gameType", value)}
              />
              <SelectField
                label="仮想敵状態"
                value={attack.attackerStatus}
                options={statusOptions}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerStatus", value)}
              />
              <SelectField
                label="天候"
                value={attack.weather}
                options={weatherOptions}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "weather", value)}
              />
              <SelectField
                label="フィールド"
                value={attack.terrain}
                options={terrainOptions}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "terrain", value)}
              />
            </div>

            <section className="attack-stat-section attack-setting-section-body" aria-label={`${attackLabel} 仮想敵能力`}>
              <div className="ev-table attacker-stat-table offense-defender-stat-table" aria-label={`${attackLabel} 仮想敵能力`}>
                <div className="ev-header attacker-stat-header">
                  <span>能力</span>
                  <span>実数値</span>
                  <span>SP</span>
                  <span>ランク</span>
                </div>
                {offenseDefenderStatKeys.map((key) => (
                  <div
                    className={`ev-row attacker-stat-row ${key}`}
                    key={key}
                  >
                    <strong>
                      <StatIcon stat={key} />
                      <span>仮想敵</span>
                    </strong>
                    <span className="actual-stat-with-modifier">
                      <NatureStatModifier natureLabel={attack.attackerNatureInput} stat={key} />
                      <span className="actual-stat">{actualStats?.[key] ?? "-"}</span>
                    </span>
                    <input
                      {...numericInputProps}
                      value={attack.attackerStatPoints[key]}
                      aria-label={`${attackLabel} 仮想敵${statLabels[key]} SP`}
                      placeholder={`${statLabels[key]} SP`}
                      onFocus={selectInputValueOnFocus}
                      onChange={(event) => onUpdateAttackerEv(`${scenarioId}:${attack.id}`, key, toStatPointInput(event.target.value))}
                    />
                    {key !== "hp" ? (
                      <RankSelectField
                        label={`${attackLabel} 仮想敵${statLabels[key]}ランク`}
                        value={attack.attackerBoosts[key] ?? 0}
                        onChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerBoosts", {
                          ...attack.attackerBoosts,
                          [key]: value,
                        })}
                      />
                    ) : (
                      <span className="attacker-stat-role">仮想敵</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </section>

          {battleModifiersSection}
        </>
      ) : (
        <>
          <section className="attack-setting-section attack-setting-section--indented" aria-labelledby={`${scenarioId}-${attack.id}-survival-title`}>
            <h3 id={`${scenarioId}-${attack.id}-survival-title`}>耐久条件</h3>
            <div className="attack-number-grid attack-setting-section-body">
              <ScenarioStepperField
                label="攻撃回数"
                value={attack.repeat}
                min={1}
                max={10}
                disabled={isBeatUp}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "repeat", value)}
              />
              <ScenarioStepperField
                label="耐久回数"
                value={attack.requiredSurvivedHits}
                min={1}
                max={10}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "requiredSurvivedHits", value)}
              />
              <ScenarioNumberField
                label="耐久確率"
                showLabel
                value={attack.minSurvivalProbabilityPercent}
                min={0}
                max={100}
                suffix="%"
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "minSurvivalProbabilityPercent", value)}
              />
            </div>
          </section>

          <section
            className="attack-setting-section attack-setting-section--indented"
            aria-labelledby={`${scenarioId}-${attack.id}-environment-title`}
          >
            <h3 id={`${scenarioId}-${attack.id}-environment-title`}>状況条件</h3>
            <div className="attack-field-grid attack-setting-section-body">
              <SelectField
                label="ルール"
                value={attack.gameType}
                options={gameTypeOptions}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "gameType", value)}
              />
              <SelectField
                label="状態異常"
                value={attack.attackerStatus}
                options={statusOptions}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerStatus", value)}
              />
              <SelectField
                label="天候"
                value={attack.weather}
                options={weatherOptions}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "weather", value)}
              />
              <SelectField
                label="フィールド"
                value={attack.terrain}
                options={terrainOptions}
                onChange={(value) => onUpdateAttack(scenarioId, attack.id, "terrain", value)}
              />
            </div>

            <section className="attack-stat-section attack-setting-section-body" aria-label={`${attackLabel} 能力`}>
              <div className="ev-table attacker-stat-table" aria-label={`${attackLabel} 参照能力`}>
                <div className="ev-header attacker-stat-header">
                  <span>能力</span>
                  <span>実数値</span>
                  <span>SP</span>
                  <span>ランク</span>
                </div>
                {statReferencePlan.references.map((reference) => {
                  const key = reference.stat;
                  const isAttacker = reference.owner === "attacker";
                  const sourceLabel = isAttacker ? "仮想敵" : "調整対象";
                  const statPoints = isAttacker ? attack.attackerStatPoints : targetForm.statPoints;
                  const stats = isAttacker ? actualStats : targetActualStats;
                  const nature = isAttacker ? attack.attackerNatureInput : targetForm.natureInput;

                  return (
                    <div
                      className={`ev-row attacker-stat-row ${key}${isAttacker ? "" : " target-reference"}`}
                      key={`${reference.owner}-${key}-${reference.role}`}
                    >
                      <strong>
                        <StatIcon stat={key} />
                        <span>{sourceLabel}</span>
                      </strong>
                      <span className="actual-stat-with-modifier">
                        <NatureStatModifier natureLabel={nature} stat={key} />
                        <span className="actual-stat">{stats?.[key] ?? "-"}</span>
                      </span>
                      {isAttacker ? (
                        <input
                          {...numericInputProps}
                          value={statPoints[key]}
                          aria-label={`${attackLabel} ${statLabels[key]} SP`}
                          placeholder={`${statLabels[key]} SP`}
                          onFocus={selectInputValueOnFocus}
                          onChange={(event) => onUpdateAttackerEv(`${scenarioId}:${attack.id}`, key, toStatPointInput(event.target.value))}
                        />
                      ) : (
                        <span className="attacker-reference-sp">{statPoints[key]}</span>
                      )}
                      {isAttacker && key !== "hp" ? (
                        <RankSelectField
                          label={`${attackLabel} ${statLabels[key]}ランク`}
                          value={attack.attackerBoosts[key] ?? 0}
                          onChange={(value) => onUpdateAttack(scenarioId, attack.id, "attackerBoosts", {
                            ...attack.attackerBoosts,
                            [key]: value,
                          })}
                        />
                      ) : (
                        <span className="attacker-stat-role">
                          {reference.role === "power" ? "威力参照" : sourceLabel}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </section>

          {battleModifiersSection}

          <section
            className="attack-setting-section attack-setting-section--indented attack-setting-section--target-condition"
            aria-labelledby={`${scenarioId}-${attack.id}-target-condition-title`}
          >
            <h3 id={`${scenarioId}-${attack.id}-target-condition-title`}>調整対象条件</h3>
            <div className="attack-target-condition-body">
              <div className="scenario-defender-status">
                <span>状態異常</span>
                <SelectField
                  compact
                  label={`${attackLabel} 調整対象の状態異常`}
                  value={attack.defenderStatus}
                  options={statusOptions}
                  onChange={(value) => onUpdateAttack(scenarioId, attack.id, "defenderStatus", value)}
                />
              </div>
              <div className="scenario-defender-ranks" aria-label={`${attackLabel} 調整対象条件`}>
                <span className="scenario-defender-rank-label">ランク</span>
                {defenderRankKeys.map((key) => (
                  <div className="scenario-defender-rank" key={key}>
                    <StatIcon stat={key} />
                    <RankSelectField
                      label={`${attackLabel} 調整対象${statLabels[key]}ランク`}
                      value={attack.defenderBoosts[key] ?? 0}
                      onChange={(value) => onUpdateAttack(scenarioId, attack.id, "defenderBoosts", {
                        ...attack.defenderBoosts,
                        [key]: value,
                      })}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}
      {!isAbilitySupport && !isSpeedAdjustment ? (
        <HpEventsEditor
          attack={attack}
          adjustmentType={adjustmentType}
          scenarioId={scenarioId}
          targetForm={targetForm}
          onUpdateAttack={onUpdateAttack}
        />
      ) : null}
    </section>
  );
}

type ScenarioTextFieldProps = {
  kind?: EntityKind;
  label: string;
  showLabel: boolean;
  value: string;
  className?: string;
  description?: string;
  placeholder?: string;
  options?: EntityInputOption[];
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectValue?: (value: string) => void;
};

function ScenarioTextField({
  kind,
  label,
  showLabel,
  value,
  className,
  description,
  placeholder,
  options: suggestedOptions,
  onChange,
  onSelectValue,
}: ScenarioTextFieldProps) {
  const datalistId = `entity-options-${kind ?? "text"}-${useId()}`;
  const scenarioFieldClassName = ["scenario-cell", className].filter(Boolean).join(" ");

  if (kind === "pokemon" && onSelectValue) {
    return (
      <PokemonAutocompleteField
        className={scenarioFieldClassName}
        label={label}
        value={value}
        invalid={isUnresolvedEntityInput("pokemon", value)}
        onChange={onChange}
        onSelectValue={onSelectValue}
      />
    );
  }

  if ((kind === "item" || kind === "move") && onSelectValue) {
    return (
      <DropdownTextField
        kind={kind}
        className={scenarioFieldClassName}
        label={label}
        value={value}
        options={suggestedOptions ?? getMatchingEntityInputOptions(kind, value)}
        description={description}
        onChange={onChange}
        onSelectValue={onSelectValue}
      />
    );
  }

  const options = kind ? suggestedOptions ?? getMatchingEntityInputOptions(kind, value) : [];

  return (
    <label className={`${scenarioFieldClassName} placeholder-field${kind && isUnresolvedEntityInput(kind, value) ? " is-invalid" : ""}`} title={description}>
      <input
        value={value}
        placeholder={showLabel ? label : placeholder}
        list={kind ? datalistId : undefined}
        autoComplete={kind ? "off" : undefined}
        aria-label={label}
        aria-description={description}
        onFocus={selectInputValueOnFocus}
        onChange={onChange}
      />
      {kind ? (
        <datalist id={datalistId}>
          {options.map((option) => (
            <option
              value={option.value}
              key={option.value}
            />
          ))}
        </datalist>
      ) : null}
    </label>
  );
}

type ScenarioNumberFieldProps = {
  className?: string;
  label: string;
  showLabel: boolean;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onFocus?: () => void;
  onChange: (value: number) => void;
  suffix?: string;
};

function ScenarioNumberField({
  className,
  label,
  showLabel,
  value,
  min,
  max,
  disabled,
  onFocus,
  onChange,
  suffix,
}: ScenarioNumberFieldProps) {
  const ariaLabel = suffix ? `${label} ${suffix}` : label;

  return (
    <label className={`scenario-cell number-cell number-labeled-field${suffix ? " has-suffix" : ""}${className ? ` ${className}` : ""}`}>
      {showLabel ? <span className="row-label">{label}</span> : null}
      <span className="number-input-wrap">
        <input
          {...numericInputProps}
          value={value}
          disabled={disabled}
          aria-label={ariaLabel}
          onFocus={(event) => {
            selectInputValueOnFocus(event);
            onFocus?.();
          }}
          onChange={(event) => onChange(clampNumberInput(toNumber(event.target.value, min), min, max))}
        />
        {suffix ? <span className="number-input-suffix">{suffix}</span> : null}
      </span>
    </label>
  );
}

type ResultsPanelProps = {
  displayMode?: "panel" | "mobile-inline";
  pageSize?: number;
  candidates: CandidateResult[];
  passingCandidateCount?: number;
  selectedCandidateId: string | null;
  appliedCandidateId: string | null;
  appliedAdjustmentId?: string | null;
  scenarios: ScenarioFormState[];
  status: string;
  offenseResults: OffenseScenarioResult[];
  speedResults: SpeedScenarioResult[];
  strictestFailureLabel: string | null;
  targetLabel: string;
  resultAlertMessage: string | null;
  onSelectCandidate: (id: string) => void;
  onApplyCandidate: (candidate: CandidateResult) => void;
  onApplyOffenseResult?: (entry: OffenseScenarioResult) => void;
  onApplySpeedResult?: (entry: SpeedScenarioResult) => void;
  onCloseMobileSheet?: () => void;
};

const getOffenseResultTone = (result: OffenseScenarioResult["result"]): "green" | "red" | "blue" | "purple" => {
  if (result.status === "unresolved" || result.status === "invalid") {
    return "purple";
  }
  if (result.status === "fixed") {
    return result.passed ? "blue" : "red";
  }
  return result.passed ? "green" : "red";
};

const formatResultAlertStrictestCondition = (message: string): string => {
  const integrationPrefixes = [
    "火力調整条件を候補一覧へ統合できません: ",
    "素早さ調整条件を候補一覧へ統合できません: ",
  ];
  const matchedPrefix = integrationPrefixes.find((prefix) => message.startsWith(prefix));
  return matchedPrefix ? message.slice(matchedPrefix.length) : message;
};

const formatOffenseCandidateDetail = (
  entry: OffenseScenarioResult,
  targetLabel: string,
  scenario: ScenarioFormState | undefined,
): string => {
  const attacker = scenario?.attacks.find((attack) => attack.id === entry.attackId);
  const defenderLabel = attacker?.attackerPokemonInput.trim() || entry.attackLabel;
  const moveLabel = attacker?.moveInput.trim() || "技";
  const moveCanonicalName = attacker
    ? resolveCanonicalEntityName("move", attacker.moveInput)
    : undefined;
  const hpDependentMovePower = moveCanonicalName
    ? isCurrentHpDependentMoveCanonicalName(moveCanonicalName)
    : false;
  const statPointLabel = entry.result.stat
    ? `${statLabels[entry.result.stat]}${entry.result.requiredStatPoints ?? "-"}`
    : entry.result.label;
  const sourceLabel = [statPointLabel, targetLabel.trim() || "調整対象", moveLabel].join(" ");
  const movePowerLabel = entry.result.movePower
    ? `${formatMovePowerEvaluation(entry.result.movePower, { hpDependent: hpDependentMovePower })} / `
    : "";
  if (entry.result.description) {
    const description = formatLocalizedDamageDescription(entry.result.description);
    return `${movePowerLabel}${entry.result.movePower ? stripLocalizedDamagePowerLabel(description) : description} / KO率 ${formatPercent(entry.result.koProbability)}`;
  }
  const damageLabel = entry.result.damageRange
    ? `${formatDamageRange(entry.result.damageRange.min, entry.result.damageRange.max)} `
      + `(${entry.result.damageRange.percentMin.toFixed(1)}-${entry.result.damageRange.percentMax.toFixed(1)}%)`
    : entry.result.reason;

  return `${movePowerLabel}${sourceLabel} → ${defenderLabel} : ${damageLabel} / KO率 ${formatPercent(entry.result.koProbability)}`;
};

const formatBottleneckDisplayLabel = (label: string): string => `最厳条件: ${label}`;

const getSpeedResultTone = (result: SpeedAdjustmentResult): "green" | "red" | "blue" | "purple" => {
  if (result.status === "unresolved" || result.status === "invalid") {
    return "purple";
  }
  if (result.status === "tie") {
    return "blue";
  }
  return result.passed ? "green" : "red";
};

const formatSpeedRelationLabel = (result: Pick<SpeedAdjustmentResult, "orderMode" | "relation">): string => {
  switch (result.relation) {
    case "outspeed":
      return result.orderMode === "trick-room" ? "先制できる" : "抜ける";
    case "tie":
      return "同速";
    case "miss":
    default:
      return "届かない";
  }
};

const formatSpeedResultDetail = (
  entry: SpeedScenarioResult,
  targetLabel: string,
  scenario: ScenarioFormState | undefined,
): string => {
  const attack = scenario?.attacks.find((currentAttack) => currentAttack.id === entry.attackId);
  const opponentLabel = attack?.speedTargetMode === "manual" && attack.speedTargetValue > 0
    ? `任意S${attack.speedTargetValue}`
    : attack?.attackerPokemonInput.trim() || entry.attackLabel;
  const requiredStatPointLabel = entry.result.requiredStatPoints === null
    ? "S-"
    : `S${entry.result.requiredStatPoints}`;
  const actualSpeedLabel = entry.result.actualSpeed === null ? "-" : String(entry.result.actualSpeed);
  const noteLabel = entry.result.notes.length > 0 ? ` / ${entry.result.notes.join(" / ")}` : "";

  return `${requiredStatPointLabel} ${targetLabel.trim() || "調整対象"} → ${opponentLabel} : `
    + `自分 ${actualSpeedLabel} / 相手 ${entry.result.targetSpeed} / ${formatSpeedRelationLabel(entry.result)}${noteLabel}`;
};

type StandaloneAdjustmentResultsProps = {
  offenseResults: OffenseScenarioResult[];
  speedResults: SpeedScenarioResult[];
  targetLabel: string;
  scenariosById: Map<string, ScenarioFormState>;
  appliedAdjustmentId: string | null;
  onApplyOffenseResult: (entry: OffenseScenarioResult) => void;
  onApplySpeedResult: (entry: SpeedScenarioResult) => void;
};

function StandaloneAdjustmentResults({
  offenseResults,
  speedResults,
  targetLabel,
  scenariosById,
  appliedAdjustmentId,
  onApplyOffenseResult,
  onApplySpeedResult,
}: StandaloneAdjustmentResultsProps) {
  return (
    <div className="adjustment-result-list" aria-label="火力・素早さライン結果">
      <strong className="adjustment-result-list-title">火力・素早さライン結果</strong>
      {offenseResults.map((entry) => (
        <div className="adjustment-result-row" key={entry.id}>
          <StatusBadge tone={getOffenseResultTone(entry.result)} />
          <strong>{entry.result.label}</strong>
          <span className="adjustment-result-source">{entry.scenarioLabel} / {entry.attackLabel}</span>
          <span className="adjustment-result-metric">KO {formatPercent(entry.result.koProbability)}</span>
          <em className={entry.result.passed ? "" : "fail-badge"}>
            {formatScenarioResultStatusLabel(entry.result.passed)}
          </em>
          <Button
            variant="primary"
            size="small"
            className="candidate-apply-button adjustment-apply-button"
            onClick={() => onApplyOffenseResult(entry)}
            disabled={!entry.result.canApply}
            aria-label={`${entry.result.label}を調整対象へ適用`}
          >
            {appliedAdjustmentId === entry.id ? "適用済み" : "適用"}
          </Button>
          <small>
            {formatOffenseCandidateDetail(entry, targetLabel, scenariosById.get(entry.scenarioId))}
            {" / "}
            {entry.result.reason}
            {entry.result.hpEventEvaluations.length > 0
              ? ` / ${entry.result.hpEventEvaluations
                .map((evaluation) => formatHpEventEvaluation(evaluation, "offense"))
                .join(" / ")}`
              : ""}
          </small>
        </div>
      ))}
      {speedResults.map((entry) => (
        <div className="adjustment-result-row" key={entry.id}>
          <StatusBadge tone={getSpeedResultTone(entry.result)} />
          <strong>{entry.result.label}</strong>
          <span className="adjustment-result-source">{entry.scenarioLabel} / {entry.attackLabel}</span>
          <span className="adjustment-result-metric">相手S {entry.result.targetSpeed || "-"}</span>
          <em className={entry.result.passed ? "" : "fail-badge"}>
            {formatScenarioResultStatusLabel(entry.result.passed)}
          </em>
          <Button
            variant="primary"
            size="small"
            className="candidate-apply-button adjustment-apply-button"
            onClick={() => onApplySpeedResult(entry)}
            disabled={!entry.result.canApply}
            aria-label={`${entry.result.label}を調整対象へ適用`}
          >
            {appliedAdjustmentId === entry.id ? "適用済み" : "適用"}
          </Button>
          <small>{formatSpeedResultDetail(entry, targetLabel, scenariosById.get(entry.scenarioId))}</small>
        </div>
      ))}
    </div>
  );
}

export function ResultsPanel({
  displayMode = "panel",
  pageSize = RESULTS_PAGE_SIZE,
  candidates,
  passingCandidateCount = candidates.length,
  selectedCandidateId,
  appliedCandidateId,
  appliedAdjustmentId = null,
  scenarios,
  status,
  offenseResults,
  speedResults,
  strictestFailureLabel,
  targetLabel,
  resultAlertMessage,
  onSelectCandidate,
  onApplyCandidate,
  onApplyOffenseResult = () => undefined,
  onApplySpeedResult = () => undefined,
  onCloseMobileSheet = () => undefined,
}: ResultsPanelProps) {
  const [candidateSortKey, setCandidateSortKey] = useState<CandidateSortKey>("recommended");
  const [candidateSortDirection, setCandidateSortDirection] = useState<CandidateSortDirection>("asc");
  const [candidatePage, setCandidatePage] = useState(1);
  const scenarioLabels = useMemo(
    () => new Map(scenarios.map((scenario) => [scenario.id, scenario.label])),
    [scenarios],
  );
  const scenariosById = useMemo(
    () => new Map(scenarios.map((scenario) => [scenario.id, scenario])),
    [scenarios],
  );
  const hasEnabledDefenceScenario = scenarios.some((scenario) => (
    scenario.enabled && scenario.adjustmentType === "defence"
  ));
  const showStandaloneAdjustmentResults = (
    candidates.length === 0
    && !hasEnabledDefenceScenario
    && (offenseResults.length > 0 || speedResults.length > 0)
  );
  const attackLabelsByScenarioId = useMemo(
    () => new Map(scenarios.map((scenario) => [
      scenario.id,
      scenario.attacks
        .map((attack, attackIndex) => ({ attack, attackIndex }))
        .filter(({ attack }) => attack.moveInput.trim())
        .map(({ attack, attackIndex }) => (
          formatScenarioAttackLabel(scenario.adjustmentType, attackIndex, attack.label)
        )),
    ])),
    [scenarios],
  );
  const sortedCandidates = useMemo(
    () => [...candidates].sort((left, right) => (
      compareResultCandidates(left, right, candidateSortKey, candidateSortDirection)
    )),
    [candidateSortDirection, candidateSortKey, candidates],
  );
  const totalCandidatePages = Math.max(1, Math.ceil(sortedCandidates.length / pageSize));
  const safeCandidatePage = Math.min(candidatePage, totalCandidatePages);
  const pageStartIndex = sortedCandidates.length === 0 ? 0 : (safeCandidatePage - 1) * pageSize;
  const pageEndIndex = Math.min(sortedCandidates.length, pageStartIndex + pageSize);
  const displayedCandidates = sortedCandidates.slice(pageStartIndex, pageEndIndex);
  const resultCountLabel = status === "running"
    ? `探索中 / 合格候補 ${passingCandidateCount} 件 / ${pageSize}件ずつ表示`
    : candidates.length > 0
      ? `候補 ${candidates.length} 件 / ${pageStartIndex + 1}-${pageEndIndex} 件目`
      : `候補 ${candidates.length} 件`;
  const mobileInline = displayMode === "mobile-inline";
  const titleId = mobileInline ? "mobile-candidate-title" : "results-title";

  useEffect(() => {
    setCandidatePage(1);
  }, [candidateSortDirection, candidateSortKey, candidates.length]);

  useEffect(() => {
    setCandidatePage((currentPage) => Math.min(currentPage, totalCandidatePages));
  }, [totalCandidatePages]);

  return (
    <section
      className={mobileInline
        ? "mobile-candidate-results mobile-candidate-layout"
        : "results-panel mobile-candidate-layout"}
      aria-labelledby={titleId}
    >
      <div className="section-heading">
        <div>
          <h2 id={titleId}>候補一覧</h2>
          <span>{resultCountLabel}</span>
        </div>
        {mobileInline ? null : (
          <button className="mobile-sheet-close" type="button" onClick={onCloseMobileSheet}>
            閉じる
          </button>
        )}
      </div>

      {candidates.length > 0 ? (
        <div className="candidate-toolbar" aria-label="候補一覧の表示操作">
          <SelectField
            compact
            className="candidate-sort-field"
            label="並び替え"
            value={candidateSortKey}
            options={candidateSortOptions}
            onChange={(nextSortKey) => {
              setCandidateSortKey(nextSortKey);
              setCandidateSortDirection(getDefaultCandidateSortDirection(nextSortKey));
            }}
          />
          <SelectField
            compact
            className="candidate-sort-direction-field"
            label="順序"
            value={candidateSortDirection}
            options={candidateSortDirectionOptions}
            onChange={setCandidateSortDirection}
          />
          <span className="candidate-page-status" aria-live="polite">
            {pageStartIndex + 1}-{pageEndIndex} / {candidates.length}
          </span>
          {mobileInline ? null : (
            <div className="candidate-page-actions" aria-label="候補一覧のページ操作">
              <Button
                variant="ghost"
                size="small"
                onClick={() => setCandidatePage((currentPage) => Math.max(1, currentPage - 1))}
                disabled={safeCandidatePage <= 1}
              >
                前へ
              </Button>
              <span>{safeCandidatePage} / {totalCandidatePages}</span>
              <Button
                variant="ghost"
                size="small"
                onClick={() => setCandidatePage((currentPage) => Math.min(totalCandidatePages, currentPage + 1))}
                disabled={safeCandidatePage >= totalCandidatePages}
              >
                次へ
              </Button>
            </div>
          )}
        </div>
      ) : null}

      <div className="candidate-table" role="table" aria-label="候補一覧">
        <div className="candidate-row header" role="row">
          <span>順位</span><span>H/A/B/C/D/S</span><span /><span>使用SP</span><span>残りSP</span><span>最厳条件</span><span /><span />
        </div>
        {resultAlertMessage ? (
          <div className="empty-result impossible-result result-alert" role="alert">
            <strong>FAIL</strong>
            <span>すべてのシナリオを満たす候補を作れません。</span>
            <small>最厳条件: {formatResultAlertStrictestCondition(resultAlertMessage)}</small>
          </div>
        ) : null}
        {candidates.length === 0 ? (
          resultAlertMessage ? null : showStandaloneAdjustmentResults ? (
            <StandaloneAdjustmentResults
              offenseResults={offenseResults}
              speedResults={speedResults}
              targetLabel={targetLabel}
              scenariosById={scenariosById}
              appliedAdjustmentId={appliedAdjustmentId}
              onApplyOffenseResult={onApplyOffenseResult}
              onApplySpeedResult={onApplySpeedResult}
            />
          ) : <div className={`empty-result${status === "complete" ? " impossible-result" : ""}`}>
            {status === "complete" ? (
              <>
                <strong>FAIL</strong>
                <span>すべてのシナリオを満たす候補が見つかりません</span>
                {strictestFailureLabel ? <small>最厳条件: {strictestFailureLabel}</small> : null}
              </>
            ) : (
              "計算結果"
            )}
          </div>
        ) : displayedCandidates.map((candidate) => {
          const expanded = selectedCandidateId === candidate.id;
          const isStatPointBudgetFull = candidate.remainingStatPointBudget === 0;
          const hasRemainingStatPoints = candidate.remainingStatPointBudget > 0;
          return (
            <Collapsible.Root
              className={`candidate-entry${expanded ? " selected" : ""}`}
              open={expanded}
              onOpenChange={(open) => {
                if (open !== expanded) {
                  onSelectCandidate(candidate.id);
                }
              }}
              role="rowgroup"
              key={candidate.id}
            >
              <div className="candidate-row" role="row">
                <Collapsible.Trigger asChild>
                  <button className="candidate-row-toggle" type="button">
                    <span className={`rank${candidate.rank === 1 ? " crown" : ""}`}>{candidate.rank}</span>
                    <CandidateStatPointSpread statPoints={candidate.appliedStatPoints} />
                    <span className="candidate-row-spacer" aria-hidden="true" />
                    <span
                      className="candidate-budget-bar"
                      style={{
                        "--candidate-used-track": `${candidate.usedStatPointBudget}fr`,
                        "--candidate-remaining-track": `${candidate.remainingStatPointBudget}fr`,
                      } as CSSProperties}
                    >
                      <span
                        className={`candidate-budget-value used${isStatPointBudgetFull ? " is-budget-full" : ""}`}
                      >
                        <span className="visually-hidden">使用SP</span>
                        {candidate.usedStatPointBudget}
                      </span>
                      <span
                        className={`candidate-budget-value remaining ${hasRemainingStatPoints ? "has-remaining" : "is-zero"}`}
                      >
                        <span className="visually-hidden">残りSP</span>
                        {candidate.remainingStatPointBudget}
                      </span>
                    </span>
                    <span className="candidate-bottleneck">
                      {formatBottleneckDisplayLabel(candidate.bottleneckLabel)}
                    </span>
                    <span className="candidate-disclosure" aria-hidden="true">
                      <ChevronRightIcon className="disclosure-chevron" />
                    </span>
                  </button>
                </Collapsible.Trigger>
                <Button
                  variant="primary"
                  size="small"
                  className="candidate-apply-button"
                  onClick={() => onApplyCandidate(candidate)}
                  aria-label={`${candidate.rank}位の候補を調整対象へ適用`}
                >
                  {appliedCandidateId === candidate.id ? "適用済み" : "適用"}
                </Button>
              </div>
              <Collapsible.Content asChild>
                <div
                  className="candidate-expanded-detail"
                  id={`${mobileInline ? "mobile-" : ""}${candidate.id}-details`}
                >
                  {candidate.scenarioResults.map((result) => {
                    const scenarioLabel = scenarioLabels.get(result.scenarioId) ?? result.scenarioId;
                    const sourceAttacks = scenariosById.get(result.scenarioId)?.attacks
                      .filter((attack) => attack.moveInput.trim()) ?? [];
                    return (
                      <section className="candidate-scenario-detail" key={result.scenarioId}>
                        <div className="candidate-scenario-status">
                          <StatusBadge tone={result.passed ? "green" : "red"} />
                          <strong>{scenarioLabel}</strong>
                          <span>生存率 {formatPercent(result.survivalProbability)}</span>
                          <em className={result.passed ? "" : "fail-badge"}>
                            {formatScenarioResultStatusLabel(result.passed)}
                          </em>
                        </div>
                        {result.hitEvaluations.length > 0 || (result.hpEventEvaluations?.length ?? 0) > 0 ? (
                          <ul>
                            {result.hitEvaluations.map((hit, hitIndex) => {
                              const attackLabel = attackLabelsByScenarioId.get(result.scenarioId)?.[hitIndex];
                              const sourceMoveCanonicalName = resolveCanonicalEntityName(
                                "move",
                                sourceAttacks[hitIndex]?.moveInput ?? "",
                              );
                              const hpDependentMovePower = sourceMoveCanonicalName
                                ? isCurrentHpDependentMoveCanonicalName(sourceMoveCanonicalName)
                                : false;
                              const detailLabel = attackLabel ? `${scenarioLabel} / ${attackLabel}` : scenarioLabel;
                              const hpEvents = (result.hpEventEvaluations ?? [])
                                .filter((evaluation) => evaluation.cardId === hit.hitId);
                              const beforeMoveEvents = hpEvents
                                .filter((evaluation) => evaluation.sequenceContext === "priorMove");
                              const laterEvents = hpEvents
                                .filter((evaluation) => evaluation.sequenceContext !== "priorMove");
                              return (
                                <Fragment key={hit.hitId}>
                                  {beforeMoveEvents.map((evaluation) => (
                                    <li className="candidate-hp-event-detail" key={`${evaluation.eventId}-${evaluation.occurrence}`}>
                                      <strong>{detailLabel} / 定数ダメージ・回復</strong>
                                      <span>{formatHpEventEvaluation(evaluation, "defence")}</span>
                                    </li>
                                  ))}
                                  <li>
                                    <strong>{detailLabel}</strong>
                                    <span>
                                      {hit.movePower
                                        ? `${formatMovePowerEvaluation(hit.movePower, { hpDependent: hpDependentMovePower })} / `
                                        : ""}
                                      {hit.description
                                        ? hit.movePower
                                          ? stripLocalizedDamagePowerLabel(formatLocalizedDamageDescription(hit.description))
                                          : formatLocalizedDamageDescription(hit.description)
                                        : `被ダメージ ${formatDamageRange(hit.damageRange.min, hit.damageRange.max)} (${hit.damageRange.percentMin.toFixed(1)}-${hit.damageRange.percentMax.toFixed(1)}%)`}
                                    </span>
                                  </li>
                                  {laterEvents.map((evaluation) => (
                                    <li className="candidate-hp-event-detail" key={`${evaluation.eventId}-${evaluation.occurrence}`}>
                                      <strong>{detailLabel} / 定数ダメージ・回復</strong>
                                      <span>{formatHpEventEvaluation(evaluation, "defence")}</span>
                                    </li>
                                  ))}
                                </Fragment>
                              );
                            })}
                          </ul>
                        ) : null}
                      </section>
                    );
                  })}
                  {offenseResults.map((entry) => {
                    const scenarioLabel = scenarioLabels.get(entry.scenarioId) ?? entry.scenarioLabel;
                    return (
                      <section className="candidate-scenario-detail" key={entry.id}>
                        <div className="candidate-scenario-status">
                          <StatusBadge tone={getOffenseResultTone(entry.result)} />
                          <strong>{scenarioLabel}</strong>
                          <span>KO率 {formatPercent(entry.result.koProbability)}</span>
                          <em className={entry.result.passed ? "" : "fail-badge"}>
                            {formatScenarioResultStatusLabel(entry.result.passed)}
                          </em>
                        </div>
                        <ul>
                          <li>
                            <strong>{scenarioLabel}</strong>
                            <span>
                              {formatOffenseCandidateDetail(entry, targetLabel, scenariosById.get(entry.scenarioId))}
                            </span>
                          </li>
                          {entry.result.hpEventEvaluations.map((evaluation) => (
                            <li className="candidate-hp-event-detail" key={`${evaluation.eventId}-${evaluation.occurrence}`}>
                              <strong>{scenarioLabel} / 定数ダメージ・回復</strong>
                              <span>{formatHpEventEvaluation(evaluation, "offense")}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    );
                  })}
                  {speedResults.map((entry) => {
                    const scenarioLabel = scenarioLabels.get(entry.scenarioId) ?? entry.scenarioLabel;
                    return (
                      <section className="candidate-scenario-detail" key={entry.id}>
                        <div className="candidate-scenario-status">
                          <StatusBadge tone={getSpeedResultTone(entry.result)} />
                          <strong>{scenarioLabel}</strong>
                          <span>相手S {entry.result.targetSpeed || "-"}</span>
                          <em className={entry.result.passed ? "" : "fail-badge"}>
                            {formatScenarioResultStatusLabel(entry.result.passed)}
                          </em>
                        </div>
                        <ul>
                          <li>
                            <strong>{scenarioLabel}</strong>
                            <span>
                              {formatSpeedResultDetail(entry, targetLabel, scenariosById.get(entry.scenarioId))}
                            </span>
                          </li>
                        </ul>
                      </section>
                    );
                  })}
                </div>
              </Collapsible.Content>
            </Collapsible.Root>
          );
        })}
      </div>
      {mobileInline && candidates.length > 0 ? (
        <div className="candidate-page-actions mobile-candidate-page-actions" aria-label="候補一覧のページ操作">
          <Button
            variant="ghost"
            size="small"
            onClick={() => setCandidatePage((currentPage) => Math.max(1, currentPage - 1))}
            disabled={safeCandidatePage <= 1}
          >
            前へ
          </Button>
          <span>{safeCandidatePage} / {totalCandidatePages}</span>
          <Button
            variant="ghost"
            size="small"
            onClick={() => setCandidatePage((currentPage) => Math.min(totalCandidatePages, currentPage + 1))}
            disabled={safeCandidatePage >= totalCandidatePages}
          >
            次へ
          </Button>
        </div>
      ) : null}
    </section>
  );
}

export function CandidateStatPointBars({ statPoints }: { statPoints: StatTable }) {
  return (
    <span
      className="candidate-sp-bars"
      aria-label={`SPバー: ${formatStatPointSpreadLabel(statPoints)}`}
    >
      {statKeys.map((key) => (
        <span
          className={`candidate-sp-bar ${key}`}
          aria-hidden="true"
          key={key}
        >
          <span style={{ width: `${(statPoints[key] / CHAMPIONS_MAX_STAT_POINTS_PER_STAT) * 100}%` }} />
        </span>
      ))}
    </span>
  );
}

export function CandidateStatPointSpread({ statPoints }: { statPoints: StatTable }) {
  return (
    <span
      className="allocation compact-allocation candidate-stat-spread"
      aria-label={`${formatStatPointSpreadLabel(statPoints)} SP`}
    >
      {statKeys.map((key) => (
        <b className={`candidate-stat-value ${key}`} key={key}>
          <span className="candidate-stat-code">{statLabels[key]}</span>
          <span>{statPoints[key]}</span>
        </b>
      ))}
      <CandidateStatPointBars statPoints={statPoints} />
    </span>
  );
}
