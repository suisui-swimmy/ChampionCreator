const scenarioCards = document.querySelectorAll(".scenario-card");
const candidateRows = document.querySelectorAll(".candidate-row:not(.header)");
const selectedScenario = document.querySelector("#selectedScenario");
const candidateRank = document.querySelector("#candidateRank");
const runButton = document.querySelector("#runButton");
const applyButton = document.querySelector("#applyButton");

scenarioCards.forEach((card) => {
  card.addEventListener("click", () => selectScenario(card));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectScenario(card);
    }
  });
});

candidateRows.forEach((row) => {
  row.addEventListener("click", () => {
    candidateRows.forEach((item) => item.classList.remove("selected"));
    row.classList.add("selected");
    candidateRank.textContent = `#${row.dataset.rank}`;
  });
});

runButton.addEventListener("click", () => {
  document.body.classList.add("is-running");
  runButton.textContent = "計算中...";

  window.setTimeout(() => {
    document.body.classList.remove("is-running");
    runButton.textContent = "計算実行";
  }, 900);
});

applyButton.addEventListener("click", () => {
  applyButton.textContent = "適用済み";
  window.setTimeout(() => {
    applyButton.textContent = "適用";
  }, 1200);
});

function selectScenario(card) {
  scenarioCards.forEach((item) => item.classList.remove("selected"));
  card.classList.add("selected");
  selectedScenario.textContent = `${card.dataset.scenario} を確認中`;
}
