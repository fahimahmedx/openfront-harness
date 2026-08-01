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

const featuredReplayUrl = "/replay/9f73a404-ae98-430f-be5b-ea22fb1755a6";
const sourceLink = document.querySelector<HTMLAnchorElement>("#source-link")!;
const refreshButton =
  document.querySelector<HTMLButtonElement>("#refresh-button")!;
const recentRuns = document.querySelector<HTMLElement>("#recent-runs")!;
const archiveRuns = document.querySelector<HTMLElement>("#archive-runs")!;
const runArchive = document.querySelector<HTMLDetailsElement>("#run-archive")!;
const proofOutcome = document.querySelector<HTMLElement>("#proof-outcome")!;
const proofDecisions = document.querySelector<HTMLElement>("#proof-decisions")!;
const proofTime = document.querySelector<HTMLElement>("#proof-time")!;
const proofCost = document.querySelector<HTMLElement>("#proof-cost")!;
const demoResult = document.querySelector<HTMLElement>("#demo-result")!;
const heroRunId =
  document.querySelector<HTMLElement>("[data-hero-run-id]")?.dataset
    .heroRunId ?? null;

let currentScenarioId: string | null = null;
let cachedRuns: RunSummary[] = [];

const autoplayVideos = document.querySelectorAll<HTMLVideoElement>(
  ".hero-demo video, .action-reel video",
);
if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  autoplayVideos.forEach((video) => {
    video.pause();
    video.removeAttribute("autoplay");
  });
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
  if (scenarioId === "japan-v2" || scenarioId === "japan-v3") return "Japan";

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

function updateHeroRun(run: RunSummary): void {
  const outcome = run.llmWon
    ? "LLM victory"
    : `${ordinal(run.finalPlacement)} place`;
  proofOutcome.textContent = outcome;
  proofDecisions.textContent = run.decisionCount.toLocaleString();
  proofTime.textContent = `${(run.ticks / 10 / 60).toFixed(1)} min`;
  proofCost.textContent = `$${run.costUsd.toFixed(3)}`;
  demoResult.textContent = outcome;
}

function runRow(run: RunSummary, featured = false): string {
  const status =
    run.status === "sample"
      ? "Verified sample"
      : run.status.charAt(0).toUpperCase() + run.status.slice(1);
  const replayUrl = featured ? featuredReplayUrl : run.replayUrl;
  return `<article class="run-row${featured ? " run-row-featured" : ""}">
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
      <a${featured ? ' class="run-primary-action"' : ""} href="${escapeHtml(replayUrl)}">${featured ? "Open replay" : "Watch replay"} <span aria-hidden="true">↗</span></a>
      <a href="/api/runs/${escapeHtml(run.runId)}/artifact">${featured ? "Download artifact" : "Artifact"}</a>
    </div>
  </article>`;
}

function renderRuns(): void {
  if (!cachedRuns.length) {
    recentRuns.innerHTML =
      '<div class="loading">No completed trials are available.</div>';
    runArchive.hidden = true;
    return;
  }

  const scenarioRuns = currentScenarioId
    ? cachedRuns.filter((run) => run.scenarioId === currentScenarioId)
    : cachedRuns;
  const sample = scenarioRuns.find((run) => run.status === "sample");
  const heroRun = cachedRuns.find((run) => run.runId === heroRunId);

  if (heroRun) updateHeroRun(heroRun);

  const recent = [
    ...(sample ? [sample] : []),
    ...scenarioRuns.filter((run) => run.runId !== sample?.runId),
  ].slice(0, 4);
  recentRuns.innerHTML = recent.length
    ? recent.map((run) => runRow(run, run.runId === sample?.runId)).join("")
    : '<div class="loading">No completed trials yet.</div>';

  const recentIds = new Set(recent.map((run) => run.runId));
  const archived = cachedRuns.filter((run) => !recentIds.has(run.runId));
  archiveRuns.innerHTML = archived.map((run) => runRow(run)).join("");
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
});

void loadRuns().catch((error) => {
  console.error(error);
  recentRuns.innerHTML =
    '<div class="loading error">Recorded runs are temporarily unavailable.</div>';
});
