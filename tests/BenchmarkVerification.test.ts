import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import { afterEach, describe, expect, test } from "vitest";
import { replacer } from "../OpenFrontIO/src/core/Util";
import { AgentPolicy, HarnessRunner } from "../src/HarnessRunner";
import { RunStore } from "../src/RunStore";
import { BENCHMARK_CAPABILITY_TASKS } from "../src/benchmark/BenchmarkCapabilities";
import { runBenchmarkCapabilityTrial } from "../src/benchmark/BenchmarkCapabilityRunner";
import { FrozenCapabilityFixture } from "../src/benchmark/BenchmarkCapabilityRunner";
import {
  BENCHMARK_MATCH_TASKS,
  benchmarkTask,
} from "../src/benchmark/BenchmarkConfig";
import { canonicalHash, canonicalJson } from "../src/benchmark/CanonicalJson";
import { summarizeBenchmarkTrials } from "../src/benchmark/BenchmarkReport";
import {
  BenchmarkManifestSchema,
  BenchmarkRunReportSchema,
  BenchmarkTrialSchema,
} from "../src/benchmark/BenchmarkSchemas";
import { deterministicShuffle } from "../src/benchmark/BenchmarkStatistics";

const execFileAsync = promisify(execFile);
const gzipAsync = promisify(gzip);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

function holdPolicy(): AgentPolicy {
  return {
    requestedModel: "test/verification-model",
    provider: "deterministic-local",
    promptVersion: "agent-v13",
    async estimateNextCost() {
      return 0;
    },
    async decide() {
      return {
        decision: { strategy: "Verification fixture hold.", action: "hold" },
        attempts: 1,
        attemptFailures: [],
        attemptTimings: [],
        latencyMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        model: "test/verification-model",
        provider: "deterministic-local",
      };
    },
  };
}

describe("benchmark verifier", () => {
  test("replays capability artifacts and rejects artifact tampering", async () => {
    const root = path.resolve(".");
    const runDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "openfront-benchmark-verify-"),
    );
    temporaryDirectories.push(runDir);
    await fs.mkdir(path.join(runDir, "trials"), { recursive: true });
    await fs.mkdir(path.join(runDir, "artifacts"), { recursive: true });
    const manifestValue = JSON.parse(
      await fs.readFile(
        path.join(root, "resources/benchmark/manifest.json"),
        "utf8",
      ),
    );
    const manifest = BenchmarkManifestSchema.parse(manifestValue);
    await fs.writeFile(
      path.join(runDir, "manifest.json"),
      canonicalJson(manifestValue),
    );

    let runnerSeed = "verification-0";
    let schedule: string[] = [];
    for (let index = 0; index < 1_000; index++) {
      runnerSeed = `verification-${index}`;
      schedule = deterministicShuffle(
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
      if (schedule[0].startsWith("cap-")) break;
    }
    const task = manifest.tasks.find((item) => item.id === schedule[0]);
    if (!task || task.suite !== "capability") {
      throw new Error("Could not select a capability-first schedule");
    }
    const result = await runBenchmarkCapabilityTrial(
      task as unknown as FrozenCapabilityFixture,
      holdPolicy(),
    );
    const runId = randomUUID();
    const trialId = randomUUID();
    const artifactRelative = `artifacts/${trialId}.capability.json.gz`;
    const artifact = { fixture: task, ...result };
    const writeArtifact = async (value: unknown) =>
      fs.writeFile(
        path.join(runDir, artifactRelative),
        await gzipAsync(JSON.stringify(value, replacer)),
      );
    await writeArtifact(artifact);
    const trial = BenchmarkTrialSchema.parse({
      schemaVersion: "benchmark-trial-v1",
      benchmarkVersion: manifest.benchmarkVersion,
      manifestHash: canonicalHash(manifestValue),
      runId,
      trialId,
      taskId: task.id,
      suite: "capability",
      split: "scored",
      status: "valid",
      invalidReason: null,
      model: {
        requested: "test/verification-model",
        resolved: "test/verification-model",
        provider: "deterministic-local",
        requestedProvider: "deterministic-local",
        promptVersion: "agent-v13",
        reasoningEffort: "none",
      },
      startedAt: "2026-08-06T00:00:00.000Z",
      completedAt: "2026-08-06T00:00:01.000Z",
      hashes: {
        checkpoint: result.checkpointHashes.state,
        final: result.finalHash,
      },
      attempts: {
        failures: result.agent.attemptFailures,
        timings: result.agent.attemptTimings,
        fallback: false,
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
      artifactPath: artifactRelative,
    });
    await fs.writeFile(
      path.join(runDir, "trials/000.json"),
      `${JSON.stringify(trial, null, 2)}\n`,
    );
    const bootstrapSeed = `${runnerSeed}:bootstrap`;
    const report = BenchmarkRunReportSchema.parse({
      schemaVersion: "benchmark-run-v1",
      benchmarkVersion: manifest.benchmarkVersion,
      classification: "external-self-run",
      complete: false,
      configuration: {
        requestedModel: "test/verification-model",
        requestedProvider: "deterministic-local",
        promptVersion: "agent-v13",
        reasoningEffort: "none",
      },
      manifestHash: canonicalHash(manifestValue),
      runId,
      runnerSeed,
      bootstrapSeed,
      bootstrapReplicates: 10_000,
      declaredTrials: { matchPerTask: 3, capabilityPerFixture: 10 },
      completedTrials: { match: 0, capability: 1 },
      taskOrder: schedule,
      trialReferences: ["trials/000.json"],
      invalidTrials: [],
      summaries: summarizeBenchmarkTrials([trial], bootstrapSeed),
      exactInvocation: "benchmark verification test",
    });
    await fs.writeFile(
      path.join(runDir, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );

    const invoke = () =>
      execFileAsync(
        process.execPath,
        ["--import", "tsx", "scripts/VerifyBenchmark.ts", runDir],
        {
          cwd: root,
          env: {
            ...process.env,
            TSX_TSCONFIG_PATH: path.join(root, "OpenFrontIO/tsconfig.json"),
          },
        },
      );
    await expect(invoke()).resolves.toMatchObject({
      stdout: expect.stringContaining("Verified"),
    });
    await writeArtifact({ ...artifact, assertions: [] });
    await expect(invoke()).rejects.toThrow();
  }, 30_000);

  test("replays and validates match artifacts", async () => {
    const root = path.resolve(".");
    const runDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "openfront-benchmark-match-verify-"),
    );
    temporaryDirectories.push(runDir);
    await fs.mkdir(path.join(runDir, "trials"), { recursive: true });
    const manifestValue = JSON.parse(
      await fs.readFile(
        path.join(root, "resources/benchmark/manifest.json"),
        "utf8",
      ),
    );
    const manifest = BenchmarkManifestSchema.parse(manifestValue);
    await fs.writeFile(
      path.join(runDir, "manifest.json"),
      canonicalJson(manifestValue),
    );
    let runnerSeed = "match-verification-0";
    let schedule: string[] = [];
    for (let index = 0; index < 1_000; index++) {
      runnerSeed = `match-verification-${index}`;
      schedule = deterministicShuffle(
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
      if (schedule[0].startsWith("match-")) break;
    }
    const trialId = randomUUID();
    const runId = randomUUID();
    const failingAgent: AgentPolicy = {
      requestedModel: "test/verification-model",
      provider: "deterministic-local",
      promptVersion: "agent-v13",
      async estimateNextCost() {
        return 0;
      },
      async decide() {
        return {
          decision: null,
          attempts: 1,
          attemptFailures: [
            {
              attempt: 1,
              code: "request_error",
              message: "deterministic verifier failure",
              rejectedActionIds: [],
            },
          ],
          attemptTimings: [],
          latencyMs: 0,
          promptTokens: 0,
          completionTokens: 0,
          costUsd: 0,
          model: "test/verification-model",
          provider: "deterministic-local",
          error: "deterministic verifier failure",
        };
      },
    };
    const store = new RunStore(path.join(runDir, "artifacts"));
    await store.init();
    const artifact = await new HarnessRunner(
      store,
      failingAgent,
      path.join(root, "OpenFrontIO/resources/maps"),
      benchmarkTask(schedule[0]),
    ).run(trialId);
    const trial = BenchmarkTrialSchema.parse({
      schemaVersion: "benchmark-trial-v1",
      benchmarkVersion: manifest.benchmarkVersion,
      manifestHash: canonicalHash(manifestValue),
      runId,
      trialId,
      taskId: schedule[0],
      suite: "match",
      split: "scored",
      status: "valid",
      invalidReason: null,
      model: {
        ...artifact.model,
        requestedProvider: "deterministic-local",
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
    await fs.writeFile(
      path.join(runDir, "trials/000.json"),
      `${JSON.stringify(trial, null, 2)}\n`,
    );
    const bootstrapSeed = `${runnerSeed}:bootstrap`;
    const report = BenchmarkRunReportSchema.parse({
      schemaVersion: "benchmark-run-v1",
      benchmarkVersion: manifest.benchmarkVersion,
      classification: "external-self-run",
      complete: false,
      configuration: {
        requestedModel: "test/verification-model",
        requestedProvider: "deterministic-local",
        promptVersion: "agent-v13",
        reasoningEffort: "none",
      },
      manifestHash: canonicalHash(manifestValue),
      runId,
      runnerSeed,
      bootstrapSeed,
      bootstrapReplicates: 10_000,
      declaredTrials: { matchPerTask: 3, capabilityPerFixture: 10 },
      completedTrials: { match: 1, capability: 0 },
      taskOrder: schedule,
      trialReferences: ["trials/000.json"],
      invalidTrials: [],
      summaries: summarizeBenchmarkTrials([trial], bootstrapSeed),
      exactInvocation: "benchmark match verification test",
    });
    await fs.writeFile(
      path.join(runDir, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    await expect(
      execFileAsync(
        process.execPath,
        ["--import", "tsx", "scripts/VerifyBenchmark.ts", runDir],
        {
          cwd: root,
          env: {
            ...process.env,
            TSX_TSCONFIG_PATH: path.join(root, "OpenFrontIO/tsconfig.json"),
          },
        },
      ),
    ).resolves.toMatchObject({ stdout: expect.stringContaining("Verified") });
  }, 30_000);
});
