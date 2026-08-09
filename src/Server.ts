import { randomUUID } from "crypto";
import * as dotenv from "dotenv";
import ejs from "ejs";
import express from "express";
import fs from "fs/promises";
import { marked } from "marked";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { gunzip } from "zlib";
import {
  AssetManifest,
  buildAssetUrl,
} from "../OpenFrontIO/src/core/AssetUrls";
import { replacer } from "../OpenFrontIO/src/core/Util";
import {
  EvalReplayStore,
  evalTrialDecision,
  evalTrialSummary,
} from "./EvalReplayStore";
import {
  BenchmarkReplayStore,
  capabilityReplayDecision,
  capabilityReplaySummary,
} from "./BenchmarkReplayStore";
import { HarnessRunner } from "./HarnessRunner";
import { DailyRateLimiter } from "./RateLimiter";
import { artifactSummary, RunStore } from "./RunStore";
import {
  createScenarioStartInfo,
  OPENFRONT_COMMIT,
  publicScenario,
  SCENARIO,
} from "./Scenario";
import {
  VisualBaselineArtifact,
  VisualBaselineArtifactSchema,
} from "./VisualBaselineTypes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
dotenv.config({
  path: path.join(projectRoot, ".env"),
});
const staticDir = path.join(projectRoot, "static");
const publicBaseUrl = (
  process.env.PUBLIC_BASE_URL ??
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : "http://localhost:3000")
).replace(/\/+$/, "");
const linkPreviewPath = path.join(
  projectRoot,
  "resources/social/openfront-harness-link-preview.png",
);
const baselineDataDir = path.resolve(
  process.env.BASELINE_DATA_DIR ?? path.join(projectRoot, "data/baseline"),
);
const gunzipAsync = promisify(gunzip);
const runIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function getVisualBaselineArtifact(runId: string) {
  if (!runIdPattern.test(runId)) return null;
  try {
    const compressed = await fs.readFile(
      path.join(baselineDataDir, runId, "artifact.json.gz"),
    );
    return VisualBaselineArtifactSchema.parse(
      JSON.parse((await gunzipAsync(compressed)).toString("utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`Ignoring unreadable visual baseline ${runId}`, error);
    }
    return null;
  }
}

function visualBaselineSummary(artifact: VisualBaselineArtifact) {
  const winner = artifact.outcome.winner;
  const lastDecision = artifact.decisions[artifact.decisions.length - 1];
  const modelPausedGame =
    artifact.status === "terminated" &&
    artifact.termination?.reason === "client-progress-timeout" &&
    lastDecision?.acceptedIntents.some(
      (intent) =>
        typeof intent === "object" &&
        intent !== null &&
        "type" in intent &&
        intent.type === "toggle_pause" &&
        "paused" in intent &&
        intent.paused === true,
    );
  const territoryLeader = artifact.outcome.finalPlayers.reduce<
    (typeof artifact.outcome.finalPlayers)[number] | undefined
  >(
    (leader, player) =>
      !leader || player.tiles > leader.tiles ? player : leader,
    undefined,
  );
  const winnerName =
    Array.isArray(winner) && typeof winner[1] === "string"
      ? winner[1]
      : (territoryLeader?.name ?? "Undeclared");
  return {
    runId: artifact.runId,
    scenarioId: artifact.scenario.id,
    status: artifact.status,
    startedAt: artifact.startedAt,
    completedAt: artifact.completedAt,
    interface: artifact.interface,
    model: artifact.model.resolved,
    provider: artifact.model.provider,
    winner: winnerName,
    llmWon: artifact.outcome.llmWon,
    finalPlacement: artifact.outcome.finalPlacement,
    ticks: artifact.outcome.terminalTick,
    decisionCount: artifact.decisions.length,
    commandCount: artifact.decisions.reduce(
      (total, decision) => total + decision.commands.length,
      0,
    ),
    costUsd: artifact.usage.costUsd,
    replayUrl: artifact.replay ? `/replay/${artifact.runId}` : null,
    artifactUrl: `/api/runs/${artifact.runId}/artifact`,
    pausedByModel: Boolean(modelPausedGame),
  };
}

async function listVisualBaselineArtifacts() {
  let entries;
  try {
    entries = await fs.readdir(baselineDataDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const artifacts = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && runIdPattern.test(entry.name))
      .map((entry) => getVisualBaselineArtifact(entry.name)),
  );
  return artifacts
    .filter((artifact): artifact is VisualBaselineArtifact => artifact !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
const dataDir = path.resolve(
  process.env.RUN_DATA_DIR ?? path.join(projectRoot, "data/runs"),
);
const localDataRoot = path.join(projectRoot, "data");
const evalDataRoot = path.resolve(
  process.env.EVAL_DATA_DIR ?? path.join(localDataRoot, "evals"),
);
const benchmarkDataRoot = path.join(localDataRoot, "benchmarks");
const artifactRoot =
  dataDir === localDataRoot || dataDir.startsWith(`${localDataRoot}${path.sep}`)
    ? localDataRoot
    : dataDir;
const bundledRunRoot = path.join(projectRoot, "resources/harness");
const bundledRunFiles = (await fs.readdir(bundledRunRoot, { recursive: true }))
  .filter((file) => file.endsWith(".json.gz"))
  .sort()
  .map((file) => path.join(bundledRunRoot, file));

const htmlCache = new Map<string, Promise<string>>();
function renderShell(fileName: "replay.html" | "harness.html" | "evals.html") {
  const cacheHtml = process.env.NODE_ENV === "production";
  const cached = cacheHtml ? htmlCache.get(fileName) : undefined;
  if (cached) return cached;
  const rendered = (async () => {
    const [template, manifestBody] = await Promise.all([
      fs.readFile(path.join(staticDir, fileName), "utf8"),
      fs
        .readFile(path.join(staticDir, "asset-manifest.json"), "utf8")
        .catch(() => "{}"),
    ]);
    const assetManifest = JSON.parse(manifestBody) as AssetManifest;
    const cdnBase = process.env.CDN_BASE ?? "";
    const asset = (assetPath: string) =>
      buildAssetUrl(assetPath, assetManifest, cdnBase);
    return ejs.render(template, {
      gitCommit: JSON.stringify(process.env.GIT_COMMIT ?? OPENFRONT_COMMIT),
      assetManifest: JSON.stringify(assetManifest),
      cdnBase: JSON.stringify(cdnBase),
      cdnBaseRaw: cdnBase,
      gameEnv: JSON.stringify("prod"),
      numWorkers: JSON.stringify(1),
      turnstileSiteKey: JSON.stringify("disabled-for-local-replay"),
      jwtAudience: JSON.stringify("openfront-harness"),
      instanceId: JSON.stringify(
        process.env.RAILWAY_DEPLOYMENT_ID ?? "harness",
      ),
      manifestHref: asset("manifest.json"),
      faviconHref: asset("images/Favicon.svg"),
      gameplayScreenshotUrl: asset("images/GameplayScreenshot.png"),
      backgroundImageUrl: asset("images/background.webp"),
      desktopLogoImageUrl: asset("images/OpenFront.png"),
      mobileLogoImageUrl: asset("images/OF.png"),
      publicBaseUrl,
    });
  })().catch((error) => {
    htmlCache.delete(fileName);
    throw error;
  });
  if (cacheHtml) htmlCache.set(fileName, rendered);
  return rendered;
}

async function sendShell(
  res: express.Response,
  next: express.NextFunction,
  fileName: "replay.html" | "harness.html" | "evals.html",
) {
  try {
    res.setHeader("Cache-Control", "no-store");
    res.type("html").send(await renderShell(fileName));
  } catch (error) {
    next(error);
  }
}
if (process.env.NODE_ENV === "production" && !process.env.RATE_LIMIT_SALT) {
  throw new Error("RATE_LIMIT_SALT is required in production");
}
const rateSalt =
  process.env.RATE_LIMIT_SALT ?? "development-only-rate-limit-salt";
if (!process.env.RATE_LIMIT_SALT) {
  console.warn("RATE_LIMIT_SALT is not set; using a development-only value");
}

const store = new RunStore(dataDir, bundledRunFiles, artifactRoot);
const evalStore = new EvalReplayStore(evalDataRoot);
const benchmarkReplayStore = new BenchmarkReplayStore(benchmarkDataRoot);
const limiter = new DailyRateLimiter(
  path.join(dataDir, "rate-limits.json"),
  rateSalt,
  5,
);
await Promise.all([store.init(), limiter.init()]);
let launchPending = false;

const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.post(/\/api\/archive_singleplayer_game$/, (_req, res) => {
  res.status(204).end();
});
app.use(express.json({ limit: "16kb" }));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    scenario: publicScenario().id,
    storage: dataDir,
    generationAvailable: Boolean(process.env.OPENROUTER_API_KEY),
    activeRun: store.activeRun()?.runId ?? null,
  });
});

app.get("/api/evals/replays", async (_req, res, next) => {
  try {
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.json(await benchmarkReplayStore.index());
  } catch (error) {
    next(error);
  }
});

app.get("/api/scenario", (_req, res) => {
  res.json({
    scenario: publicScenario(),
    sourceUrl: process.env.SOURCE_URL ?? null,
    quota: limiter.status(),
    activeRun: store.activeRun() ?? null,
  });
});

app.get("/api/baseline/bootstrap", (req, res) => {
  const requestedModel =
    typeof req.query.model === "string" && req.query.model.length <= 160
      ? req.query.model
      : undefined;
  res.setHeader("Cache-Control", "no-store");
  res.json({
    gameStartInfo: createScenarioStartInfo(requestedModel),
    spawn: SCENARIO.spawn,
  });
});

app.get("/api/runs", async (_req, res, next) => {
  try {
    const artifacts = await store.listArtifacts();
    res.json({
      runs: artifacts.map(artifactSummary),
      activeRun: store.activeRun() ?? null,
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/baseline/runs", async (_req, res, next) => {
  try {
    const artifacts = await listVisualBaselineArtifacts();
    res.json({ runs: artifacts.map(visualBaselineSummary) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/runs", async (req, res, next) => {
  let ownsLaunchLock = false;
  try {
    const active = store.activeRun();
    if (launchPending || active) {
      return res.status(409).json({
        error: "A benchmark match is already running",
        ...(active ? { run: active } : {}),
      });
    }
    launchPending = true;
    ownsLaunchLock = true;
    if (!process.env.OPENROUTER_API_KEY) {
      return res.status(503).json({
        error:
          "Fresh generation is unavailable; the bundled replay still works",
      });
    }
    const limit = await limiter.consume(req.ip ?? "unknown");
    if (!limit.allowed) {
      return res.status(429).json({
        error:
          limit.reason === "ip"
            ? "This network has already launched a run today"
            : "The public daily run quota is exhausted",
        quota: limiter.status(),
      });
    }

    const runId = randomUUID();
    const runner = HarnessRunner.fromEnvironment(store);
    void runner.run(runId).catch((error) => {
      console.error(
        `Run ${runId} failed outside the normal artifact path`,
        error,
      );
      store.setProgress({
        runId,
        status: "failed",
        startedAt: new Date().toISOString(),
        tick: 0,
        decisionCount: 0,
        maxDecisionCount: publicScenario().maxDecisionCount,
        latestStrategy: "Run failed during initialization",
        costUsd: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    });
    return res.status(202).json({
      runId,
      statusUrl: `/api/runs/${runId}`,
      replayUrl: `/replay/${runId}`,
      quota: limiter.status(),
    });
  } catch (error) {
    next(error);
  } finally {
    if (ownsLaunchLock) launchPending = false;
  }
});

app.get("/api/runs/:runId", async (req, res, next) => {
  try {
    const progress = store.getProgress(req.params.runId);
    if (progress) return res.json({ run: progress });
    const artifact = await store.getArtifact(req.params.runId);
    if (artifact) {
      return res.json({
        run: {
          ...artifactSummary(artifact),
          usage: artifact.usage,
          outcome: artifact.outcome,
          decisions: artifact.decisions,
        },
      });
    }
    const baseline = await getVisualBaselineArtifact(req.params.runId);
    if (baseline) {
      return res.json({
        run: {
          ...visualBaselineSummary(baseline),
          decisions: [],
          baseline: true,
        },
      });
    }
    const evalTrial = await evalStore.getTrial(req.params.runId);
    if (evalTrial) {
      return res.json({
        run: {
          ...evalTrialSummary(evalTrial),
          usage: {
            promptTokens: evalTrial.trace.promptTokens,
            completionTokens: evalTrial.trace.completionTokens,
            costUsd: evalTrial.trace.costUsd,
          },
          outcome: evalTrial.outcome,
          decisions: [evalTrialDecision(evalTrial)],
        },
      });
    }
    const benchmarkReplay = await benchmarkReplayStore.getArtifact(
      req.params.runId,
    );
    if (!benchmarkReplay)
      return res.status(404).json({ error: "Run not found" });
    if (benchmarkReplay.suite === "match") {
      return res.json({
        run: {
          ...artifactSummary(benchmarkReplay.artifact),
          usage: benchmarkReplay.artifact.usage,
          outcome: benchmarkReplay.artifact.outcome,
          decisions: benchmarkReplay.artifact.decisions,
        },
      });
    }
    return res.json({
      run: {
        ...capabilityReplaySummary(
          benchmarkReplay.trial,
          benchmarkReplay.artifact,
        ),
        usage: {
          promptTokens: benchmarkReplay.artifact.agent.promptTokens,
          completionTokens: benchmarkReplay.artifact.agent.completionTokens,
          costUsd: benchmarkReplay.artifact.agent.costUsd,
        },
        outcome: { taskPass: benchmarkReplay.artifact.taskPass },
        decisions: [capabilityReplayDecision(benchmarkReplay.artifact)],
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/runs/:runId/replay", async (req, res, next) => {
  try {
    const artifact = await store.getArtifact(req.params.runId);
    if (artifact) {
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.json(JSON.parse(JSON.stringify(artifact.replay, replacer)));
    }
    const baseline = await getVisualBaselineArtifact(req.params.runId);
    if (baseline) {
      if (!baseline?.replay) {
        return res.status(404).json({ error: "Run not found" });
      }
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.setHeader("X-Harness-Replay-Kind", "visual-controls");
      return res.json(
        JSON.parse(
          JSON.stringify(
            {
              ...baseline.replay,
              gitCommit: baseline.scenario.openfront.commit,
              subdomain: "baseline",
              domain: "openfront-harness",
            },
            replacer,
          ),
        ),
      );
    }
    const evalTrial = await evalStore.getTrial(req.params.runId);
    if (evalTrial) {
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.json(JSON.parse(JSON.stringify(evalTrial.replay, replacer)));
    }
    const benchmarkReplay = await benchmarkReplayStore.getArtifact(
      req.params.runId,
    );
    if (!benchmarkReplay)
      return res.status(404).json({ error: "Run not found" });
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.json(
      JSON.parse(JSON.stringify(benchmarkReplay.artifact.replay, replacer)),
    );
  } catch (error) {
    next(error);
  }
});

app.get("/api/runs/:runId/artifact", async (req, res, next) => {
  try {
    const artifact = await store.getArtifact(req.params.runId);
    const baseline = artifact
      ? null
      : await getVisualBaselineArtifact(req.params.runId);
    const evalTrial =
      artifact || baseline ? null : await evalStore.getTrial(req.params.runId);
    const benchmarkReplay =
      artifact || baseline || evalTrial
        ? null
        : await benchmarkReplayStore.getArtifact(req.params.runId);
    const downloadable =
      artifact ?? baseline ?? evalTrial ?? benchmarkReplay?.artifact;
    if (!downloadable) return res.status(404).json({ error: "Run not found" });
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${req.params.runId}.json"`,
    );
    return res.json(JSON.parse(JSON.stringify(downloadable, replacer)));
  } catch (error) {
    next(error);
  }
});

function architectureVisual(): string {
  return `<figure class="system-map" aria-labelledby="architecture-caption">
    <figcaption id="architecture-caption"><span class="visual-kicker">System architecture</span><span class="visual-meta">One bounded decision loop</span></figcaption>
    <div class="architecture-stage">
      <div class="architecture-main">
        <div class="arch-card"><small>01 · Environment</small><div><strong>OpenFront engine</strong><p>Advances ticks and returns the authoritative game state.</p></div></div>
        <div class="arch-card"><small>02 · Observe</small><div><strong>Observation + legal actions</strong><p>Compacts state and builds a resource-safe action menu.</p></div></div>
        <div class="arch-card model"><small>03 · Decide</small><div><strong>Model adapter</strong><p>Sends the observation and legal actions to the selected LLM provider.</p></div></div>
        <div class="arch-card"><small>04 · Verify</small><div><strong>Validate + resolve</strong><p>Rejects unknown IDs and unsafe action combinations.</p></div></div>
        <div class="arch-card"><small>05 · Execute</small><div><strong>Harness runner</strong><p>Submits exact commands, advances time, and repeats.</p></div></div>
      </div>
      <div class="architecture-support">
        <div class="support-card"><b>Run store</b><span>Decisions, outcomes, latency, cost, and errors</span></div>
        <div class="support-card"><b>Artifacts</b><span>Versioned files for replay, audit, and verification</span></div>
      </div>
    </div>
  </figure>`;
}

function actionReliabilityVisual(): string {
  return `<figure class="reliability-map" aria-labelledby="reliability-caption">
    <figcaption id="reliability-caption"><span class="visual-kicker">Action boundary</span><span class="visual-meta">Only validated pairs reach the game</span></figcaption>
    <div class="reliability-stage">
      <div class="reliability-flow" role="list" aria-label="Action validation flow">
        <div class="reliability-node" role="listitem"><small>01 · Generate</small><strong>Legal action menu</strong><span>Stable IDs from the current game state</span></div>
        <div class="reliability-node reliability-selection" role="listitem"><small>02 · Select</small><strong>Model chooses two IDs</strong><div class="action-slots"><span>Action 1</span><span>Action 2</span></div></div>
        <div class="reliability-node reliability-gate" role="listitem"><small>03 · Validate together</small><strong>Both actions must pass</strong><ul><li>Allowed in its slot</li><li>Within shared budget</li><li>Compatible as a pair</li></ul></div>
        <div class="reliability-node reliability-accepted" role="listitem"><small>04 · Accept</small><strong>Exact core intents</strong><span>Known commands with bounded authority</span></div>
        <div class="reliability-node reliability-engine" role="listitem"><small>05 · Execute</small><strong>OpenFront engine</strong><span>Final authority over the outcome</span></div>
      </div>
      <div class="reliability-fallback" aria-label="Invalid response fallback">
        <span class="fallback-source">Fails validation</span><span class="fallback-arrow" aria-hidden="true">→</span><span>Retry once with the error</span><span class="fallback-arrow" aria-hidden="true">→</span><strong>Two holds</strong><small>if the retry also fails</small>
      </div>
    </div>
  </figure>`;
}

function prepareDocumentMarkdown(markdown: string, isWriteup: boolean): string {
  if (!isWriteup) return markdown;
  return markdown
    .replace(
      "<CLIP OF ATTACK-2-CLIPPED.mov HERE>",
      `<figure class="hero-media">
        <video autoplay muted loop playsinline preload="metadata" poster="/media/writeup/attack-2-clipped-poster.jpg" aria-label="Recorded OpenFront match showing the agent launching an attack">
          <source src="/media/writeup/attack-2-clipped.webm" type="video/webm">
          <source src="/media/writeup/attack-2-clipped.mp4" type="video/mp4">
        </video>
        <figcaption><span class="live-pill">Recorded agent run</span><span>OpenFront · Japan scenario</span></figcaption>
      </figure>`,
    )
    .replace(
      "<BENCHMARK CHART HERE>",
      `<figure class="result-chart result-chart-standalone">
          <img src="/media/writeup/gpt-5.6-harness-win-rate.svg" alt="GPT-5.6 Luna won zero of ten trials with visual browser control, zero of ten with visual browser control plus a game manual, and ten of ten with the harness">
          <figcaption>Observed win rate across ten trials per interface in the fixed Japan scenario.</figcaption>
        </figure>`,
    )
    .replace(
      "<OPENFRONT GAMEPLAY CLIP HERE>",
      `<figure class="gameplay-media">
        <video autoplay muted loop playsinline preload="metadata" aria-label="Recorded OpenFront gameplay showing the agent attacking Hokkaido">
          <source src="/media/writeup/attack-1-clipped.webm" type="video/webm">
          <source src="/media/writeup/attack-1-clipped.mp4" type="video/mp4">
        </video>
      </figure>`,
    )
    .replace("<ACTION RELIABILITY DIAGRAM HERE>", actionReliabilityVisual())
    .replace(/```mermaid[\s\S]*?```/, architectureVisual())
    .replaceAll("](charts/", "](/media/writeup/");
}

const authorSocials = `<div class="author-block">
  <span class="author-credit">Built by <strong>Fahim Ahmed</strong></span>
  <span class="author-socials" role="group" aria-label="Fahim Ahmed on social media">
    <a href="https://x.com/0xOptimus" target="_blank" rel="noopener noreferrer" aria-label="Fahim Ahmed on X" title="Fahim Ahmed on X"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.657l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25h6.826l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z"/></svg></a>
    <a href="https://www.linkedin.com/in/fahim-a/" target="_blank" rel="noopener noreferrer" aria-label="Fahim Ahmed on LinkedIn" title="Fahim Ahmed on LinkedIn"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.94v5.666H9.351V9h3.414v1.561h.047c.476-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286ZM5.337 7.433a2.062 2.062 0 1 1 0-4.124 2.062 2.062 0 0 1 0 4.124ZM7.119 20.452H3.555V9h3.564v11.452ZM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003Z"/></svg></a>
    <a href="https://github.com/fahimahmedx/" target="_blank" rel="noopener noreferrer" aria-label="Fahim Ahmed on GitHub" title="Fahim Ahmed on GitHub"><svg aria-hidden="true" viewBox="0 0 16 16"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82A7.65 7.65 0 0 1 8 3.82c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg></a>
  </span>
</div>`;

app.get("/assets/writeup.css", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.sendFile(path.join(projectRoot, "src/client/writeup.css"));
});

app.get("/assets/writeup.js", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=3600");
  res
    .type("text/javascript")
    .sendFile(path.join(projectRoot, "src/client/Writeup.js"));
});

app.get("/openfront-harness-link-preview.png", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=86400");
  res.type("png").sendFile(linkPreviewPath);
});

const writeupMedia: Record<string, string> = {
  "attack-2-clipped.webm": "videos/attack-2-clipped.webm",
  "attack-2-clipped.mp4": "videos/attack-2-clipped.mp4",
  "attack-2-clipped-poster.jpg": "videos/attack-2-clipped-poster.jpg",
  "attack-1-clipped.webm": "videos/attack-1-clipped.webm",
  "attack-1-clipped.mp4": "videos/attack-1-clipped.mp4",
  "gpt-5.6-territory-over-time.svg": "charts/gpt-5.6-territory-over-time.svg",
  "gpt-5.6-territory-races.svg": "charts/gpt-5.6-territory-races.svg",
  "gpt-5.6-harness-win-rate.svg": "charts/gpt-5.6-harness-win-rate.svg",
  "model-action-mix.svg": "charts/model-action-mix.svg",
  "provider-schema-compliance.png": "charts/provider-schema-compliance.png",
  "audit-trace-before-after.png": "charts/audit-trace-before-after.png",
  "replay-9f73a404-5m50.png": "charts/replay-9f73a404-5m50.png",
  "unpinned-provider-output-variance.png":
    "charts/unpinned-provider-output-variance.png",
};

app.get("/media/writeup/:asset", (req, res) => {
  const file = writeupMedia[req.params.asset];
  if (!file) return res.status(404).send("Not found");
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.sendFile(path.join(projectRoot, file));
});

app.get("/docs/:document", async (req, res) => {
  const allowed: Record<string, string> = {
    writeup: "writeup.md",
    decisions: "design-decision.md",
    readme: "README.md",
  };
  const file = allowed[req.params.document];
  if (!file) return res.status(404).send("Not found");
  const isWriteup = req.params.document === "writeup";
  const markdown = prepareDocumentMarkdown(
    await fs.readFile(path.join(projectRoot, file), "utf8"),
    isWriteup,
  );
  const title =
    req.params.document === "writeup"
      ? "Project write-up"
      : req.params.document === "decisions"
        ? "Design decisions"
        : "OpenFront LLM Harness";
  const html = await marked.parse(markdown);
  res.type("html")
    .send(`<!doctype html><html lang="en" data-theme="light"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta id="theme-color" name="theme-color" content="#f2f0e9">
    <meta name="description" content="How a bounded, auditable agent harness made LLMs reliably play OpenFront.">
    <title>${title} · OpenFront LLM Harness</title>
    <link rel="stylesheet" href="/assets/writeup.css">
    <script>try{if(localStorage.getItem("openfront-docs-theme")==="dark")document.documentElement.dataset.theme="dark"}catch{}</script>
    <script type="module" src="/assets/writeup.js"></script>
  </head><body>
    <a class="skip-link" href="#writeup-article">Skip to article</a>
    <div id="read-progress" class="read-progress" aria-hidden="true"></div>
    <header class="site-nav"><nav class="nav-inner" aria-label="Primary navigation">
      <div class="nav-left"><a class="brand" href="/" aria-label="OpenFront Harness home">OpenFront <span>Harness</span></a>${isWriteup ? authorSocials : ""}</div>
      <div class="nav-actions"><button id="theme-toggle" class="theme-toggle" type="button" aria-pressed="false"><span aria-hidden="true">◐</span><span id="theme-label">Dark mode</span></button></div>
    </nav></header>
    <main class="writeup-shell">
      <aside class="reading-rail" aria-label="Article contents"><p class="rail-kicker">In this case study</p><nav id="toc" class="toc"></nav></aside>
      <article id="writeup-article" class="writeup">${html}${isWriteup ? `<div class="article-end"><p>Building an agent where reliability matters?</p><div class="article-end-cta"><span>I build reliable harnesses and evals for agents in interactive environments.</span><a href="https://www.linkedin.com/in/fahim-a/" target="_blank" rel="noopener noreferrer">Let’s chat ↗</a></div></div>` : ""}</article>
    </main>
    <footer class="site-footer"><div class="footer-inner"><span>OpenFront Harness · Built by Fahim Ahmed</span><span>OpenFront v0.32.9 · <a href="https://github.com/openfrontio/OpenFrontIO">Upstream project</a></span></div></footer>
  </body></html>`);
});

app.get(["/replay.html", "/replay/:runId"], (_req, res, next) => {
  void sendShell(res, next, "replay.html");
});
app.get(["/baseline", "/baseline.html"], (_req, res, next) => {
  void sendShell(res, next, "replay.html");
});
app.get(["/lab", "/lab.html"], (_req, res) => {
  res.redirect(302, "/");
});
app.get("/evals/report.json", (_req, res) => {
  res.setHeader("Cache-Control", "public, max-age=3600");
  res
    .type("json")
    .sendFile(
      path.join(
        projectRoot,
        "data/benchmarks/luna-official-v0.1-r3/report.json",
      ),
    );
});
app.get(["/evals", "/evals.html"], (_req, res, next) => {
  void sendShell(res, next, "evals.html");
});
app.get(["/", "/harness.html"], (_req, res, next) => {
  void sendShell(res, next, "harness.html");
});
app.use(express.static(staticDir, { index: false, maxAge: "1h" }));
app.get("*path", (_req, res, next) => {
  void sendShell(res, next, "harness.html");
});

app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(error);
    res.status(500).json({ error: "Internal harness error" });
  },
);

const port = Number(process.env.PORT ?? 3000);
const server = app.listen(port, "0.0.0.0", () => {
  console.log(`OpenFront LLM Harness listening on ${port}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
