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
    const rawSample = JSON.parse(body);
    const sample = RunArtifactSchema.parse(rawSample);

    expect(sample.status).toBe("sample");
    expect(sample.scenario.id).toBe("japan-v2");
    expect(sample.model.promptVersion).toBe("agent-v2");
    expect(sample.decisions.length).toBeGreaterThan(0);
    expect(sample.replay.info.num_turns).toBe(sample.outcome.ticks);
    expect(sample.outcome.finalPlacement).toBeGreaterThanOrEqual(1);
    expect(sample.outcome.finalPlacement).toBeLessThanOrEqual(4);
    expect(sample.usage.costUsd).toBeLessThanOrEqual(1);
    expect(sample.decisions[0].observation).toHaveProperty(
      "instantVictoryTerritoryPercent",
      80,
    );
    expect(sample.decisions[0].observation).not.toHaveProperty("winPercent");
    expect(sample.decisions[0].observation).toMatchObject({
      isTerritoryLeader: expect.any(Boolean),
      territoryLeadPercent: expect.any(Number),
      territoryDeficitPercent: expect.any(Number),
    });
    expect(sample.decisions[0].observation).not.toHaveProperty(
      "territoryGapToLeader",
    );
    expect(sample.decisions[0].actionOutcomes).toHaveLength(2);
    expect(sample.decisions[0].actionOutcomes[0].status).toMatch(
      /completed|unknown/,
    );

    const legacy = RunArtifactSchema.parse({
      ...sample,
      scenario: { ...sample.scenario, id: "japan-v1" },
      model: { ...sample.model, promptVersion: "agent-v1" },
    });
    expect(legacy.model.promptVersion).toBe("agent-v1");

    const current = RunArtifactSchema.parse({
      ...sample,
      schemaVersion: 2,
      model: { ...sample.model, promptVersion: "agent-v10" },
    });
    expect(current.model.promptVersion).toBe("agent-v10");
    expect(current.decisions[0].attemptFailures).toEqual([]);
    expect(current.decisions[0].attemptTimings).toEqual([]);
  });
});
