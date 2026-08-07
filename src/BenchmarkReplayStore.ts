import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { z } from "zod";
import { GameRecordSchema } from "../OpenFrontIO/src/core/Schemas";
import {
  ActionOutcomeSchema,
  AgentAttemptFailureSchema,
  AgentAttemptTimingSchema,
  LegalActionSchema,
  ObservationSchema,
  ReplayRunArtifact,
  ReplayRunArtifactSchema,
} from "./Types";
import {
  BenchmarkTrial,
  BenchmarkTrialSchema,
} from "./benchmark/BenchmarkSchemas";

const gunzipAsync = promisify(gunzip);

const benchmarkProfiles = [
  {
    id: "glm-5.2-baidu",
    label: "GLM-5.2",
    directory: "glm-5.2-baidu",
  },
  {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    directory: "gpt-5.6-luna-openai",
  },
  {
    id: "deepseek-v4-flash-cloudflare",
    label: "DeepSeek V4 Flash 0731",
    directory: "deepseek-v4-flash-cloudflare",
  },
] as const;

const CapabilityReplayArtifactSchema = z.object({
  fixture: z.object({ id: z.string() }).passthrough(),
  observation: ObservationSchema,
  candidates: z.array(LegalActionSchema),
  selectedActionIds: z.array(z.string()).length(1),
  appliedActionIds: z.array(z.string()).length(1),
  actionOutcomes: z.array(ActionOutcomeSchema),
  agent: z
    .object({
      attempts: z.number().int().positive(),
      attemptFailures: z.array(AgentAttemptFailureSchema),
      attemptTimings: z.array(AgentAttemptTimingSchema),
      promptTokens: z.number().int().nonnegative(),
      completionTokens: z.number().int().nonnegative(),
      costUsd: z.number().nonnegative(),
      model: z.string(),
      provider: z.string().nullable(),
      latencyMs: z.number().nonnegative(),
      decision: z
        .object({ strategy: z.string(), action: z.string() })
        .nullable(),
    })
    .passthrough(),
  taskPass: z.boolean(),
  replay: GameRecordSchema,
});

export type CapabilityReplayArtifact = z.infer<
  typeof CapabilityReplayArtifactSchema
>;

export type BenchmarkReplayArtifact =
  | {
      suite: "match";
      trial: BenchmarkTrial;
      artifact: ReplayRunArtifact;
    }
  | {
      suite: "capability";
      trial: BenchmarkTrial;
      artifact: CapabilityReplayArtifact;
    };

export type BenchmarkReplayIndex = {
  models: Array<{
    id: string;
    label: string;
    trials: Array<{
      trialId: string;
      taskId: string;
      suite: "match" | "capability";
      trialNumber: number;
    }>;
  }>;
};

type StoredTrial = {
  profileDirectory: string;
  trial: BenchmarkTrial;
  trialNumber: number;
};

export class BenchmarkReplayStore {
  private indexPromise: Promise<BenchmarkReplayIndex> | undefined;
  private readonly trialsById = new Map<string, StoredTrial>();

  constructor(readonly benchmarkRoot: string) {}

  index(): Promise<BenchmarkReplayIndex> {
    this.indexPromise ??= this.loadIndex().catch((error) => {
      this.indexPromise = undefined;
      throw error;
    });
    return this.indexPromise;
  }

  async getArtifact(trialId: string): Promise<BenchmarkReplayArtifact | null> {
    if (!this.trialsById.size) await this.index();
    const stored = this.trialsById.get(trialId);
    if (!stored) return null;

    const profileRoot = path.join(this.benchmarkRoot, stored.profileDirectory);
    const artifactPath = path.resolve(profileRoot, stored.trial.artifactPath);
    if (!artifactPath.startsWith(`${profileRoot}${path.sep}`)) return null;

    try {
      const compressed = await fs.readFile(artifactPath);
      const value = JSON.parse(
        (await gunzipAsync(compressed)).toString("utf8"),
      );
      if (stored.trial.suite === "match") {
        return {
          suite: "match",
          trial: stored.trial,
          artifact: ReplayRunArtifactSchema.parse(value),
        };
      }
      return {
        suite: "capability",
        trial: stored.trial,
        artifact: CapabilityReplayArtifactSchema.parse(value),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Ignoring unreadable benchmark replay ${trialId}`, error);
      }
      return null;
    }
  }

  private async loadIndex(): Promise<BenchmarkReplayIndex> {
    this.trialsById.clear();
    const models: BenchmarkReplayIndex["models"] = [];

    for (const profile of benchmarkProfiles) {
      const trialsRoot = path.join(
        this.benchmarkRoot,
        profile.directory,
        "trials",
      );
      let files: string[];
      try {
        files = (await fs.readdir(trialsRoot))
          .filter((file) => file.endsWith(".json"))
          .sort();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }

      const taskCounts = new Map<string, number>();
      const trials: BenchmarkReplayIndex["models"][number]["trials"] = [];
      for (const file of files) {
        const value = JSON.parse(
          await fs.readFile(path.join(trialsRoot, file), "utf8"),
        );
        const trial = BenchmarkTrialSchema.parse(value);
        if (trial.status !== "valid") continue;
        const trialNumber = (taskCounts.get(trial.taskId) ?? 0) + 1;
        taskCounts.set(trial.taskId, trialNumber);
        this.trialsById.set(trial.trialId, {
          profileDirectory: profile.directory,
          trial,
          trialNumber,
        });
        trials.push({
          trialId: trial.trialId,
          taskId: trial.taskId,
          suite: trial.suite,
          trialNumber,
        });
      }
      models.push({ id: profile.id, label: profile.label, trials });
    }

    return { models };
  }
}

export function capabilityReplaySummary(
  trial: BenchmarkTrial,
  artifact: CapabilityReplayArtifact,
) {
  return {
    runId: trial.trialId,
    scenarioId: trial.taskId,
    benchmarkTrial: true,
    status: "completed",
    startedAt: trial.startedAt,
    completedAt: trial.completedAt,
    model: artifact.agent.model,
    provider: artifact.agent.provider,
    winner: artifact.taskPass ? "Task passed" : "Task not passed",
    llmWon: false,
    finalPlacement: null,
    ticks: artifact.replay.info.num_turns,
    decisionCount: 1,
    costUsd: artifact.agent.costUsd,
    replayUrl: `/replay/${trial.trialId}`,
  };
}

export function capabilityReplayDecision(artifact: CapabilityReplayArtifact) {
  return {
    index: 0,
    tick: artifact.observation.tick,
    observation: artifact.observation,
    candidates: artifact.candidates,
    strategy: artifact.agent.decision?.strategy ?? "No model decision",
    selectedActionIds: artifact.selectedActionIds,
    appliedActionIds: artifact.appliedActionIds,
    outcomes: artifact.actionOutcomes.map(
      (outcome) => `${outcome.status}: ${outcome.detail}`,
    ),
    actionOutcomes: artifact.actionOutcomes,
    attempts: artifact.agent.attempts,
    attemptFailures: artifact.agent.attemptFailures,
    attemptTimings: artifact.agent.attemptTimings,
    fallback: artifact.agent.decision === null,
    latencyMs: artifact.agent.latencyMs,
    promptTokens: artifact.agent.promptTokens,
    completionTokens: artifact.agent.completionTokens,
    costUsd: artifact.agent.costUsd,
    model: artifact.agent.model,
    provider: artifact.agent.provider,
  };
}
