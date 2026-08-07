import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PlayerType } from "../OpenFrontIO/src/core/game/Game";
import { createGameRunner } from "../OpenFrontIO/src/core/GameRunner";
import { Intent, Turn } from "../OpenFrontIO/src/core/Schemas";
import {
  BENCHMARK_CLIENT_ID,
  BENCHMARK_MAPS,
  BENCHMARK_MATCH_TASKS,
  benchmarkTask,
  createBenchmarkStartInfo,
} from "../src/benchmark/BenchmarkConfig";
import { NodeGameMapLoader } from "../src/NodeGameMapLoader";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function argument(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv
    .find((value) => value.startsWith(prefix))
    ?.slice(prefix.length);
}

async function validateOne(taskId: string): Promise<void> {
  const task = benchmarkTask(taskId);
  const runner = await createGameRunner(
    createBenchmarkStartInfo(task, "benchmark-validator"),
    BENCHMARK_CLIENT_ID,
    new NodeGameMapLoader(
      path.join(PROJECT_ROOT, "OpenFrontIO/resources/maps"),
      BENCHMARK_MAPS,
    ),
    () => undefined,
  );
  const turns: Turn[] = [];
  const execute = (intents: Intent[] = []) => {
    const turn: Turn = {
      turnNumber: turns.length,
      intents: intents.map((intent) => ({
        ...intent,
        clientID: BENCHMARK_CLIENT_ID,
      })),
    };
    turns.push(turn);
    runner.addTurn(turn);
    if (!runner.executeNextTick())
      throw new Error("engine rejected validation turn");
  };
  const tile = runner.game.ref(task.spawn.x, task.spawn.y);
  if (!runner.game.isLand(tile))
    throw new Error(`${task.id} spawn is not land`);
  execute([{ type: "spawn", tile }]);
  for (let tick = 0; tick < 30; tick++) {
    if (
      runner.game.players().length ===
        1 + task.nationCount + task.tribeBotCount &&
      runner.game.players().every((player) => player.hasSpawned())
    )
      break;
    execute();
  }
  const player = runner.game.playerByClientID(BENCHMARK_CLIENT_ID);
  if (!player?.hasSpawned())
    throw new Error(`${task.id} player failed to spawn`);
  const nations = runner.game
    .players()
    .filter((item) => item.type() === PlayerType.Nation);
  const bots = runner.game
    .players()
    .filter((item) => item.type() === PlayerType.Bot);
  if (
    nations.length !== task.nationCount ||
    bots.length !== task.tribeBotCount
  ) {
    throw new Error(
      `${task.id} expected ${task.nationCount} nations/${task.tribeBotCount} bots, got ${nations.length}/${bots.length}`,
    );
  }
  const actual = [...nations, ...bots].map((item) => item.name()).sort();
  const expected = [...task.expectedRoster].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${task.id} roster mismatch: expected ${expected.join("; ")}; got ${actual.join("; ")}`,
    );
  }
  process.stdout.write(
    `${task.id}: land spawn and deterministic roster verified\n`,
  );
}

function runChild(taskId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", fileURLToPath(import.meta.url), `--task=${taskId}`],
      { cwd: PROJECT_ROOT, stdio: "inherit" },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${taskId} validator exited ${code}`)),
    );
  });
}

const selected = argument("task");
if (selected) {
  await validateOne(selected);
} else {
  // A process boundary prevents OpenFront's mutable map cache leaking between
  // the two tasks on each map.
  for (const task of BENCHMARK_MATCH_TASKS) await runChild(task.id);
}
