import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { execFile } from "node:child_process";
import { OpenRouterAgent, promptFor } from "../src/OpenRouterAgent";
import { RunArtifactSchema } from "../src/Types";
import { BENCHMARK_CAPABILITY_TASKS } from "../src/benchmark/BenchmarkCapabilities";
import {
  BENCHMARK_MATCH_TASKS,
  benchmarkGameConfig,
} from "../src/benchmark/BenchmarkConfig";
import { verifyBenchmarkMapAssets } from "../src/benchmark/BenchmarkManifest";
import {
  BenchmarkManifestSchema,
  BenchmarkRunReportSchema,
  BenchmarkTrialSchema,
} from "../src/benchmark/BenchmarkSchemas";
import { canonicalHash, sha256 } from "../src/benchmark/CanonicalJson";
import { matchPoints, mean } from "../src/benchmark/BenchmarkStatistics";

const gunzipAsync = promisify(gunzip);
const execFileAsync = promisify(execFile);
const requested = process.argv[2];
if (!requested)
  throw new Error("Usage: npm run benchmark:verify -- <run-directory>");
const runDir = path.resolve(requested);

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

const manifestValue = await json(path.join(runDir, "manifest.json"));
const manifest = BenchmarkManifestSchema.parse(manifestValue);
const manifestHash = canonicalHash(manifestValue);
const report = BenchmarkRunReportSchema.parse(
  await json(path.join(runDir, "report.json")),
);
if (report.manifestHash !== manifestHash)
  throw new Error("Report manifest hash mismatch");
const { stdout: harnessCommit } = await execFileAsync(
  "git",
  ["rev-parse", "HEAD"],
  {
    cwd: path.resolve("."),
  },
);
if (harnessCommit.trim() !== manifest.harnessCommit) {
  throw new Error(
    "Checked-out harness commit does not match the release manifest",
  );
}
if (
  manifest.promptVersion !== OpenRouterAgent.promptVersion() ||
  manifest.promptHash !== sha256(promptFor({} as never, []))
) {
  throw new Error("Frozen prompt version or hash mismatch");
}

const expectedTaskIds = new Set([
  ...BENCHMARK_MATCH_TASKS.map((task) => task.id),
  ...BENCHMARK_CAPABILITY_TASKS.map((task) => task.fixtureId),
]);
const manifestTaskIds = manifest.tasks.map((task) => task.id);
if (
  new Set(manifestTaskIds).size !== 22 ||
  manifestTaskIds.some((id) => !expectedTaskIds.has(id as never))
) {
  throw new Error("Manifest does not contain the exact 22 public tasks");
}
for (const task of BENCHMARK_MATCH_TASKS) {
  const recorded = manifest.tasks.find((candidate) => candidate.id === task.id);
  const config = benchmarkGameConfig(task);
  if (
    !recorded ||
    recorded.suite !== "match" ||
    recorded.map !== task.map ||
    recorded.seed !== task.seed ||
    recorded.spawn.x !== task.spawn.x ||
    recorded.spawn.y !== task.spawn.y ||
    JSON.stringify([...recorded.expectedRoster]) !==
      JSON.stringify([...task.expectedRoster]) ||
    canonicalHash(recorded.resolvedConfig) !== canonicalHash(config) ||
    recorded.resolvedConfigHash !== canonicalHash(config)
  ) {
    throw new Error(`Frozen match configuration mismatch: ${task.id}`);
  }
}

const mapsDir = path.resolve("OpenFrontIO/resources/maps");
await verifyBenchmarkMapAssets(mapsDir, manifest.mapAssets);

if (new Set(report.trialReferences).size !== report.trialReferences.length) {
  throw new Error("Run report contains duplicate trial references");
}
const trials = [];
const artifactPaths = new Set<string>();
for (const reference of report.trialReferences) {
  const trial = BenchmarkTrialSchema.parse(await json(safePath(reference)));
  if (trial.runId !== report.runId || trial.manifestHash !== manifestHash) {
    throw new Error(`Trial identity mismatch: ${reference}`);
  }
  const task = manifest.tasks.find(
    (candidate) => candidate.id === trial.taskId,
  );
  if (!task || task.suite !== trial.suite)
    throw new Error(`Unknown trial task: ${trial.taskId}`);
  if (artifactPaths.has(trial.artifactPath))
    throw new Error(`Duplicate gameplay artifact: ${trial.artifactPath}`);
  artifactPaths.add(trial.artifactPath);
  if (trial.suite === "capability") {
    const pass = trial.assertions.every((item) => item.passed);
    if (trial.taskScore !== (pass ? 100 : 0))
      throw new Error(`Capability grade mismatch: ${trial.taskId}`);
  } else if (trial.status === "valid") {
    const artifactFile = safePath(trial.artifactPath);
    const artifact = RunArtifactSchema.parse(
      JSON.parse(
        (await gunzipAsync(await fs.readFile(artifactFile))).toString("utf8"),
      ),
    );
    const fieldSize = artifact.outcome.fieldSize;
    if (fieldSize === undefined)
      throw new Error(`Missing match field size: ${trial.taskId}`);
    const expected = matchPoints(fieldSize, artifact.outcome.finalPlacement);
    if (
      Math.abs(trial.taskScore - expected) > 1e-9 ||
      artifact.outcome.matchPoints !== expected
    ) {
      throw new Error(`Match score mismatch: ${trial.taskId}`);
    }
    if (trial.hashes.final !== artifact.outcome.finalHash) {
      throw new Error(`Final hash mismatch: ${trial.taskId}`);
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
)
  throw new Error("Completed trial counts do not match trial records");

if (report.complete) {
  for (const task of BENCHMARK_MATCH_TASKS) {
    if (matchTrials.filter((trial) => trial.taskId === task.id).length !== 3) {
      throw new Error(
        `Complete report does not have three valid trials for ${task.id}`,
      );
    }
  }
  for (const task of BENCHMARK_CAPABILITY_TASKS) {
    if (
      capabilityTrials.filter((trial) => trial.taskId === task.fixtureId)
        .length !== 10
    ) {
      throw new Error(
        `Complete report does not have ten valid trials for ${task.fixtureId}`,
      );
    }
  }
}

const taskMeans = BENCHMARK_MATCH_TASKS.map((task) => {
  const values = matchTrials
    .filter((trial) => trial.taskId === task.id)
    .map((trial) => trial.taskScore);
  return values.length === 0 ? null : mean(values);
}).filter((value): value is number => value !== null);
const capabilityRates = BENCHMARK_CAPABILITY_TASKS.map((task) => {
  const values = capabilityTrials.filter(
    (trial) => trial.taskId === task.fixtureId,
  );
  return values.length === 0
    ? null
    : values.filter((trial) => trial.taskScore === 100).length / values.length;
}).filter((value): value is number => value !== null);
const recomputed = {
  matchScore: taskMeans.length === 0 ? null : mean(taskMeans),
  capabilityScore:
    capabilityRates.length === 0 ? null : 100 * mean(capabilityRates),
};
for (const [key, value] of Object.entries(recomputed)) {
  const reported = report.summaries[key];
  if (
    value !== null &&
    (typeof reported !== "number" || Math.abs(reported - value) > 1e-9)
  ) {
    throw new Error(`Reported ${key} does not match trial records`);
  }
}

process.stdout.write(
  `Verified ${report.runId}: ${matchTrials.length} match and ${capabilityTrials.length} capability trials${report.complete ? " (complete)" : " (incomplete)"}\n`,
);
