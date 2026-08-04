import { describe, expect, test } from "vitest";
import {
  createNeutralExpansionCheckpoint,
  NEUTRAL_EXPANSION_FIXTURE,
  NeutralExpansionAgent,
  runNeutralExpansionTrial,
  scriptedAgentResult,
  selectNeutralExpansionDiplomacyControl,
  selectNeutralExpansionHoldControl,
  selectNeutralExpansionReferenceActions,
  summarizeNeutralExpansionTrials,
} from "../src/evals/NeutralExpansionEval";
import { LegalAction } from "../src/Types";

type ActionSelector = (candidates: LegalAction[]) => [string, string];

function agent(
  strategy: string,
  selectActions: ActionSelector,
): NeutralExpansionAgent {
  return {
    requestedModel: "scripted-neutral-expansion-policy",
    provider: "local",
    promptVersion: "agent-v12",
    async decide(_observation, candidates) {
      return scriptedAgentResult(
        this.requestedModel,
        strategy,
        selectActions(candidates),
      );
    },
  };
}

describe("neutral expansion eval", () => {
  test("reproduces its accepted checkpoint in five clean sessions", async () => {
    for (let replay = 0; replay < 5; replay++) {
      const checkpoint = await createNeutralExpansionCheckpoint();
      try {
        expect(checkpoint.session.game.ticks()).toBe(
          NEUTRAL_EXPANSION_FIXTURE.checkpointTick,
        );
        expect(checkpoint.hashes).toEqual({
          state: NEUTRAL_EXPANSION_FIXTURE.expectedCheckpoint.stateHash,
          observation:
            NEUTRAL_EXPANSION_FIXTURE.expectedCheckpoint.observationHash,
          candidateMenu:
            NEUTRAL_EXPANSION_FIXTURE.expectedCheckpoint.candidateMenuHash,
          tileState: NEUTRAL_EXPANSION_FIXTURE.expectedCheckpoint.tileStateHash,
        });
        expect(checkpoint.observation.self).toMatchObject({
          tiles: 52,
          troopCapacityPercent: 71.65,
          totalIncomingTroops: 0,
          totalOutgoingTroops: 0,
        });
        expect(
          checkpoint.candidates
            .filter((candidate) => candidate.category === "expand")
            .map((candidate) => candidate.id)
            .sort(),
        ).toEqual([
          "expand:neutral:100",
          "expand:neutral:25",
          "expand:neutral:50",
          "expand:neutral:75",
        ]);
      } finally {
        checkpoint.session.close();
      }
    }
  }, 30_000);

  test("the reference policy passes in five clean trials", async () => {
    const reference = agent(
      "Convert the safe surplus into neutral territory.",
      selectNeutralExpansionReferenceActions,
    );

    const trials = [];
    for (let replay = 0; replay < 5; replay++) {
      const result = await runNeutralExpansionTrial(reference);
      trials.push(result);
      expect(result.outcome).toMatchObject({
        finalTick:
          NEUTRAL_EXPANSION_FIXTURE.checkpointTick +
          NEUTRAL_EXPANSION_FIXTURE.horizonTicks,
        neutralTilesGained: 2116,
        taskPass: true,
        taskScore: 100,
        componentCoverage: 1,
      });
      expect(result.trace.appliedActionIds).toEqual([
        "expand:neutral:100",
        "hold:2",
      ]);
      expect(result.replay.info.num_turns).toBe(result.outcome.finalTick);
      expect(
        result.replay.turns.some((turn) =>
          turn.intents.some((intent) => intent.type === "attack"),
        ),
      ).toBe(true);
    }
    expect(summarizeNeutralExpansionTrials(trials)).toMatchObject({
      validTrials: 5,
      successes: 5,
      passAt1: 1,
      estimatedPassPower3: 1,
      meanComponentCoverage: 1,
      firstAttemptValidityRate: 1,
      retryRate: 0,
      fallbackRate: 0,
      meanCostUsd: 0,
      totalCostUsd: 0,
    });
  }, 30_000);

  test("passes a different legal expansion trajectory", async () => {
    const result = await runNeutralExpansionTrial(
      agent("Start a smaller safe expansion.", () => [
        "expand:neutral:25",
        "hold:2",
      ]),
    );

    expect(result.outcome.neutralTilesGained).toBeGreaterThan(0);
    expect(result.outcome.taskPass).toBe(true);
    expect(result.outcome.taskScore).toBe(100);
  });

  test("rejects double hold and a plausible diplomacy distractor", async () => {
    const controls = [
      agent("Wait without spending troops.", () =>
        selectNeutralExpansionHoldControl(),
      ),
      agent(
        "Use diplomacy while leaving the neutral frontier untouched.",
        selectNeutralExpansionDiplomacyControl,
      ),
    ];

    for (const control of controls) {
      const result = await runNeutralExpansionTrial(control);
      expect(result.outcome).toMatchObject({
        neutralTilesGained: 0,
        taskPass: false,
        taskScore: 0,
        componentCoverage: 0,
      });
    }
  });

  test("counts a production fallback as a valid failed trial", async () => {
    const result = await runNeutralExpansionTrial({
      requestedModel: "failed-scripted-policy",
      provider: "local",
      promptVersion: "agent-v12",
      async decide() {
        return {
          decision: null,
          attempts: 2,
          attemptFailures: [
            {
              attempt: 1,
              code: "request_error",
              message: "first simulated provider failure",
              rejectedActionIds: [],
            },
            {
              attempt: 2,
              code: "request_error",
              message: "second simulated provider failure",
              rejectedActionIds: [],
            },
          ],
          attemptTimings: [],
          latencyMs: 10,
          promptTokens: 0,
          completionTokens: 0,
          costUsd: 0,
          model: "failed-scripted-policy",
          provider: "local",
          error: "simulated provider failure",
        };
      },
    });

    expect(result.trace).toMatchObject({
      selectedActionIds: ["hold:1", "hold:2"],
      appliedActionIds: ["hold:1", "hold:2"],
      fallback: true,
      attempts: 2,
    });
    expect(result.outcome).toMatchObject({
      neutralTilesGained: 0,
      taskPass: false,
      taskScore: 0,
    });
  });
});
