import * as dotenv from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OpenRouterAgent } from "../OpenRouterAgent";
import {
  NEUTRAL_EXPANSION_FIXTURE,
  NeutralExpansionTrial,
  runNeutralExpansionTrial,
  summarizeNeutralExpansionTrials,
} from "./NeutralExpansionEval";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

function option(name: string): string | undefined {
  const prefix = `--${name}=`;
  const inline = process.argv.find((argument) => argument.startsWith(prefix));
  if (inline !== undefined) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function trialCount(): number {
  const value = Number(option("trials") ?? 10);
  if (!Number.isInteger(value) || value < 1 || value > 1_000) {
    throw new Error(`--trials must be an integer from 1 to 1000, got ${value}`);
  }
  return value;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  throw new Error("OPENROUTER_API_KEY is required to run the live eval");
}

const requestedTrials = trialCount();
if (requestedTrials < 10) {
  console.warn(
    `Running ${requestedTrials} trial(s); eval-spec.md requires at least 10 for development results.`,
  );
}

const agent = new OpenRouterAgent(apiKey);
const trials: NeutralExpansionTrial[] = [];
const invalidTrials: Array<{ attempt: number; reason: string }> = [];
const maximumAttempts = requestedTrials + 5;
for (
  let attempt = 1;
  trials.length < requestedTrials && attempt <= maximumAttempts;
  attempt++
) {
  try {
    const trial = await runNeutralExpansionTrial(agent);
    trials.push(trial);
    console.log(
      `Trial ${trials.length}/${requestedTrials}: ${trial.outcome.taskPass ? "pass" : "fail"} ` +
        `(${trial.outcome.neutralTilesGained} neutral tiles, ${trial.trace.latencyMs.toFixed(0)} ms)`,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    invalidTrials.push({ attempt, reason });
    console.error(`Invalid eval attempt ${attempt}: ${reason}`);
  }
}
if (trials.length < requestedTrials) {
  throw new Error(
    `Only ${trials.length}/${requestedTrials} valid trials completed after ${maximumAttempts} attempts`,
  );
}

const completedAt = new Date();
const report = {
  evalVersion: NEUTRAL_EXPANSION_FIXTURE.evalVersion,
  familyId: NEUTRAL_EXPANSION_FIXTURE.familyId,
  fixtureId: NEUTRAL_EXPANSION_FIXTURE.fixtureId,
  split: NEUTRAL_EXPANSION_FIXTURE.split,
  completedAt: completedAt.toISOString(),
  requestedTrials,
  invalidTrials,
  summary: summarizeNeutralExpansionTrials(trials),
  trials,
};
const defaultOutput = path.join(
  PROJECT_ROOT,
  "data/evals",
  NEUTRAL_EXPANSION_FIXTURE.evalVersion,
  NEUTRAL_EXPANSION_FIXTURE.familyId,
  `${completedAt.toISOString().replace(/[:.]/g, "-")}-${safeSegment(agent.requestedModel)}.json`,
);
const output = path.resolve(option("output") ?? defaultOutput);
await fs.mkdir(path.dirname(output), { recursive: true });
const temporary = `${output}.tmp-${process.pid}`;
await fs.writeFile(temporary, JSON.stringify(report, null, 2));
await fs.rename(temporary, output);

console.log(
  `Neutral expansion: ${report.summary.successes}/${report.summary.validTrials} passed ` +
    `(${(report.summary.passAt1 * 100).toFixed(1)}% pass@1), ` +
    `$${report.summary.totalCostUsd.toFixed(4)} total`,
);
console.log(`Report: ${output}`);
