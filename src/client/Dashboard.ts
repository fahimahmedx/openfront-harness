import "./dashboard.css";

type RunSummary = {
  runId: string;
  scenarioId: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  model: string;
  provider?: string | null;
  winner: string;
  llmWon: boolean;
  finalPlacement: number;
  ticks: number;
  decisionCount: number;
  costUsd: number;
  replayUrl: string;
};

type RunProgressView = {
  runId?: string;
  status: string;
  tick?: number;
  decisionCount?: number;
  maxDecisionCount?: number;
  latestStrategy?: string;
  costUsd?: number;
  error?: string;
  winner?: string;
  replayUrl?: string;
  outcome?: { winner?: string; llmWon?: boolean };
};

type QuotaView = {
  remaining: number;
  limit: number;
};

const runButton = document.querySelector<HTMLButtonElement>("#run-button")!;
const sampleLinks = Array.from(
  document.querySelectorAll<HTMLAnchorElement>("[data-sample-link]"),
);
const quota = document.querySelector<HTMLElement>("#quota")!;
const generationStatus =
  document.querySelector<HTMLElement>("#generation-status")!;
const availabilityDot =
  document.querySelector<HTMLElement>("#availability-dot")!;
const scenarioGrid = document.querySelector<HTMLElement>("#scenario-grid")!;
const runsGrid = document.querySelector<HTMLElement>("#runs-grid")!;
const progress = document.querySelector<HTMLElement>("#progress")!;
const sourceLink = document.querySelector<HTMLAnchorElement>("#source-link")!;
const refreshButton =
  document.querySelector<HTMLButtonElement>("#refresh-button")!;

const proofOutcome = document.querySelector<HTMLElement>("#proof-outcome")!;
const proofDecisions = document.querySelector<HTMLElement>("#proof-decisions")!;
const proofTime = document.querySelector<HTMLElement>("#proof-time")!;
const proofCost = document.querySelector<HTMLElement>("#proof-cost")!;
const posterScenario = document.querySelector<HTMLElement>("#poster-scenario")!;
const posterResult = document.querySelector<HTMLElement>("#poster-result")!;

let generationAvailable: boolean | null = null;
let quotaState: QuotaView | null = null;
let activeRunId: string | null = null;
let pollingRunId: string | null = null;
let launchPending = false;

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

function scenarioLabel(scenarioId: string): string {
  return scenarioId
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function updateRunControls(): void {
  const quotaExhausted = quotaState !== null && quotaState.remaining <= 0;
  const busy = launchPending || activeRunId !== null;
  runButton.disabled = busy || generationAvailable !== true || quotaExhausted;

  if (launchPending) {
    runButton.textContent = "Starting trial…";
  } else if (activeRunId) {
    runButton.textContent = "Trial in progress";
  } else if (generationAvailable === false) {
    runButton.textContent = "Generation unavailable";
  } else if (quotaExhausted) {
    runButton.textContent = "Daily quota exhausted";
  } else {
    runButton.textContent = "Run another trial";
  }
}

function setQuotaText(message?: string): void {
  if (message) {
    quota.textContent = message;
    return;
  }
  if (!quotaState) {
    quota.textContent = "Public quota is unavailable.";
    return;
  }
  quota.textContent = `${quotaState.remaining} of ${quotaState.limit} public runs remain today · one run per network`;
}

function updateSample(sample: RunSummary): void {
  sampleLinks.forEach((link) => {
    link.href = sample.replayUrl;
  });
  const outcome = sample.llmWon
    ? "LLM victory"
    : `${ordinal(sample.finalPlacement)} place`;
  proofOutcome.textContent = outcome;
  proofDecisions.textContent = sample.decisionCount.toLocaleString();
  proofTime.textContent = `${(sample.ticks / 10 / 60).toFixed(1)} min`;
  proofCost.textContent = `$${sample.costUsd.toFixed(3)}`;
  posterScenario.textContent = scenarioLabel(sample.scenarioId);
  posterResult.textContent = sample.llmWon
    ? "Verified LLM victory"
    : `Verified ${ordinal(sample.finalPlacement)}-place finish`;
}

async function loadHealth(): Promise<void> {
  const response = await fetch("/api/health");
  if (!response.ok) throw new Error("Health check failed");
  const data = (await response.json()) as { generationAvailable: boolean };
  generationAvailable = data.generationAvailable;
  availabilityDot.classList.toggle("available", generationAvailable);
  availabilityDot.classList.toggle("unavailable", !generationAvailable);
  generationStatus.textContent = generationAvailable
    ? "Fresh generation is available"
    : "Fresh generation is offline; the verified replay remains available";
  updateRunControls();
}

async function loadScenario(): Promise<void> {
  const response = await fetch("/api/scenario");
  if (!response.ok) throw new Error("Scenario request failed");
  const data = await response.json();
  const scenario = data.scenario;
  quotaState = data.quota as QuotaView;

  if (data.sourceUrl) {
    sourceLink.href = data.sourceUrl;
    sourceLink.classList.remove("hidden");
  }

  const metrics = [
    ["Scenario", scenarioLabel(scenario.id)],
    ["Map", `${scenario.map} / ${scenario.mapSize}`],
    ["Match", "1 LLM + 3 nations"],
    ["Decision cadence", `${scenario.decisionIntervalTicks} ticks`],
    ["Action bandwidth", `${scenario.actionSlots} IDs / decision`],
    [
      "Limits",
      `${scenario.maxDecisionCount} decisions / ${scenario.maxSimulatedMinutes} min`,
    ],
    ["Seed", scenario.seed],
    ["Engine", scenario.openfront.version],
  ];
  scenarioGrid.innerHTML = metrics
    .map(
      ([label, value]) =>
        `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`,
    )
    .join("");
  setQuotaText();

  if (data.activeRun?.runId) {
    const runId = String(data.activeRun.runId);
    activeRunId = runId;
    showProgress(data.activeRun);
    void pollRun(runId);
  }
  updateRunControls();
}

function runCard(run: RunSummary): string {
  const outcome = run.llmWon
    ? "LLM victory"
    : `${ordinal(run.finalPlacement)} place · ${run.winner} won`;
  const statusLabel = run.status === "sample" ? "Verified sample" : run.status;
  return `<article class="run-card">
    <div class="run-card-top">
      <span class="status ${escapeHtml(run.status)}">${escapeHtml(statusLabel)} · ${escapeHtml(scenarioLabel(run.scenarioId))}</span>
      <time datetime="${escapeHtml(run.startedAt)}">${new Date(run.startedAt).toLocaleDateString()}</time>
    </div>
    <div class="run-card-body">
      <h3>${escapeHtml(outcome)}</h3>
      <p>${escapeHtml(run.model)}${run.provider ? ` via ${escapeHtml(run.provider)}` : ""}</p>
    </div>
    <div class="run-stats">
      <span><b>${run.decisionCount}</b> decisions</span>
      <span><b>${(run.ticks / 10 / 60).toFixed(1)}</b> sim min</span>
      <span><b>$${run.costUsd.toFixed(3)}</b> inference</span>
    </div>
    <div class="card-actions">
      <a href="${escapeHtml(run.replayUrl)}">Watch replay <span aria-hidden="true">↗</span></a>
      <a href="/api/runs/${escapeHtml(run.runId)}/artifact">Download artifact</a>
    </div>
  </article>`;
}

async function loadRuns(): Promise<void> {
  refreshButton.disabled = true;
  try {
    const response = await fetch("/api/runs");
    if (!response.ok) throw new Error("Runs request failed");
    const data = await response.json();
    const runs = data.runs as RunSummary[];
    runsGrid.innerHTML = runs.length
      ? runs.map(runCard).join("")
      : `<div class="empty">No completed runs yet. The first finished trial will appear here with its replay and artifact.</div>`;
    const samples = runs
      .filter((run) => run.status === "sample")
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    if (samples[0]) updateSample(samples[0]);
  } finally {
    refreshButton.disabled = false;
  }
}

function showProgress(run: RunProgressView): void {
  const decisionCount = Number(run.decisionCount ?? 0);
  const maxDecisionCount = Number(run.maxDecisionCount ?? 120);
  const percent = Math.min(
    100,
    Math.max(0, (decisionCount / Math.max(1, maxDecisionCount)) * 100),
  );
  progress.className = "progress running";
  progress.innerHTML = `<div class="progress-copy">
    <p class="eyebrow">TRIAL IN PROGRESS</p>
    <h3>Decision ${escapeHtml(decisionCount)} of ${escapeHtml(maxDecisionCount)}</h3>
    <p>${escapeHtml(run.latestStrategy ?? "Initializing the Japan simulation…")}</p>
    <div class="progress-track" aria-hidden="true"><span style="width:${percent.toFixed(1)}%"></span></div>
  </div>
  <div class="progress-metrics">
    <span>Tick <b>${escapeHtml(run.tick ?? 0)}</b></span>
    <span>Inference <b>$${Number(run.costUsd ?? 0).toFixed(3)}</b></span>
  </div>`;
}

function showCompletedRun(run: RunProgressView, runId: string): void {
  const winner = run.outcome?.winner ?? run.winner ?? "Match complete";
  progress.className = "progress complete";
  progress.innerHTML = `<div>
    <p class="eyebrow">TRIAL COMPLETE</p>
    <h3>${escapeHtml(winner)}</h3>
    <p>The replay and complete decision artifact are ready.</p>
  </div>
  <a class="result-link" href="/replay/${escapeHtml(runId)}">Open replay <span aria-hidden="true">↗</span></a>`;
}

function showFailedRun(run: RunProgressView): void {
  progress.className = "progress failed";
  progress.innerHTML = `<div>
    <p class="eyebrow">TRIAL ${escapeHtml(run.status.toUpperCase())}</p>
    <h3>The match did not produce a benchmark result.</h3>
    <p>${escapeHtml(run.error ?? "The run ended before a winner was declared.")}</p>
  </div>`;
}

function showPollingError(): void {
  progress.className = "progress failed";
  progress.innerHTML = `<div>
    <p class="eyebrow">STATUS CONNECTION LOST</p>
    <h3>The trial may still be running.</h3>
    <p>Trying the status endpoint again…</p>
  </div>`;
}

async function pollRun(runId: string): Promise<void> {
  if (pollingRunId === runId) return;
  pollingRunId = runId;
  let consecutiveErrors = 0;
  try {
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        const response = await fetch(`/api/runs/${runId}`);
        if (!response.ok) {
          if (response.status === 404) {
            showFailedRun({ status: "failed", error: "Run not found." });
            break;
          }
          throw new Error("Status request failed");
        }
        const { run } = (await response.json()) as { run: RunProgressView };
        consecutiveErrors = 0;
        if (run.status === "running") {
          showProgress(run);
          continue;
        }
        if (run.status === "completed" || run.status === "sample") {
          showCompletedRun(run, runId);
        } else {
          showFailedRun(run);
        }
        break;
      } catch (error) {
        console.error(error);
        consecutiveErrors += 1;
        showPollingError();
        if (consecutiveErrors >= 5) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  } finally {
    pollingRunId = null;
    activeRunId = null;
    updateRunControls();
    await Promise.allSettled([loadRuns(), loadScenario()]);
  }
}

runButton.addEventListener("click", async () => {
  if (runButton.disabled) return;
  launchPending = true;
  updateRunControls();
  try {
    const response = await fetch("/api/runs", { method: "POST" });
    const data = await response.json();
    if (data.quota) {
      quotaState = data.quota as QuotaView;
      setQuotaText();
    }
    if (!response.ok) {
      setQuotaText(data.error ?? "Could not start the trial");
      if (data.run?.runId) {
        const runId = String(data.run.runId);
        activeRunId = runId;
        showProgress(data.run);
        void pollRun(runId);
      }
      return;
    }
    activeRunId = data.runId;
    showProgress({
      runId: data.runId,
      status: "running",
      decisionCount: 0,
      maxDecisionCount: 120,
      latestStrategy: "Loading the Japan simulation…",
      tick: 0,
      costUsd: 0,
    });
    void pollRun(data.runId);
  } catch (error) {
    console.error(error);
    setQuotaText("Could not reach the harness API.");
  } finally {
    launchPending = false;
    updateRunControls();
  }
});

refreshButton.addEventListener("click", () => {
  void loadRuns().catch((error) => {
    console.error(error);
    runsGrid.innerHTML = `<div class="empty error">Recorded runs are temporarily unavailable. Try refreshing again.</div>`;
  });
});

void loadScenario().catch((error) => {
  console.error(error);
  scenarioGrid.innerHTML = `<div class="metric-loading error">The fixed scenario could not be loaded.</div>`;
  quotaState = null;
  setQuotaText("Scenario data is unavailable.");
  updateRunControls();
});

void loadRuns().catch((error) => {
  console.error(error);
  runsGrid.innerHTML = `<div class="empty error">Recorded runs are temporarily unavailable. The documentation remains accessible.</div>`;
});

void loadHealth().catch((error) => {
  console.error(error);
  generationAvailable = false;
  availabilityDot.classList.add("unavailable");
  generationStatus.textContent = "Live generation status is unavailable";
  updateRunControls();
});
