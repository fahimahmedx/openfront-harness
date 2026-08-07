import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ACCEPTANCE_CONTROL_MODES,
  acceptancePolicy,
} from "../src/benchmark/BenchmarkAcceptance";
import { runBenchmarkCapabilityTrial } from "../src/benchmark/BenchmarkCapabilityRunner";
import {
  BenchmarkAcceptanceReportSchema,
  BenchmarkManifestSchema,
} from "../src/benchmark/BenchmarkSchemas";
import { canonicalHash } from "../src/benchmark/CanonicalJson";

const root = path.resolve(import.meta.dirname, "..");
const manifest = BenchmarkManifestSchema.parse(
  JSON.parse(
    await fs.readFile(
      path.join(root, "resources/benchmark/manifest.json"),
      "utf8",
    ),
  ),
);
const selectedFamily = process.argv[2];

for (const task of manifest.tasks.filter(
  (item) =>
    item.suite === "capability" &&
    (!selectedFamily || item.family === selectedFamily),
)) {
  if (task.suite !== "capability") continue;
  const report = BenchmarkAcceptanceReportSchema.parse(
    JSON.parse(
      await fs.readFile(path.join(root, task.acceptanceReportPath), "utf8"),
    ),
  );
  if (
    report.fixtureId !== task.id ||
    new Set(report.cleanRebuilds.map(canonicalHash)).size !== 1 ||
    canonicalHash(report.cleanRebuilds[0]) !== canonicalHash(task.hashes)
  ) {
    throw new Error(`${task.id}: recorded clean rebuild evidence is invalid`);
  }
  const references = [];
  for (let replay = 0; replay < 5; replay++) {
    references.push(
      await runBenchmarkCapabilityTrial(
        task,
        acceptancePolicy(task, "reference"),
      ),
    );
  }
  const controls = [];
  for (const mode of ACCEPTANCE_CONTROL_MODES) {
    controls.push({
      mode,
      result: await runBenchmarkCapabilityTrial(
        task,
        acceptancePolicy(task, mode),
      ),
    });
  }
  if (
    references.some((result) => !result.taskPass) ||
    controls.some(({ result }) => result.taskPass) ||
    new Set(controls.map(({ result }) => result.selectedActionIds[0])).size !==
      controls.length
  ) {
    throw new Error(`${task.id}: live acceptance policies failed`);
  }
  process.stdout.write(
    `${task.family}: 5/5 reference passes; controls ${controls
      .map(({ result }) => `${result.selectedActionIds[0]}=fail`)
      .join(", ")}\n`,
  );
}
