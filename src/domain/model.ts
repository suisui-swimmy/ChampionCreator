export const STAT_KEYS = ["hp", "atk", "def", "spa", "spd", "spe"] as const;

export type StatKey = (typeof STAT_KEYS)[number];

export type StatTable = Record<StatKey, number>;

export type NatureName =
  | "Hardy"
  | "Adamant"
  | "Bold"
  | "Calm"
  | "Modest"
  | "Jolly"
  | "Timid"
  | "Careful"
  | "Impish";

export type SupportStatus =
  | "supported"
  | "needs-confirmation"
  | "unsupported-temporary"
  | "adapter-temporary";

export type ScenarioKind = "defence" | "offence" | "speed";

export type MoveCategory = "Physical" | "Special" | "Status" | "Unknown";

export interface VersionedPayload {
  schemaVersion: number;
  dataVersion: string;
}

export interface SpeciesRef {
  id: string;
  displayName: string;
  showdownName: string;
  nationalDexNo?: number;
  championsKey?: string;
  iconAsset?: string;
  sourceStatus: SupportStatus;
  baseStats?: StatTable;
  notes?: string;
}

export interface MoveRef {
  id: string;
  displayName: string;
  showdownName: string;
  category: MoveCategory;
  typeName?: string;
  powerOverride?: number;
  sourceStatus: SupportStatus;
}

export interface ChampionsStatPoints {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

export interface ManualStatOverrides {
  finalStats?: Partial<StatTable>;
  movePower?: number;
  damageMultiplier?: number;
}

export interface Build {
  id: string;
  label: string;
  species: SpeciesRef;
  level: number;
  nature: NatureName;
  ivs: StatTable;
  statPoints: ChampionsStatPoints;
  ability?: string;
  item?: string;
  teraType?: string;
  manualOverrides?: ManualStatOverrides;
}

export interface FieldState {
  weather?: "none" | "sun" | "rain" | "sand" | "snow";
  terrain?: "none" | "electric" | "grassy" | "misty" | "psychic";
  reflect?: boolean;
  lightScreen?: boolean;
  criticalHit?: boolean;
  spreadMove?: boolean;
  hazardDamage?: {
    label: string;
    maxHpRatio: number;
  };
}

export interface RankStages {
  atk?: number;
  def?: number;
  spa?: number;
  spd?: number;
  spe?: number;
}

export interface BaseScenario {
  id: string;
  kind: ScenarioKind;
  enabled: boolean;
  title: string;
  attacker: Build;
  defender: Build;
  move?: MoveRef;
  field: FieldState;
  attackerStages?: RankStages;
  defenderStages?: RankStages;
  manualOverrides?: ManualStatOverrides;
  tags: string[];
  notes?: string;
}

export interface ScenarioRow {
  id: string;
  label: string;
  kind: ScenarioKind;
  enabled: boolean;
  title: string;
  goalSummary: string;
  scenarioIds: string[];
  notes?: string;
}

export interface DefenceConstraint {
  type: "survive";
  scenarioId: string;
  hits: number;
  minSurvivalRate: number;
}

export interface OffenceConstraint {
  type: "ko";
  scenarioId: string;
  hits: number;
  minKoRate: number;
}

export interface SpeedConstraint {
  type: "outspeed";
  scenarioId: string;
  relation: "strictly-greater" | "greater-or-equal";
  minMargin: number;
}

export type Constraint =
  | DefenceConstraint
  | OffenceConstraint
  | SpeedConstraint;

export interface SearchBudget {
  maxPerStat: number;
  maxTotal: number;
  fixed: Partial<ChampionsStatPoints>;
  lowerBounds: Partial<ChampionsStatPoints>;
  mode: "fast" | "precise";
}

export interface Candidate {
  id: string;
  statPoints: ChampionsStatPoints;
  totalSp: number;
  remainingSp: number;
  searchPhase: "coarse" | "refined" | "final-verified";
}

export interface ScenarioEvaluation {
  scenarioId: string;
  passed: boolean;
  probability: number;
  damageRange?: [number, number];
  requiredValue?: number;
  actualValue?: number;
  explanation: string;
}

export interface Result {
  candidate: Candidate;
  passed: boolean;
  score: number;
  bottleneckScenarioId: string;
  evaluations: ScenarioEvaluation[];
  markdownSummary: string;
}

export interface SupportMatrixItem {
  id: string;
  label: string;
  status: SupportStatus;
  handling: string;
}

export interface AdjustmentProject extends VersionedPayload {
  id: string;
  title: string;
  target: Build;
  scenarios: BaseScenario[];
  scenarioRows: ScenarioRow[];
  constraints: Constraint[];
  searchBudget: SearchBudget;
  supportMatrix: SupportMatrixItem[];
  results: Result[];
}
