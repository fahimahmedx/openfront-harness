import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentPolicy, HarnessRunner } from "../src/HarnessRunner";
import { RunStore } from "../src/RunStore";
import { benchmarkTask } from "../src/benchmark/BenchmarkConfig";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

describe("benchmark match runner", () => {
  test("runs a non-Japan task and counts provider failures as a valid outcome", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "openfront-benchmark-test-"),
    );
    temporaryDirectories.push(directory);
    const store = new RunStore(directory);
    await store.init();
    const agent: AgentPolicy = {
      requestedModel: "test/failing-agent",
      provider: "test",
      promptVersion: "agent-v13",
      async estimateNextCost() {
        return 0;
      },
      async decide() {
        return {
          decision: null,
          attempts: 2,
          attemptFailures: [
            {
              attempt: 1 as const,
              code: "request_error" as const,
              message: "simulated provider failure",
              rejectedActionIds: [],
            },
          ],
          attemptTimings: [],
          latencyMs: 1,
          promptTokens: 0,
          completionTokens: 0,
          costUsd: 0,
          model: "test/failing-agent",
          provider: "test",
          error: "simulated provider failure",
        };
      },
    };
    const artifact = await new HarnessRunner(
      store,
      agent,
      path.resolve("OpenFrontIO/resources/maps"),
      benchmarkTask("match-03"),
    ).run();

    expect(artifact.status).toBe("completed");
    expect(artifact.decisions).toHaveLength(5);
    expect(artifact.outcome.terminationReason).toBe(
      "five consecutive model decision failures",
    );
    expect(artifact.outcome.fieldSize).toBe(6);
    expect(artifact.outcome.matchPoints).toBeGreaterThanOrEqual(0);
    expect(artifact.outcome.matchPoints).toBeLessThanOrEqual(100);
  }, 30_000);
});
