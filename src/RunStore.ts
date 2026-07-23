import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { gunzip, gzip } from "zlib";
import { replacer } from "../OpenFrontIO/src/core/Util";
import { RunArtifact, RunArtifactSchema, RunProgress } from "./Types";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

export function artifactSummary(artifact: RunArtifact) {
  return {
    runId: artifact.runId,
    scenarioId:
      typeof artifact.scenario.id === "string"
        ? artifact.scenario.id
        : "unknown",
    status: artifact.status,
    startedAt: artifact.startedAt,
    completedAt: artifact.completedAt,
    model: artifact.model.resolved,
    provider: artifact.model.provider,
    winner: artifact.outcome.winner,
    llmWon: artifact.outcome.llmWon,
    finalPlacement: artifact.outcome.finalPlacement,
    ticks: artifact.outcome.ticks,
    decisionCount: artifact.decisions.length,
    costUsd: artifact.usage.costUsd,
    replayUrl: `/replay/${artifact.runId}`,
  };
}

export class RunStore {
  private readonly active = new Map<string, RunProgress>();

  constructor(
    readonly dataDir: string,
    private readonly sampleFile?: string,
  ) {}

  async init(): Promise<void> {
    await fs.mkdir(this.dataDir, { recursive: true });
    const files = await fs.readdir(this.dataDir);
    await Promise.all(
      files
        .filter((file) => file.endsWith(".pending.json"))
        .map(async (file) => {
          const pendingPath = path.join(this.dataDir, file);
          const interruptedPath = pendingPath.replace(
            /\.pending\.json$/,
            ".interrupted.json",
          );
          await fs.rename(pendingPath, interruptedPath).catch(() => undefined);
        }),
    );
  }

  setProgress(progress: RunProgress): void {
    this.active.set(progress.runId, progress);
  }

  getProgress(runId: string): RunProgress | undefined {
    return this.active.get(runId);
  }

  clearProgress(runId: string): void {
    this.active.delete(runId);
  }

  activeRun(): RunProgress | undefined {
    return Array.from(this.active.values()).find(
      (progress) => progress.status === "running",
    );
  }

  async savePending(progress: RunProgress): Promise<void> {
    const target = path.join(this.dataDir, `${progress.runId}.pending.json`);
    await this.atomicWrite(target, JSON.stringify(progress, null, 2));
  }

  async saveArtifact(artifact: RunArtifact): Promise<void> {
    const parsed = RunArtifactSchema.parse(artifact);
    const target = path.join(this.dataDir, `${parsed.runId}.json.gz`);
    const body = await gzipAsync(JSON.stringify(parsed, replacer));
    await this.atomicWrite(target, body);
    await fs
      .unlink(path.join(this.dataDir, `${parsed.runId}.pending.json`))
      .catch(() => undefined);
  }

  async getArtifact(runId: string): Promise<RunArtifact | null> {
    const activeFile = path.join(this.dataDir, `${runId}.json.gz`);
    const local = await this.readArtifact(activeFile);
    if (local) return local;
    if (this.sampleFile) {
      const sample = await this.readArtifact(this.sampleFile);
      if (sample?.runId === runId) return sample;
    }
    return null;
  }

  async listArtifacts(): Promise<RunArtifact[]> {
    const files = (await fs.readdir(this.dataDir))
      .filter((file) => file.endsWith(".json.gz"))
      .sort()
      .reverse();
    const artifacts = (
      await Promise.all(
        files
          .slice(0, 50)
          .map((file) => this.readArtifact(path.join(this.dataDir, file))),
      )
    ).filter((artifact): artifact is RunArtifact => artifact !== null);
    if (this.sampleFile) {
      const sample = await this.readArtifact(this.sampleFile);
      if (
        sample &&
        !artifacts.some((artifact) => artifact.runId === sample.runId)
      ) {
        artifacts.push(sample);
      }
    }
    return artifacts.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private async readArtifact(file: string): Promise<RunArtifact | null> {
    try {
      const compressed = await fs.readFile(file);
      const json = await gunzipAsync(compressed);
      return RunArtifactSchema.parse(JSON.parse(json.toString("utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn(`Ignoring unreadable run artifact ${file}`, error);
      }
      return null;
    }
  }

  private async atomicWrite(
    target: string,
    data: string | Uint8Array,
  ): Promise<void> {
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temp, data);
    await fs.rename(temp, target);
  }
}
