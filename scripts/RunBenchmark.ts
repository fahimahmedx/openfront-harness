import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import * as dotenv from "dotenv";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { gzip } from "node:zlib";
import { replacer } from "../OpenFrontIO/src/core/Util";
import { HarnessRunner } from "../src/HarnessRunner";
import { OpenRouterAgent } from "../src/OpenRouterAgent";
import { RunStore } from "../src/RunStore";
import { runBenchmarkCapabilityTrial } from "../src/benchmark/BenchmarkCapabilityRunner";
import { BENCHMARK_CAPABILITY_TASKS } from "../src/benchmark/BenchmarkCapabilities";
import {
  BENCHMARK_MATCH_TASKS,
  benchmarkTask,
} from "../src/benchmark/BenchmarkConfig";
import { summarizeBenchmarkTrials } from "../src/benchmark/BenchmarkReport";
import { validateBenchmarkRelease } from "../src/benchmark/BenchmarkReleaseValidation";
import {
  BenchmarkManifestSchema,
  BenchmarkRunReport,
  BenchmarkRunReportSchema,
  BenchmarkTrial,
  BenchmarkTrialSchema,
} from "../src/benchmark/BenchmarkSchemas";
import { canonicalHash, canonicalJson } from "../src/benchmark/CanonicalJson";
import { deterministicShuffle } from "../src/benchmark/BenchmarkStatistics";

const gzipAsync = promisify(gzip);
const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

function option(name: string): string | undefined {
  const direct = process.argv.indexOf(`--${name}`);
  if (direct >= 0) return process.argv[direct + 1];
  const prefix = `--${name}=`;
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

async function atomicJson(target: string, value: unknown): Promise<void> {
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, replacer, 2)}\n`);
  await fs.rename(temporary, target);
}

async function worker(): Promise<void> {
  const manifestPath = path.resolve(option("manifest")!);
  const runDir = path.resolve(option("output")!);
  const runId = option("run-id")!;
  const trialId = option("trial-id")!;
  const taskId = option("task")!;
  const trialFile = option("trial-file")!;
  const manifestValue = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const manifest = BenchmarkManifestSchema.parse(manifestValue);
  const manifestHash = canonicalHash(manifestValue);
  const task = manifest.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error(`Manifest task not found: ${taskId}`);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required");
  const agent = new OpenRouterAgent(apiKey);
  const startedAt = new Date();
  let trial: BenchmarkTrial;
  if (task.suite === "match") {
    const store = new RunStore(path.join(runDir, "artifacts"));
    await store.init();
    const artifact = await new HarnessRunner(
      store,
      agent,
      path.join(PROJECT_ROOT, "OpenFrontIO/resources/maps"),
      benchmarkTask(task.id),
    ).run(trialId);
    if (
      artifact.status !== "completed" ||
      artifact.outcome.matchPoints === undefined
    ) {
      throw new Error(
        `Infrastructure-invalid match: ${artifact.outcome.terminationReason}`,
      );
    }
    trial = BenchmarkTrialSchema.parse({
      schemaVersion: "benchmark-trial-v1",
      benchmarkVersion: manifest.benchmarkVersion,
      manifestHash,
      runId,
      trialId,
      taskId,
      suite: "match",
      split: "scored",
      status: "valid",
      invalidReason: null,
      model: {
        ...artifact.model,
        requestedProvider: agent.provider ?? null,
      },
      startedAt: artifact.startedAt,
      completedAt: artifact.completedAt,
      hashes: { final: artifact.outcome.finalHash },
      attempts: {
        failures: artifact.decisions.flatMap(
          (decision) => decision.attemptFailures,
        ),
        timings: artifact.decisions.flatMap(
          (decision) => decision.attemptTimings,
        ),
        fallback: artifact.decisions.some((decision) => decision.fallback),
      },
      usage: artifact.usage,
      assertions: [],
      diagnostics: {
        winner: artifact.outcome.winner,
        won: artifact.outcome.llmWon,
        placement: artifact.outcome.finalPlacement,
        survived: artifact.outcome.survived,
        finalLandShare: artifact.outcome.finalLandShare,
        finalTroopShare: artifact.outcome.finalTroopShare,
        terminationReason: artifact.outcome.terminationReason,
        decisions: artifact.decisions.length,
      },
      componentCoverage: null,
      taskScore: artifact.outcome.matchPoints,
      artifactPath: `artifacts/${trialId}.json.gz`,
    });
  } else {
    const result = await runBenchmarkCapabilityTrial(task, agent);
    const artifactPath = path.join(
      runDir,
      "artifacts",
      `${trialId}.capability.json.gz`,
    );
    await fs.mkdir(path.dirname(artifactPath), { recursive: true });
    await fs.writeFile(
      artifactPath,
      await gzipAsync(JSON.stringify({ fixture: task, ...result }, replacer)),
    );
    trial = BenchmarkTrialSchema.parse({
      schemaVersion: "benchmark-trial-v1",
      benchmarkVersion: manifest.benchmarkVersion,
      manifestHash,
      runId,
      trialId,
      taskId,
      suite: "capability",
      split: "scored",
      status: "valid",
      invalidReason: null,
      model: {
        requested: agent.requestedModel,
        resolved: result.agent.model,
        provider: result.agent.provider,
        requestedProvider: agent.provider ?? null,
        promptVersion: agent.promptVersion,
        reasoningEffort: OpenRouterAgent.reasoningEffort(),
      },
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      hashes: {
        checkpoint: result.checkpointHashes.state,
        final: result.finalHash,
      },
      attempts: {
        failures: result.agent.attemptFailures,
        timings: result.agent.attemptTimings,
        fallback: result.agent.decision === null,
      },
      usage: {
        promptTokens: result.agent.promptTokens,
        completionTokens: result.agent.completionTokens,
        costUsd: result.agent.costUsd,
      },
      assertions: result.assertions,
      diagnostics: result.diagnostics,
      componentCoverage: result.componentCoverage,
      taskScore: result.taskScore,
      artifactPath: `artifacts/${trialId}.capability.json.gz`,
    });
  }
  await atomicJson(path.join(runDir, trialFile), trial);
}

function child(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn(
      globalThis.process.execPath,
      ["--import", "tsx", fileURLToPath(import.meta.url), "--worker", ...args],
      {
        cwd: PROJECT_ROOT,
        env: {
          ...globalThis.process.env,
          TSX_TSCONFIG_PATH: path.join(
            PROJECT_ROOT,
            "OpenFrontIO/tsconfig.json",
          ),
        },
        stdio: "inherit",
      },
    );
    process.once("error", reject);
    process.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Trial worker exited ${code}`)),
    );
  });
}

async function main(): Promise<void> {
  if (option("profile") !== "official")
    throw new Error("--profile official is required");
  const resumeDir = option("resume") ? path.resolve(option("resume")!) : null;
  const manifestPath = path.resolve(
    option("manifest") ??
      (resumeDir
        ? path.join(resumeDir, "manifest.json")
        : path.join(PROJECT_ROOT, "resources/benchmark/manifest.json")),
  );
  const manifestRaw = await fs.readFile(manifestPath, "utf8").catch(() => {
    throw new Error(
      "No frozen release manifest exists. Ten scored fixtures and their acceptance reports must pass before an official run.",
    );
  });
  const manifestValue = JSON.parse(manifestRaw);
  const manifest = await validateBenchmarkRelease(manifestValue, PROJECT_ROOT);
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required");
  const configuredAgent = new OpenRouterAgent(apiKey);
  const configuration = {
    requestedModel: configuredAgent.requestedModel,
    requestedProvider: configuredAgent.provider ?? null,
    promptVersion: configuredAgent.promptVersion,
    reasoningEffort: OpenRouterAgent.reasoningEffort(),
  } as const;
  const resumedReport = resumeDir
    ? BenchmarkRunReportSchema.parse(
        JSON.parse(
          await fs.readFile(path.join(resumeDir, "report.json"), "utf8"),
        ),
      )
    : null;
  if (resumedReport?.complete)
    throw new Error("Cannot resume an already complete run");
  if (
    resumedReport &&
    canonicalHash(resumedReport.configuration) !== canonicalHash(configuration)
  ) {
    throw new Error("Cannot resume with a different model configuration");
  }
  const runId = resumedReport?.runId ?? randomUUID();
  const runnerSeed =
    resumedReport?.runnerSeed ?? option("runner-seed") ?? runId;
  const bootstrapSeed =
    resumedReport?.bootstrapSeed ??
    option("bootstrap-seed") ??
    `${runnerSeed}:bootstrap`;
  const runDir =
    resumeDir ??
    path.resolve(
      option("output") ?? path.join(PROJECT_ROOT, "data/benchmarks", runId),
    );
  await fs.mkdir(path.join(runDir, "trials"), { recursive: true });
  await fs.mkdir(path.join(runDir, "artifacts"), { recursive: true });
  await fs.writeFile(
    path.join(runDir, "manifest.json"),
    canonicalJson(manifestValue),
  );
  const frozenManifestPath = path.join(runDir, "manifest.json");
  const manifestHash = canonicalHash(manifestValue);
  if (resumedReport && resumedReport.manifestHash !== manifestHash) {
    throw new Error("Resume manifest does not match the partial run");
  }
  const schedule = deterministicShuffle(
    [
      ...BENCHMARK_MATCH_TASKS.flatMap((task) =>
        Array.from({ length: 3 }, () => task.id),
      ),
      ...BENCHMARK_CAPABILITY_TASKS.flatMap((task) =>
        Array.from({ length: 10 }, () => task.fixtureId),
      ),
    ],
    runnerSeed,
  );
  if (
    resumedReport &&
    canonicalHash(resumedReport.taskOrder) !== canonicalHash(schedule)
  ) {
    throw new Error("Resume report task order is not the canonical schedule");
  }
  const trialReferences = [...(resumedReport?.trialReferences ?? [])];
  if (
    new Set(trialReferences).size !== trialReferences.length ||
    trialReferences.some(
      (reference, index) =>
        reference !== `trials/${String(index).padStart(3, "0")}.json`,
    )
  ) {
    throw new Error("Resume report contains invalid trial references");
  }
  const invalidTrials = [...(resumedReport?.invalidTrials ?? [])];
  const trials: BenchmarkTrial[] = await Promise.all(
    trialReferences.map(async (reference, index) => {
      const trial = BenchmarkTrialSchema.parse(
        JSON.parse(await fs.readFile(path.join(runDir, reference), "utf8")),
      );
      if (
        trial.taskId !== schedule[index] ||
        trial.model.requested !== configuration.requestedModel ||
        trial.model.requestedProvider !== configuration.requestedProvider ||
        trial.model.promptVersion !== configuration.promptVersion ||
        trial.model.reasoningEffort !== configuration.reasoningEffort
      ) {
        throw new Error(`Resume trial mismatch: ${reference}`);
      }
      return trial;
    }),
  );
  const invocation = process.argv
    .map((value) =>
      value.includes("OPENROUTER_API_KEY") ? "[REDACTED]" : value,
    )
    .join(" ");
  const writeReport = async (complete: boolean) => {
    const report = BenchmarkRunReportSchema.parse({
      schemaVersion: "benchmark-run-v1",
      benchmarkVersion: manifest.benchmarkVersion,
      classification: resumedReport?.classification ?? "external-self-run",
      complete,
      configuration,
      manifestHash,
      runId,
      runnerSeed,
      bootstrapSeed,
      bootstrapReplicates: 10_000,
      declaredTrials: { matchPerTask: 3, capabilityPerFixture: 10 },
      completedTrials: {
        match: trials.filter(
          (trial) => trial.suite === "match" && trial.status === "valid",
        ).length,
        capability: trials.filter(
          (trial) => trial.suite === "capability" && trial.status === "valid",
        ).length,
      },
      taskOrder: schedule,
      trialReferences,
      invalidTrials,
      summaries: summarizeBenchmarkTrials(trials, bootstrapSeed),
      exactInvocation: invocation,
    } satisfies BenchmarkRunReport);
    await atomicJson(path.join(runDir, "report.json"), report);
  };
  await writeReport(false);
  for (let index = 0; index < schedule.length; index++) {
    const taskId = schedule[index];
    const reference = `trials/${String(index).padStart(3, "0")}.json`;
    if (trialReferences.includes(reference)) continue;
    let completed = false;
    for (let attempt = 1; attempt <= 6 && !completed; attempt++) {
      const trialId = randomUUID();
      try {
        await child([
          `--manifest=${frozenManifestPath}`,
          `--output=${runDir}`,
          `--run-id=${runId}`,
          `--trial-id=${trialId}`,
          `--task=${taskId}`,
          `--trial-file=${reference}`,
        ]);
        const trial = BenchmarkTrialSchema.parse(
          JSON.parse(await fs.readFile(path.join(runDir, reference), "utf8")),
        );
        trials.push(trial);
        trialReferences.push(reference);
        completed = true;
        await writeReport(false);
        process.stdout.write(
          `${index + 1}/${schedule.length} ${taskId}: ${trial.taskScore.toFixed(1)}\n`,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        invalidTrials.push({ taskId, reason });
        await writeReport(false);
      }
    }
    if (!completed)
      throw new Error(`${taskId} failed six infrastructure attempts`);
  }
  await writeReport(true);
  process.stdout.write(
    `Complete benchmark report: ${path.join(runDir, "report.json")}\n`,
  );
}

if (process.argv.includes("--worker")) await worker();
else await main();
