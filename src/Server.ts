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
  res.type("html")
    .send(`<!doctype html><html lang="en" data-theme="light"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <meta id="theme-color" name="theme-color" content="#f3f1ea">
    <title>${title} · OpenFront LLM Harness</title>
    <script>try{if(localStorage.getItem("openfront-docs-theme")==="dark")document.documentElement.dataset.theme="dark"}catch{}</script>
    <style>
      :root{color-scheme:light;--paper:#f3f1ea;--raised:#faf9f4;--ink:#101614;--muted:#5f6863;--faint:#858d88;--line:#d2d6ce;--line-strong:#aeb5ad;--signal:#1e7a5a;--code:#e5e8e1;--quote:#46504b}
      :root[data-theme="dark"]{color-scheme:dark;--paper:#0b1713;--raised:#10211a;--ink:#f3f1ea;--muted:#a8b5af;--faint:#7c8d85;--line:#2c4037;--line-strong:#496056;--signal:#64e2aa;--code:#14271f;--quote:#bdc8c2}
      *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.75 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-rendering:optimizeLegibility;transition:background-color .18s ease,color .18s ease}a{color:var(--signal);text-underline-offset:3px}a:hover{text-decoration-thickness:2px}nav{position:sticky;z-index:10;top:0;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--paper) 94%,transparent);backdrop-filter:blur(14px)}.nav-inner{width:min(100% - 40px,960px);min-height:72px;display:flex;align-items:center;justify-content:space-between;gap:30px;margin:0 auto}.brand{flex:none;color:var(--ink);font-size:20px;font-weight:900;letter-spacing:-.055em;text-decoration:none}.brand span{color:var(--signal);padding-inline:3px;letter-spacing:0}.theme-toggle{min-width:102px;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid var(--line-strong);border-radius:3px;background:transparent;color:var(--ink);padding:8px 10px;cursor:pointer;font:700 10px/1.2 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;text-transform:uppercase}.theme-toggle:hover{border-color:var(--signal);color:var(--signal)}.theme-icon{font-size:13px}:focus-visible{outline:3px solid #2c86d3;outline-offset:3px}article{width:min(100% - 40px,860px);margin:0 auto;padding:clamp(54px,8vw,88px) 0 120px}h1,h2,h3{line-height:1.12;text-wrap:balance}h1{max-width:820px;margin:0 0 .7em;font-size:clamp(2.65rem,7vw,5rem);font-weight:720;letter-spacing:-.065em}h2{margin:2.4em 0 .7em;border-top:1px solid var(--line-strong);padding-top:.75em;font-size:clamp(1.75rem,4vw,2.45rem);letter-spacing:-.045em}h3{margin:2em 0 .55em;font-size:1.3rem;letter-spacing:-.025em}p,li{color:var(--muted)}strong{color:var(--ink)}article>p:first-of-type{font-size:1.12rem}code{border:1px solid var(--line);border-radius:3px;background:var(--code);padding:.12em .35em;color:var(--ink);font:600 .88em/1.5 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}pre{overflow:auto;border:1px solid var(--line-strong);border-radius:4px;background:var(--raised);padding:20px}pre code{border:0;background:transparent;padding:0}blockquote{margin:2em 0;border-left:2px solid var(--signal);padding:.25em 0 .25em 22px;color:var(--quote)}blockquote p{margin:0;color:inherit}table{width:100%;display:block;overflow:auto;border-collapse:collapse;margin:1.8em 0}th,td{border-bottom:1px solid var(--line);padding:10px 14px;text-align:left;white-space:nowrap}th{color:var(--ink);font-size:.82rem}td{color:var(--muted)}hr{border:0;border-top:1px solid var(--line-strong);margin:3.5rem 0}img{max-width:100%}
      @media(max-width:680px){.nav-inner{width:min(100% - 24px,960px);min-height:64px}.brand{font-size:18px}.theme-toggle{min-width:0}.theme-toggle span:last-child{display:none}article{width:min(100% - 30px,860px);padding-top:48px}h1{font-size:clamp(2.5rem,13vw,4rem)}pre{padding:14px}}
      @media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition-duration:.01ms!important}}
    </style></head><body>
      <nav><div class="nav-inner"><a class="brand" href="/" aria-label="OpenFront Harness home">OpenFront <span>Harness</span></a><button id="theme-toggle" class="theme-toggle" type="button" aria-pressed="false"><span class="theme-icon" aria-hidden="true">◐</span><span id="theme-label">Dark mode</span></button></div></nav>
      <article>${await marked.parse(markdown)}</article>
      <script>(()=>{const root=document.documentElement;const button=document.querySelector("#theme-toggle");const label=document.querySelector("#theme-label");const color=document.querySelector("#theme-color");const apply=(theme)=>{const dark=theme==="dark";root.dataset.theme=dark?"dark":"light";button.setAttribute("aria-pressed",String(dark));label.textContent=dark?"Light mode":"Dark mode";color.setAttribute("content",dark?"#0b1713":"#f3f1ea")};apply(root.dataset.theme==="dark"?"dark":"light");button.addEventListener("click",()=>{const next=root.dataset.theme==="dark"?"light":"dark";apply(next);try{localStorage.setItem("openfront-docs-theme",next)}catch{}})})()</script>
    </body></html>`);
});

app.get(["/replay.html", "/replay/:runId"], (_req, res, next) => {
  void sendShell(res, next, "replay.html");
});
app.get(["/lab", "/lab.html"], (_req, res) => {
  res.redirect(302, "/");
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
