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
    private readonly bundledFiles: string[] = [],
    private readonly artifactRoot: string = dataDir,
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
    const nestedFiles = (await this.findArtifactFiles()).filter(
      (file) =>
        file !== activeFile && path.basename(file) === `${runId}.json.gz`,
    );
    for (const file of nestedFiles) {
      const nested = await this.readArtifact(file);
      if (nested?.runId === runId) return nested;
    }
    for (const file of this.bundledFiles) {
      const bundled = await this.readArtifact(file);
      if (bundled?.runId === runId) return bundled;
    }
    return null;
  }

  async listArtifacts(): Promise<RunArtifact[]> {
    const files = await this.findArtifactFiles();
    const discovered = (
      await Promise.all(files.map((file) => this.readArtifact(file)))
    ).filter((artifact): artifact is RunArtifact => artifact !== null);
    const artifactsById = new Map<string, RunArtifact>();
    for (const artifact of discovered) {
      if (!artifactsById.has(artifact.runId)) {
        artifactsById.set(artifact.runId, artifact);
      }
    }
    for (const file of this.bundledFiles) {
      const bundled = await this.readArtifact(file);
      if (
        bundled &&
        (!artifactsById.has(bundled.runId) || bundled.status === "sample")
      ) {
        artifactsById.set(bundled.runId, bundled);
      }
    }
    const artifacts = Array.from(artifactsById.values());
    return artifacts.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  private async findArtifactFiles(): Promise<string[]> {
    const files: string[] = [];
    const directories = [this.artifactRoot];
    while (directories.length > 0) {
      const directory = directories.pop()!;
      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          directories.push(target);
        } else if (entry.isFile() && entry.name.endsWith(".json.gz")) {
          files.push(target);
        }
      }
    }
    return files.sort((a, b) => {
      const aIsPrimary = path.dirname(a) === this.dataDir;
      const bIsPrimary = path.dirname(b) === this.dataDir;
      return Number(bIsPrimary) - Number(aIsPrimary) || a.localeCompare(b);
    });
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
