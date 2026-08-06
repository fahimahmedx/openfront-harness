import path from "node:path";
import { HarnessRunner, AgentPolicy } from "../src/HarnessRunner";
import { RunStore } from "../src/RunStore";
import { AgentResult, LegalAction, Observation } from "../src/Types";
import { benchmarkTask } from "../src/benchmark/BenchmarkConfig";

function maximum(actions: LegalAction[]): LegalAction | undefined {
  return [...actions].sort((left, right) => {
    const leftAmount = Number(left.id.split(":").at(-1));
    const rightAmount = Number(right.id.split(":").at(-1));
    return rightAmount - leftAmount;
  })[0];
}

const taskId = process.argv[2];
if (!taskId)
  throw new Error("Usage: tsx scripts/RunScriptedBenchmarkSource.ts match-XX");
const policy: AgentPolicy = {
  requestedModel: "fixture-hostile-policy",
  provider: "local",
  promptVersion: "agent-v12",
  async estimateNextCost() {
    return 0;
  },
  async decide(
    observation: Observation,
    candidates: LegalAction[],
  ): Promise<AgentResult> {
    const expansions = candidates.filter(
      (action) => action.category === "expand",
    );
    const attacks = candidates.filter(
      (action) =>
        action.category === "attack" && action.id.startsWith("attack:"),
    );
    const boats = candidates.filter(
      (action) => action.category === "boat" && action.id.startsWith("boat:"),
    );
    let actions: [string, string] = ["hold:1", "hold:2"];
    if (expansions.length > 0) {
      const action = maximum(expansions)!;
      actions = [action.id, action.id];
    } else if (attacks.length > 0) {
      const opponents = observation.opponents as Array<Record<string, unknown>>;
      const target = opponents
        .filter((opponent) =>
          attacks.some((action) =>
            action.id.startsWith(`attack:${opponent.id}:`),
          ),
        )
        .sort(
          (left, right) =>
            Number(left.troopsRelativeToSelf ?? Infinity) -
            Number(right.troopsRelativeToSelf ?? Infinity),
        )[0];
      const action = maximum(
        attacks.filter((candidate) =>
          candidate.id.startsWith(`attack:${target.id}:`),
        ),
      )!;
      actions = [action.id, action.id];
    } else if (boats.length > 0) {
      const action = maximum(boats)!;
      actions = [action.id, action.id];
    }
    return {
      decision: { strategy: "Fixture preparation policy", actions },
      attempts: 1,
      attemptFailures: [],
      attemptTimings: [],
      latencyMs: 0,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      model: "fixture-hostile-policy",
      provider: "local",
    };
  },
};

const directory = path.resolve(
  "data/benchmark-fixture-sources",
  `${taskId}-hostile`,
);
const store = new RunStore(directory);
await store.init();
const artifact = await new HarnessRunner(
  store,
  policy,
  path.resolve("OpenFrontIO/resources/maps"),
  benchmarkTask(taskId),
).run();
process.stdout.write(
  `${JSON.stringify({ taskId, runId: artifact.runId, decisions: artifact.decisions.length, outcome: artifact.outcome })}\n`,
);
