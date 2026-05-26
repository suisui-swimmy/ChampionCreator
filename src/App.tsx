import { type KeyboardEvent, useEffect, useRef, useState } from "react";

type ScenarioId = "シナリオA" | "シナリオB" | "シナリオC";

type AttackCard = {
  pokemon: string;
  move: string;
  meta: string[];
  typeLabel: string;
  cardClass: string;
  thumbClass: string;
  thumbText: string;
  checks?: string[];
};

type Scenario = {
  id: ScenarioId;
  summary: string;
  attacks: AttackCard[];
  hasAddAttack?: boolean;
};

type Candidate = {
  rank: number;
  allocation: [number, number, number, number, number, number];
  usage: string;
  passLabel: string;
  pass: boolean;
  bottleneck: string;
};

const evRows = [
  { key: "hp", label: "HP", stat: 297, sp: 2, width: "10%", fixed: false },
  { key: "atk", label: "A", stat: 328, sp: 0, width: "0%", fixed: false },
  { key: "def", label: "B", stat: 197, sp: 0, width: "12%", fixed: false },
  { key: "spa", label: "C", stat: 348, sp: 32, width: "100%", fixed: true },
  { key: "spd", label: "D", stat: 206, sp: 0, width: "0%", fixed: false },
  { key: "spe", label: "S", stat: 328, sp: 32, width: "100%", fixed: true },
] as const;

const scenarios: Scenario[] = [
  {
    id: "シナリオA",
    summary: "1回耐える / 93.8%以上",
    attacks: [
      {
        pokemon: "ランドロス(霊獣)",
        move: "じしん",
        meta: ["Lv.100", "いじっぱり", "こだわりハチマキ"],
        typeLabel: "じめん / 物理",
        cardClass: "ground",
        thumbClass: "landorus",
        thumbText: "L",
      },
      {
        pokemon: "ガブリアス",
        move: "げきりん",
        meta: ["Lv.100", "ようき", "こだわりスカーフ"],
        typeLabel: "ドラゴン / 物理",
        cardClass: "dragon",
        thumbClass: "garchomp",
        thumbText: "G",
      },
    ],
  },
  {
    id: "シナリオB",
    summary: "確定2発 / 75.0%以上",
    attacks: [
      {
        pokemon: "ハピナス",
        move: "だいもんじ",
        meta: [],
        checks: ["もらもの", "壁"],
        typeLabel: "ほのお / 特殊",
        cardClass: "fire",
        thumbClass: "blissey",
        thumbText: "H",
      },
      {
        pokemon: "サーフゴー",
        move: "シャドーボール",
        meta: ["ランク ±0", "こだわりメガネ"],
        typeLabel: "ゴースト / 特殊",
        cardClass: "ghost",
        thumbClass: "gholdengo",
        thumbText: "S",
      },
    ],
  },
  {
    id: "シナリオC",
    summary: "最速ドラパルト抜き",
    hasAddAttack: true,
    attacks: [
      {
        pokemon: "ドラパルト",
        move: "ドラゴンアロー",
        meta: ["すりぬけ", "きあいのタスキ"],
        typeLabel: "ドラゴン / 物理",
        cardClass: "dragon",
        thumbClass: "dragapult",
        thumbText: "D",
      },
    ],
  },
];

const candidates: Candidate[] = [
  { rank: 1, allocation: [12, 0, 4, 28, 0, 22], usage: "66 / 0", passLabel: "3 / 3", pass: true, bottleneck: "シナリオA +7.9%" },
  { rank: 2, allocation: [12, 0, 8, 28, 0, 18], usage: "66 / 0", passLabel: "3 / 3", pass: true, bottleneck: "シナリオB +5.3%" },
  { rank: 3, allocation: [12, 0, 0, 30, 0, 24], usage: "66 / 0", passLabel: "3 / 3", pass: true, bottleneck: "シナリオC +4.1%" },
  { rank: 4, allocation: [12, 0, 12, 24, 0, 18], usage: "64 / 2", passLabel: "2 / 3", pass: false, bottleneck: "シナリオB -8.7%" },
];

export function App() {
  const [selectedScenario, setSelectedScenario] = useState<ScenarioId>("シナリオA");
  const [selectedRank, setSelectedRank] = useState(1);
  const [isRunning, setIsRunning] = useState(false);
  const [applyLabel, setApplyLabel] = useState("適用");
  const runTimer = useRef<number | null>(null);
  const applyTimer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (runTimer.current !== null) {
        window.clearTimeout(runTimer.current);
      }
      if (applyTimer.current !== null) {
        window.clearTimeout(applyTimer.current);
      }
    };
  }, []);

  const handleRun = () => {
    if (isRunning) {
      return;
    }

    setIsRunning(true);
    runTimer.current = window.setTimeout(() => setIsRunning(false), 900);
  };

  const handleApply = () => {
    setApplyLabel("適用済み");
    applyTimer.current = window.setTimeout(() => setApplyLabel("適用"), 1200);
  };

  return (
    <div className={`app-shell${isRunning ? " is-running" : ""}`}>
      <header className="topbar">
        <div>
          <h1>ChampionCreator</h1>
          <p>Pokemon Champions 自動耐久調整</p>
        </div>
        <div className="topbar-actions">
          <button className="ghost-button" type="button">JSON</button>
          <button className="ghost-button" type="button">共有</button>
          <button className="primary-button" type="button" id="runButton" onClick={handleRun}>
            {isRunning ? "計算中..." : "計算実行"}
          </button>
        </div>
      </header>

      <main className="workbench">
        <TargetPanel />
        <ScenarioPanel selectedScenario={selectedScenario} onSelectScenario={setSelectedScenario} />
        <ResultsPanel selectedRank={selectedRank} onSelectRank={setSelectedRank} />
        <DetailPanel
          selectedScenario={selectedScenario}
          selectedRank={selectedRank}
          applyLabel={applyLabel}
          onApply={handleApply}
        />
      </main>
    </div>
  );
}

function TargetPanel() {
  return (
    <section className="target-panel" aria-labelledby="target-title">
      <div className="section-heading">
        <div>
          <h2 id="target-title">調整対象</h2>
          <span>自分のポケモン</span>
        </div>
        <button className="icon-button" type="button" aria-label="調整対象をリセット">↺</button>
      </div>

      <div className="target-summary">
        <div className="target-art" aria-hidden="true">
          <div className="wing-mark" />
          <strong>MX</strong>
        </div>
        <div className="field-grid">
          <label>
            ポケモン
            <select defaultValue="メガリザードンX">
              <option>メガリザードンX</option>
              <option>ガブリアス</option>
            </select>
          </label>
          <label>
            性格
            <select defaultValue="ひかえめ">
              <option>ひかえめ</option>
              <option>ようき</option>
            </select>
          </label>
          <label>
            Lv.
            <input type="number" defaultValue="100" min="1" max="100" />
          </label>
          <label>
            持ち物
            <select defaultValue="こだわりスカーフ">
              <option>こだわりスカーフ</option>
              <option>あつぞこブーツ</option>
            </select>
          </label>
        </div>
      </div>

      <div className="type-row">
        <span className="type-chip fire">ほのお</span>
        <span className="type-chip dragon">ドラゴン</span>
        <span className="type-chip dragon">テラ: ドラゴン</span>
      </div>

      <div className="ev-table" aria-label="努力値配分">
        <div className="ev-header">
          <span>能力</span>
          <span>実数値</span>
          <span>現在SP</span>
          <span>SP配分</span>
          <span>固定</span>
        </div>
        {evRows.map((row) => (
          <div className={`ev-row ${row.key}`} key={row.key}>
            <strong>{row.label}</strong>
            <span>{row.stat}</span>
            <input defaultValue={row.sp} aria-label={`${row.label} SP`} />
            <div className="bar"><i style={{ width: row.width }} /></div>
            <input type="checkbox" defaultChecked={row.fixed} aria-label={`${row.label}を固定`} />
          </div>
        ))}
      </div>

      <div className="sp-summary">
        <span>合計SP</span>
        <strong>66 / 66</strong>
      </div>
    </section>
  );
}

type ScenarioPanelProps = {
  selectedScenario: ScenarioId;
  onSelectScenario: (scenario: ScenarioId) => void;
};

function ScenarioPanel({ selectedScenario, onSelectScenario }: ScenarioPanelProps) {
  return (
    <section className="scenario-panel" aria-labelledby="scenario-title">
      <div className="section-heading">
        <div>
          <h2 id="scenario-title">仮想敵シナリオ</h2>
          <span>カードで条件をまとめる</span>
        </div>
        <button className="ghost-button" type="button">+ シナリオを追加</button>
      </div>

      <div className="scenario-grid">
        {scenarios.map((scenario) => (
          <ScenarioCard
            key={scenario.id}
            scenario={scenario}
            selected={selectedScenario === scenario.id}
            onSelect={() => onSelectScenario(scenario.id)}
          />
        ))}
      </div>
    </section>
  );
}

type ScenarioCardProps = {
  scenario: Scenario;
  selected: boolean;
  onSelect: () => void;
};

function ScenarioCard({ scenario, selected, onSelect }: ScenarioCardProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  };

  return (
    <article
      className={`scenario-card${selected ? " selected" : ""}`}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      <div className="scenario-header">
        <label className="switch"><input type="checkbox" defaultChecked /><span /></label>
        <div><strong>{scenario.id}</strong><small>{scenario.summary}</small></div>
        <button className="icon-button" type="button" aria-label={`${scenario.id}を折りたたむ`}>⌄</button>
      </div>
      <div className={`attack-pair${scenario.hasAddAttack ? " single" : ""}`}>
        {scenario.attacks.map((attack) => <AttackCardView attack={attack} key={`${scenario.id}-${attack.pokemon}`} />)}
        {scenario.hasAddAttack ? <button className="add-attack" type="button">+ 攻撃を追加</button> : null}
      </div>
    </article>
  );
}

function AttackCardView({ attack }: { attack: AttackCard }) {
  return (
    <div className={`attack-card ${attack.cardClass}`}>
      <div className={`thumb ${attack.thumbClass}`}>{attack.thumbText}</div>
      <div className="attack-fields">
        <select defaultValue={attack.pokemon}><option>{attack.pokemon}</option></select>
        <select defaultValue={attack.move}><option>{attack.move}</option></select>
        {attack.checks ? (
          <div className="check-row">
            {attack.checks.map((check, index) => (
              <label key={check}><input type="checkbox" defaultChecked={index === 0} /> {check}</label>
            ))}
          </div>
        ) : (
          <div className="mini-row">
            {attack.meta.map((meta) => <span key={meta}>{meta}</span>)}
          </div>
        )}
      </div>
      <div className="type-strip">{attack.typeLabel}</div>
    </div>
  );
}

type ResultsPanelProps = {
  selectedRank: number;
  onSelectRank: (rank: number) => void;
};

function ResultsPanel({ selectedRank, onSelectRank }: ResultsPanelProps) {
  return (
    <section className="results-panel" aria-labelledby="results-title">
      <div className="section-heading">
        <div>
          <h2 id="results-title">結果</h2>
          <span>候補 38 件</span>
        </div>
        <div className="segmented">
          <button className="active" type="button">PASSのみ</button>
          <button type="button">全部</button>
        </div>
      </div>

      <div className="result-layout">
        <aside className="filter-panel">
          <h3>表示フィルタ</h3>
          <label><input type="checkbox" defaultChecked /> 耐久</label>
          <label><input type="checkbox" defaultChecked /> 火力</label>
          <label><input type="checkbox" defaultChecked /> 素早さ</label>
          <select aria-label="ソート">
            <option>総使用SPが少ない順</option>
            <option>余裕が大きい順</option>
          </select>
        </aside>

        <div className="candidate-table" role="table" aria-label="候補一覧">
          <div className="candidate-row header" role="row">
            <span>順位</span><span>SP配分 (H-A-B-C-D-S)</span><span>使用/残り</span><span>PASS</span><span>ボトルネック</span>
          </div>
          {candidates.map((candidate) => (
            <button
              className={`candidate-row${selectedRank === candidate.rank ? " selected" : ""}${candidate.pass ? "" : " warning"}`}
              type="button"
              key={candidate.rank}
              onClick={() => onSelectRank(candidate.rank)}
            >
              <span className={`rank${candidate.rank === 1 ? " crown" : ""}`}>{candidate.rank}</span>
              <span className="allocation">
                {candidate.allocation.map((value, index) => <b key={`${candidate.rank}-${index}`}>{value}</b>)}
                <i />
              </span>
              <span>{candidate.usage}</span>
              <span className={candidate.pass ? "pass" : "fail"}>{candidate.passLabel}</span>
              <span>{candidate.bottleneck}</span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

type DetailPanelProps = {
  selectedScenario: ScenarioId;
  selectedRank: number;
  applyLabel: string;
  onApply: () => void;
};

function DetailPanel({ selectedScenario, selectedRank, applyLabel, onApply }: DetailPanelProps) {
  const selectedCandidate = candidates.find((candidate) => candidate.rank === selectedRank) ?? candidates[0];

  return (
    <aside className="detail-panel" aria-live="polite">
      <div className="section-heading">
        <div>
          <h2>選択中の候補 <span>#{selectedRank}</span></h2>
          <span>{selectedScenario} を確認中</span>
        </div>
        <button className="primary-button small" type="button" onClick={onApply}>{applyLabel}</button>
      </div>
      <div className="detail-allocation">
        {["H", "A", "B", "C", "D", "S"].map((label) => (
          <span key={label}>{label}</span>
        ))}
        {selectedCandidate.allocation.map((value, index) => (
          <strong key={`value-${index}`}>{value}</strong>
        ))}
      </div>
      <div className="tabs" role="tablist" aria-label="候補詳細">
        <button className="active" type="button">条件の確認</button>
        <button type="button">詳細ステータス</button>
        <button type="button">ダメージ内訳</button>
      </div>
      <div className="check-list">
        <div><span className="badge blue" /><strong>シナリオA</strong><span>98.7%</span><em>PASS</em><small>+7.9%</small></div>
        <div><span className="badge red" /><strong>シナリオB</strong><span>82.3%</span><em>PASS</em><small>+7.3%</small></div>
        <div><span className="badge purple" /><strong>シナリオC</strong><span>6実数値上</span><em>PASS</em><small>+6</small></div>
      </div>
    </aside>
  );
}
