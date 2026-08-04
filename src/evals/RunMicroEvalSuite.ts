import * as dotenv from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { replacer } from "../../OpenFrontIO/src/core/Util";
import { OpenRouterAgent } from "../OpenRouterAgent";
import {
  MicroEvalFamilyId,
  MicroEvalTrial,
  REMAINING_MICRO_EVAL_FAMILIES,
  runMicroEvalTrial,
} from "./MicroEvalSuite";
import {
  NeutralExpansionTrial,
  runNeutralExpansionTrial,
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

type FamilyId = "neutral-expansion" | MicroEvalFamilyId;
const allFamilies: FamilyId[] = [
  "neutral-expansion",
  ...REMAINING_MICRO_EVAL_FAMILIES,
];

function selectedFamilies(): FamilyId[] {
  const requested = option("family") ?? "all";
  if (requested === "all") return allFamilies;
  const selected = requested.split(",").map((family) => family.trim());
  const unknown = selected.filter(
    (family) => !allFamilies.includes(family as FamilyId),
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown --family value(s): ${unknown.join(", ")}`);
  }
  return selected as FamilyId[];
}

function shuffled<T>(values: T[]): T[] {
  const copy = [...values];
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index];
}

function wilson95(successes: number, trials: number) {
  if (trials === 0) return { lower: 0, upper: 0 };
  const z = 1.96;
  const observed = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = observed + (z * z) / (2 * trials);
  const margin =
    z *
    Math.sqrt(
      (observed * (1 - observed)) / trials + (z * z) / (4 * trials * trials),
    );
  return {
    lower: Math.max(0, (center - margin) / denominator),
    upper: Math.min(1, (center + margin) / denominator),
  };
}

function bootstrapMacro95(
  trials: Array<NeutralExpansionTrial | MicroEvalTrial>,
): { lower: number; upper: number } {
  const groups = Array.from(new Set(trials.map((trial) => trial.familyId))).map(
    (family) => trials.filter((trial) => trial.familyId === family),
  );
  if (groups.length === 0) return { lower: 0, upper: 0 };
  let state = 0x4f50454e;
  const random = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
  const samples: number[] = [];
  for (let iteration = 0; iteration < 2_000; iteration++) {
    const familyRates = groups.map((group) => {
      let successes = 0;
      for (let draw = 0; draw < group.length; draw++) {
        if (group[Math.floor(random() * group.length)].outcome.taskPass) {
          successes++;
        }
      }
      return successes / group.length;
    });
    samples.push(
      familyRates.reduce((sum, value) => sum + value, 0) / familyRates.length,
    );
  }
  return {
    lower: percentile(samples, 0.025),
    upper: percentile(samples, 0.975),
  };
}

function summarize(
  trials: Array<NeutralExpansionTrial | MicroEvalTrial>,
): Record<string, unknown> {
  const byFamily: Record<string, Record<string, number>> = {};
  for (const family of allFamilies) {
    const familyTrials = trials.filter((trial) => trial.familyId === family);
    if (familyTrials.length === 0) continue;
    const successes = familyTrials.filter(
      (trial) => trial.outcome.taskPass,
    ).length;
    const passAt1 = successes / familyTrials.length;
    byFamily[family] = {
      validTrials: familyTrials.length,
      successes,
      passAt1,
      estimatedPassPower3: passAt1 ** 3,
      passAt1Wilson95Lower: wilson95(successes, familyTrials.length).lower,
      passAt1Wilson95Upper: wilson95(successes, familyTrials.length).upper,
      meanComponentCoverage:
        familyTrials.reduce(
          (sum, trial) => sum + trial.outcome.componentCoverage,
          0,
        ) / familyTrials.length,
    };
  }
  const familyRates = Object.values(byFamily).map((family) => family.passAt1);
  const costs = trials.map((trial) => trial.trace.costUsd);
  const latencies = trials.map((trial) => trial.trace.latencyMs);
  const macroPassAt1 =
    familyRates.length === 0
      ? 0
      : familyRates.reduce((sum, value) => sum + value, 0) / familyRates.length;
  return {
    microEvalScore: 100 * macroPassAt1,
    macroPassAt1Bootstrap95: bootstrapMacro95(trials),
    familyResults: byFamily,
    validTrials: trials.length,
    totalCostUsd: costs.reduce((sum, value) => sum + value, 0),
    meanCostUsd:
      costs.length === 0
        ? 0
        : costs.reduce((sum, value) => sum + value, 0) / costs.length,
    firstAttemptValidityRate:
      trials.length === 0
        ? 0
        : trials.filter(
            (trial) =>
              trial.trace.attempts === 1 &&
              trial.trace.attemptFailures.length === 0,
          ).length / trials.length,
    retryRate:
      trials.length === 0
        ? 0
        : trials.filter((trial) => trial.trace.attempts > 1).length /
          trials.length,
    fallbackRate:
      trials.length === 0
        ? 0
        : trials.filter((trial) => trial.trace.fallback).length / trials.length,
    medianLatencyMs: percentile(latencies, 0.5),
    p95LatencyMs: percentile(latencies, 0.95),
    meanPromptTokens:
      trials.length === 0
        ? 0
        : trials.reduce((sum, trial) => sum + trial.trace.promptTokens, 0) /
          trials.length,
    meanCompletionTokens:
      trials.length === 0
        ? 0
        : trials.reduce((sum, trial) => sum + trial.trace.completionTokens, 0) /
          trials.length,
  };
}

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey)
  throw new Error("OPENROUTER_API_KEY is required to run the live eval");

const requestedTrials = trialCount();
if (requestedTrials < 10) {
  console.warn(
    `Running ${requestedTrials} trial(s) per family; eval-spec.md requires at least 10 for development results.`,
  );
}
const families = selectedFamilies();
const schedule = shuffled(
  families.flatMap((family) =>
    Array.from({ length: requestedTrials }, () => family),
  ),
);
const agent = new OpenRouterAgent(apiKey);
const trials: Array<NeutralExpansionTrial | MicroEvalTrial> = [];
const invalidTrials: Array<{ familyId: FamilyId; reason: string }> = [];

for (const family of schedule) {
  let completed = false;
  for (let attempt = 1; !completed && attempt <= 6; attempt++) {
    try {
      const trial =
        family === "neutral-expansion"
          ? await runNeutralExpansionTrial(agent)
          : await runMicroEvalTrial(family, agent);
      trials.push(trial);
      completed = true;
      console.log(
        `${family}: ${trial.outcome.taskPass ? "pass" : "fail"} ` +
          `(${trials.length}/${schedule.length}, ${trial.trace.latencyMs.toFixed(0)} ms)`,
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      invalidTrials.push({ familyId: family, reason });
      console.error(`${family}: invalid attempt ${attempt}/6: ${reason}`);
    }
  }
  if (!completed) {
    throw new Error(
      `${family} did not complete a valid trial after 6 attempts`,
    );
  }
}

const completedAt = new Date();
const report = {
  evalVersion: "openfront-micro-v1",
  split: "development",
  completedAt: completedAt.toISOString(),
  requestedTrialsPerFamily: requestedTrials,
  requestedFamilies: families,
  model: agent.requestedModel,
  invalidTrials,
  summary: summarize(trials),
  trials,
};
const output = path.resolve(
  option("output") ??
    path.join(
      PROJECT_ROOT,
      "data/evals/openfront-micro-v1",
      `${completedAt.toISOString().replace(/[:.]/g, "-")}-${agent.requestedModel.replace(/[^a-zA-Z0-9._-]+/g, "-")}.json`,
    ),
);
await fs.mkdir(path.dirname(output), { recursive: true });
const temporary = `${output}.tmp-${process.pid}`;
await fs.writeFile(temporary, JSON.stringify(report, replacer, 2));
await fs.rename(temporary, output);

console.log(
  `Micro-eval score: ${Number(report.summary.microEvalScore).toFixed(1)}/100; ` +
    `${trials.length} valid, ${invalidTrials.length} invalid, ` +
    `$${Number(report.summary.totalCostUsd).toFixed(4)} total`,
);
console.log(`Report: ${output}`);
