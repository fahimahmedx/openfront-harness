import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { GameRecordSchema } from "../OpenFrontIO/src/core/Schemas";
import {
  ActionOutcomeSchema,
  AgentAttemptFailureSchema,
  AgentAttemptTimingSchema,
  DecisionRecord,
  DecisionRecordSchema,
  LegalActionSchema,
  ObservationSchema,
} from "./Types";

const EvalReplayTrialSchema = z.object({
  runId: z.uuid(),
  evalVersion: z.string(),
  graderVersion: z.string(),
  familyId: z.string(),
  fixtureId: z.string(),
  split: z.string(),
  startedAt: z.string(),
  completedAt: z.string(),
  configuration: z.object({
    scenarioId: z.string(),
    openfrontCommit: z.string(),
    model: z.string(),
    resolvedModel: z.string(),
    provider: z.string().nullable(),
    promptVersion: z.string().nullable(),
  }),
  checkpoint: z.record(z.string(), z.unknown()),
  trace: z.object({
    observation: ObservationSchema,
    candidates: z.array(LegalActionSchema),
    strategy: z.string(),
    selectedActionIds: z.tuple([z.string(), z.string()]),
    appliedActionIds: z.tuple([z.string(), z.string()]),
    actionOutcomes: z.array(ActionOutcomeSchema).length(2),
    attempts: z.number().int().positive(),
    attemptFailures: z.array(AgentAttemptFailureSchema),
    attemptTimings: z.array(AgentAttemptTimingSchema),
    fallback: z.boolean(),
    latencyMs: z.number().nonnegative(),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  }),
  outcome: z.record(z.string(), z.unknown()),
  replay: GameRecordSchema,
});

export type EvalReplayTrial = z.infer<typeof EvalReplayTrialSchema>;

function winnerLabel(trial: EvalReplayTrial): string {
  const winner = trial.replay.info.winner;
  if (winner === undefined) return "No winner";
  return winner[1] ?? winner[0];
}

export function evalTrialDecision(trial: EvalReplayTrial): DecisionRecord {
  return DecisionRecordSchema.parse({
    index: 0,
    tick: trial.trace.observation.tick,
    observation: trial.trace.observation,
    candidates: trial.trace.candidates,
    strategy: trial.trace.strategy,
    selectedActionIds: trial.trace.selectedActionIds,
    appliedActionIds: trial.trace.appliedActionIds,
    outcomes: trial.trace.actionOutcomes.map(
      (outcome) => `${outcome.status}: ${outcome.detail}`,
    ),
    actionOutcomes: trial.trace.actionOutcomes,
    attempts: trial.trace.attempts,
    attemptFailures: trial.trace.attemptFailures,
    attemptTimings: trial.trace.attemptTimings,
    fallback: trial.trace.fallback,
    latencyMs: trial.trace.latencyMs,
    promptTokens: trial.trace.promptTokens,
    completionTokens: trial.trace.completionTokens,
    costUsd: trial.trace.costUsd,
    model: trial.configuration.resolvedModel,
    provider: trial.configuration.provider,
  });
}

export function evalTrialSummary(trial: EvalReplayTrial) {
  const winner = trial.replay.info.winner;
  return {
    runId: trial.runId,
    scenarioId: trial.configuration.scenarioId,
    status: "completed",
    startedAt: trial.startedAt,
    completedAt: trial.completedAt,
    model: trial.configuration.resolvedModel,
    provider: trial.configuration.provider,
    winner: winnerLabel(trial),
    llmWon: winner?.[0] === "player" && winner.includes("LLMAGENT"),
    finalPlacement: null,
    ticks: trial.replay.info.num_turns,
    decisionCount: 1,
    costUsd: trial.trace.costUsd,
    replayUrl: `/replay/${trial.runId}`,
    evalVersion: trial.evalVersion,
    familyId: trial.familyId,
    fixtureId: trial.fixtureId,
    taskPass: trial.outcome.taskPass === true,
  };
}

export class EvalReplayStore {
  constructor(readonly evalRoot: string) {}

  async getTrial(runId: string): Promise<EvalReplayTrial | null> {
    for (const file of await this.reportFiles()) {
      let report: unknown;
      try {
        report = JSON.parse(await fs.readFile(file, "utf8"));
      } catch (error) {
        console.warn(`Ignoring unreadable eval report ${file}`, error);
        continue;
      }
      if (typeof report !== "object" || report === null) continue;
      const trials = (report as { trials?: unknown }).trials;
      if (!Array.isArray(trials)) continue;
      const candidate = trials.find(
        (trial) =>
          typeof trial === "object" &&
          trial !== null &&
          (trial as { runId?: unknown }).runId === runId,
      );
      if (candidate === undefined) continue;
      const parsed = EvalReplayTrialSchema.safeParse(candidate);
      if (!parsed.success) {
        console.warn(
          `Eval trial ${runId} in ${file} is not replay-compatible`,
          parsed.error,
        );
        return null;
      }
      return parsed.data;
    }
    return null;
  }

  private async reportFiles(): Promise<string[]> {
    const files: string[] = [];
    const directories = [this.evalRoot];
    while (directories.length > 0) {
      const directory = directories.pop()!;
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      for (const entry of entries) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) directories.push(target);
        else if (entry.isFile() && entry.name.endsWith(".json"))
          files.push(target);
      }
    }
    return files.sort();
  }
}
