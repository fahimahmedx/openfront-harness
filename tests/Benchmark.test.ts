import path from "node:path";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { GameMapType } from "../OpenFrontIO/src/core/game/Game";
import {
  BENCHMARK_CAPABILITY_TASKS,
  BENCHMARK_CAPABILITY_FAMILIES,
} from "../src/benchmark/BenchmarkCapabilities";
import {
  BENCHMARK_LIMITS,
  BENCHMARK_MAPS,
  BENCHMARK_MATCH_TASKS,
  benchmarkGameConfig,
} from "../src/benchmark/BenchmarkConfig";
import {
  deterministicShuffle,
  matchPoints,
  stratifiedBootstrap95,
  wilson95,
} from "../src/benchmark/BenchmarkStatistics";
import { replaySafeGameId } from "../src/benchmark/BenchmarkSeed";
import { simpleHash } from "../OpenFrontIO/src/core/Util";
import { canonicalHash, canonicalJson } from "../src/benchmark/CanonicalJson";
import {
  benchmarkMapAssetHashes,
  createReleaseManifestInput,
  verifyBenchmarkMapAssets,
} from "../src/benchmark/BenchmarkManifest";
import { NodeGameMapLoader } from "../src/NodeGameMapLoader";
import { BenchmarkManifestSchema } from "../src/benchmark/BenchmarkSchemas";
import { BenchmarkAcceptanceReportSchema } from "../src/benchmark/BenchmarkSchemas";
import {
  benchmarkHarnessSourceHash,
  validateBenchmarkRelease,
} from "../src/benchmark/BenchmarkReleaseValidation";

describe("public benchmark contract", () => {
  test("contains the exact scored suite dimensions", () => {
    expect(BENCHMARK_MATCH_TASKS).toHaveLength(12);
    expect(BENCHMARK_CAPABILITY_TASKS).toHaveLength(10);
    expect(
      new Set(BENCHMARK_CAPABILITY_TASKS.map((task) => task.family)),
    ).toEqual(new Set(BENCHMARK_CAPABILITY_FAMILIES));
    expect(new Set(BENCHMARK_MATCH_TASKS.map((task) => task.map)).size).toBe(6);
  });

  test("accepts only the replacement one-action v0.1 manifest", () => {
    const raw = JSON.parse(
      readFileSync(path.resolve("resources/benchmark/manifest.json"), "utf8"),
    );
    const manifest = BenchmarkManifestSchema.parse(raw);
    expect(manifest.promptVersion).toBe("agent-v13");
    expect(manifest.resolverVersion).toBe("single-action-v1");
    expect(
      manifest.tasks.every((task) => task.ceilings.actionsPerDecision === 1),
    ).toBe(true);

    expect(() =>
      BenchmarkManifestSchema.parse({
        ...raw,
        promptVersion: "agent-v12",
        resolverVersion: "simultaneous-two-slot-v1",
      }),
    ).toThrow();

    expect(() =>
      BenchmarkManifestSchema.parse({
        ...raw,
        tasks: raw.tasks.map((task: { ceilings: object }) => ({
          ...task,
          ceilings: { ...task.ceilings, actionSlots: 2 },
        })),
      }),
    ).toThrow();

    const capability = raw.tasks.find(
      (task: { suite: string }) => task.suite === "capability",
    );
    expect(() =>
      BenchmarkManifestSchema.parse({
        ...raw,
        tasks: raw.tasks.map((task: { id: string }) =>
          task.id === capability.id
            ? {
                ...task,
                recentDecisions: [
                  {
                    selectedActionIds: ["hold:1", "hold:2"],
                    appliedActionIds: ["hold:1", "hold:2"],
                    actionOutcomes: [{}, {}],
                  },
                ],
              }
            : task,
        ),
      }),
    ).toThrow();
  });

  test("fails closed when frozen runtime configuration drifts", async () => {
    const root = path.resolve(".");
    const raw = JSON.parse(
      readFileSync(
        path.join(root, "resources/benchmark/manifest.json"),
        "utf8",
      ),
    );
    await expect(validateBenchmarkRelease(raw, root)).resolves.toBeTruthy();
    await expect(
      validateBenchmarkRelease(
        {
          ...raw,
          tasks: raw.tasks.map((task: { ceilings: object }, index: number) =>
            index === 0
              ? { ...task, ceilings: { ...task.ceilings, maxWallClockMs: 1 } }
              : task,
          ),
        },
        root,
      ),
    ).rejects.toThrow(/configuration mismatch/);
    expect(raw.harnessSourceHash).toBe(await benchmarkHarnessSourceHash(root));
  });

  test("records real five-run acceptance evidence and distinct failing controls", () => {
    const manifest = BenchmarkManifestSchema.parse(
      JSON.parse(
        readFileSync(path.resolve("resources/benchmark/manifest.json"), "utf8"),
      ),
    );
    for (const task of manifest.tasks) {
      if (task.suite !== "capability") continue;
      const report = BenchmarkAcceptanceReportSchema.parse(
        JSON.parse(
          readFileSync(path.resolve(task.acceptanceReportPath), "utf8"),
        ),
      );
      expect(report.referenceReplays.runs).toHaveLength(5);
      expect(report.referenceReplays.runs.every((run) => run.passed)).toBe(
        true,
      );
      expect(report.controls).toHaveLength(2);
      expect(
        new Set(report.controls.map((control) => control.selectedActionId))
          .size,
      ).toBe(2);
      expect(report.controls.every((control) => !control.passed)).toBe(true);
    }
  });

  test("fully resolves every game config without relying on benchmark-changing defaults", () => {
    for (const task of BENCHMARK_MATCH_TASKS) {
      const config = benchmarkGameConfig(task);
      expect(config).toMatchObject({
        gameMap: task.map,
        gameMapSize: "Normal",
        gameMode: "Free For All",
        gameType: "Singleplayer",
        difficulty: task.difficulty,
        nations: task.nationCount,
        bots: task.tribeBotCount,
        randomSpawn: false,
        donateGold: false,
        donateTroops: false,
        infiniteGold: false,
        infiniteTroops: false,
        instantBuild: false,
        maxTimerValue: 20,
      });
      expect(1 + task.nationCount + task.tribeBotCount).toBe(
        1 + task.expectedRoster.length,
      );
    }
    expect(BENCHMARK_LIMITS.actionsPerDecision).toBe(1);
    expect(BENCHMARK_LIMITS.maxCandidates).toBe(64);
  });

  test("generic map loading remains explicitly allowlisted", async () => {
    const root = path.resolve("OpenFrontIO/resources/maps");
    const loader = new NodeGameMapLoader(root, BENCHMARK_MAPS);
    await expect(
      loader.getMapData(GameMapType.World).manifest(),
    ).resolves.toBeTruthy();
    expect(() => loader.getMapData(GameMapType.Africa)).toThrow(/allowlist/);
  });

  test("hashes and verifies every asset for all six maps", async () => {
    const root = path.resolve("OpenFrontIO/resources/maps");
    const hashes = await benchmarkMapAssetHashes(root);
    expect(Object.keys(hashes)).toHaveLength(30);
    expect(
      Object.values(hashes).every((hash) => /^[0-9a-f]{64}$/.test(hash)),
    ).toBe(true);
    await expect(
      verifyBenchmarkMapAssets(root, hashes),
    ).resolves.toBeUndefined();
  });

  test("refuses to fabricate a release manifest from development fixtures", async () => {
    await expect(
      createReleaseManifestInput({
        mapsDir: path.resolve("OpenFrontIO/resources/maps"),
        harnessCommit: "0123456789abcdef",
        harnessSourceHash: "0".repeat(64),
        releaseDate: "2026-08-05",
        graderPackageHash: "0".repeat(64),
        capabilities: [],
      }),
    ).rejects.toThrow(/ten accepted scored capability fixtures/);
  });

  test("uses canonical sorted JSON and stable SHA-256", () => {
    expect(canonicalJson({ z: 1, a: { d: 2, b: 1 } })).toBe(
      '{"a":{"b":1,"d":2},"z":1}',
    );
    expect(canonicalHash({ b: 2, a: 1 })).toBe(canonicalHash({ a: 1, b: 2 }));
    expect(canonicalHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  test("scores placements exactly as specified", () => {
    expect(matchPoints(4, 1)).toBe(100);
    expect(matchPoints(4, 2)).toBeCloseTo(66.6666667);
    expect(matchPoints(4, 4)).toBe(0);
    expect(() => matchPoints(1, 1)).toThrow();
  });

  test("maps short normative seeds to replay-safe IDs without changing RNG", () => {
    for (const task of BENCHMARK_MATCH_TASKS) {
      const replayId = replaySafeGameId(task.seed);
      expect(replayId).toMatch(/^[A-Za-z0-9]{8}$/);
      expect(simpleHash(replayId)).toBe(simpleHash(task.seed));
    }
  });

  test("statistics and scheduling are deterministic", () => {
    expect(deterministicShuffle([1, 2, 3, 4], "seed")).toEqual(
      deterministicShuffle([1, 2, 3, 4], "seed"),
    );
    const interval = wilson95(5, 10);
    expect(interval.lower).toBeCloseTo(0.2366, 3);
    expect(interval.upper).toBeCloseTo(0.7634, 3);
    const bootstrap = stratifiedBootstrap95(
      [
        { taskId: "a", stratum: "x", values: [0, 100, 100] },
        { taskId: "b", stratum: "x", values: [20, 40, 60] },
      ],
      "bootstrap-seed",
      200,
    );
    expect(bootstrap).toEqual(
      stratifiedBootstrap95(
        [
          { taskId: "a", stratum: "x", values: [0, 100, 100] },
          { taskId: "b", stratum: "x", values: [20, 40, 60] },
        ],
        "bootstrap-seed",
        200,
      ),
    );
  });
});
