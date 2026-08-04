import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

const gunzipAsync = promisify(gunzip);
const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

const selections = {
  "saturated-capacity-expansion": {
    source: "data/previous/runs/e5165ff3-d610-4705-acce-76b5e7102da8.json.gz",
    decisionIndex: 9,
  },
  "weaker-target-selection": {
    source: "data/previous/runs/35fd5d95-ae47-4384-9ab2-9337b9557ace.json.gz",
    decisionIndex: 26,
  },
  "incoming-attack-response": {
    source: "data/previous/runs/35fd5d95-ae47-4384-9ab2-9337b9557ace.json.gz",
    decisionIndex: 27,
  },
  "frontier-restraint": {
    source:
      "data/previous/lifecycle-verification/fa907146-94dc-426b-b49b-a8ea6c641f19.json.gz",
    decisionIndex: 108,
  },
  "split-front-defense": {
    source: "data/glm-5.2/f7e8e361-047d-43ab-a53c-1055af01117c.json.gz",
    decisionIndex: 71,
  },
  "losing-attack-retreat": {
    source:
      "data/deepseek-v4-flash/8d43865f-2dd0-4cd8-9576-64e6ecd48a2c.json.gz",
    decisionIndex: 74,
  },
  "naval-target-recognition": {
    source: "data/gpt-5.6-luna/5c3016b7-10bf-4583-af24-b27b8de4e378.json.gz",
    decisionIndex: 54,
  },
  "construction-failure-recovery": {
    source:
      "data/previous/lifecycle-verification/fa907146-94dc-426b-b49b-a8ea6c641f19.json.gz",
    decisionIndex: 76,
  },
} as const;

type Artifact = {
  decisions: Array<Record<string, unknown> & { index: number; tick: number }>;
  replay: {
    turns: Array<{
      turnNumber: number;
      intents: Array<Record<string, unknown>>;
    }>;
  };
};

const fixtures: Record<string, unknown> = {};
for (const [familyId, selection] of Object.entries(selections)) {
  const sourcePath = path.join(PROJECT_ROOT, selection.source);
  const compressed = await readFile(sourcePath);
  const artifact = JSON.parse(
    (await gunzipAsync(compressed)).toString("utf8"),
  ) as Artifact;
  const decision = artifact.decisions.find(
    (candidate) => candidate.index === selection.decisionIndex,
  );
  if (decision === undefined) {
    throw new Error(
      `${familyId} source is missing decision ${selection.decisionIndex}`,
    );
  }
  const recentDecisions = artifact.decisions
    .filter((candidate) => candidate.tick < decision.tick)
    .slice(-3)
    .map((candidate) => ({
      tick: candidate.tick,
      strategy: candidate.strategy ?? "",
      appliedActionIds: candidate.appliedActionIds ?? ["hold:1", "hold:2"],
      outcomes: candidate.outcomes ?? [],
      actionOutcomes: candidate.actionOutcomes ?? [],
    }));
  fixtures[familyId] = {
    sourceArtifact: selection.source,
    sourceArtifactSha256: createHash("sha256").update(compressed).digest("hex"),
    sourceDecisionIndex: decision.index,
    checkpointTick: decision.tick,
    preparationTurns: artifact.replay.turns
      .filter((turn) => turn.turnNumber < decision.tick)
      .map((turn) => ({
        turnNumber: turn.turnNumber,
        intents: turn.intents.map(
          ({ clientID: _clientID, ...intent }) => intent,
        ),
      })),
    recentDecisions,
  };
}

const output = path.join(
  PROJECT_ROOT,
  "src/evals/fixtures/replay-prefixes.json",
);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(fixtures, null, 2)}\n`);
console.log(
  `Wrote ${Object.keys(fixtures).length} fixture prefixes to ${output}`,
);
