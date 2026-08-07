import * as dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HarnessRunner } from "../src/HarnessRunner";
import { RunStore } from "../src/RunStore";
import { benchmarkTask } from "../src/benchmark/BenchmarkConfig";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(root, ".env") });
const taskId = process.argv[2];
if (!taskId)
  throw new Error("Usage: tsx scripts/RunBenchmarkSourceMatch.ts match-XX");
const store = new RunStore(
  path.join(root, "data/benchmark-fixture-sources", taskId),
);
await store.init();
const artifact = await HarnessRunner.benchmarkFromEnvironment(
  store,
  benchmarkTask(taskId),
).run();
process.stdout.write(
  JSON.stringify({
    taskId,
    runId: artifact.runId,
    status: artifact.status,
    decisions: artifact.decisions.length,
    placement: artifact.outcome.finalPlacement,
    costUsd: artifact.usage.costUsd,
    termination: artifact.outcome.terminationReason,
  }) + "\n",
);
