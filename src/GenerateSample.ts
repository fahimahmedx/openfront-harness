import * as dotenv from "dotenv";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { gzip } from "zlib";
import { replacer } from "../OpenFrontIO/src/core/Util";
import { HarnessRunner } from "./HarnessRunner";
import { RunStore } from "./RunStore";
import { RunArtifactSchema } from "./Types";

const gzipAsync = promisify(gzip);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
dotenv.config({
  path: path.join(projectRoot, ".env"),
});

if (!process.env.OPENROUTER_API_KEY) {
  throw new Error("OPENROUTER_API_KEY is required to generate the sample");
}

const tempDir = path.join(projectRoot, "data/sample-generation");
const store = new RunStore(tempDir);
await store.init();
const artifact = await HarnessRunner.fromEnvironment(store).run();
if (artifact.status !== "completed") {
  throw new Error(
    `Sample run did not complete: ${artifact.outcome.terminationReason}`,
  );
}
const sample = RunArtifactSchema.parse({ ...artifact, status: "sample" });
const outputDir = path.join(projectRoot, "resources/harness");
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(
  path.join(outputDir, "sample-run.json.gz"),
  await gzipAsync(JSON.stringify(sample, replacer)),
);
console.log(
  `Sample ${sample.runId}: ${sample.outcome.winner}, ${sample.decisions.length} decisions, $${sample.usage.costUsd.toFixed(4)}`,
);
