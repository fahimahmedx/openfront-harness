import { createHash, randomUUID } from "crypto";
import * as dotenv from "dotenv";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { gzip } from "zlib";
import { chromium, type Page } from "playwright";
import { PartialGameRecordSchema } from "../OpenFrontIO/src/core/Schemas";
import { replacer } from "../OpenFrontIO/src/core/Util";
import {
  DEFAULT_OPENROUTER_MODEL,
  modelPlayerName,
  publicScenario,
  SCENARIO,
} from "./Scenario";
import { continueVisualBaselineInCore } from "./VisualBaselineCoreContinuation";
import {
  VisualAgentError,
  type VisualAgentResult,
  VisualControlsAgent,
  visualInterfacePromptSha256,
} from "./VisualControlsAgent";
import {
  BaselinePlayerSnapshot,
  BaselineScoreSnapshot,
  BrowserBaselineStatus,
  VISUAL_BASELINE,
  VISUAL_BASELINE_INTERFACE,
  type VisualBaselineInterface,
  VisualBaselineInterfaceSchema,
  VisualBaselineArtifact,
  VisualBaselineArtifactSchema,
  VisualBaselineDecision,
  VisualBaselineUsage,
  VisualCommand,
} from "./VisualBaselineTypes";

const gzipAsync = promisify(gzip);
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
dotenv.config({ path: path.join(projectRoot, ".env") });

function addUsage(target: VisualBaselineUsage, addition: VisualBaselineUsage) {
  target.promptTokens += addition.promptTokens;
  target.completionTokens += addition.completionTokens;
  target.costUsd += addition.costUsd;
  target.modelCalls += addition.modelCalls;
}

async function baselineStatus(page: Page): Promise<BrowserBaselineStatus> {
  return page.evaluate(() => {
    const controller = window.openfrontVisualBaseline;
    if (!controller)
      throw new Error("Visual baseline controller is unavailable");
    return controller.status();
  });
}

async function capturedTurns(page: Page): Promise<unknown[]> {
  return page.evaluate(() => {
    const controller = window.openfrontVisualBaseline;
    if (!controller)
      throw new Error("Visual baseline controller is unavailable");
    return controller.capturedTurns();
  });
}

async function waitForGateOrFinish(page: Page, timeout = 60_000) {
  await page.waitForFunction(
    () => {
      const status = window.openfrontVisualBaseline?.status();
      return Boolean(
        status &&
        (status.finished ||
          (status.gatedAt !== null && status.latestSnapshot !== null)),
      );
    },
    undefined,
    { timeout },
  );
  const status = await baselineStatus(page);
  if (!status.finished) {
    await page.waitForFunction(
      () =>
        document.body.classList.contains("in-game") &&
        getComputedStyle(document.documentElement).visibility === "visible" &&
        document.querySelector("canvas") !== null,
      undefined,
      { timeout },
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    // The first WebGL terrain upload can complete after the first two frames in
    // headless Chrome. Keep simulation gated while the stock renderer settles.
    await page.waitForTimeout(status.decisionIndex === 0 ? 1_000 : 100);
  }
  return baselineStatus(page);
}

async function executeCommand(page: Page, command: VisualCommand) {
  switch (command.command) {
    case "move":
      await page.mouse.move(command.x, command.y);
      break;
    case "click":
      await page.mouse.click(command.x, command.y, { button: command.button });
      break;
    case "drag":
      await page.mouse.move(command.x, command.y);
      await page.mouse.down();
      await page.mouse.move(command.x2, command.y2, { steps: 10 });
      await page.mouse.up();
      break;
    case "scroll":
      await page.mouse.move(command.x, command.y);
      await page.mouse.wheel(0, command.deltaY);
      break;
    case "keypress":
      await page.keyboard.press(command.key);
      break;
    case "wait":
      await page.waitForTimeout(command.milliseconds);
      break;
    case "done":
      break;
  }
  await page.waitForTimeout(100);
}

async function captureRenderedScreenshot(page: Page) {
  const deadline = Date.now() + 10_000;
  while (true) {
    const screenshot = await page.screenshot({ type: "png" });
    if (screenshot.byteLength >= VISUAL_BASELINE.minScreenshotBytes) {
      return screenshot;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Stock renderer did not produce a populated screenshot (received ${screenshot.byteLength} bytes)`,
      );
    }
    await page.waitForTimeout(250);
  }
}

export function playerPlacement(
  players: BaselinePlayerSnapshot[],
  clientID: string,
) {
  const ordered = players
    .map((player, order) => ({ player, order }))
    .sort(
      (a, b) =>
        Number(b.player.alive) - Number(a.player.alive) ||
        (b.player.eliminatedAt ?? -1) - (a.player.eliminatedAt ?? -1) ||
        b.player.tiles - a.player.tiles ||
        a.order - b.order,
    );
  const placement = ordered.findIndex(
    ({ player }) => player.clientID === clientID,
  );
  return placement === -1 ? SCENARIO.expectedNations.length + 1 : placement + 1;
}

export function territoryAreaUnderCurve(
  snapshots: BaselineScoreSnapshot[],
  clientID: string,
) {
  const samples = snapshots
    .map((snapshot) => ({
      tick: snapshot.tick,
      percent:
        ((snapshot.players.find((player) => player.clientID === clientID)
          ?.tiles ?? 0) /
          Math.max(1, snapshot.landTiles)) *
        100,
    }))
    .sort((a, b) => a.tick - b.tick)
    .filter(
      (sample, index, all) =>
        index === 0 || sample.tick !== all[index - 1].tick,
    );
  if (samples.length === 0) return 0;
  if (samples.length === 1) return samples[0].percent;
  let area = 0;
  for (let index = 1; index < samples.length; index++) {
    const previous = samples[index - 1];
    const current = samples[index];
    area +=
      ((previous.percent + current.percent) / 2) *
      (current.tick - previous.tick);
  }
  const duration = samples[samples.length - 1].tick - samples[0].tick;
  return duration <= 0 ? samples[samples.length - 1].percent : area / duration;
}

function launchOptions() {
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  if (executablePath) return { headless: true, executablePath } as const;
  if (process.platform === "darwin") {
    return {
      headless: true,
      executablePath:
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    } as const;
  }
  return { headless: true } as const;
}

async function atomicWrite(target: string, body: Uint8Array) {
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, body);
  await fs.rename(temp, target);
}

export function selectedVisualBaselineInterface(
  value = process.env.BASELINE_INTERFACE,
): VisualBaselineInterface {
  return VisualBaselineInterfaceSchema.parse(
    value ?? VISUAL_BASELINE_INTERFACE,
  );
}

export async function runVisualBaseline(
  interfaceName = selectedVisualBaselineInterface(),
): Promise<VisualBaselineArtifact> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required");
  const requestedModel =
    process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
  const requestedProvider = process.env.OPENROUTER_PROVIDER ?? "openai";
  const runId = randomUUID();
  const startedAt = new Date();
  const outputRoot = path.resolve(
    process.env.BASELINE_DATA_DIR ?? path.join(projectRoot, "data/baseline"),
  );
  const runDir = path.join(outputRoot, runId);
  const screenshotDir = path.join(runDir, "screenshots");
  await fs.mkdir(screenshotDir, { recursive: true });

  const agent = new VisualControlsAgent(
    apiKey,
    requestedModel,
    requestedProvider,
    interfaceName,
  );
  const usage: VisualBaselineUsage = {
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    modelCalls: 0,
  };
  const decisions: VisualBaselineDecision[] = [];
  const recentPublicNotes: string[] = [];
  let resolvedModel = requestedModel;
  let resolvedProvider: string | null = requestedProvider ?? null;
  let finalStatus: BrowserBaselineStatus | null = null;
  let completedByCoreContinuation = false;
  let error: string | undefined;
  const browser = await chromium.launch(launchOptions());
  try {
    const baseUrl = (
      process.env.BASELINE_URL ?? "http://localhost:3000"
    ).replace(/\/$/, "");
    const context = await browser.newContext({
      viewport: VISUAL_BASELINE.viewport,
      deviceScaleFactor: 1,
      locale: "en-US",
      colorScheme: "dark",
    });
    const username = JSON.stringify(modelPlayerName(requestedModel));
    await context.addInitScript({
      content: `
        if (window === window.top) {
          try {
            localStorage.setItem("username", ${username});
            localStorage.setItem("clanTag", "");
          } catch {}
          window.ramp = {
            que: [], passiveMode: true, onPlayerReady: null,
            spaAddAds() {}, async destroyUnits() {}, spaNewPage() {},
            spaAds() {}, async addUnits() {}, displayUnits() {}
          };
        }
      `,
    });
    const baselineOrigin = new URL(baseUrl).origin;
    await context.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      if (
        requestUrl.startsWith(baselineOrigin) ||
        requestUrl.startsWith("blob:") ||
        requestUrl.startsWith("data:")
      ) {
        await route.continue();
      } else {
        await route.abort("blockedbyclient");
      }
    });
    const page = await context.newPage();
    page.on("pageerror", (cause) =>
      console.error("baseline page error", cause),
    );
    await page.goto(
      `${baseUrl}/baseline?model=${encodeURIComponent(requestedModel)}`,
      { waitUntil: "domcontentloaded", timeout: 60_000 },
    );
    let status = await waitForGateOrFinish(page);
    while (!status.finished && decisions.length < SCENARIO.maxDecisionCount) {
      if (status.gatedAt === null || status.latestSnapshot === null) {
        throw new Error("Baseline reached a decision without a score snapshot");
      }
      const self = status.latestSnapshot.players.find(
        (player) => player.clientID === SCENARIO.clientID,
      );
      if (self && !self.alive) {
        const continuation = await continueVisualBaselineInCore(
          await capturedTurns(page),
          requestedModel,
          startedAt,
        );
        status = {
          ...status,
          gatedAt: null,
          nextGateTick: Number.MAX_SAFE_INTEGER,
          latestSnapshot: continuation.snapshot,
          winnerJson: JSON.stringify({ winner: continuation.winner }, replacer),
          replayJson: JSON.stringify(continuation.replay, replacer),
          finished: true,
        };
        finalStatus = status;
        completedByCoreContinuation = true;
        break;
      }
      if (Date.now() - startedAt.getTime() > SCENARIO.maxWallClockMs) {
        throw new Error("Visual baseline exceeded the wall-clock safety limit");
      }

      const decision: VisualBaselineDecision = {
        decision: decisions.length,
        tick: status.gatedAt,
        commands: [],
        acceptedIntents: [],
        scoreOnlySnapshot: {
          ...status.latestSnapshot,
          tick: status.gatedAt,
        },
      };
      for (
        let commandIndex = 0;
        commandIndex < VISUAL_BASELINE.maxPrimitiveCommandsPerDecision;
        commandIndex++
      ) {
        const screenshot = await captureRenderedScreenshot(page);
        const fileName = `decision-${String(decision.decision).padStart(3, "0")}-command-${commandIndex}.png`;
        const screenshotPath = path.join(screenshotDir, fileName);
        await fs.writeFile(screenshotPath, screenshot);
        let result: VisualAgentResult;
        try {
          result = await agent.decide(screenshot, recentPublicNotes);
        } catch (cause) {
          if (cause instanceof VisualAgentError) addUsage(usage, cause.usage);
          throw cause;
        }
        addUsage(usage, result.usage);
        resolvedModel = result.resolvedModel;
        resolvedProvider = result.provider;
        await executeCommand(page, result.command);
        status = await baselineStatus(page);
        decision.commands.push({
          commandIndex,
          screenshot: `screenshots/${fileName}`,
          screenshotSha256: createHash("sha256")
            .update(screenshot)
            .digest("hex"),
          selected: result.command,
          latencyMs: result.latencyMs,
          usage: result.usage,
          intentsAfterCommand: status.intents.length,
        });
        recentPublicNotes.push(result.command.note);
        if (usage.costUsd >= SCENARIO.maxRunCostUsd) {
          throw new Error("Visual baseline reached the $1 model-cost limit");
        }
        if (
          result.command.command === "done" ||
          status.intents.length >= VISUAL_BASELINE.maxGameIntentsPerDecision
        ) {
          break;
        }
      }
      decision.acceptedIntents = status.intents;
      decisions.push(decision);
      await page.evaluate(() => window.openfrontVisualBaseline?.release());
      status = await waitForGateOrFinish(page);
    }
    if (!status.finished && decisions.length === SCENARIO.maxDecisionCount) {
      const continuation = await continueVisualBaselineInCore(
        await capturedTurns(page),
        requestedModel,
        startedAt,
        undefined,
        true,
      );
      status = {
        ...status,
        gatedAt: null,
        nextGateTick: Number.MAX_SAFE_INTEGER,
        latestSnapshot: continuation.snapshot,
        winnerJson: JSON.stringify({ winner: continuation.winner }, replacer),
        replayJson: JSON.stringify(continuation.replay, replacer),
        finished: true,
      };
      finalStatus = status;
      completedByCoreContinuation = true;
    }
    if (!status.finished) {
      throw new Error(
        "Visual baseline reached the maximum decision count without a winner",
      );
    }
    if (!completedByCoreContinuation) {
      await page.waitForFunction(
        () => window.openfrontVisualBaseline?.status().replayJson !== null,
        undefined,
        { timeout: 10_000 },
      );
      finalStatus = await baselineStatus(page);
    }
    if (finalStatus?.error) throw new Error(finalStatus.error);
    await context.close();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
    console.error(error);
  } finally {
    await browser.close();
  }

  const finalSnapshot = finalStatus?.latestSnapshot ?? {
    tick: decisions[decisions.length - 1]?.tick ?? 0,
    landTiles: 1,
    players: [],
  };
  const self = finalSnapshot.players.find(
    (player) => player.clientID === SCENARIO.clientID,
  );
  let winnerMessage: { winner?: unknown } | null = null;
  if (finalStatus?.winnerJson) {
    try {
      winnerMessage = JSON.parse(finalStatus.winnerJson) as {
        winner?: unknown;
      };
    } catch (cause) {
      error ??= `Could not parse visual baseline winner: ${cause instanceof Error ? cause.message : String(cause)}`;
    }
  }
  const winner = winnerMessage?.winner ?? null;
  let replay: unknown = null;
  if (finalStatus?.replayJson) {
    try {
      replay = PartialGameRecordSchema.parse(
        JSON.parse(finalStatus.replayJson),
      );
    } catch (cause) {
      error ??= `Could not parse visual baseline replay: ${cause instanceof Error ? cause.message : String(cause)}`;
    }
  }
  const scenario = publicScenario(requestedModel);
  const artifact: VisualBaselineArtifact = {
    schemaVersion: 2,
    interface: interfaceName,
    runId,
    status: error ? "failed" : "completed",
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    scenario: {
      id: scenario.id,
      seed: scenario.seed,
      clientID: scenario.clientID,
      spawn: scenario.spawn,
      decisionIntervalTicks: scenario.decisionIntervalTicks,
      actionSlots: scenario.actionSlots,
      maxDecisionCount: scenario.maxDecisionCount,
      maxSimulatedMinutes: scenario.maxSimulatedMinutes,
      openfront: scenario.openfront,
    },
    model: {
      requested: requestedModel,
      resolved: resolvedModel,
      provider: resolvedProvider,
      reasoningEffort: "none",
      promptVersion: interfaceName,
    },
    protocol: {
      viewport: VISUAL_BASELINE.viewport,
      firstDecisionTick: VISUAL_BASELINE.firstDecisionTick,
      maxPrimitiveCommandsPerDecision:
        VISUAL_BASELINE.maxPrimitiveCommandsPerDecision,
      maxGameIntentsPerDecision: VISUAL_BASELINE.maxGameIntentsPerDecision,
      minScreenshotBytes: VISUAL_BASELINE.minScreenshotBytes,
      interfacePromptSha256: visualInterfacePromptSha256(interfaceName),
      recentPublicNoteCount: VISUAL_BASELINE.recentPublicNoteCount,
    },
    decisions,
    usage,
    outcome: {
      winner,
      llmWon:
        Array.isArray(winner) &&
        winner[0] === "player" &&
        winner[1] === SCENARIO.clientID,
      finalPlacement: playerPlacement(finalSnapshot.players, SCENARIO.clientID),
      terminalTick: finalSnapshot.tick,
      finalTerritoryPercent:
        ((self?.tiles ?? 0) / Math.max(1, finalSnapshot.landTiles)) * 100,
      territoryAreaUnderCurve: territoryAreaUnderCurve(
        [
          ...decisions.map((decision) => decision.scoreOnlySnapshot),
          finalSnapshot,
        ],
        SCENARIO.clientID,
      ),
      finalPlayers: finalSnapshot.players,
    },
    replay,
    ...(error ? { error } : {}),
  };
  const parsed = VisualBaselineArtifactSchema.parse(artifact);
  const body = await gzipAsync(JSON.stringify(parsed, replacer));
  await atomicWrite(path.join(runDir, "artifact.json.gz"), body);
  console.log(
    `${parsed.status}: ${runId} | interface=${parsed.interface} | winner=${JSON.stringify(parsed.outcome.winner)} | placement=${parsed.outcome.finalPlacement} | cost=$${parsed.usage.costUsd.toFixed(6)}`,
  );
  return parsed;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void runVisualBaseline().then((artifact) => {
    process.exitCode = artifact.status === "completed" ? 0 : 1;
  });
}
