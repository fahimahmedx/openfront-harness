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

export function isGoldSpendingLegalAction(action: LegalAction): boolean {
  return (
    action.intent?.type === "build_unit" ||
    action.intent?.type === "upgrade_structure"
  );
}

type PlayerInteraction = {
  targetID: string;
  posture: "cooperate" | "oppose";
};

function playerInteraction(action: LegalAction): PlayerInteraction | null {
  const intent = action.intent;
  if (intent === null) return null;

  switch (intent.type) {
    case "allianceRequest":
    case "allianceExtension":
      return { targetID: intent.recipient, posture: "cooperate" };
    case "breakAlliance":
      return { targetID: intent.recipient, posture: "oppose" };
    case "embargo":
      return intent.action === "start"
        ? { targetID: intent.targetID, posture: "oppose" }
        : null;
    case "attack":
      return intent.targetID === null
        ? null
        : { targetID: intent.targetID, posture: "oppose" };
    case "boat": {
      const match = /^(?:counter-)?boat:([^:]+):/.exec(action.id);
      return match?.[1] ? { targetID: match[1], posture: "oppose" } : null;
    }
    default:
      return null;
  }
}

export function legalActionConflictReason(
  first: LegalAction,
  second: LegalAction,
): "mixed_posture_same_target" | "multi_front_proactive_offense" | null {
  const firstInteraction = playerInteraction(first);
  const secondInteraction = playerInteraction(second);
  const conflictingPostures =
    firstInteraction !== null &&
    secondInteraction !== null &&
    firstInteraction.targetID === secondInteraction.targetID &&
    firstInteraction.posture !== secondInteraction.posture;
  if (conflictingPostures) return "mixed_posture_same_target";

  const proactiveAttackTarget = (action: LegalAction): string | null => {
    if (
      action.intent?.type === "attack" &&
      action.intent.targetID !== null &&
      action.id.startsWith("attack:")
    ) {
      return action.intent.targetID;
    }
    if (action.intent?.type === "boat" && action.id.startsWith("boat:")) {
      return /^boat:([^:]+):/.exec(action.id)?.[1] ?? null;
    }
    return null;
  };
  const firstTarget = proactiveAttackTarget(first);
  const secondTarget = proactiveAttackTarget(second);
  return firstTarget !== null &&
    secondTarget !== null &&
    firstTarget !== secondTarget
    ? "multi_front_proactive_offense"
    : null;
}

export function areConflictingLegalActions(
  first: LegalAction,
  second: LegalAction,
): boolean {
  return legalActionConflictReason(first, second) !== null;
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
    "conflicting_action_ids",
    "truncated_response",
    "refusal",
    "request_error",
    "cost_limit",
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

export const TIMER_VICTORY_RULE =
  "When the timer expires, the living player with the most land tiles wins.";

const TerritoryLeaderSchema = z.object({
  id: z.string(),
  name: z.string(),
  territoryPercent: z.number().nonnegative(),
});

function legacyObservationFields(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const observation = value as Record<string, unknown>;
  const self =
    typeof observation.self === "object" && observation.self !== null
      ? (observation.self as Record<string, unknown>)
      : {};
  const opponents = Array.isArray(observation.opponents)
    ? observation.opponents.filter(
        (candidate): candidate is Record<string, unknown> =>
          typeof candidate === "object" && candidate !== null,
      )
    : [];
  const standings = [self, ...opponents]
    .map((candidate, order) => ({
      id:
        typeof candidate.id === "string"
          ? candidate.id
          : order === 0
            ? "self"
            : `opponent-${order}`,
      name:
        typeof candidate.name === "string"
          ? candidate.name
          : order === 0
            ? "Self"
            : `Opponent ${order}`,
      territoryPercent:
        typeof candidate.territoryPercent === "number"
          ? candidate.territoryPercent
          : 0,
      alive: candidate.alive !== false,
      order,
    }))
    .filter((candidate) => candidate.alive)
    .sort(
      (a, b) => b.territoryPercent - a.territoryPercent || a.order - b.order,
    );
  const leader = standings[0] ?? {
    id: "self",
    name: "Self",
    territoryPercent: 0,
  };
  const selfRank = Math.max(
    1,
    standings.findIndex((candidate) => candidate.order === 0) + 1,
  );
  const observedRank =
    typeof observation.currentRank === "number"
      ? observation.currentRank
      : selfRank;
  const selfTerritory =
    typeof self.territoryPercent === "number" ? self.territoryPercent : 0;
  const isTerritoryLeader =
    typeof observation.isTerritoryLeader === "boolean"
      ? observation.isTerritoryLeader
      : observedRank === 1;
  const runnerUp = standings.find((candidate) => candidate.order !== 0);
  const derivedLeadPercent = isTerritoryLeader
    ? Math.max(0, selfTerritory - (runnerUp?.territoryPercent ?? selfTerritory))
    : 0;
  const derivedDeficitPercent = isTerritoryLeader
    ? 0
    : Math.max(0, leader.territoryPercent - selfTerritory);

  return {
    ...observation,
    instantVictoryTerritoryPercent:
      observation.instantVictoryTerritoryPercent ??
      observation.winPercent ??
      80,
    currentRank: observedRank,
    territoryLeader: observation.territoryLeader ?? {
      id: leader.id,
      name: leader.name,
      territoryPercent: leader.territoryPercent,
    },
    isTerritoryLeader,
    territoryLeadPercent:
      observation.territoryLeadPercent ?? derivedLeadPercent,
    territoryDeficitPercent:
      observation.territoryDeficitPercent ??
      observation.territoryGapToLeader ??
      derivedDeficitPercent,
    timerVictoryRule: observation.timerVictoryRule ?? TIMER_VICTORY_RULE,
  };
}

export const ObservationSchema = z.preprocess(
  legacyObservationFields,
  z
    .object({
      scenarioId: z.string(),
      decision: z.number().int().nonnegative(),
      tick: z.number().int().nonnegative(),
      elapsedSeconds: z.number().nonnegative(),
      timeRemainingSeconds: z.number().nonnegative(),
      instantVictoryTerritoryPercent: z.number(),
      currentRank: z.number().int().positive(),
      territoryLeader: TerritoryLeaderSchema,
      isTerritoryLeader: z.boolean(),
      territoryLeadPercent: z.number().nonnegative(),
      territoryDeficitPercent: z.number().nonnegative(),
      timerVictoryRule: z.literal(TIMER_VICTORY_RULE),
      landTiles: z.number().int().nonnegative(),
      self: z.record(z.string(), z.unknown()),
      opponents: z.array(z.record(z.string(), z.unknown())),
      recentDecisions: z.array(z.record(z.string(), z.unknown())),
    })
    .refine(
      (observation) =>
        observation.isTerritoryLeader === (observation.currentRank === 1),
      {
        message: "isTerritoryLeader must agree with currentRank",
        path: ["isTerritoryLeader"],
      },
    )
    .refine(
      (observation) =>
        observation.isTerritoryLeader
          ? observation.territoryDeficitPercent === 0
          : observation.territoryLeadPercent === 0,
      {
        message:
          "territoryLeadPercent and territoryDeficitPercent must be mutually exclusive",
        path: ["territoryLeadPercent"],
      },
    ),
);
export type Observation = z.infer<typeof ObservationSchema>;

export const ActionOutcomeStatusSchema = z.enum([
  "started",
  "failed",
  "completed",
  "destroyed",
  "unknown",
]);
export type ActionOutcomeStatus = z.infer<typeof ActionOutcomeStatusSchema>;

export const ActionOutcomeFailureCodeSchema = z.enum([
  "anchor_lost",
  "insufficient_gold",
  "placement_blocked",
  "player_eliminated",
  "runtime_rejected",
]);
export type ActionOutcomeFailureCode = z.infer<
  typeof ActionOutcomeFailureCodeSchema
>;

export const ActionOutcomeSchema = z.object({
  actionId: z.string().min(1).max(160),
  status: ActionOutcomeStatusSchema,
  startedAtTick: z.number().int().nonnegative().nullable(),
  resolvedAtTick: z.number().int().nonnegative().nullable(),
  entityId: z.union([z.string(), z.number().int()]).nullable(),
  detail: z.string().min(1).max(500),
  failureCode: ActionOutcomeFailureCodeSchema.optional(),
});
export type ActionOutcome = z.infer<typeof ActionOutcomeSchema>;

function legacyActionOutcomes(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const decision = value as Record<string, unknown>;
  if (Array.isArray(decision.actionOutcomes)) return value;
  const actionIds = Array.isArray(decision.appliedActionIds)
    ? decision.appliedActionIds
    : [];
  const outcomes = Array.isArray(decision.outcomes) ? decision.outcomes : [];
  const tick = typeof decision.tick === "number" ? decision.tick : 0;
  return {
    ...decision,
    actionOutcomes: actionIds.map((actionId, index) => {
      const detail =
        typeof outcomes[index] === "string"
          ? outcomes[index]
          : "Legacy artifact did not record an execution result";
      const held = detail === "held" || String(actionId).startsWith("hold:");
      return {
        actionId: String(actionId),
        status: held ? "completed" : "unknown",
        startedAtTick: held ? tick : null,
        resolvedAtTick: held ? tick : null,
        entityId: null,
        detail,
      };
    }),
  };
}

export const DecisionRecordSchema = z.preprocess(
  legacyActionOutcomes,
  z.object({
    index: z.number().int().nonnegative(),
    tick: z.number().int().nonnegative(),
    observation: ObservationSchema,
    candidates: z.array(LegalActionSchema),
    strategy: z.string().max(160),
    selectedActionIds: z.array(z.string()).length(2),
    appliedActionIds: z.array(z.string()).length(2),
    outcomes: z.array(z.string()).length(2),
    actionOutcomes: z.array(ActionOutcomeSchema).length(2),
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
  }),
);
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
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  runId: z.uuid(),
  status: RunStatusSchema,
  scenario: z.record(z.string(), z.unknown()),
  model: z.object({
    requested: z.string(),
    resolved: z.string(),
    provider: z.string().nullable(),
    promptVersion: z.enum([
      "agent-v1",
      "agent-v2",
      "agent-v3",
      "agent-v4",
      "agent-v5",
      "agent-v6",
      "agent-v7",
      "agent-v8",
      "agent-v9",
      "agent-v10",
      "agent-v11",
      "agent-v12",
    ]),
    // Retained only for parsing artifacts created before model seeding was
    // removed. New runs omit this field.
    seed: z.literal(3209).optional(),
    reasoningEffort: z
      .enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"])
      .optional(),
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
    fieldSize: z.number().int().min(2).optional(),
    survived: z.boolean().optional(),
    finalLandShare: z.number().min(0).max(1).optional(),
    finalTroopShare: z.number().min(0).max(1).optional(),
    matchPoints: z.number().min(0).max(100).optional(),
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
