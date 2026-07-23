import { randomUUID } from "crypto";
import * as dotenv from "dotenv";
import ejs from "ejs";
import express from "express";
import fs from "fs/promises";
import { marked } from "marked";
import path from "path";
import { fileURLToPath } from "url";
import {
  AssetManifest,
  buildAssetUrl,
} from "../OpenFrontIO/src/core/AssetUrls";
import { replacer } from "../OpenFrontIO/src/core/Util";
import { HarnessRunner } from "./HarnessRunner";
import { DailyRateLimiter } from "./RateLimiter";
import { artifactSummary, RunStore } from "./RunStore";
import { OPENFRONT_COMMIT, publicScenario } from "./Scenario";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
dotenv.config({
  path: path.join(projectRoot, ".env"),
});
const staticDir = path.join(projectRoot, "static");
const dataDir = path.resolve(
  process.env.RUN_DATA_DIR ?? path.join(projectRoot, ".data/runs"),
);
const sampleFile = path.join(
  projectRoot,
  "resources/harness/sample-run.json.gz",
);

const htmlCache = new Map<string, Promise<string>>();
function renderShell(fileName: "replay.html" | "harness.html") {
  let rendered = htmlCache.get(fileName);
  if (rendered) return rendered;
  rendered = (async () => {
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
    });
  })().catch((error) => {
    htmlCache.delete(fileName);
    throw error;
  });
  htmlCache.set(fileName, rendered);
  return rendered;
}

async function sendShell(
  res: express.Response,
  next: express.NextFunction,
  fileName: "replay.html" | "harness.html",
) {
  try {
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

const store = new RunStore(dataDir, sampleFile);
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

app.get("/api/scenario", (_req, res) => {
  res.json({
    scenario: publicScenario(),
    sourceUrl: process.env.SOURCE_URL ?? null,
    quota: limiter.status(),
    activeRun: store.activeRun() ?? null,
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
    if (!artifact) return res.status(404).json({ error: "Run not found" });
    return res.json({
      run: {
        ...artifactSummary(artifact),
        usage: artifact.usage,
        outcome: artifact.outcome,
        decisions: artifact.decisions,
      },
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/runs/:runId/replay", async (req, res, next) => {
  try {
    const artifact = await store.getArtifact(req.params.runId);
    if (!artifact) return res.status(404).json({ error: "Run not found" });
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.json(JSON.parse(JSON.stringify(artifact.replay, replacer)));
  } catch (error) {
    next(error);
  }
});

app.get("/api/runs/:runId/artifact", async (req, res, next) => {
  try {
    const artifact = await store.getArtifact(req.params.runId);
    if (!artifact) return res.status(404).json({ error: "Run not found" });
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${artifact.runId}.json"`,
    );
    return res.json(JSON.parse(JSON.stringify(artifact, replacer)));
  } catch (error) {
    next(error);
  }
});

app.get("/docs/:document", async (req, res) => {
  const allowed: Record<string, string> = {
    writeup: "writeup.md",
    decisions: "design-decision.md",
    readme: "README.md",
  };
  const file = allowed[req.params.document];
  if (!file) return res.status(404).send("Not found");
  const markdown = await fs.readFile(path.join(projectRoot, file), "utf8");
  const title =
    req.params.document === "writeup"
      ? "Project write-up"
      : req.params.document === "decisions"
        ? "Design decisions"
        : "OpenFront LLM Harness";
  res.type("html").send(`<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title} · OpenFront LLM Harness</title>
    <style>
      :root{color-scheme:dark}body{margin:0;background:#07100d;color:#dce9e3;font:16px/1.7 Inter,system-ui,sans-serif}nav{position:sticky;top:0;background:#07100dee;border-bottom:1px solid #284238;padding:14px max(20px,calc((100vw - 820px)/2));backdrop-filter:blur(14px)}nav a{color:#71e4a8;text-decoration:none;margin-right:22px;font-weight:700}article{max-width:820px;margin:0 auto;padding:56px 20px 100px}h1{font-size:clamp(2.3rem,7vw,4.3rem);line-height:1.02;letter-spacing:-.05em}h2{margin-top:2.2em;line-height:1.2}h3{margin-top:1.8em}a{color:#71e4a8}code{background:#10241c;padding:.12em .35em;border-radius:4px}pre{overflow:auto;background:#10241c;padding:18px;border:1px solid #284238;border-radius:8px}pre code{padding:0}blockquote{border-left:3px solid #71e4a8;margin-left:0;padding-left:18px;color:#9fb4aa}table{width:100%;border-collapse:collapse;display:block;overflow:auto}th,td{padding:9px 14px;border-bottom:1px solid #284238;text-align:left}hr{border:0;border-top:1px solid #284238;margin:3rem 0}
    </style></head><body><nav><a href="/">OF × LLM</a><a href="/docs/writeup">Write-up</a><a href="/docs/decisions">Decisions</a></nav><article>${await marked.parse(markdown)}</article></body></html>`);
});

app.get(["/replay.html", "/replay/:runId"], (_req, res, next) => {
  void sendShell(res, next, "replay.html");
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
