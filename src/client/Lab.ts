import "./dashboard.css";

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
  outcome?: { winner?: string; llmWon?: boolean };
};

type QuotaView = {
  remaining: number;
  limit: number;
};

const runButton = document.querySelector<HTMLButtonElement>("#run-button")!;
const quota = document.querySelector<HTMLElement>("#quota")!;
const generationStatus =
  document.querySelector<HTMLElement>("#generation-status")!;
const availabilityDot =
  document.querySelector<HTMLElement>("#availability-dot")!;
const progress = document.querySelector<HTMLElement>("#progress")!;
const labScenario = document.querySelector<HTMLElement>("#lab-scenario")!;

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
  labScenario.innerHTML = `
    <span><b>Scenario</b>${escapeHtml(scenarioLabel(scenario.id))}</span>
    <span><b>Decision ceiling</b>${escapeHtml(scenario.maxDecisionCount)}</span>
    <span><b>Match ceiling</b>${escapeHtml(scenario.maxSimulatedMinutes)} sim min</span>
    <span><b>Cost ceiling</b>$${Number(scenario.maxRunCostUsd).toFixed(2)}</span>`;
  setQuotaText();

  if (data.activeRun?.runId) {
    const runId = String(data.activeRun.runId);
    activeRunId = runId;
    showProgress(data.activeRun);
    void pollRun(runId);
  }
  updateRunControls();
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
        const { run } = (await response.json()) as {
          run: RunProgressView;
        };
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
    await loadScenario().catch(console.error);
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

void loadScenario().catch((error) => {
  console.error(error);
  labScenario.innerHTML =
    '<span class="error"><b>Scenario</b>Unavailable</span>';
  quotaState = null;
  setQuotaText("Scenario data is unavailable.");
  updateRunControls();
});

void loadHealth().catch((error) => {
  console.error(error);
  generationAvailable = false;
  availabilityDot.classList.add("unavailable");
  generationStatus.textContent = "Live generation status is unavailable";
  updateRunControls();
});
