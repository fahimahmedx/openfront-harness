import "./dashboard.css";

type RunSummary = {
  runId: string;
  scenarioId: string;
  status: string;
  startedAt: string;
  model: string;
  winner: string;
  llmWon: boolean;
  finalPlacement: number;
  ticks: number;
  decisionCount: number;
  costUsd: number;
  replayUrl: string;
};

const runButton = document.querySelector<HTMLButtonElement>("#run-button")!;
const sampleButton =
  document.querySelector<HTMLAnchorElement>("#sample-button")!;
const quota = document.querySelector<HTMLElement>("#quota")!;
const scenarioGrid = document.querySelector<HTMLElement>("#scenario-grid")!;
const runsGrid = document.querySelector<HTMLElement>("#runs")!;
const progress = document.querySelector<HTMLElement>("#progress")!;
const sourceLink = document.querySelector<HTMLAnchorElement>("#source-link")!;
const refreshButton =
  document.querySelector<HTMLButtonElement>("#refresh-button")!;

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function ordinal(value: number): string {
  return value === 1
    ? "1st"
    : value === 2
      ? "2nd"
      : value === 3
        ? "3rd"
        : `${value}th`;
}

async function loadScenario() {
  const response = await fetch("/api/scenario");
  const data = await response.json();
  const scenario = data.scenario;
  if (data.sourceUrl) {
    sourceLink.href = data.sourceUrl;
    sourceLink.classList.remove("hidden");
  }
  const metrics = [
    ["Map", `${scenario.map} / ${scenario.mapSize}`],
    ["Players", "1 LLM + 3 nations"],
    ["Seed", scenario.seed],
    [
      "Spawn",
      `${scenario.spawn.label} (${scenario.spawn.x}, ${scenario.spawn.y})`,
    ],
    ["Cadence", `${scenario.decisionIntervalTicks} ticks / decision`],
    ["Actions", `${scenario.actionSlots} fixed slots`],
    ["Time limit", `${scenario.maxSimulatedMinutes} simulated minutes`],
    ["Core", scenario.openfront.version],
  ];
  scenarioGrid.innerHTML = metrics
    .map(
      ([label, value]) =>
        `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join("");
  quota.textContent = `${data.quota.remaining} of ${data.quota.limit} public runs remain today · one run per network`;
  if (data.activeRun) {
    runButton.disabled = true;
    showProgress(data.activeRun);
    void pollRun(data.activeRun.runId);
  }
}

function runCard(run: RunSummary) {
  const outcome = run.llmWon
    ? "LLM victory"
    : `${ordinal(run.finalPlacement)} place · ${run.winner} won`;
  return `<article class="run-card">
    <div class="run-card-top">
      <span class="status ${escapeHtml(run.status)}">${escapeHtml(run.status)} · ${escapeHtml(run.scenarioId)}</span>
      <time>${new Date(run.startedAt).toLocaleDateString()}</time>
    </div>
    <h3>${escapeHtml(outcome)}</h3>
    <p>${escapeHtml(run.model)}</p>
    <div class="run-stats">
      <span><b>${run.decisionCount}</b> decisions</span>
      <span><b>${(run.ticks / 10 / 60).toFixed(1)}</b> sim min</span>
      <span><b>$${run.costUsd.toFixed(3)}</b> inference</span>
    </div>
    <div class="card-actions">
      <a href="${escapeHtml(run.replayUrl)}">Watch full replay →</a>
      <a href="/api/runs/${escapeHtml(run.runId)}/artifact">Artifact</a>
    </div>
  </article>`;
}

async function loadRuns() {
  const response = await fetch("/api/runs");
  const data = await response.json();
  const runs = data.runs as RunSummary[];
  runsGrid.innerHTML = runs.length
    ? runs.map(runCard).join("")
    : `<div class="empty">No completed runs yet. Launch one to create the first artifact.</div>`;
  const sample = runs.find((run) => run.status === "sample");
  if (sample) {
    sampleButton.href = sample.replayUrl;
    sampleButton.classList.remove("hidden");
  }
}

function showProgress(run: any) {
  progress.classList.remove("hidden");
  progress.innerHTML = `<div class="progress-copy">
    <p class="eyebrow">MATCH GENERATING</p>
    <h2>Decision ${escapeHtml(run.decisionCount)} / ${escapeHtml(run.maxDecisionCount)}</h2>
    <p>${escapeHtml(run.latestStrategy ?? "Initializing…")}</p>
  </div>
  <div class="progress-metrics">
    <span>Tick <b>${escapeHtml(run.tick)}</b></span>
    <span>Spent <b>$${Number(run.costUsd ?? 0).toFixed(3)}</b></span>
  </div>`;
}

async function pollRun(runId: string) {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const response = await fetch(`/api/runs/${runId}`);
    if (!response.ok) return;
    const { run } = await response.json();
    if (run.status === "running") {
      showProgress(run);
      continue;
    }
    progress.innerHTML = `<p class="eyebrow">MATCH COMPLETE</p>
      <h2>${escapeHtml(run.outcome?.winner ?? run.winner)} · ${escapeHtml(run.decisionCount)} decisions</h2>
      <a class="result-link" href="/replay/${runId}">Open the full replay →</a>`;
    runButton.disabled = false;
    await Promise.all([loadRuns(), loadScenario()]);
    return;
  }
}

runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  runButton.textContent = "Starting…";
  const response = await fetch("/api/runs", { method: "POST" });
  const data = await response.json();
  runButton.textContent = "Run the benchmark";
  if (!response.ok) {
    runButton.disabled = false;
    quota.textContent = data.error ?? "Could not start the run";
    if (data.run) {
      showProgress(data.run);
      void pollRun(data.run.runId);
    }
    return;
  }
  showProgress({
    decisionCount: 0,
    maxDecisionCount: 120,
    latestStrategy: "Loading the Japan simulation…",
    tick: 0,
    costUsd: 0,
  });
  void pollRun(data.runId);
});
refreshButton.addEventListener("click", () => void loadRuns());

void Promise.all([loadScenario(), loadRuns()]).catch((error) => {
  console.error(error);
  quota.textContent = "The harness API is unavailable.";
});
