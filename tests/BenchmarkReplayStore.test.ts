import path from "node:path";
import { describe, expect, it } from "vitest";
import { BenchmarkReplayStore } from "../src/BenchmarkReplayStore";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("BenchmarkReplayStore", () => {
  it("indexes every verified benchmark trial and loads both replay suites", async () => {
    const store = new BenchmarkReplayStore(
      path.join(projectRoot, "data/benchmarks"),
    );
    const index = await store.index();

    expect(index.models).toHaveLength(3);
    for (const model of index.models) {
      expect(model.trials).toHaveLength(136);
      expect(
        model.trials.filter((trial) => trial.suite === "match"),
      ).toHaveLength(36);
      expect(
        model.trials.filter((trial) => trial.suite === "capability"),
      ).toHaveLength(100);
    }

    const matchTrial = index.models[0].trials.find(
      (trial) => trial.suite === "match",
    )!;
    const capabilityTrial = index.models[0].trials.find(
      (trial) => trial.suite === "capability",
    )!;

    const matchReplay = await store.getArtifact(matchTrial.trialId);
    const capabilityReplay = await store.getArtifact(capabilityTrial.trialId);

    expect(matchReplay?.suite).toBe("match");
    expect(matchReplay?.artifact.replay.info.num_turns).toBeGreaterThan(0);
    expect(capabilityReplay?.suite).toBe("capability");
    expect(capabilityReplay?.artifact.replay.info.num_turns).toBeGreaterThan(0);
  });
});
