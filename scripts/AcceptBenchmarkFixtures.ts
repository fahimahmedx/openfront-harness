import { promises as fs } from "node:fs";
import path from "node:path";
import { AgentPolicy } from "../src/HarnessRunner";
import { BenchmarkManifestSchema } from "../src/benchmark/BenchmarkSchemas";
import { runBenchmarkCapabilityTrial } from "../src/benchmark/BenchmarkCapabilityRunner";
import { LegalAction } from "../src/Types";

const manifest = BenchmarkManifestSchema.parse(
  JSON.parse(
    await fs.readFile(
      path.resolve("resources/benchmark/manifest.json"),
      "utf8",
    ),
  ),
);

function largest(candidates: LegalAction[], prefix: string): string {
  const matches = candidates.filter((item) => item.id.startsWith(prefix));
  if (!matches.length)
    throw new Error(`No reference action matching ${prefix}`);
  return matches.sort(
    (a, b) => Number(b.id.split(":").at(-1)) - Number(a.id.split(":").at(-1)),
  )[0].id;
}

function referenceActions(
  task: Extract<(typeof manifest.tasks)[number], { suite: "capability" }>,
  observation: any,
  candidates: LegalAction[],
): string[] {
  const hold = ["hold:1", "hold:2"];
  switch (task.family) {
    case "neutral-expansion":
    case "saturated-capacity-expansion": {
      const action = largest(candidates, "expand:neutral:");
      return [action, action];
    }
    case "post-expansion-recovery":
    case "frontier-restraint":
      return hold;
    case "weaker-target-selection": {
      const target = observation.opponents.find(
        (item: any) => item.name === task.semanticRoles.targetName,
      );
      const action = largest(candidates, `attack:${target.id}:`);
      return [action, action];
    }
    case "incoming-attack-response": {
      const action = largest(candidates, "counter:");
      return [action, action];
    }
    case "split-front-defense": {
      const attackers = [
        ...new Set(
          candidates
            .filter((item) => item.id.startsWith("counter:"))
            .map((item) => item.id.split(":")[1]),
        ),
      ];
      return attackers
        .slice(0, 2)
        .map((id: string) => largest(candidates, `counter:${id}:`));
    }
    case "losing-attack-retreat":
      return [
        candidates.find((item) => item.category === "retreat")!.id,
        "hold:2",
      ];
    case "naval-target-recognition": {
      const target = observation.opponents.find(
        (item: any) => item.name === task.semanticRoles.targetName,
      );
      const action = largest(candidates, `boat:${target.id}:`);
      return [action, action];
    }
    case "construction-failure-recovery":
      return [
        candidates.find((item) => item.id.startsWith("build:Defense Post:"))!
          .id,
        "hold:2",
      ];
    default:
      throw new Error(`Unknown family ${task.family}`);
  }
}

function distractorActions(
  task: Extract<(typeof manifest.tasks)[number], { suite: "capability" }>,
  observation: any,
  candidates: LegalAction[],
  alternate: boolean,
): string[] {
  const repeat = (id: string) => [id, id];
  if (task.family === "post-expansion-recovery") {
    const expands = candidates.filter((item) => item.id.startsWith("expand:"));
    return repeat((alternate ? expands[0] : expands.at(-1))!.id);
  }
  if (task.family === "weaker-target-selection") {
    if (alternate) return ["hold:1", "hold:2"];
    const targets = observation.opponents.filter((item: any) =>
      candidates.some((candidate) =>
        candidate.id.startsWith(`attack:${item.id}:`),
      ),
    );
    const strong = targets.sort(
      (a: any, b: any) => b.troopsRelativeToSelf - a.troopsRelativeToSelf,
    )[0];
    return repeat(largest(candidates, `attack:${strong.id}:`));
  }
  if (task.family === "frontier-restraint") {
    const action = candidates.find((item) =>
      item.id.startsWith(alternate ? "boat:" : "attack:"),
    );
    return action ? repeat(action.id) : ["hold:1", "hold:2"];
  }
  if (task.family === "split-front-defense") {
    if (alternate) return ["hold:1", "hold:2"];
    const attacker = candidates
      .find((item) => item.id.startsWith("counter:"))!
      .id.split(":")[1];
    return repeat(largest(candidates, `counter:${attacker}:`));
  }
  if (task.family === "losing-attack-retreat") {
    const boat = candidates.find((item) => item.id.startsWith("boat:"));
    return boat
      ? alternate
        ? [boat.id, "hold:2"]
        : repeat(boat.id)
      : ["hold:1", "hold:2"];
  }
  if (
    [
      "incoming-attack-response",
      "construction-failure-recovery",
      "naval-target-recognition",
    ].includes(task.family)
  ) {
    const distractor = candidates.find(
      (item) => item.category === (alternate ? "diplomacy" : "build"),
    );
    return distractor ? [distractor.id, "hold:2"] : ["hold:1", "hold:2"];
  }
  return ["hold:1", "hold:2"];
}

function policy(
  task: Extract<(typeof manifest.tasks)[number], { suite: "capability" }>,
  mode: "reference" | "hold" | "distractor1" | "distractor2",
): AgentPolicy {
  return {
    requestedModel: "fixture-builder",
    provider: "deterministic-local",
    promptVersion: "fixture-acceptance-v1",
    async estimateNextCost() {
      return 0;
    },
    async decide(observation, candidates) {
      const actions =
        mode === "reference"
          ? referenceActions(task, observation, candidates)
          : mode === "hold"
            ? ["hold:1", "hold:2"]
            : distractorActions(
                task,
                observation,
                candidates,
                mode === "distractor2",
              );
      return {
        decision: { strategy: `${mode} acceptance policy`, actions },
        attempts: 1,
        attemptFailures: [],
        attemptTimings: [],
        latencyMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        model: `fixture-${mode}`,
        provider: "deterministic-local",
      };
    },
  };
}

const selectedFamily = process.argv[2];
for (const task of manifest.tasks.filter(
  (item): item is Extract<typeof item, { suite: "capability" }> =>
    item.suite === "capability" &&
    (!selectedFamily || item.family === selectedFamily),
)) {
  const reference = await runBenchmarkCapabilityTrial(
    task,
    policy(task, "reference"),
  );
  const hold = await runBenchmarkCapabilityTrial(task, policy(task, "hold"));
  const distractor1 = await runBenchmarkCapabilityTrial(
    task,
    policy(task, "distractor1"),
  );
  const distractor2 = await runBenchmarkCapabilityTrial(
    task,
    policy(task, "distractor2"),
  );
  process.stdout.write(
    `${JSON.stringify({ family: task.family, reference: reference.taskPass, hold: hold.taskPass, distractor1: distractor1.taskPass, distractor2: distractor2.taskPass, referenceAssertions: reference.assertions, holdAssertions: hold.assertions, distractor1Assertions: distractor1.assertions, distractor2Assertions: distractor2.assertions, referenceDiagnostics: reference.diagnostics, holdDiagnostics: hold.diagnostics, distractor1Diagnostics: distractor1.diagnostics, distractor2Diagnostics: distractor2.diagnostics })}\n`,
  );
}
