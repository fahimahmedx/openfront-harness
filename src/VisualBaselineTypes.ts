import { z } from "zod";

export const VISUAL_BASELINE_INTERFACE = "visual-controls-v1" as const;

export const VISUAL_BASELINE = {
  viewport: { width: 1280, height: 720 },
  firstDecisionTick: 3,
  decisionIntervalTicks: 100,
  minScreenshotBytes: 20_000,
  maxPrimitiveCommandsPerDecision: 8,
  maxGameIntentsPerDecision: 2,
  maxWaitMs: 2_000,
  commandSet: ["move", "click", "drag", "scroll", "keypress", "wait", "done"],
} as const;

const PointFields = {
  x: z
    .number()
    .int()
    .min(0)
    .max(VISUAL_BASELINE.viewport.width - 1),
  y: z
    .number()
    .int()
    .min(0)
    .max(VISUAL_BASELINE.viewport.height - 1),
};

export const VisualCommandSchema = z.discriminatedUnion("command", [
  z.object({
    command: z.literal("move"),
    ...PointFields,
    note: z.string().trim().max(160),
  }),
  z.object({
    command: z.literal("click"),
    ...PointFields,
    button: z.enum(["left", "right"]).default("left"),
    note: z.string().trim().max(160),
  }),
  z.object({
    command: z.literal("drag"),
    ...PointFields,
    x2: PointFields.x,
    y2: PointFields.y,
    note: z.string().trim().max(160),
  }),
  z.object({
    command: z.literal("scroll"),
    ...PointFields,
    deltaY: z.number().int().min(-2_000).max(2_000),
    note: z.string().trim().max(160),
  }),
  z.object({
    command: z.literal("keypress"),
    key: z.string().trim().min(1).max(40),
    note: z.string().trim().max(160),
  }),
  z.object({
    command: z.literal("wait"),
    milliseconds: z.number().int().min(0).max(VISUAL_BASELINE.maxWaitMs),
    note: z.string().trim().max(160),
  }),
  z.object({
    command: z.literal("done"),
    note: z.string().trim().max(160),
  }),
]);

export type VisualCommand = z.infer<typeof VisualCommandSchema>;

export type BaselinePlayerSnapshot = {
  id: string;
  clientID: string | null;
  name: string;
  alive: boolean;
  tiles: number;
  troops: number;
  gold: number;
  eliminatedAt?: number;
};

export type BaselineScoreSnapshot = {
  tick: number;
  landTiles: number;
  players: BaselinePlayerSnapshot[];
};

export type BrowserBaselineStatus = {
  active: true;
  gatedAt: number | null;
  nextGateTick: number;
  decisionIndex: number;
  intents: unknown[];
  latestSnapshot: BaselineScoreSnapshot | null;
  winnerJson: string | null;
  replayJson: string | null;
  finished: boolean;
  error: string | null;
};

export type BrowserBaselineController = {
  active: true;
  spawn: { x: number; y: number };
  shouldGate(turn: number): boolean;
  acceptIntent(intent: unknown): boolean;
  release(): void;
  fastForward(): void;
  isFastForwarding(): boolean;
  onTurn(turn: unknown): void;
  capturedTurns(): unknown[];
  onUpdate(snapshot: BaselineScoreSnapshot): void;
  onWinner(winnerJson: string): void;
  onReplay(replayJson: string): void;
  fail(message: string): void;
  status(): BrowserBaselineStatus;
};

export const VisualBaselineUsageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  modelCalls: z.number().int().nonnegative(),
});

export type VisualBaselineUsage = z.infer<typeof VisualBaselineUsageSchema>;

const StoredCommandSchema = z.object({
  commandIndex: z.number().int().nonnegative(),
  screenshot: z.string(),
  screenshotSha256: z.string().length(64),
  selected: VisualCommandSchema,
  latencyMs: z.number().nonnegative(),
  usage: VisualBaselineUsageSchema,
  intentsAfterCommand: z.number().int().nonnegative(),
});

export const VisualBaselineDecisionSchema = z.object({
  decision: z.number().int().nonnegative(),
  tick: z.number().int().nonnegative(),
  commands: z.array(StoredCommandSchema),
  acceptedIntents: z.array(z.unknown()),
  scoreOnlySnapshot: z.custom<BaselineScoreSnapshot>(),
});

export type VisualBaselineDecision = z.infer<
  typeof VisualBaselineDecisionSchema
>;

export const VisualBaselineArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  interface: z.literal(VISUAL_BASELINE_INTERFACE),
  runId: z.string().uuid(),
  status: z.enum(["completed", "failed"]),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  scenario: z.object({
    id: z.string(),
    seed: z.string(),
    clientID: z.string(),
    spawn: z.object({ x: z.number(), y: z.number(), label: z.string() }),
    decisionIntervalTicks: z.number(),
    actionSlots: z.number(),
    maxDecisionCount: z.number(),
    maxSimulatedMinutes: z.number(),
    openfront: z.object({ version: z.string(), commit: z.string() }),
  }),
  model: z.object({
    requested: z.string(),
    resolved: z.string(),
    provider: z.string().nullable(),
    reasoningEffort: z.literal("none"),
    promptVersion: z.literal(VISUAL_BASELINE_INTERFACE),
  }),
  protocol: z.object({
    viewport: z.object({ width: z.number(), height: z.number() }),
    firstDecisionTick: z.number(),
    maxPrimitiveCommandsPerDecision: z.number(),
    maxGameIntentsPerDecision: z.number(),
    minScreenshotBytes: z.number(),
    controlsPromptSha256: z.string().length(64),
  }),
  decisions: z.array(VisualBaselineDecisionSchema),
  usage: VisualBaselineUsageSchema,
  outcome: z.object({
    winner: z.unknown().nullable(),
    llmWon: z.boolean(),
    finalPlacement: z.number().int().positive(),
    terminalTick: z.number().int().nonnegative(),
    finalTerritoryPercent: z.number().nonnegative(),
    territoryAreaUnderCurve: z.number().nonnegative(),
    finalPlayers: z.array(z.custom<BaselinePlayerSnapshot>()),
  }),
  replay: z.unknown().nullable(),
  error: z.string().optional(),
});

export type VisualBaselineArtifact = z.infer<
  typeof VisualBaselineArtifactSchema
>;

declare global {
  interface Window {
    openfrontVisualBaseline?: BrowserBaselineController;
  }
}
