import * as dotenv from "dotenv";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HarnessRunner, AgentPolicy } from "../src/HarnessRunner";
import { OpenRouterAgent } from "../src/OpenRouterAgent";
import { RunStore } from "../src/RunStore";
import { AgentResult, LegalAction, Observation } from "../src/Types";
import { benchmarkTask } from "../src/benchmark/BenchmarkConfig";
import { createReplayCheckpoint } from "../src/evals/ReplayCheckpoint";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

class OneDecisionSmokeAgent implements AgentPolicy {
  readonly requestedModel: string;
  readonly provider: string | undefined;
  readonly promptVersion: string;
  private used = false;

  constructor(private readonly live: OpenRouterAgent) {
    this.requestedModel = live.requestedModel;
    this.provider = live.provider;
    this.promptVersion = live.promptVersion;
  }

  estimateNextCost(observation: Observation, candidates: LegalAction[]) {
    return this.used
      ? Promise.resolve(0)
      : this.live.estimateNextCost(observation, candidates);
  }

  async decide(
    observation: Observation,
    candidates: LegalAction[],
  ): Promise<AgentResult> {
    if (!this.used) {
      this.used = true;
      return this.live.decide(observation, candidates);
    }
    return {
      decision: {
        strategy: "Smoke rollout hold.",
        action: "hold",
      },
      attempts: 1,
      attemptFailures: [],
      attemptTimings: [],
      latencyMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: this.requestedModel,
      provider: this.provider ?? null,
    };
  }
}

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey)
  throw new Error("OPENROUTER_API_KEY is required for benchmark smoke");

const temporary = await fs.mkdtemp(
  path.join(os.tmpdir(), "openfront-benchmark-smoke-"),
);
try {
  // Exercise and close the checkpoint path before the match mutates Japan's
  // module-cached map. Official trials use one child process each.
  const checkpoint = await createReplayCheckpoint(
    "saturated-capacity-expansion",
  );
  const checkpointStateHash = checkpoint.hashes.state;
  checkpoint.session.close();
  const store = new RunStore(temporary);
  await store.init();
  const live = new OpenRouterAgent(apiKey);
  const runner = new HarnessRunner(
    store,
    new OneDecisionSmokeAgent(live),
    path.join(PROJECT_ROOT, "OpenFrontIO/resources/maps"),
    benchmarkTask("match-01"),
  );
  const artifact = await runner.run();
  if (artifact.decisions.length === 0)
    throw new Error("Smoke made no model decision");
  if (artifact.decisions[0].attempts < 1)
    throw new Error("Smoke request was not attempted");
  process.stdout.write(
    `Smoke passed: structured response, ${artifact.replay.turns.length} replay turns, checkpoint ${checkpointStateHash}\n`,
  );
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
