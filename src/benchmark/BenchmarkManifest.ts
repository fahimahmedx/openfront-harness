import { promises as fs } from "node:fs";
import path from "node:path";
import { OpenRouterAgent, promptFor } from "../OpenRouterAgent";
import { OPENFRONT_COMMIT, OPENFRONT_VERSION } from "../Scenario";
import { BENCHMARK_CAPABILITY_TASKS } from "./BenchmarkCapabilities";
import {
  BENCHMARK_LIMITS,
  BENCHMARK_MATCH_TASKS,
  BENCHMARK_VERSION,
  benchmarkGameConfig,
} from "./BenchmarkConfig";
import { canonicalHash, sha256 } from "./CanonicalJson";

const ASSET_NAMES = [
  "manifest.json",
  "map.bin",
  "map4x.bin",
  "map16x.bin",
  "thumbnail.webp",
] as const;

export async function benchmarkMapAssetHashes(
  mapsDir: string,
): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  for (const slug of new Set(
    BENCHMARK_MATCH_TASKS.map((task) => task.mapSlug),
  )) {
    for (const name of ASSET_NAMES) {
      const relative = `${slug}/${name}`;
      hashes[relative] = sha256(
        await fs.readFile(path.join(mapsDir, relative)),
      );
    }
  }
  return hashes;
}

export async function verifyBenchmarkMapAssets(
  mapsDir: string,
  expected: Readonly<Record<string, string>>,
): Promise<void> {
  const actual = await benchmarkMapAssetHashes(mapsDir);
  const expectedKeys = Object.keys(expected).sort();
  const actualKeys = Object.keys(actual).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error("Benchmark map asset list does not match the manifest");
  }
  for (const key of actualKeys) {
    if (actual[key] !== expected[key]) {
      throw new Error(`Benchmark map asset hash mismatch: ${key}`);
    }
  }
}

export type FrozenCapabilityData = {
  fixtureId: string;
  preparationTurns: Array<Record<string, unknown>>;
  decisionIndex: number;
  recentDecisions: Array<Record<string, unknown>>;
  checkpointTick: number;
  hashes: {
    state: number | string;
    observation: string;
    candidateMenu: string;
    tileState: string;
  };
  semanticRoles: Record<string, unknown>;
  thresholds: Record<string, unknown>;
  ownershipSets: Record<string, number[]>;
  referencePolicyHash: string;
  controlPolicyHashes: string[];
  acceptanceReportPath: string;
  acceptanceReportHash: string;
};

export async function createReleaseManifestInput(options: {
  mapsDir: string;
  harnessCommit: string;
  harnessSourceHash: string;
  releaseDate: string;
  graderPackageHash: string;
  capabilities: readonly FrozenCapabilityData[];
}) {
  if (options.capabilities.length !== 10) {
    throw new Error(
      "A release manifest requires ten accepted scored capability fixtures; development fixtures cannot be substituted",
    );
  }
  const capabilityData = new Map(
    options.capabilities.map((fixture) => [fixture.fixtureId, fixture]),
  );
  const commonTask = (source: (typeof BENCHMARK_MATCH_TASKS)[number]) => ({
    split: "scored" as const,
    map: source.map,
    mapPath: source.mapSlug,
    seed: source.seed,
    spawn: source.spawn,
    difficulty: source.difficulty,
    nationCount: source.nationCount,
    tribeBotCount: source.tribeBotCount,
    expectedRoster: source.expectedRoster,
    resolvedConfig: benchmarkGameConfig(source),
    resolvedConfigHash: canonicalHash(benchmarkGameConfig(source)),
    ceilings: BENCHMARK_LIMITS,
  });
  return {
    benchmarkVersion: BENCHMARK_VERSION,
    releaseDate: options.releaseDate,
    license: "AGPL-3.0-only",
    maintainer: "fahimahmedx",
    engine: { version: OPENFRONT_VERSION, commit: OPENFRONT_COMMIT },
    mapAssets: await benchmarkMapAssetHashes(options.mapsDir),
    harnessCommit: options.harnessCommit,
    harnessSourceHash: options.harnessSourceHash,
    promptVersion: OpenRouterAgent.promptVersion(),
    // The prompt serializer is code, so hash a stable representative rendering;
    // verification additionally pins the complete benchmark runtime source.
    promptHash: sha256(promptFor({} as never, [])),
    schemaVersions: {
      manifest: "benchmark-manifest-v1",
      trial: "benchmark-trial-v1",
      report: "benchmark-run-v1",
    },
    resolverVersion: "single-action-v1",
    troopPolicy: BENCHMARK_LIMITS.troopPolicy,
    graderPackageHash: options.graderPackageHash,
    taskOrder: {
      algorithm: "fnv1a-mulberry32-fisher-yates-v1",
      runnerSeedFormat: "non-empty UTF-8 string",
    },
    bootstrap: {
      implementation: "stratified-task-bootstrap-v1",
      replicates: 10_000,
    },
    tasks: [
      ...BENCHMARK_MATCH_TASKS.map((task) => ({
        id: task.id,
        suite: "match" as const,
        ...commonTask(task),
      })),
      ...BENCHMARK_CAPABILITY_TASKS.map((task) => {
        const frozen = capabilityData.get(task.fixtureId);
        if (!frozen)
          throw new Error(`Missing frozen fixture data for ${task.fixtureId}`);
        const source = BENCHMARK_MATCH_TASKS.find(
          (candidate) => candidate.id === task.sourceTaskId,
        )!;
        return {
          id: task.fixtureId,
          suite: "capability" as const,
          ...commonTask(source),
          family: task.family,
          sourceTaskId: task.sourceTaskId,
          preparationTurns: frozen.preparationTurns,
          decisionIndex: frozen.decisionIndex,
          recentDecisions: frozen.recentDecisions,
          checkpointTick: frozen.checkpointTick,
          hashes: frozen.hashes,
          horizonTicks: task.horizonTicks,
          semanticRoles: frozen.semanticRoles,
          thresholds: frozen.thresholds,
          ownershipSets: frozen.ownershipSets,
          graderVersion: task.graderVersion,
          referencePolicyHash: frozen.referencePolicyHash,
          controlPolicyHashes: frozen.controlPolicyHashes,
          acceptanceReportPath: frozen.acceptanceReportPath,
          acceptanceReportHash: frozen.acceptanceReportHash,
        };
      }),
    ],
  };
}
