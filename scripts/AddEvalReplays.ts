import { promises as fs } from "node:fs";
import path from "node:path";
import { replacer } from "../OpenFrontIO/src/core/Util";
import { Intent } from "../OpenFrontIO/src/core/Schemas";
import { resolveDecisionAction } from "../src/ObservationActions";
import {
  createMicroEvalCheckpoint,
  MICRO_EVAL_FIXTURES,
  MicroEvalFamilyId,
  REMAINING_MICRO_EVAL_FAMILIES,
} from "../src/evals/MicroEvalSuite";
import {
  createNeutralExpansionCheckpoint,
  NEUTRAL_EXPANSION_FIXTURE,
} from "../src/evals/NeutralExpansionEval";

type StoredTrial = {
  runId: string;
  familyId: string;
  startedAt: string;
  checkpoint: { stateHash: number; tileStateHash: string };
  trace: { appliedActionIds: [string] };
  outcome: {
    finalTick: number;
    finalStateHash: number | null;
    finalTileCount: number;
  };
  replay?: unknown;
};

type StoredReport = { trials: StoredTrial[] };

const reportArgument = process.argv[2];
if (reportArgument === undefined) {
  throw new Error(
    "Usage: npm run eval:add-replays -- path/to/eval-report.json",
  );
}
const reportPath = path.resolve(reportArgument);
const report = JSON.parse(
  await fs.readFile(reportPath, "utf8"),
) as StoredReport;
if (!Array.isArray(report.trials)) throw new Error("Eval report has no trials");

let added = 0;
for (const trial of report.trials) {
  if (trial.replay !== undefined) continue;
  const isNeutral = trial.familyId === "neutral-expansion";
  if (
    !isNeutral &&
    !REMAINING_MICRO_EVAL_FAMILIES.includes(trial.familyId as MicroEvalFamilyId)
  ) {
    throw new Error(`Unsupported eval family ${trial.familyId}`);
  }
  const checkpoint = isNeutral
    ? await createNeutralExpansionCheckpoint()
    : await createMicroEvalCheckpoint(trial.familyId as MicroEvalFamilyId);
  try {
    if (
      checkpoint.hashes.state !== trial.checkpoint.stateHash ||
      checkpoint.hashes.tileState !== trial.checkpoint.tileStateHash
    ) {
      throw new Error(`${trial.runId} checkpoint no longer reproduces`);
    }
    const resolved = resolveDecisionAction(
      trial.trace.appliedActionIds[0],
      checkpoint.candidates,
    );
    if (
      resolved.fallback ||
      resolved.action.id !== trial.trace.appliedActionIds[0]
    ) {
      throw new Error(`${trial.runId} stored actions no longer resolve`);
    }
    const intents = [resolved.action]
      .map((action) => action.intent)
      .filter((intent): intent is Intent => intent !== null);
    const horizon = isNeutral
      ? NEUTRAL_EXPANSION_FIXTURE.horizonTicks
      : MICRO_EVAL_FIXTURES[trial.familyId as MicroEvalFamilyId].horizonTicks;
    checkpoint.session.execute(intents);
    for (
      let tick = 1;
      tick < horizon && checkpoint.session.game.getWinner() === null;
      tick++
    ) {
      checkpoint.session.execute();
    }
    if (
      checkpoint.session.game.ticks() !== trial.outcome.finalTick ||
      checkpoint.session.lastHash !== trial.outcome.finalStateHash ||
      checkpoint.player.numTilesOwned() !== trial.outcome.finalTileCount
    ) {
      throw new Error(`${trial.runId} replay outcome does not match its trace`);
    }
    trial.replay = checkpoint.session.createReplayRecord(
      new Date(trial.startedAt),
    );
    added++;
  } finally {
    checkpoint.session.close();
  }
}

const temporary = `${reportPath}.tmp-${process.pid}`;
await fs.writeFile(temporary, JSON.stringify(report, replacer, 2));
await fs.rename(temporary, reportPath);
console.log(`Added ${added} replay record(s) to ${reportPath}`);
