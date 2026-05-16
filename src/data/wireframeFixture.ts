import { DATA_VERSION } from "../version";
import type {
  AdjustmentProject,
  Build,
  MoveRef,
  SpeciesRef,
  StatTable,
} from "../domain/model";

const perfectIvs: StatTable = {
  hp: 31,
  atk: 31,
  def: 31,
  spa: 31,
  spd: 31,
  spe: 31,
};

const eggSpecies: SpeciesRef = {
  id: "egg-placeholder",
  displayName: "タマゴ",
  showdownName: "Pikachu",
  championsKey: "pm0000_00_00_00_0",
  iconAsset: "/assets/pokemon-icons/pm0000_00_00_00_0.png",
  sourceStatus: "adapter-temporary",
  baseStats: {
    hp: 55,
    atk: 80,
    def: 70,
    spa: 65,
    spd: 70,
    spe: 90,
  },
  notes:
    "ワイヤーフレーム用の仮データ。Showdown 名は smoke test 用に差し替えやすい既存名を置く。",
};

const virtualAttacker: SpeciesRef = {
  id: "virtual-attacker-a",
  displayName: "仮想敵A",
  showdownName: "Garchomp",
  sourceStatus: "needs-confirmation",
  baseStats: {
    hp: 108,
    atk: 130,
    def: 95,
    spa: 80,
    spd: 85,
    spe: 102,
  },
};

const virtualWall: SpeciesRef = {
  id: "virtual-wall-b",
  displayName: "仮想敵B",
  showdownName: "Corviknight",
  sourceStatus: "needs-confirmation",
  baseStats: {
    hp: 98,
    atk: 87,
    def: 105,
    spa: 53,
    spd: 85,
    spe: 67,
  },
};

const makeBuild = (overrides: Partial<Build> & Pick<Build, "id" | "label" | "species">): Build => ({
  level: 50,
  nature: "Jolly",
  ivs: perfectIvs,
  statPoints: {
    hp: 0,
    atk: 0,
    def: 0,
    spa: 0,
    spd: 0,
    spe: 0,
  },
  ability: "未指定",
  item: "未指定",
  ...overrides,
});

const targetBuild = makeBuild({
  id: "target-build",
  label: "調整対象",
  species: eggSpecies,
  nature: "Jolly",
  ability: "任意",
  item: "Clear Amulet",
  teraType: "Water",
  statPoints: {
    hp: 12,
    atk: 20,
    def: 8,
    spa: 0,
    spd: 8,
    spe: 18,
  },
  manualOverrides: {
    finalStats: {
      hp: 167,
      atk: 152,
      def: 116,
      spd: 118,
      spe: 154,
    },
  },
});

const earthquake: MoveRef = {
  id: "earthquake",
  displayName: "じしん",
  showdownName: "Earthquake",
  category: "Physical",
  typeName: "Ground",
  sourceStatus: "supported",
};

const aquaJet: MoveRef = {
  id: "aqua-jet",
  displayName: "アクアジェット",
  showdownName: "Aqua Jet",
  category: "Physical",
  typeName: "Water",
  sourceStatus: "supported",
};

const thunderbolt: MoveRef = {
  id: "thunderbolt",
  displayName: "10まんボルト",
  showdownName: "Thunderbolt",
  category: "Special",
  typeName: "Electric",
  sourceStatus: "supported",
};

const virtualSupport: SpeciesRef = {
  id: "virtual-support-c",
  displayName: "仮想敵C",
  showdownName: "Flutter Mane",
  sourceStatus: "needs-confirmation",
  baseStats: {
    hp: 55,
    atk: 55,
    def: 55,
    spa: 135,
    spd: 135,
    spe: 135,
  },
};

export const wireframeProject: AdjustmentProject = {
  schemaVersion: 1,
  dataVersion: DATA_VERSION,
  id: "wireframe-project-001",
  title: "Regulation M-A 連立調整メモ",
  target: targetBuild,
  searchBudget: {
    maxPerStat: 32,
    maxTotal: 66,
    fixed: {
      atk: 20,
    },
    lowerBounds: {
      spe: 16,
    },
    mode: "fast",
  },
  scenarios: [
    {
      id: "def-garchomp-earthquake",
      kind: "defence",
      enabled: true,
      title: "仮想敵Aのじしんを耐える",
      attacker: makeBuild({
        id: "attacker-garchomp",
        label: "攻撃側",
        species: virtualAttacker,
        nature: "Adamant",
        statPoints: {
          hp: 0,
          atk: 32,
          def: 0,
          spa: 0,
          spd: 0,
          spe: 20,
        },
        item: "Choice Band",
      }),
      defender: targetBuild,
      move: earthquake,
      field: {
        weather: "none",
        terrain: "none",
        reflect: false,
        criticalHit: false,
        spreadMove: false,
      },
      attackerStages: {
        atk: 1,
      },
      tags: ["耐久", "物理", "高優先"],
    },
    {
      id: "def-flutter-thunderbolt",
      kind: "defence",
      enabled: true,
      title: "仮想敵Cの10まんボルトを耐える",
      attacker: makeBuild({
        id: "attacker-flutter",
        label: "攻撃側",
        species: virtualSupport,
        nature: "Timid",
        statPoints: {
          hp: 0,
          atk: 0,
          def: 0,
          spa: 32,
          spd: 0,
          spe: 32,
        },
        item: "Booster Energy",
      }),
      defender: targetBuild,
      move: thunderbolt,
      field: {
        weather: "none",
        terrain: "electric",
        lightScreen: true,
      },
      attackerStages: {
        spa: 1,
      },
      tags: ["耐久", "特殊", "ダブル想定"],
    },
    {
      id: "off-target-aqua-jet",
      kind: "offence",
      enabled: true,
      title: "アクアジェットで仮想敵Bを2発圏内",
      attacker: targetBuild,
      defender: makeBuild({
        id: "defender-corviknight",
        label: "防御側",
        species: virtualWall,
        nature: "Impish",
        statPoints: {
          hp: 24,
          atk: 0,
          def: 20,
          spa: 0,
          spd: 4,
          spe: 0,
        },
        item: "Sitrus Berry",
      }),
      move: aquaJet,
      field: {
        weather: "rain",
        terrain: "none",
        reflect: false,
      },
      tags: ["火力", "先制技"],
    },
    {
      id: "spe-plus-one-check",
      kind: "speed",
      enabled: true,
      title: "+1 で最速仮想敵Aを抜く",
      attacker: targetBuild,
      defender: makeBuild({
        id: "speed-target-garchomp",
        label: "速度比較対象",
        species: virtualAttacker,
        nature: "Jolly",
        statPoints: {
          hp: 0,
          atk: 0,
          def: 0,
          spa: 0,
          spd: 0,
          spe: 32,
        },
      }),
      field: {
        weather: "none",
        terrain: "none",
      },
      attackerStages: {
        spe: 1,
      },
      tags: ["素早さ", "積み後"],
      notes: "速度計算は Milestone 4 で Showdown / @pkmn 系に寄せて検証する。",
    },
  ],
  scenarioRows: [
    {
      id: "scenario-row-a",
      label: "シナリオA",
      kind: "defence",
      enabled: true,
      title: "A+Bの集中攻撃を耐える",
      goalSummary: "2攻撃を連続で耐える 93.8%以上",
      scenarioIds: ["def-garchomp-earthquake", "def-flutter-thunderbolt"],
      notes: "ダブルバトル想定。行内の攻撃カードを左から順に評価する。",
    },
    {
      id: "scenario-row-b",
      label: "シナリオB",
      kind: "offence",
      enabled: true,
      title: "雨下アクアジェットで削り切る",
      goalSummary: "確定2発 100%",
      scenarioIds: ["off-target-aqua-jet"],
    },
    {
      id: "scenario-row-c",
      label: "シナリオC",
      kind: "speed",
      enabled: true,
      title: "+1後に最速ラインを抜く",
      goalSummary: "最速仮想敵Aを+1後に抜く",
      scenarioIds: ["spe-plus-one-check"],
    },
    {
      id: "scenario-row-d",
      label: "シナリオD",
      kind: "defence",
      enabled: false,
      title: "参考: 特殊耐久",
      goalSummary: "この行は無効化されています",
      scenarioIds: [],
    },
  ],
  constraints: [
    {
      type: "survive",
      scenarioId: "def-garchomp-earthquake",
      hits: 1,
      minSurvivalRate: 0.9375,
    },
    {
      type: "survive",
      scenarioId: "def-flutter-thunderbolt",
      hits: 1,
      minSurvivalRate: 0.9375,
    },
    {
      type: "ko",
      scenarioId: "off-target-aqua-jet",
      hits: 2,
      minKoRate: 1,
    },
    {
      type: "outspeed",
      scenarioId: "spe-plus-one-check",
      relation: "strictly-greater",
      minMargin: 1,
    },
  ],
  supportMatrix: [
    {
      id: "damage-rolls",
      label: "ダメージ乱数",
      status: "supported",
      handling: "@smogon/calc の結果を薄いラッパー経由で使う予定。",
    },
    {
      id: "stat-points",
      label: "SP ルール",
      status: "supported",
      handling: "0..32 SP / 合計 66 SP を正規モデルにする。",
    },
    {
      id: "calc-input-catalog",
      label: "入力候補ポケモン・技",
      status: "supported",
      handling:
        "@smogon/calc / Showdown 由来データに存在するものは原則入力可能。レギュ合法性は検証しない。",
    },
    {
      id: "multi-hit-sequence",
      label: "連続被弾・定数ダメージ",
      status: "adapter-temporary",
      handling: "各 hit は calc、シーケンス管理だけアプリ側に閉じ込める。",
    },
    {
      id: "mega-tera",
      label: "Mega / Tera など",
      status: "needs-confirmation",
      handling:
        "全解禁サンドボックス前提で入力欄は確保し、未確定仕様は精度ラベルや手入力上書きで扱う。",
    },
  ],
  results: [
    {
      candidate: {
        id: "candidate-001",
        statPoints: {
          hp: 14,
          atk: 20,
          def: 10,
          spa: 0,
          spd: 6,
          spe: 16,
        },
        totalSp: 66,
        remainingSp: 0,
        searchPhase: "final-verified",
      },
      passed: true,
      score: 92,
      bottleneckScenarioId: "def-garchomp-earthquake",
      evaluations: [
        {
          scenarioId: "def-garchomp-earthquake",
          passed: true,
          probability: 0.9375,
          damageRange: [139, 166],
          explanation: "最大乱数以外を耐える想定。最終実装では calc 結果で再検証。",
        },
        {
          scenarioId: "off-target-aqua-jet",
          passed: true,
          probability: 1,
          damageRange: [54, 66],
          explanation: "雨補正込みで2発圏内のダミー表示。",
        },
        {
          scenarioId: "def-flutter-thunderbolt",
          passed: true,
          probability: 0.941,
          damageRange: [122, 151],
          explanation: "壁込みの特殊被弾を耐えるダミー表示。",
        },
        {
          scenarioId: "spe-plus-one-check",
          passed: true,
          probability: 1,
          requiredValue: 231,
          actualValue: 232,
          explanation: "+1 後に 1 だけ上回る。",
        },
      ],
      markdownSummary:
        "H14-A20-B10-C0-D6-S16 / じしん耐え 93.75% / アクアジェット2発 / +1で仮想敵A抜き",
    },
    {
      candidate: {
        id: "candidate-002",
        statPoints: {
          hp: 16,
          atk: 20,
          def: 8,
          spa: 0,
          spd: 4,
          spe: 18,
        },
        totalSp: 66,
        remainingSp: 0,
        searchPhase: "final-verified",
      },
      passed: true,
      score: 88,
      bottleneckScenarioId: "off-target-aqua-jet",
      evaluations: [
        {
          scenarioId: "def-garchomp-earthquake",
          passed: true,
          probability: 1,
          damageRange: [136, 162],
          explanation: "HP寄せで耐久余裕を確保。",
        },
        {
          scenarioId: "off-target-aqua-jet",
          passed: true,
          probability: 1,
          damageRange: [53, 64],
          explanation: "火力側の余裕が少ない。",
        },
        {
          scenarioId: "def-flutter-thunderbolt",
          passed: true,
          probability: 0.963,
          damageRange: [118, 148],
          explanation: "特殊耐久に少し余裕あり。",
        },
        {
          scenarioId: "spe-plus-one-check",
          passed: true,
          probability: 1,
          requiredValue: 231,
          actualValue: 235,
          explanation: "素早さに余裕あり。",
        },
      ],
      markdownSummary:
        "H16-A20-B8-C0-D4-S18 / 耐久安定 / 火力条件ぎりぎり / 速度余裕あり",
    },
  ],
};
