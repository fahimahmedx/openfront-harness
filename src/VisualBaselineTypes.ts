import { z } from "zod";

export const VISUAL_BASELINE_INTERFACE = "visual-controls-v1" as const;
export const VISUAL_NAIVE_INTERFACE = "visual-naive-v1" as const;
export const VisualBaselineInterfaceSchema = z.enum([
  VISUAL_BASELINE_INTERFACE,
  VISUAL_NAIVE_INTERFACE,
]);
export type VisualBaselineInterface = z.infer<
  typeof VisualBaselineInterfaceSchema
>;

export const VISUAL_BASELINE = {
  viewport: { width: 1280, height: 720 },
  firstDecisionTick: 3,
  decisionIntervalTicks: 100,
  minScreenshotBytes: 20_000,
  maxPrimitiveCommandsPerDecision: 8,
  maxGameIntentsPerDecision: 2,
  recentPublicNoteCount: 3,
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

const NamedKeyAliases: Record<string, string> = {
  alt: "Alt",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  arrowup: "ArrowUp",
  backspace: "Backspace",
  cmd: "Meta",
  command: "Meta",
  control: "Control",
  ctrl: "Control",
  delete: "Delete",
  end: "End",
  enter: "Enter",
  esc: "Escape",
  escape: "Escape",
  home: "Home",
  insert: "Insert",
  meta: "Meta",
  pagedown: "PageDown",
  pageup: "PageUp",
  return: "Enter",
  shift: "Shift",
  space: "Space",
  spacebar: "Space",
  tab: "Tab",
};

function normalizeKeyToken(token: string) {
  const trimmed = token.trim();
  const lower = trimmed.toLowerCase();
  const alias = NamedKeyAliases[lower];
  if (alias) return alias;
  if (/^key[a-z]$/i.test(trimmed))
    return `Key${trimmed.slice(-1).toUpperCase()}`;
  if (/^digit[0-9]$/i.test(trimmed)) return `Digit${trimmed.slice(-1)}`;
  if (/^f(?:[1-9]|1[0-2])$/i.test(trimmed)) return trimmed.toUpperCase();
  return trimmed;
}

export function normalizeVisualKey(key: string) {
  return key.split("+").map(normalizeKeyToken).join("+");
}

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
    key: z.string().trim().min(1).max(40).transform(normalizeVisualKey),
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

const VisualBaselineArtifactCommonShape = {
  runId: z.string().uuid(),
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
} as const;

export const VisualBaselineTerminationSchema = z.object({
  reason: z.enum([
    "wall-clock-limit",
    "model-cost-limit",
    "client-progress-timeout",
    "model-command-invalid",
  ]),
  classification: z.literal("model-failure"),
  detail: z.string(),
});
export type VisualBaselineTermination = z.infer<
  typeof VisualBaselineTerminationSchema
>;

const VisualBaselineProtocolShape = {
  viewport: z.object({ width: z.number(), height: z.number() }),
  firstDecisionTick: z.number(),
  maxPrimitiveCommandsPerDecision: z.number(),
  maxGameIntentsPerDecision: z.number(),
  minScreenshotBytes: z.number(),
} as const;

const VisualBaselineArtifactV1Schema = z.object({
  schemaVersion: z.literal(1),
  ...VisualBaselineArtifactCommonShape,
  status: z.enum(["completed", "failed"]),
  error: z.string().optional(),
  interface: z.literal(VISUAL_BASELINE_INTERFACE),
  model: z.object({
    requested: z.string(),
    resolved: z.string(),
    provider: z.string().nullable(),
    reasoningEffort: z.literal("none"),
    promptVersion: z.literal(VISUAL_BASELINE_INTERFACE),
  }),
  protocol: z.object({
    ...VisualBaselineProtocolShape,
    controlsPromptSha256: z.string().length(64),
  }),
});

const VisualBaselineArtifactV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    ...VisualBaselineArtifactCommonShape,
    status: z.enum(["completed", "failed"]),
    error: z.string().optional(),
    interface: VisualBaselineInterfaceSchema,
    model: z.object({
      requested: z.string(),
      resolved: z.string(),
      provider: z.string().nullable(),
      reasoningEffort: z.literal("none"),
      promptVersion: VisualBaselineInterfaceSchema,
    }),
    protocol: z.object({
      ...VisualBaselineProtocolShape,
      interfacePromptSha256: z.string().length(64),
      recentPublicNoteCount: z.literal(VISUAL_BASELINE.recentPublicNoteCount),
    }),
  })
  .superRefine((artifact, context) => {
    if (artifact.model.promptVersion !== artifact.interface) {
      context.addIssue({
        code: "custom",
        path: ["model", "promptVersion"],
        message: "promptVersion must match the visual interface",
      });
    }
  });

const VisualBaselineArtifactV3Schema = z
  .object({
    schemaVersion: z.literal(3),
    ...VisualBaselineArtifactCommonShape,
    status: z.enum(["completed", "terminated", "failed"]),
    termination: VisualBaselineTerminationSchema.optional(),
    error: z.string().optional(),
    interface: VisualBaselineInterfaceSchema,
    model: z.object({
      requested: z.string(),
      resolved: z.string(),
      provider: z.string().nullable(),
      reasoningEffort: z.literal("none"),
      promptVersion: VisualBaselineInterfaceSchema,
    }),
    protocol: z.object({
      ...VisualBaselineProtocolShape,
      interfacePromptSha256: z.string().length(64),
      recentPublicNoteCount: z.literal(VISUAL_BASELINE.recentPublicNoteCount),
    }),
    outcome: VisualBaselineArtifactCommonShape.outcome.extend({
      isTerminal: z.boolean(),
    }),
  })
  .superRefine((artifact, context) => {
    if (artifact.model.promptVersion !== artifact.interface) {
      context.addIssue({
        code: "custom",
        path: ["model", "promptVersion"],
        message: "promptVersion must match the visual interface",
      });
    }
    if (artifact.status === "terminated" && !artifact.termination) {
      context.addIssue({
        code: "custom",
        path: ["termination"],
        message: "terminated artifacts require termination metadata",
      });
    }
    if (artifact.status !== "terminated" && artifact.termination) {
      context.addIssue({
        code: "custom",
        path: ["termination"],
        message: "only terminated artifacts may include termination metadata",
      });
    }
    if (artifact.status === "failed" && !artifact.error) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "failed artifacts require an evaluator error",
      });
    }
    if (artifact.status !== "failed" && artifact.error) {
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "only failed artifacts may include an evaluator error",
      });
    }
    if (artifact.outcome.isTerminal !== (artifact.status === "completed")) {
      context.addIssue({
        code: "custom",
        path: ["outcome", "isTerminal"],
        message: "only completed artifacts have terminal outcomes",
      });
    }
  });

export const VisualBaselineArtifactSchema = z.union([
  VisualBaselineArtifactV1Schema,
  VisualBaselineArtifactV2Schema,
  VisualBaselineArtifactV3Schema,
]);

export type VisualBaselineArtifact = z.infer<
  typeof VisualBaselineArtifactSchema
>;

declare global {
  interface Window {
    openfrontVisualBaseline?: BrowserBaselineController;
  }
}
