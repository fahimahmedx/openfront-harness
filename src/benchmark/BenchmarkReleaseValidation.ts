import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { OpenRouterAgent, promptFor } from "../OpenRouterAgent";
import { OPENFRONT_COMMIT, OPENFRONT_VERSION } from "../Scenario";
import {
  ACCEPTANCE_CONTROL_MODES,
  acceptancePolicyHash,
} from "./BenchmarkAcceptance";
import { BENCHMARK_CAPABILITY_TASKS } from "./BenchmarkCapabilities";
import {
  BENCHMARK_LIMITS,
  BENCHMARK_MATCH_TASKS,
  benchmarkGameConfig,
} from "./BenchmarkConfig";
import { canonicalHash, sha256 } from "./CanonicalJson";
import { verifyBenchmarkMapAssets } from "./BenchmarkManifest";
import {
  BenchmarkAcceptanceReportSchema,
  BenchmarkManifest,
  BenchmarkManifestSchema,
} from "./BenchmarkSchemas";

const execFileAsync = promisify(execFile);
const RUNTIME_ROOTS = [
  "src",
  "scripts/RunBenchmark.ts",
  "scripts/VerifyBenchmark.ts",
  "scripts/BenchmarkSmoke.ts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "OpenFrontIO/tsconfig.json",
] as const;

async function runtimeFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (relative: string): Promise<void> => {
    const absolute = path.join(root, relative);
    const stat = await fs.stat(absolute);
    if (stat.isDirectory()) {
      for (const name of (await fs.readdir(absolute)).sort()) {
        await visit(path.join(relative, name));
      }
      return;
    }
    if (relative.startsWith(`src${path.sep}`) && !relative.endsWith(".ts")) {
      return;
    }
    files.push(relative.split(path.sep).join("/"));
  };
  for (const relative of RUNTIME_ROOTS) await visit(relative);
  return files.sort();
}

export async function benchmarkHarnessSourceHash(
  root: string,
): Promise<string> {
  const hashes: Record<string, string> = {};
  for (const relative of await runtimeFiles(root)) {
    hashes[relative] = sha256(await fs.readFile(path.join(root, relative)));
  }
  return canonicalHash(hashes);
}

async function verifyHarnessCommit(
  root: string,
  commit: string,
): Promise<void> {
  await execFileAsync("git", ["cat-file", "-e", `${commit}^{commit}`], {
    cwd: root,
  }).catch(() => {
    throw new Error(`Frozen harness commit does not exist: ${commit}`);
  });
  await execFileAsync("git", ["merge-base", "--is-ancestor", commit, "HEAD"], {
    cwd: root,
  }).catch(() => {
    throw new Error(
      "Frozen harness commit is not an ancestor of the checked-out release",
    );
  });
}

function same(left: unknown, right: unknown): boolean {
  return canonicalHash(left) === canonicalHash(right);
}

function validateCommonTask(
  recorded: BenchmarkManifest["tasks"][number],
  expected: (typeof BENCHMARK_MATCH_TASKS)[number],
): void {
  const config = benchmarkGameConfig(expected);
  if (
    recorded.map !== expected.map ||
    recorded.mapPath !== expected.mapSlug ||
    recorded.seed !== expected.seed ||
    !same(recorded.spawn, expected.spawn) ||
    recorded.difficulty !== expected.difficulty ||
    recorded.nationCount !== expected.nationCount ||
    recorded.tribeBotCount !== expected.tribeBotCount ||
    !same(recorded.expectedRoster, expected.expectedRoster) ||
    !same(recorded.resolvedConfig, config) ||
    recorded.resolvedConfigHash !== canonicalHash(config) ||
    !same(recorded.ceilings, BENCHMARK_LIMITS)
  ) {
    throw new Error(`Frozen task configuration mismatch: ${recorded.id}`);
  }
}

function safeReleasePath(root: string, relative: string): string {
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Release path escapes project root: ${relative}`);
  }
  return absolute;
}

export async function validateBenchmarkRelease(
  manifestValue: unknown,
  root: string,
): Promise<BenchmarkManifest> {
  const manifest = BenchmarkManifestSchema.parse(manifestValue);
  if (!same(manifest, manifestValue)) {
    throw new Error("Manifest contains unknown or non-canonical schema fields");
  }
  if (
    manifest.engine.version !== OPENFRONT_VERSION ||
    manifest.engine.commit !== OPENFRONT_COMMIT
  ) {
    throw new Error("Frozen OpenFront engine version or commit mismatch");
  }
  if (
    manifest.promptVersion !== OpenRouterAgent.promptVersion() ||
    manifest.promptHash !== sha256(promptFor({} as never, []))
  ) {
    throw new Error("Frozen prompt version or hash mismatch");
  }
  if (!same(manifest.troopPolicy, BENCHMARK_LIMITS.troopPolicy)) {
    throw new Error("Frozen troop policy mismatch");
  }
  const graderHash = sha256(
    await fs.readFile(
      path.join(root, "src/benchmark/BenchmarkCapabilityRunner.ts"),
    ),
  );
  if (manifest.graderPackageHash !== graderHash) {
    throw new Error("Frozen capability grader hash mismatch");
  }
  if (manifest.harnessSourceHash !== (await benchmarkHarnessSourceHash(root))) {
    throw new Error("Frozen harness source hash mismatch");
  }
  await verifyHarnessCommit(root, manifest.harnessCommit);
  await verifyBenchmarkMapAssets(
    path.join(root, "OpenFrontIO/resources/maps"),
    manifest.mapAssets,
  );

  const expectedIds = [
    ...BENCHMARK_MATCH_TASKS.map((task) => task.id),
    ...BENCHMARK_CAPABILITY_TASKS.map((task) => task.fixtureId),
  ];
  if (
    !same(
      manifest.tasks.map((task) => task.id),
      expectedIds,
    )
  ) {
    throw new Error("Manifest does not contain the canonical ordered 22 tasks");
  }
  for (const expected of BENCHMARK_MATCH_TASKS) {
    const recorded = manifest.tasks.find((task) => task.id === expected.id);
    if (!recorded || recorded.suite !== "match") {
      throw new Error(`Missing frozen match task: ${expected.id}`);
    }
    validateCommonTask(recorded, expected);
  }
  for (const expected of BENCHMARK_CAPABILITY_TASKS) {
    const recorded = manifest.tasks.find(
      (task) => task.id === expected.fixtureId,
    );
    if (!recorded || recorded.suite !== "capability") {
      throw new Error(`Missing frozen capability task: ${expected.fixtureId}`);
    }
    const source = BENCHMARK_MATCH_TASKS.find(
      (task) => task.id === expected.sourceTaskId,
    );
    if (
      !source ||
      recorded.family !== expected.family ||
      recorded.sourceTaskId !== expected.sourceTaskId ||
      recorded.horizonTicks !== expected.horizonTicks ||
      recorded.graderVersion !== expected.graderVersion
    ) {
      throw new Error(`Frozen capability definition mismatch: ${recorded.id}`);
    }
    if (
      recorded.referencePolicyHash !==
        acceptancePolicyHash(recorded, "reference") ||
      !same(
        recorded.controlPolicyHashes,
        ACCEPTANCE_CONTROL_MODES.map((mode) =>
          acceptancePolicyHash(recorded, mode),
        ),
      )
    ) {
      throw new Error(`Frozen acceptance policy hash mismatch: ${recorded.id}`);
    }
    validateCommonTask(recorded, source);
    const reportFile = safeReleasePath(root, recorded.acceptanceReportPath);
    const reportBuffer = await fs.readFile(reportFile);
    if (sha256(reportBuffer) !== recorded.acceptanceReportHash) {
      throw new Error(`Acceptance report hash mismatch: ${recorded.id}`);
    }
    const reportValue = JSON.parse(reportBuffer.toString("utf8"));
    const report = BenchmarkAcceptanceReportSchema.parse(reportValue);
    if (!same(report, reportValue)) {
      throw new Error(
        `Acceptance report contains unknown fields: ${recorded.id}`,
      );
    }
    if (
      report.fixtureId !== recorded.id ||
      report.sourceArtifact !== recorded.semanticRoles.sourceArtifact
    ) {
      throw new Error(`Acceptance report fixture mismatch: ${recorded.id}`);
    }
    if (
      new Set(report.cleanRebuilds.map((hashes) => canonicalHash(hashes)))
        .size !== 1
    ) {
      throw new Error(`Acceptance rebuild drift: ${recorded.id}`);
    }
    if (!same(report.cleanRebuilds[0], recorded.hashes)) {
      throw new Error(`Acceptance checkpoint hash mismatch: ${recorded.id}`);
    }
  }
  return manifest;
}
