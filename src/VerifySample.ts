import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { gunzip, gzip } from "zlib";
import { replacer } from "../OpenFrontIO/src/core/Util";
import { AgentPolicy, HarnessRunner } from "./HarnessRunner";
import { RunStore } from "./RunStore";
import { RunArtifactSchema } from "./Types";

const gunzipAsync = promisify(gunzip);
const gzipAsync = promisify(gzip);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const samplePath = path.join(
  projectRoot,
  "resources/harness/sample-run.json.gz",
);

const source = RunArtifactSchema.parse(
  JSON.parse((await gunzipAsync(await fs.readFile(samplePath))).toString()),
);
let decisionIndex = 0;
const recordedPolicy: AgentPolicy = {
  requestedModel: source.model.requested,
  provider: source.model.provider ?? undefined,
  async estimateNextCost() {
    return 0;
  },
  async decide() {
    const record = source.decisions[decisionIndex++];
    if (!record) throw new Error("Recorded sample ran out of decisions");
    const errorPrefix = "Decision failed; holding. ";
    return {
      decision: record.fallback
        ? null
        : {
            strategy: record.strategy,
            actions: record.selectedActionIds as [string, string],
          },
      attempts: record.attempts,
      attemptFailures: record.attemptFailures,
      latencyMs: record.latencyMs,
      promptTokens: record.promptTokens,
      completionTokens: record.completionTokens,
      costUsd: record.costUsd,
      model: record.model,
      provider: record.provider,
      error: record.fallback
        ? record.strategy.replace(errorPrefix, "")
        : undefined,
    };
  },
};

const store = new RunStore(path.join(projectRoot, ".data/sample-verification"));
await store.init();
const replayed = await new HarnessRunner(store, recordedPolicy).run(
  source.runId,
);
for (const field of ["winner", "ticks", "finalHash"] as const) {
  if (replayed.outcome[field] !== source.outcome[field]) {
    throw new Error(
      `Sample mismatch for ${field}: expected ${source.outcome[field]}, got ${replayed.outcome[field]}`,
    );
  }
}

if (process.env.REFRESH_SAMPLE === "true") {
  const refreshed = RunArtifactSchema.parse({
    ...replayed,
    status: "sample",
    // Verification runs execute without network latency. Preserve the live
    // generation timestamps so refreshing derived replay metadata does not
    // misrepresent the sample as a four-second model run.
    startedAt: process.env.SAMPLE_STARTED_AT ?? source.startedAt,
    completedAt: process.env.SAMPLE_COMPLETED_AT ?? source.completedAt,
  });
  await fs.writeFile(
    samplePath,
    await gzipAsync(JSON.stringify(refreshed, replacer)),
  );
}

console.log(
  `Verified sample hash ${replayed.outcome.finalHash} at tick ${replayed.outcome.ticks}; LLM placement ${replayed.outcome.finalPlacement}, ${replayed.decisions.length} decisions`,
);
