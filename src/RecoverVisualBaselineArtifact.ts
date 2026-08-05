import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import { replacer } from "../OpenFrontIO/src/core/Util";
import { SCENARIO } from "./Scenario";
import {
  continueVisualBaselineInCore,
  reconstructVisualBaselineTurns,
} from "./VisualBaselineCoreContinuation";
import {
  VisualBaselineArtifact,
  VisualBaselineArtifactSchema,
} from "./VisualBaselineTypes";
import {
  playerPlacement,
  territoryAreaUnderCurve,
} from "./VisualBaselineRunner";

const gunzipAsync = promisify(gunzip);
const gzipAsync = promisify(gzip);
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function recover(runId: string): Promise<VisualBaselineArtifact> {
  const artifactPath = path.join(
    projectRoot,
    "data/baseline",
    runId,
    "artifact.json.gz",
  );
  const source = VisualBaselineArtifactSchema.parse(
    JSON.parse((await gunzipAsync(await fs.readFile(artifactPath))).toString()),
  );
  if (source.status !== "failed" || !source.error?.includes("Timeout 300000ms")) {
    throw new Error(
      "Recovery only accepts a post-elimination five-minute timeout artifact",
    );
  }
  const turns = await reconstructVisualBaselineTurns(
    source.decisions,
    source.model.requested,
  );
  const continuation = await continueVisualBaselineInCore(
    turns,
    source.model.requested,
    new Date(source.startedAt),
  );
  const self = continuation.snapshot.players.find(
    (player) => player.clientID === SCENARIO.clientID,
  );
  const winner = continuation.winner ?? null;
  const recovered = VisualBaselineArtifactSchema.parse(
    JSON.parse(
      JSON.stringify(
        {
          ...source,
          status: "completed",
          completedAt: new Date().toISOString(),
          outcome: {
            winner,
            llmWon:
              Array.isArray(winner) &&
              winner[0] === "player" &&
              winner[1] === SCENARIO.clientID,
            finalPlacement: playerPlacement(
              continuation.snapshot.players,
              SCENARIO.clientID,
            ),
            terminalTick: continuation.snapshot.tick,
            finalTerritoryPercent:
              ((self?.tiles ?? 0) /
                Math.max(1, continuation.snapshot.landTiles)) *
              100,
            territoryAreaUnderCurve: territoryAreaUnderCurve(
              [
                ...source.decisions.map(
                  (decision) => decision.scoreOnlySnapshot,
                ),
                continuation.snapshot,
              ],
              SCENARIO.clientID,
            ),
            finalPlayers: continuation.snapshot.players,
          },
          replay: continuation.replay,
          error: undefined,
        },
        replacer,
      ),
    ),
  );
  const tempPath = `${artifactPath}.${process.pid}.tmp`;
  await fs.writeFile(
    tempPath,
    await gzipAsync(Buffer.from(JSON.stringify(recovered, replacer))),
  );
  await fs.rename(tempPath, artifactPath);
  return recovered;
}

const runId = process.argv[2];
if (!runId) throw new Error("Usage: RecoverVisualBaselineArtifact.ts <run-id>");
const artifact = await recover(runId);
console.log(
  `completed: ${artifact.runId} | winner=${JSON.stringify(artifact.outcome.winner)} | placement=${artifact.outcome.finalPlacement}`,
);
