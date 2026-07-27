import { z } from "zod";
import {
  GameRecordSchema,
  IntentSchema,
} from "../OpenFrontIO/src/core/Schemas";

export const LegalActionSchema = z.object({
  id: z.string().min(1).max(160),
  category: z.enum([
    "hold",
    "expand",
    "attack",
    "boat",
    "retreat",
    "build",
    "upgrade",
    "diplomacy",
  ]),
  label: z.string().min(1).max(240),
  intent: IntentSchema.nullable(),
});
export type LegalAction = z.infer<typeof LegalActionSchema>;

export function isRepeatableLegalAction(action: LegalAction): boolean {
  return (
    action.category === "expand" ||
    action.category === "attack" ||
    action.category === "boat"
  );
}

export const AgentDecisionSchema = z.object({
  strategy: z.string().trim().max(160),
  actions: z.array(z.string().min(1).max(160)).length(2),
});
export type AgentDecision = z.infer<typeof AgentDecisionSchema>;

export const AgentAttemptFailureSchema = z.object({
  attempt: z.number().int().min(1).max(2),
  code: z.enum([
    "empty_response",
    "invalid_json",
    "invalid_shape",
    "unknown_action_id",
    "duplicate_action_id",
    "truncated_response",
    "refusal",
    "request_error",
  ]),
  message: z.string().min(1).max(500),
  rejectedActionIds: z.array(z.string().min(1).max(160)).max(2).default([]),
});
export type AgentAttemptFailure = z.infer<typeof AgentAttemptFailureSchema>;

export const AgentAttemptTimingSchema = z.object({
  attempt: z.number().int().min(1).max(2),
  totalMs: z.number().nonnegative(),
  timeToFirstTokenMs: z.number().nonnegative().nullable(),
  generationMs: z.number().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().default(0),
  timePerOutputTokenMs: z.number().nonnegative().nullable().default(null),
  queueMs: z.number().nonnegative().nullable(),
  generationId: z.string().min(1).nullable(),
});
export type AgentAttemptTiming = z.infer<typeof AgentAttemptTimingSchema>;

export const ObservationSchema = z.object({
  scenarioId: z.string(),
  decision: z.number().int().nonnegative(),
  tick: z.number().int().nonnegative(),
  elapsedSeconds: z.number().nonnegative(),
  timeRemainingSeconds: z.number().nonnegative(),
  winPercent: z.number(),
  landTiles: z.number().int().nonnegative(),
  self: z.record(z.string(), z.unknown()),
  opponents: z.array(z.record(z.string(), z.unknown())),
  recentDecisions: z.array(z.record(z.string(), z.unknown())),
});
export type Observation = z.infer<typeof ObservationSchema>;

export const DecisionRecordSchema = z.object({
  index: z.number().int().nonnegative(),
  tick: z.number().int().nonnegative(),
  observation: ObservationSchema,
  candidates: z.array(LegalActionSchema),
  strategy: z.string().max(160),
  selectedActionIds: z.array(z.string()).length(2),
  appliedActionIds: z.array(z.string()).length(2),
  outcomes: z.array(z.string()).length(2),
  attempts: z.number().int().min(1).max(2),
  attemptFailures: z.array(AgentAttemptFailureSchema).default([]),
  attemptTimings: z.array(AgentAttemptTimingSchema).max(2).default([]),
  fallback: z.boolean(),
  latencyMs: z.number().nonnegative(),
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  model: z.string(),
  provider: z.string().nullable(),
});
export type DecisionRecord = z.infer<typeof DecisionRecordSchema>;

export const RunStatusSchema = z.enum([
  "sample",
  "running",
  "completed",
  "failed",
  "interrupted",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  runId: z.uuid(),
  status: RunStatusSchema,
  scenario: z.record(z.string(), z.unknown()),
  model: z.object({
    requested: z.string(),
    resolved: z.string(),
    provider: z.string().nullable(),
    promptVersion: z.enum(["agent-v1", "agent-v2", "agent-v3", "agent-v4"]),
    seed: z.literal(3209),
  }),
  startedAt: z.string(),
  completedAt: z.string(),
  usage: z.object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative(),
  }),
  outcome: z.object({
    winner: z.string(),
    llmWon: z.boolean(),
    ticks: z.number().int().nonnegative(),
    simulatedSeconds: z.number().nonnegative(),
    finalHash: z.number().nullable(),
    finalPlacement: z.number().int().positive(),
    terminationReason: z.string(),
  }),
  decisions: z.array(DecisionRecordSchema),
  replay: GameRecordSchema,
});
export type RunArtifact = z.infer<typeof RunArtifactSchema>;

export interface RunProgress {
  runId: string;
  status: RunStatus;
  startedAt: string;
  tick: number;
  decisionCount: number;
  maxDecisionCount: number;
  latestStrategy: string;
  costUsd: number;
  error?: string;
}

export interface AgentResult {
  decision: AgentDecision | null;
  attempts: number;
  attemptFailures: AgentAttemptFailure[];
  attemptTimings: AgentAttemptTiming[];
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  model: string;
  provider: string | null;
  error?: string;
}
