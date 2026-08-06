import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { Intent } from "../OpenFrontIO/src/core/Schemas";
import {
  createLegalActions,
  createObservation,
} from "../src/ObservationActions";
import { benchmarkTask } from "../src/benchmark/BenchmarkConfig";
import { EvalGameSession } from "../src/evals/EvalGameSession";

const taskId = process.argv[2];
const source = process.argv[3];
if (!taskId || !source) {
  throw new Error(
    "Usage: tsx scripts/ScanBenchmarkSource.ts match-XX artifact.json.gz",
  );
}
const artifact = JSON.parse(
  (await promisify(gunzip)(await readFile(source))).toString("utf8"),
) as {
  replay: {
    info: { num_turns: number };
    turns: Array<{ turnNumber: number; intents: Intent[] }>;
  };
  decisions?: Array<{
    observation?: { opponents?: Array<{ id?: string; name?: string }> };
  }>;
  model?: { requested?: string };
};
const fromTick = Number(
  process.argv.find((value) => value.startsWith("--from="))?.slice(7) ?? 0,
);
const toTick = Number(
  process.argv.find((value) => value.startsWith("--to="))?.slice(5) ??
    artifact.replay.info.num_turns,
);
const turns = new Map(
  artifact.replay.turns.map((turn) => [turn.turnNumber, turn.intents]),
);
const sourceIdToName = new Map<string, string>();
for (const decision of artifact.decisions ?? []) {
  for (const opponent of decision.observation?.opponents ?? []) {
    if (opponent.id && opponent.name)
      sourceIdToName.set(opponent.id, opponent.name);
  }
}
const session = await EvalGameSession.create(
  artifact.model?.requested ?? "openai/gpt-5.6-luna",
  path.resolve("OpenFrontIO/resources/maps"),
  benchmarkTask(taskId),
);
try {
  for (
    let tick = 0;
    tick < Math.min(artifact.replay.info.num_turns, toTick + 1);
    tick++
  ) {
    const player = session.game.playerByClientID("LLMAGENT");
    if (player?.hasSpawned() && player.isAlive()) {
      const maximum = session.game.config().maxTroops(player);
      const capacity = maximum === 0 ? 0 : (player.troops() / maximum) * 100;
      const incoming = player.incomingAttacks();
      const outgoing = player.outgoingAttacks();
      const neutralOutgoing = outgoing.filter(
        (attack) => !attack.target().isPlayer(),
      );
      const losing = outgoing.filter((attack) => {
        const target = attack.target();
        return target.isPlayer() && attack.troops() <= 0.25 * target.troops();
      });
      const shouldInspect =
        (process.argv.includes("--all") &&
          tick >= fromTick &&
          tick <= toTick) ||
        tick % 100 === 3 ||
        incoming.length >= 2 ||
        (neutralOutgoing.length > 0 && capacity <= 20) ||
        losing.length > 0;
      if (shouldInspect) {
        const observation = createObservation(session.game, player, 0, []);
        const candidates = createLegalActions(session.game, player, {
          safeBuildAnchors: true,
        });
        const attackTargets = new Set(
          candidates
            .filter((candidate) => candidate.id.startsWith("attack:"))
            .map((candidate) => candidate.id.split(":")[1]),
        );
        const counterTargets = new Set(
          candidates
            .filter((candidate) => candidate.id.startsWith("counter:"))
            .map((candidate) => candidate.id.split(":")[1]),
        );
        const bordered = (
          observation.opponents as Array<Record<string, unknown>>
        )
          .filter((opponent) => opponent.sharedBorder === true)
          .map((opponent) => ({
            id: opponent.id,
            name: opponent.name,
            ratio: opponent.troopsRelativeToSelf,
          }));
        const interesting =
          incoming.length >= 2 ||
          (neutralOutgoing.length > 0 && capacity <= 20) ||
          losing.length > 0 ||
          (attackTargets.size === 1 && capacity >= 55 && capacity <= 70) ||
          attackTargets.size === 2 ||
          (bordered.some(
            (item) => typeof item.ratio === "number" && item.ratio <= 0.4,
          ) &&
            bordered.some(
              (item) =>
                typeof item.ratio === "number" &&
                item.ratio >= 0.8 &&
                item.ratio <= 0.99,
            )) ||
          (candidates.some((item) => item.category === "boat") &&
            bordered.length === 0);
        if (
          interesting ||
          (process.argv.includes("--all") && tick === fromTick)
        ) {
          process.stdout.write(
            `${JSON.stringify({
              tick,
              capacity: Number(capacity.toFixed(2)),
              tiles: player.numTilesOwned(),
              incoming: incoming.map((attack) => ({
                from: attack.attacker().name(),
                troops: Math.floor(attack.troops()),
              })),
              outgoing: outgoing.map((attack) => ({
                target: attack.target().isPlayer()
                  ? attack.target().name()
                  : "neutral",
                troops: Math.floor(attack.troops()),
              })),
              losing: losing.length,
              attackTargets: [...attackTargets],
              counterTargets: [...counterTargets],
              counters: candidates.filter((item) =>
                item.id.startsWith("counter:"),
              ).length,
              bordered,
              boats: candidates.filter((item) => item.category === "boat")
                .length,
              defensePosts: candidates.filter((item) =>
                item.id.startsWith("build:Defense Post:"),
              ).length,
            })}\n`,
          );
        }
      }
    }
    try {
      const currentIdByName = new Map(
        session.game.players().map((item) => [item.name(), item.id()]),
      );
      const remapped = (turns.get(tick) ?? []).map((intent) => {
        const copy = { ...intent } as Intent & {
          clientID?: string;
          targetID?: string | null;
          recipient?: string;
        };
        if (copy.targetID && sourceIdToName.has(copy.targetID)) {
          copy.targetID = currentIdByName.get(
            sourceIdToName.get(copy.targetID)!,
          )!;
        }
        if (copy.recipient && sourceIdToName.has(copy.recipient)) {
          copy.recipient = currentIdByName.get(
            sourceIdToName.get(copy.recipient)!,
          )!;
        }
        return copy;
      });
      if (tick === 3 && process.argv.includes("--debug-players")) {
        process.stderr.write(
          `${JSON.stringify({ players: [...currentIdByName], remapped })}\n`,
        );
      }
      session.execute(
        remapped.map(({ clientID: _clientID, ...intent }) => intent as Intent),
      );
    } catch (error) {
      throw new Error(
        `Replay failed at tick ${tick}: ${JSON.stringify(turns.get(tick) ?? [])}`,
        { cause: error },
      );
    }
  }
} finally {
  session.close();
}
