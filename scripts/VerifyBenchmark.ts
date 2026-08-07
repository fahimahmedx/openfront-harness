import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { z } from "zod";
import { GameRecordSchema, Intent } from "../OpenFrontIO/src/core/Schemas";
import { AgentPolicy } from "../src/HarnessRunner";
import { RunArtifactSchema } from "../src/Types";
import { BENCHMARK_CAPABILITY_TASKS } from "../src/benchmark/BenchmarkCapabilities";
import { runBenchmarkCapabilityTrial } from "../src/benchmark/BenchmarkCapabilityRunner";
import {
  BENCHMARK_MATCH_TASKS,
  benchmarkTask,
} from "../src/benchmark/BenchmarkConfig";
import { canonicalHash } from "../src/benchmark/CanonicalJson";
import { validateBenchmarkRelease } from "../src/benchmark/BenchmarkReleaseValidation";
import { summarizeBenchmarkTrials } from "../src/benchmark/BenchmarkReport";
import {
  BenchmarkAssertionSchema,
  BenchmarkManifestTaskSchema,
  BenchmarkRunReportSchema,
  BenchmarkTrial,
  BenchmarkTrialSchema,
} from "../src/benchmark/BenchmarkSchemas";
import {
  deterministicShuffle,
  matchPoints,
} from "../src/benchmark/BenchmarkStatistics";
import { EvalGameSession } from "../src/evals/EvalGameSession";

const gunzipAsync = promisify(gunzip);
const root = path.resolve(import.meta.dirname, "..");
const requested = process.argv[2];
if (!requested)
  throw new Error("Usage: npm run benchmark:verify -- <run-directory>");
const runDir = path.resolve(requested);

const CapabilityArtifactSchema = z.object({
  fixture: BenchmarkManifestTaskSchema,
  observation: z.unknown(),
  candidates: z.array(z.record(z.string(), z.unknown())),
  selectedActionIds: z.array(z.string()).length(1),
  appliedActionIds: z.array(z.string()).length(1),
  actionOutcomes: z.array(z.record(z.string(), z.unknown())),
  agent: z
    .object({
      attempts: z.number().int().positive(),
      attemptFailures: z.array(z.unknown()),
      attemptTimings: z.array(z.unknown()),
      promptTokens: z.number().int().nonnegative(),
      completionTokens: z.number().int().nonnegative(),
      costUsd: z.number().nonnegative(),
      model: z.string(),
      provider: z.string().nullable(),
      decision: z.unknown().nullable(),
    })
    .passthrough(),
  checkpointHashes: z.object({
    state: z.union([z.number(), z.string()]),
    observation: z.string(),
    candidateMenu: z.string(),
    tileState: z.string(),
  }),
  finalHash: z.union([z.number(), z.string(), z.null()]),
  assertions: z.array(BenchmarkAssertionSchema),
  componentCoverage: z.number().min(0).max(1),
  taskPass: z.boolean(),
  taskScore: z.union([z.literal(0), z.literal(100)]),
  diagnostics: z.record(z.string(), z.unknown()),
  replay: GameRecordSchema,
});

async function json(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

function safePath(relative: string): string {
  const target = path.resolve(runDir, relative);
  if (target !== runDir && !target.startsWith(`${runDir}${path.sep}`)) {
    throw new Error(`Artifact path escapes run directory: ${relative}`);
  }
  return target;
}

function equal(left: unknown, right: unknown): boolean {
  return canonicalHash(left) === canonicalHash(right);
}

function modelMatchesConfiguration(
  trial: BenchmarkTrial,
  configuration: z.infer<typeof BenchmarkRunReportSchema>["configuration"],
): boolean {
  return (
    trial.model.requested === configuration.requestedModel &&
    trial.model.requestedProvider === configuration.requestedProvider &&
    trial.model.promptVersion === configuration.promptVersion &&
    trial.model.reasoningEffort === configuration.reasoningEffort
  );
}

async function verifyMatchReplay(
  trial: BenchmarkTrial,
  artifact: z.infer<typeof RunArtifactSchema>,
): Promise<void> {
  const session = await EvalGameSession.create(
    artifact.model.requested,
    path.join(root, "OpenFrontIO/resources/maps"),
    benchmarkTask(trial.taskId),
  );
  try {
    const turns = new Map(
      artifact.replay.turns.map((turn) => [turn.turnNumber, turn]),
    );
    for (let tick = 0; tick < artifact.replay.info.num_turns; tick++) {
      const recorded = turns.get(tick);
      session.execute(
        (recorded?.intents ?? []).map(
          ({ clientID: _clientID, ...intent }) => intent as Intent,
        ),
      );
      if (recorded?.hash !== undefined && session.lastHash !== recorded.hash) {
        throw new Error(
          `Replay hash mismatch at tick ${tick}: ${trial.taskId}`,
        );
      }
    }
    if (session.lastHash !== artifact.outcome.finalHash) {
      throw new Error(`Replay final hash mismatch: ${trial.taskId}`);
    }
  } finally {
    session.close();
  }
}

function fixedActionPolicy(action: string): AgentPolicy {
  return {
    requestedModel: "benchmark-verifier",
    provider: "deterministic-local",
    promptVersion: "agent-v13",
    async estimateNextCost() {
      return 0;
    },
    async decide() {
      return {
        decision: { strategy: "Recorded benchmark action replay.", action },
        attempts: 1,
        attemptFailures: [],
        attemptTimings: [],
        latencyMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        model: "benchmark-verifier",
        provider: "deterministic-local",
      };
    },
  };
}

const manifestValue = await json(path.join(runDir, "manifest.json"));
const manifest = await validateBenchmarkRelease(manifestValue, root);
const manifestHash = canonicalHash(manifestValue);
const reportValue = await json(path.join(runDir, "report.json"));
const report = BenchmarkRunReportSchema.parse(reportValue);
if (!equal(report, reportValue)) {
  throw new Error("Run report contains unknown schema fields");
}
if (report.manifestHash !== manifestHash)
  throw new Error("Report manifest hash mismatch");
if (
  report.bootstrapReplicates !== manifest.bootstrap.replicates ||
  !equal(report.declaredTrials, {
    matchPerTask: 3,
    capabilityPerFixture: 10,
  })
) {
  throw new Error("Report declaration does not match the release contract");
}

const expectedSchedule = deterministicShuffle(
  [
    ...BENCHMARK_MATCH_TASKS.flatMap((task) =>
      Array.from({ length: 3 }, () => task.id),
    ),
    ...BENCHMARK_CAPABILITY_TASKS.flatMap((task) =>
      Array.from({ length: 10 }, () => task.fixtureId),
    ),
  ],
  report.runnerSeed,
);
if (!equal(report.taskOrder, expectedSchedule)) {
  throw new Error("Run task order is not the seeded canonical schedule");
}
if (new Set(report.trialReferences).size !== report.trialReferences.length) {
  throw new Error("Run report contains duplicate trial references");
}

const trials: BenchmarkTrial[] = [];
const artifactPaths = new Set<string>();
for (let position = 0; position < report.trialReferences.length; position++) {
  const reference = report.trialReferences[position];
  if (reference !== `trials/${String(position).padStart(3, "0")}.json`) {
    throw new Error(`Non-canonical trial reference: ${reference}`);
  }
  const trialValue = await json(safePath(reference));
  const trial = BenchmarkTrialSchema.parse(trialValue);
  if (!equal(trial, trialValue)) {
    throw new Error(`Trial contains unknown schema fields: ${reference}`);
  }
  if (
    trial.runId !== report.runId ||
    trial.manifestHash !== manifestHash ||
    trial.taskId !== report.taskOrder[position] ||
    trial.status !== "valid" ||
    trial.invalidReason !== null
  ) {
    throw new Error(`Trial identity or schedule mismatch: ${reference}`);
  }
  if (!modelMatchesConfiguration(trial, report.configuration)) {
    throw new Error(`Mixed model configuration: ${reference}`);
  }
  const task = manifest.tasks.find(
    (candidate) => candidate.id === trial.taskId,
  );
  if (!task || task.suite !== trial.suite) {
    throw new Error(`Unknown trial task: ${trial.taskId}`);
  }
  if (artifactPaths.has(trial.artifactPath)) {
    throw new Error(`Duplicate gameplay artifact: ${trial.artifactPath}`);
  }
  artifactPaths.add(trial.artifactPath);
  const artifactFile = safePath(trial.artifactPath);
  const artifactValue = JSON.parse(
    (await gunzipAsync(await fs.readFile(artifactFile))).toString("utf8"),
  );

  if (trial.suite === "match") {
    const artifact = RunArtifactSchema.parse(artifactValue);
    const fieldSize = artifact.outcome.fieldSize;
    if (fieldSize === undefined) {
      throw new Error(`Missing match field size: ${trial.taskId}`);
    }
    const expected = matchPoints(fieldSize, artifact.outcome.finalPlacement);
    const expectedDiagnostics = {
      winner: artifact.outcome.winner,
      won: artifact.outcome.llmWon,
      placement: artifact.outcome.finalPlacement,
      survived: artifact.outcome.survived,
      finalLandShare: artifact.outcome.finalLandShare,
      finalTroopShare: artifact.outcome.finalTroopShare,
      terminationReason: artifact.outcome.terminationReason,
      decisions: artifact.decisions.length,
    };
    if (
      artifact.runId !== trial.trialId ||
      artifact.status !== "completed" ||
      trial.startedAt !== artifact.startedAt ||
      trial.completedAt !== artifact.completedAt ||
      trial.model.requested !== artifact.model.requested ||
      trial.model.resolved !== artifact.model.resolved ||
      trial.model.provider !== artifact.model.provider ||
      trial.model.promptVersion !== artifact.model.promptVersion ||
      trial.model.reasoningEffort !== artifact.model.reasoningEffort ||
      trial.taskScore !== expected ||
      artifact.outcome.matchPoints !== expected ||
      trial.hashes.final !== artifact.outcome.finalHash ||
      !equal(trial.usage, artifact.usage) ||
      !equal(trial.diagnostics, expectedDiagnostics) ||
      !equal(
        trial.attempts.failures,
        artifact.decisions.flatMap((decision) => decision.attemptFailures),
      ) ||
      !equal(
        trial.attempts.timings,
        artifact.decisions.flatMap((decision) => decision.attemptTimings),
      ) ||
      trial.attempts.fallback !==
        artifact.decisions.some((decision) => decision.fallback) ||
      trial.assertions.length !== 0 ||
      trial.componentCoverage !== null
    ) {
      throw new Error(`Match artifact mismatch: ${trial.taskId}`);
    }
    await verifyMatchReplay(trial, artifact);
  } else {
    const artifact = CapabilityArtifactSchema.parse(artifactValue);
    if (
      artifact.fixture.suite !== "capability" ||
      !equal(artifact.fixture, task) ||
      !equal(trial.hashes.checkpoint, artifact.checkpointHashes.state) ||
      !equal(trial.hashes.final, artifact.finalHash) ||
      !equal(trial.assertions, artifact.assertions) ||
      !equal(trial.diagnostics, artifact.diagnostics) ||
      trial.componentCoverage !== artifact.componentCoverage ||
      trial.taskScore !== artifact.taskScore ||
      artifact.taskPass !== (artifact.taskScore === 100) ||
      trial.usage.promptTokens !== artifact.agent.promptTokens ||
      trial.usage.completionTokens !== artifact.agent.completionTokens ||
      trial.usage.costUsd !== artifact.agent.costUsd ||
      trial.model.resolved !== artifact.agent.model ||
      trial.model.provider !== artifact.agent.provider ||
      trial.attempts.fallback !== (artifact.agent.decision === null) ||
      !equal(trial.attempts.failures, artifact.agent.attemptFailures) ||
      !equal(trial.attempts.timings, artifact.agent.attemptTimings)
    ) {
      throw new Error(`Capability artifact mismatch: ${trial.taskId}`);
    }
    const replayed = await runBenchmarkCapabilityTrial(
      task,
      fixedActionPolicy(artifact.selectedActionIds[0]),
    );
    if (
      !equal(replayed.checkpointHashes, artifact.checkpointHashes) ||
      replayed.finalHash !== artifact.finalHash ||
      !equal(replayed.observation, artifact.observation) ||
      !equal(replayed.candidates, artifact.candidates) ||
      !equal(replayed.appliedActionIds, artifact.appliedActionIds) ||
      !equal(replayed.actionOutcomes, artifact.actionOutcomes) ||
      !equal(replayed.assertions, artifact.assertions) ||
      replayed.taskScore !== artifact.taskScore
    ) {
      throw new Error(`Capability replay mismatch: ${trial.taskId}`);
    }
  }
  trials.push(trial);
}

const valid = trials.filter((trial) => trial.status === "valid");
const matchTrials = valid.filter((trial) => trial.suite === "match");
const capabilityTrials = valid.filter((trial) => trial.suite === "capability");
if (
  report.completedTrials.match !== matchTrials.length ||
  report.completedTrials.capability !== capabilityTrials.length
) {
  throw new Error("Completed trial counts do not match trial records");
}
if (report.complete && trials.length !== expectedSchedule.length) {
  throw new Error("Complete report does not contain the full schedule");
}
if (
  !equal(
    report.summaries,
    summarizeBenchmarkTrials(trials, report.bootstrapSeed),
  )
) {
  throw new Error("Reported summaries do not match the trial records");
}

const resolvedModels = new Set(valid.map((trial) => trial.model.resolved));
const providers = new Set(valid.map((trial) => trial.model.provider));
if (resolvedModels.size > 1 || providers.size > 1) {
  throw new Error("A benchmark report cannot mix resolved models or providers");
}

process.stdout.write(
  `Verified ${report.runId}: ${matchTrials.length} match and ${capabilityTrials.length} capability trials${report.complete ? " (complete)" : " (incomplete)"}\n`,
);
