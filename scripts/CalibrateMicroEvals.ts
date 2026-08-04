import {
  MicroEvalAgent,
  REMAINING_MICRO_EVAL_FAMILIES,
  runMicroEvalTrial,
} from "../src/evals/MicroEvalSuite";
import { scriptedAgentResult } from "../src/evals/NeutralExpansionEval";

function maximum(ids: string[]): string {
  return [...ids].sort(
    (left, right) =>
      Number(right.split(":").slice(-1)[0]) -
      Number(left.split(":").slice(-1)[0]),
  )[0];
}

function referenceAgent(family: string): MicroEvalAgent {
  return {
    requestedModel: "reference-policy",
    async decide(observation, candidates) {
      const ids = candidates.map((candidate) => candidate.id);
      let actions: [string, string];
      if (family === "saturated-capacity-expansion") {
        actions = [
          maximum(ids.filter((id) => id.startsWith("expand:"))),
          "hold:2",
        ];
      } else if (
        family === "post-expansion-recovery" ||
        family === "frontier-restraint"
      ) {
        actions = ["hold:1", "hold:2"];
      } else if (family === "weaker-target-selection") {
        const target = observation.opponents
          .map(
            (opponent) =>
              opponent as typeof opponent & { troopsRelativeToSelf: number },
          )
          .find(
            (opponent) =>
              opponent.sharedBorder &&
              opponent.troopsRelativeToSelf <= 0.4 &&
              ids.some((id) => id.startsWith(`attack:${opponent.id}:`)),
          )!;
        const id = maximum(
          ids.filter((candidate) =>
            candidate.startsWith(`attack:${target.id}:`),
          ),
        );
        actions = [id, id];
      } else if (family === "incoming-attack-response") {
        const id = maximum(
          ids.filter((candidate) => candidate.startsWith("counter:")),
        );
        actions = [id, id];
      } else if (family === "split-front-defense") {
        const targets = Array.from(
          new Set(
            ids
              .filter((id) => id.startsWith("counter:"))
              .map((id) => id.split(":")[1]),
          ),
        );
        actions = targets.map((target) =>
          maximum(ids.filter((id) => id.startsWith(`counter:${target}:`))),
        ) as [string, string];
      } else if (family === "losing-attack-retreat") {
        actions = [ids.find((id) => id.startsWith("retreat:"))!, "hold:2"];
      } else if (family === "naval-target-recognition") {
        const target = observation.opponents
          .map(
            (opponent) =>
              opponent as typeof opponent & { troopsRelativeToSelf: number },
          )
          .filter(
            (opponent) =>
              !opponent.sharedBorder &&
              ids.some((id) => id.startsWith(`boat:${opponent.id}:`)),
          )
          .sort(
            (left, right) =>
              left.troopsRelativeToSelf - right.troopsRelativeToSelf,
          )[0];
        const id = maximum(
          ids.filter((candidate) => candidate.startsWith(`boat:${target.id}:`)),
        );
        actions = [id, id];
      } else {
        actions = [
          ids.find((id) => id.startsWith("build:Defense Post:"))!,
          "hold:2",
        ];
      }
      return scriptedAgentResult(
        "reference-policy",
        "Reference policy",
        actions,
      );
    },
  };
}

const holdAgent: MicroEvalAgent = {
  requestedModel: "hold-control",
  async decide() {
    return scriptedAgentResult("hold-control", "Hold control", [
      "hold:1",
      "hold:2",
    ]);
  },
};

function primaryControlAgent(family: string): MicroEvalAgent {
  return {
    requestedModel: "primary-control",
    async decide(_observation, candidates) {
      const ids = candidates.map((candidate) => candidate.id);
      let actions: [string, string] = ["hold:1", "hold:2"];
      if (family === "post-expansion-recovery") {
        const id = maximum(
          ids.filter((candidate) => candidate.startsWith("expand:")),
        );
        actions = [id, id];
      } else if (family === "frontier-restraint") {
        const id = maximum(
          ids.filter((candidate) => candidate.startsWith("attack:")),
        );
        actions = [id, id];
      }
      return scriptedAgentResult("primary-control", "Primary control", actions);
    },
  };
}

const selectedFamilies = process.argv[2]
  ? REMAINING_MICRO_EVAL_FAMILIES.filter((family) => family === process.argv[2])
  : REMAINING_MICRO_EVAL_FAMILIES;

for (const family of selectedFamilies) {
  const policies = [
    ["reference", referenceAgent(family)],
    [
      "control",
      ["post-expansion-recovery", "frontier-restraint"].includes(family)
        ? primaryControlAgent(family)
        : holdAgent,
    ],
  ] as const;
  for (const [policy, agent] of policies.filter(
    ([name]) => process.argv[3] === undefined || name === process.argv[3],
  )) {
    try {
      const trial = await runMicroEvalTrial(family, agent);
      console.log(
        JSON.stringify({
          family,
          policy,
          checkpoint: trial.checkpoint,
          actions: trial.trace.appliedActionIds,
          outcome: trial.outcome,
        }),
      );
    } catch (error) {
      console.log(
        JSON.stringify({
          family,
          policy,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
}
