import { describe, expect, test } from "vitest";
import { resolveDecisionAction } from "../src/ObservationActions";
import {
  controlActions,
  createMicroEvalCheckpoint,
  MICRO_EVAL_FIXTURES,
  MicroEvalAgent,
  MicroEvalFamilyId,
  referenceActions,
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

function policy(
  family: MicroEvalFamilyId,
  kind: "reference" | "control",
): MicroEvalAgent {
  return {
    requestedModel: `${kind}-${family}`,
    provider: "local",
    promptVersion: "agent-v13",
    async decide(observation, candidates) {
      const ids = candidates.map((candidate) => candidate.id);
      let action = "hold";
      if (kind === "reference") {
        if (family === "saturated-capacity-expansion") {
          action = maximum(ids.filter((id) => id.startsWith("expand:")));
        } else if (
          family === "post-expansion-recovery" ||
          family === "frontier-restraint"
        ) {
          action = "hold";
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
          action = id;
        } else if (family === "incoming-attack-response") {
          const id = maximum(
            ids.filter((candidate) => candidate.startsWith("counter:")),
          );
          action = id;
        } else if (family === "split-front-prioritization") {
          const incoming = observation.self.incomingAttacks as Array<{
            from: string;
            troops: number;
          }>;
          const target = [...incoming].sort(
            (left, right) => right.troops - left.troops,
          )[0].from;
          action = maximum(
            ids.filter((id) => id.startsWith(`counter:${target}:`)),
          );
        } else if (family === "losing-attack-retreat") {
          action = ids.find((id) => id.startsWith("retreat:"))!;
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
            ids.filter((candidate) =>
              candidate.startsWith(`boat:${target.id}:`),
            ),
          );
          action = id;
        } else {
          action = ids.find((id) => id.startsWith("build:Defense Post:"))!;
        }
      } else if (family === "post-expansion-recovery") {
        const id = maximum(
          ids.filter((candidate) => candidate.startsWith("expand:")),
        );
        action = id;
      }
      return scriptedAgentResult(this.requestedModel, `${kind} policy`, action);
    },
  };
}

describe("remaining micro-eval families", () => {
  test("reconstructs every accepted checkpoint and exposes legal reference/control actions", async () => {
    for (const family of REMAINING_MICRO_EVAL_FAMILIES) {
      const checkpoint = await createMicroEvalCheckpoint(family);
      try {
        expect(checkpoint.hashes).toEqual(
          MICRO_EVAL_FIXTURES[family].expectedCheckpoint,
        );
        expect(checkpoint.observation.tick).toBe(
          checkpoint.session.game.ticks(),
        );
        expect(checkpoint.observation.self.alive).toBe(true);

        const reference = resolveDecisionAction(
          referenceActions(family, checkpoint),
          checkpoint.candidates,
        );
        expect(reference.fallback).toBe(false);
        expect(reference.action.id).toBe(referenceActions(family, checkpoint));

        for (const control of controlActions(family, checkpoint)) {
          const resolved = resolveDecisionAction(
            control,
            checkpoint.candidates,
          );
          expect(resolved.fallback).toBe(false);
        }
      } finally {
        checkpoint.session.close();
      }
    }
  }, 60_000);

  test.each([
    "saturated-capacity-expansion",
    "post-expansion-recovery",
    "frontier-restraint",
    "incoming-attack-response",
    "split-front-prioritization",
    "losing-attack-retreat",
    "naval-target-recognition",
    "construction-failure-recovery",
  ] as MicroEvalFamilyId[])(
    "%s reference policy passes",
    async (family) => {
      const result = await runMicroEvalTrial(
        family,
        policy(family, "reference"),
      );
      expect(result.outcome.taskPass).toBe(true);
      expect(result.outcome.taskScore).toBe(100);
      expect(result.outcome.assertions.every((item) => item.passed)).toBe(true);
    },
    90_000,
  );

  test.each([
    "saturated-capacity-expansion",
    "post-expansion-recovery",
    "weaker-target-selection",
    "incoming-attack-response",
    "split-front-prioritization",
    "losing-attack-retreat",
    "naval-target-recognition",
    "construction-failure-recovery",
  ] as MicroEvalFamilyId[])(
    "%s calibrated control fails",
    async (family) => {
      const result = await runMicroEvalTrial(family, policy(family, "control"));
      expect(result.outcome.taskPass).toBe(false);
      expect(result.outcome.taskScore).toBe(0);
      expect(result.outcome.assertions.some((item) => !item.passed)).toBe(true);
    },
    90_000,
  );
});
