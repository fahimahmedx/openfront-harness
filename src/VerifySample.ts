import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { ReplayRunArtifactSchema } from "./Types";

const gunzipAsync = promisify(gunzip);
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const samplePath = path.join(
  projectRoot,
  "resources/harness/sample-run.json.gz",
);

const sample = ReplayRunArtifactSchema.parse(
  JSON.parse((await gunzipAsync(await fs.readFile(samplePath))).toString()),
);

if (sample.status !== "sample")
  throw new Error("Bundled sample is not marked sample");
if (sample.replay.info.num_turns !== sample.outcome.ticks) {
  throw new Error(
    `Sample replay length ${sample.replay.info.num_turns} does not match outcome tick ${sample.outcome.ticks}`,
  );
}
if (sample.decisions.length === 0)
  throw new Error("Bundled sample has no trace");
if (process.env.REFRESH_SAMPLE === "true") {
  throw new Error(
    "Legacy samples are immutable replay fixtures; generate a new one-action sample instead",
  );
}

console.log(
  `Verified replay-compatible sample ${sample.runId} at tick ${sample.outcome.ticks}; ${sample.decisions.length} recorded decisions`,
);
