import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { GameRecordSchema } from "../OpenFrontIO/src/core/Schemas";
import { replacer } from "../OpenFrontIO/src/core/Util";
import {
  EvalReplayStore,
  evalTrialDecision,
  evalTrialSummary,
} from "../src/EvalReplayStore";
import {
  runNeutralExpansionTrial,
  scriptedAgentResult,
} from "../src/evals/NeutralExpansionEval";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("eval replay store", () => {
  test("loads an eval trial as a renderer replay and decision trace", async () => {
    const trial = await runNeutralExpansionTrial({
      requestedModel: "eval-replay-test",
      provider: "local",
      promptVersion: "agent-v13",
      async decide() {
        return scriptedAgentResult(
          "eval-replay-test",
          "Expand safely",
          "expand:neutral:100",
        );
      },
    });
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eval-replay-"));
    temporaryDirectories.push(directory);
    const nested = path.join(directory, "openfront-micro-v2", "neutral");
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(
      path.join(nested, "report.json"),
      JSON.stringify({ trials: [trial] }, replacer, 2),
    );

    const loaded = await new EvalReplayStore(directory).getTrial(trial.runId);
    expect(loaded).not.toBeNull();
    expect(GameRecordSchema.parse(loaded!.replay).info.num_turns).toBe(
      trial.outcome.finalTick,
    );
    expect(evalTrialDecision(loaded!)).toMatchObject({
      tick: trial.checkpoint.tick,
      appliedActionIds: ["expand:neutral:100"],
      model: "eval-replay-test",
    });
    expect(evalTrialSummary(loaded!)).toMatchObject({
      runId: trial.runId,
      familyId: "neutral-expansion",
      taskPass: true,
      replayUrl: `/replay/${trial.runId}`,
    });
  });
});
