import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { gunzipSync } from "zlib";
import { RunArtifactSchema } from "../src/Types";

describe("bundled sample", () => {
  it("is a complete, internally consistent Japan artifact", () => {
    const body = gunzipSync(
      readFileSync(path.resolve("resources/harness/sample-run.json.gz")),
    ).toString();
    const sample = RunArtifactSchema.parse(JSON.parse(body));

    expect(sample.status).toBe("sample");
    expect(sample.scenario.id).toBe("japan-v2");
    expect(sample.model.promptVersion).toBe("agent-v2");
    expect(sample.decisions.length).toBeGreaterThan(0);
    expect(sample.replay.info.num_turns).toBe(sample.outcome.ticks);
    expect(sample.outcome.finalPlacement).toBeGreaterThanOrEqual(1);
    expect(sample.outcome.finalPlacement).toBeLessThanOrEqual(4);
    expect(sample.usage.costUsd).toBeLessThanOrEqual(1);

    const legacy = RunArtifactSchema.parse({
      ...sample,
      scenario: { ...sample.scenario, id: "japan-v1" },
      model: { ...sample.model, promptVersion: "agent-v1" },
    });
    expect(legacy.model.promptVersion).toBe("agent-v1");

    const current = RunArtifactSchema.parse({
      ...sample,
      model: { ...sample.model, promptVersion: "agent-v4" },
    });
    expect(current.model.promptVersion).toBe("agent-v4");
    expect(current.decisions[0].attemptFailures).toEqual([]);
  });
});
