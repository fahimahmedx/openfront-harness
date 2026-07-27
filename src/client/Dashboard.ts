import "./dashboard.css";

type RunSummary = {
  runId: string;
  scenarioId: string;
  status: string;
  startedAt: string;
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

const sampleLinks = Array.from(
  document.querySelectorAll<HTMLAnchorElement>("[data-sample-link]"),
);
const sourceLink = document.querySelector<HTMLAnchorElement>("#source-link")!;
const refreshButton =
  document.querySelector<HTMLButtonElement>("#refresh-button")!;
const featuredRun = document.querySelector<HTMLElement>("#featured-run")!;
const recentRuns = document.querySelector<HTMLElement>("#recent-runs")!;
const archiveRuns = document.querySelector<HTMLElement>("#archive-runs")!;
const runArchive = document.querySelector<HTMLDetailsElement>("#run-archive")!;
const projectMeta = document.querySelector<HTMLElement>("#project-meta")!;
const proofOutcome = document.querySelector<HTMLElement>("#proof-outcome")!;
const proofDecisions = document.querySelector<HTMLElement>("#proof-decisions")!;
const proofTime = document.querySelector<HTMLElement>("#proof-time")!;
const proofCost = document.querySelector<HTMLElement>("#proof-cost")!;
const demoResult = document.querySelector<HTMLElement>("#demo-result")!;

let currentScenarioId: string | null = null;
let cachedRuns: RunSummary[] = [];

const demoVideo = document.querySelector<HTMLVideoElement>(".hero-demo video");
if (
  demoVideo &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches
) {
  demoVideo.pause();
  demoVideo.removeAttribute("autoplay");
}

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

function outcomeLabel(run: RunSummary): string {
  return run.llmWon
    ? "LLM victory"
    : `${ordinal(run.finalPlacement)} place · ${run.winner} won`;
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
  demoResult.textContent = outcome;
}

function featuredCard(run: RunSummary): string {
  return `<article>
    <div class="featured-copy">
      <p class="eyebrow">VERIFIED SAMPLE · ${escapeHtml(scenarioLabel(run.scenarioId))}</p>
      <h3>${escapeHtml(outcomeLabel(run))}</h3>
      <p>
        Replay all ${escapeHtml(run.decisionCount)} model decisions beside the
        native simulation, then download the complete portable artifact.
      </p>
      <div class="featured-actions">
        <a class="button button-primary" href="${escapeHtml(run.replayUrl)}">Open interactive replay <span aria-hidden="true">↗</span></a>
        <a class="inline-link" href="/api/runs/${escapeHtml(run.runId)}/artifact">Download artifact</a>
      </div>
    </div>
    <dl class="featured-stats">
      <div><dt>Model</dt><dd>${escapeHtml(run.model)}</dd></div>
      <div><dt>Decisions</dt><dd>${escapeHtml(run.decisionCount)}</dd></div>
      <div><dt>Simulated time</dt><dd>${(run.ticks / 10 / 60).toFixed(1)} min</dd></div>
      <div><dt>Inference</dt><dd>$${run.costUsd.toFixed(3)}</dd></div>
    </dl>
  </article>`;
}

function runRow(run: RunSummary): string {
  const status =
    run.status === "sample"
      ? "Verified sample"
      : run.status.charAt(0).toUpperCase() + run.status.slice(1);
  return `<article class="run-row">
    <div class="run-identity">
      <span class="status ${escapeHtml(run.status)}">${escapeHtml(status)} · ${escapeHtml(scenarioLabel(run.scenarioId))}</span>
      <h4>${escapeHtml(outcomeLabel(run))}</h4>
      <p>${escapeHtml(run.model)}${run.provider ? ` via ${escapeHtml(run.provider)}` : ""}</p>
    </div>
    <div class="run-stats">
      <span><b>${escapeHtml(run.decisionCount)}</b> decisions</span>
      <span><b>${(run.ticks / 10 / 60).toFixed(1)}</b> sim min</span>
      <span><b>$${run.costUsd.toFixed(3)}</b> inference</span>
    </div>
    <time datetime="${escapeHtml(run.startedAt)}">${new Date(run.startedAt).toLocaleDateString()}</time>
    <div class="run-actions">
      <a href="${escapeHtml(run.replayUrl)}">Watch replay <span aria-hidden="true">↗</span></a>
      <a href="/api/runs/${escapeHtml(run.runId)}/artifact">Artifact</a>
    </div>
  </article>`;
}

function renderRuns(): void {
  if (!cachedRuns.length) {
    featuredRun.innerHTML =
      '<div class="loading">No verified sample is available.</div>';
    recentRuns.innerHTML =
      '<div class="loading">No completed trials are available.</div>';
    runArchive.hidden = true;
    return;
  }

  const scenarioRuns = currentScenarioId
    ? cachedRuns.filter((run) => run.scenarioId === currentScenarioId)
    : cachedRuns;
  const sample =
    scenarioRuns.find((run) => run.status === "sample") ??
    cachedRuns.find((run) => run.status === "sample");

  if (sample) {
    updateSample(sample);
    featuredRun.innerHTML = featuredCard(sample);
  } else {
    featuredRun.innerHTML =
      '<div class="loading">The verified sample is temporarily unavailable.</div>';
  }

  const recent = scenarioRuns
    .filter((run) => run.runId !== sample?.runId)
    .slice(0, 3);
  recentRuns.innerHTML = recent.length
    ? recent.map(runRow).join("")
    : '<div class="loading">No additional trials yet.</div>';

  const recentIds = new Set(recent.map((run) => run.runId));
  const archived = cachedRuns.filter(
    (run) => run.runId !== sample?.runId && !recentIds.has(run.runId),
  );
  archiveRuns.innerHTML = archived.map(runRow).join("");
  runArchive.hidden = archived.length === 0;
}

async function loadScenario(): Promise<void> {
  const response = await fetch("/api/scenario");
  if (!response.ok) throw new Error("Scenario request failed");
  const data = await response.json();
  const scenario = data.scenario;
  currentScenarioId = String(scenario.id);

  if (data.sourceUrl) {
    sourceLink.href = data.sourceUrl;
    sourceLink.classList.remove("hidden");
  }

  projectMeta.innerHTML = `
    <span><b>Scenario</b> ${escapeHtml(scenarioLabel(scenario.id))}</span>
    <span><b>Engine</b> OpenFront ${escapeHtml(scenario.openfront.version)}</span>
    <span><b>Mode</b> 1 LLM + ${escapeHtml(scenario.nationCount)} nations</span>
    <span><b>Stack</b> TypeScript · Vite · OpenRouter</span>`;
  renderRuns();
}

async function loadRuns(): Promise<void> {
  refreshButton.disabled = true;
  try {
    const response = await fetch("/api/runs");
    if (!response.ok) throw new Error("Runs request failed");
    const data = await response.json();
    cachedRuns = data.runs as RunSummary[];
    renderRuns();
  } finally {
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener("click", () => {
  void loadRuns().catch((error) => {
    console.error(error);
    recentRuns.innerHTML =
      '<div class="loading error">Recorded runs are temporarily unavailable.</div>';
  });
});

void loadScenario().catch((error) => {
  console.error(error);
  projectMeta.classList.add("error");
});

void loadRuns().catch((error) => {
  console.error(error);
  featuredRun.innerHTML =
    '<div class="loading error">The verified replay is temporarily unavailable.</div>';
  recentRuns.innerHTML =
    '<div class="loading error">Recorded runs are temporarily unavailable.</div>';
});
