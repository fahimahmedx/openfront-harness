import { z } from "zod";
import { AgentAttemptFailureSchema, AgentAttemptTimingSchema } from "../Types";
import { BENCHMARK_VERSION } from "./BenchmarkConfig";

export const LowerHexSha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const BenchmarkSplitSchema = z.enum(["scored"]);
export const BenchmarkSuiteSchema = z.enum(["match", "capability"]);

const CommonTaskSchema = z.object({
  id: z.string().min(1),
  suite: BenchmarkSuiteSchema,
  split: BenchmarkSplitSchema,
  map: z.string().min(1),
  mapPath: z.string().min(1),
  seed: z.string().min(1),
  spawn: z.object({
    x: z.number().int(),
    y: z.number().int(),
    label: z.string().min(1),
  }),
  difficulty: z.enum(["Medium", "Hard"]),
  nationCount: z.number().int().nonnegative(),
  tribeBotCount: z.number().int().nonnegative(),
  expectedRoster: z.array(z.string().min(1)),
  resolvedConfig: z.record(z.string(), z.unknown()),
  resolvedConfigHash: LowerHexSha256Schema,
  ceilings: z
    .object({ actionsPerDecision: z.literal(1) })
    .passthrough()
    .refine((ceilings) => !("actionSlots" in ceilings), {
      message: "Legacy actionSlots is not valid in the one-action benchmark",
    }),
});

const BenchmarkRecentDecisionSchema = z
  .object({
    selectedActionIds: z.array(z.string()).length(1),
    appliedActionIds: z.array(z.string()).length(1),
    actionOutcomes: z.array(z.record(z.string(), z.unknown())).length(1),
  })
  .passthrough();

export const BenchmarkManifestTaskSchema = z.discriminatedUnion("suite", [
  CommonTaskSchema.extend({ suite: z.literal("match") }),
  CommonTaskSchema.extend({
    suite: z.literal("capability"),
    family: z.enum([
      "neutral-expansion",
      "saturated-capacity-expansion",
      "post-expansion-recovery",
      "weaker-target-selection",
      "frontier-restraint",
      "incoming-attack-response",
      "split-front-prioritization",
      "losing-attack-retreat",
      "naval-target-recognition",
      "construction-failure-recovery",
    ]),
    sourceTaskId: z.string().min(1),
    preparationTurns: z.array(z.record(z.string(), z.unknown())),
    decisionIndex: z.number().int().nonnegative(),
    recentDecisions: z.array(BenchmarkRecentDecisionSchema),
    checkpointTick: z.number().int().nonnegative(),
    hashes: z.object({
      state: z.union([
        z.number().int(),
        z.string().regex(/^(?:[0-9]+|[0-9a-f]{64})$/),
      ]),
      observation: LowerHexSha256Schema,
      candidateMenu: LowerHexSha256Schema,
      tileState: LowerHexSha256Schema,
    }),
    horizonTicks: z.number().int().positive(),
    semanticRoles: z.record(z.string(), z.unknown()),
    thresholds: z.record(z.string(), z.unknown()),
    ownershipSets: z.record(
      z.string(),
      z.array(z.number().int().nonnegative()),
    ),
    graderVersion: z.literal("capability-grader-v2"),
    referencePolicyHash: LowerHexSha256Schema,
    controlPolicyHashes: z.array(LowerHexSha256Schema).min(2),
    acceptanceReportPath: z.string().min(1),
    acceptanceReportHash: LowerHexSha256Schema,
  }),
]);

export const BenchmarkManifestSchema = z.object({
  benchmarkVersion: z.literal(BENCHMARK_VERSION),
  releaseDate: z.string().date(),
  license: z.string().min(1),
  maintainer: z.string().min(1),
  engine: z.object({
    version: z.literal("v0.32.9"),
    commit: z.literal("dcc18d5231af6253b0e991bf04a4c764982fe262"),
  }),
  mapAssets: z.record(z.string(), LowerHexSha256Schema),
  harnessCommit: z.string().min(7),
  harnessSourceHash: LowerHexSha256Schema,
  promptVersion: z.literal("agent-v13"),
  promptHash: LowerHexSha256Schema,
  schemaVersions: z.record(z.string(), z.string().min(1)),
  resolverVersion: z.literal("single-action-v1"),
  troopPolicy: z.record(z.string(), z.number()),
  graderPackageHash: LowerHexSha256Schema,
  taskOrder: z.object({
    algorithm: z.literal("fnv1a-mulberry32-fisher-yates-v1"),
    runnerSeedFormat: z.string().min(1),
  }),
  bootstrap: z.object({
    implementation: z.literal("stratified-task-bootstrap-v1"),
    replicates: z.number().int().min(10_000),
  }),
  tasks: z.array(BenchmarkManifestTaskSchema).length(22),
});
export type BenchmarkManifest = z.infer<typeof BenchmarkManifestSchema>;

export const BenchmarkAssertionSchema = z.object({
  id: z.string().min(1),
  observed: z.union([z.number(), z.boolean(), z.string()]),
  operator: z.string().min(1),
  threshold: z.union([z.number(), z.boolean(), z.string()]),
  passed: z.boolean(),
});
export type BenchmarkAssertion = z.infer<typeof BenchmarkAssertionSchema>;

const AcceptanceRunSchema = z.object({
  selectedActionId: z.string().min(1),
  finalHash: z.union([z.number(), z.string(), z.null()]),
  passed: z.boolean(),
  assertions: z.array(BenchmarkAssertionSchema),
});

export const BenchmarkAcceptanceReportSchema = z.object({
  schemaVersion: z.literal("benchmark-fixture-acceptance-v2"),
  fixtureId: z.string().min(1),
  status: z.literal("accepted"),
  sourceArtifact: z.string().min(1),
  cleanRebuilds: z
    .array(
      z.object({
        state: z.union([z.number().int(), z.string()]),
        observation: LowerHexSha256Schema,
        candidateMenu: LowerHexSha256Schema,
        tileState: LowerHexSha256Schema,
      }),
    )
    .length(5),
  machineChecks: z.object({
    checkpointRequirements: z.literal(true),
    oneActionPerDecision: z.literal(true),
    ordinaryInputOnly: z.literal(true),
  }),
  referenceReplays: z.object({
    attempted: z.literal(5),
    passed: z.literal(5),
    runs: z
      .array(AcceptanceRunSchema.extend({ passed: z.literal(true) }))
      .length(5),
  }),
  controls: z
    .array(
      AcceptanceRunSchema.extend({
        name: z.string().min(1),
        passed: z.literal(false),
      }),
    )
    .min(2)
    .refine(
      (controls) =>
        new Set(controls.map((control) => control.selectedActionId)).size ===
        controls.length,
      { message: "Acceptance controls must select distinct legal actions" },
    ),
  review: z.object({
    blindedTradeoffIdentifiable: z.literal(true),
    fairAndAttributable: z.literal(true),
  }),
});
export type BenchmarkAcceptanceReport = z.infer<
  typeof BenchmarkAcceptanceReportSchema
>;

export const BenchmarkModelSchema = z.object({
  requested: z.string().min(1),
  resolved: z.string().min(1),
  provider: z.string().nullable(),
  requestedProvider: z.string().nullable(),
  promptVersion: z.literal("agent-v13"),
  reasoningEffort: z.literal("none"),
});

export const BenchmarkConfigurationSchema = z.object({
  requestedModel: z.string().min(1),
  requestedProvider: z.string().nullable(),
  promptVersion: z.literal("agent-v13"),
  reasoningEffort: z.literal("none"),
});

export const BenchmarkTrialSchema = z.object({
  schemaVersion: z.literal("benchmark-trial-v1"),
  benchmarkVersion: z.literal(BENCHMARK_VERSION),
  manifestHash: LowerHexSha256Schema,
  runId: z.uuid(),
  trialId: z.uuid(),
  taskId: z.string().min(1),
  suite: BenchmarkSuiteSchema,
  split: BenchmarkSplitSchema,
  status: z.enum(["valid", "invalid", "needs-review"]),
  invalidReason: z.string().nullable(),
  model: BenchmarkModelSchema,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime(),
  hashes: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
  attempts: z.object({
    failures: z.array(AgentAttemptFailureSchema),
    timings: z.array(AgentAttemptTimingSchema),
    fallback: z.boolean(),
  }),
  usage: z.object({
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    costUsd: z.number().nonnegative().nullable(),
  }),
  assertions: z.array(BenchmarkAssertionSchema),
  diagnostics: z.record(z.string(), z.unknown()),
  componentCoverage: z.number().min(0).max(1).nullable(),
  taskScore: z.number().min(0).max(100),
  artifactPath: z.string().min(1),
});
export type BenchmarkTrial = z.infer<typeof BenchmarkTrialSchema>;

export const BenchmarkRunReportSchema = z.object({
  schemaVersion: z.literal("benchmark-run-v1"),
  benchmarkVersion: z.literal(BENCHMARK_VERSION),
  classification: z.enum([
    "first-party-standard",
    "external-self-run",
    "unofficial-custom-agent",
  ]),
  complete: z.boolean(),
  configuration: BenchmarkConfigurationSchema,
  manifestHash: LowerHexSha256Schema,
  runId: z.uuid(),
  runnerSeed: z.string().min(1),
  bootstrapSeed: z.string().min(1),
  bootstrapReplicates: z.number().int().min(10_000),
  declaredTrials: z.object({
    matchPerTask: z.number().int().positive(),
    capabilityPerFixture: z.number().int().positive(),
  }),
  completedTrials: z.object({
    match: z.number().int().nonnegative(),
    capability: z.number().int().nonnegative(),
  }),
  taskOrder: z.array(z.string().min(1)),
  trialReferences: z.array(z.string().min(1)),
  invalidTrials: z.array(z.object({ taskId: z.string(), reason: z.string() })),
  summaries: z.record(z.string(), z.unknown()),
  exactInvocation: z.string().min(1),
});
export type BenchmarkRunReport = z.infer<typeof BenchmarkRunReportSchema>;
