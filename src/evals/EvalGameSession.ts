import path from "node:path";
import { fileURLToPath } from "node:url";
import { Player, PlayerType, Team } from "../../OpenFrontIO/src/core/game/Game";
import { GameMap } from "../../OpenFrontIO/src/core/game/GameMap";
import {
  ErrorUpdate,
  GameUpdateType,
  GameUpdateViewData,
  HashUpdate,
  WinUpdate,
} from "../../OpenFrontIO/src/core/game/GameUpdates";
import {
  createGameRunner,
  GameRunner,
} from "../../OpenFrontIO/src/core/GameRunner";
import {
  GameRecord,
  GameRecordSchema,
  GameStartInfo,
  Intent,
  Turn,
  Winner,
} from "../../OpenFrontIO/src/core/Schemas";
import { NodeGameMapLoader } from "../NodeGameMapLoader";
import {
  createScenarioStartInfo,
  OPENFRONT_COMMIT,
  SCENARIO,
} from "../Scenario";
import {
  BENCHMARK_CLIENT_ID,
  BENCHMARK_MAPS,
  BenchmarkMatchTask,
  createBenchmarkStartInfo,
} from "../benchmark/BenchmarkConfig";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

type MapSnapshot = {
  map: GameMap;
  packedTiles: Uint32Array;
};

type UpdateListener = (update: GameUpdateViewData | ErrorUpdate) => void;

function snapshotMap(map: GameMap): MapSnapshot {
  const packedTiles = new Uint32Array(map.width() * map.height());
  map.forEachTile((tile) => {
    packedTiles[tile] = map.tileState(tile) | (map.terrainByte(tile) << 16);
  });
  return { map, packedTiles };
}

function restoreMap(snapshot: MapSnapshot): void {
  snapshot.map.forEachTile((tile) => {
    snapshot.map.updateTile(tile, snapshot.packedTiles[tile]);
  });
}

function winnerValue(winner: Player | Team | null): Winner {
  if (winner === null) return undefined;
  if (typeof winner === "string") return ["team", winner];
  const clientID = winner.clientID();
  return clientID === null ? ["nation", winner.name()] : ["player", clientID];
}

/**
 * A small deterministic runner for one eval trial.
 *
 * OpenFront caches mutable map objects at module scope. Call `close()` after a
 * trial so later trials in the same process begin with the exact pre-trial map
 * state. Eval callers must still run sessions sequentially within a process.
 */
export class EvalGameSession {
  readonly runner: GameRunner;
  readonly game: GameRunner["game"];

  private readonly turns: Turn[] = [];
  private readonly listeners = new Set<UpdateListener>();
  private readonly mapSnapshots: MapSnapshot[];
  private fatalError: string | null = null;
  private latestHash: number | null = null;
  private winUpdate: WinUpdate | null = null;
  private closed = false;

  private constructor(
    runner: GameRunner,
    mapSnapshots: MapSnapshot[],
    private readonly gameStart: GameStartInfo,
    private readonly clientID: string,
    private readonly callbackState: {
      session: EvalGameSession | null;
      pendingUpdates: Array<GameUpdateViewData | ErrorUpdate>;
    },
  ) {
    this.runner = runner;
    this.game = runner.game;
    this.mapSnapshots = mapSnapshots;
  }

  static async create(
    playerModelName: string,
    mapsDir = path.join(PROJECT_ROOT, "OpenFrontIO/resources/maps"),
    benchmarkTask?: BenchmarkMatchTask,
  ): Promise<EvalGameSession> {
    const callbackState: {
      session: EvalGameSession | null;
      pendingUpdates: Array<GameUpdateViewData | ErrorUpdate>;
    } = { session: null, pendingUpdates: [] };
    const gameStart = benchmarkTask
      ? createBenchmarkStartInfo(benchmarkTask, playerModelName)
      : createScenarioStartInfo(playerModelName);
    const clientID = benchmarkTask ? BENCHMARK_CLIENT_ID : SCENARIO.clientID;
    const runner = await createGameRunner(
      gameStart,
      clientID,
      new NodeGameMapLoader(
        mapsDir,
        benchmarkTask ? BENCHMARK_MAPS : undefined,
      ),
      (update) => {
        if (callbackState.session === null) {
          callbackState.pendingUpdates.push(update);
        } else {
          callbackState.session.receiveUpdate(update);
        }
      },
    );
    const session = new EvalGameSession(
      runner,
      [snapshotMap(runner.game.map()), snapshotMap(runner.game.miniMap())],
      gameStart,
      clientID,
      callbackState,
    );
    callbackState.session = session;
    for (const update of callbackState.pendingUpdates) {
      session.receiveUpdate(update);
    }
    callbackState.pendingUpdates.length = 0;
    return session;
  }

  get turnCount(): number {
    return this.turns.length;
  }

  get lastHash(): number | null {
    return this.latestHash;
  }

  onUpdate(listener: UpdateListener): () => void {
    this.assertOpen();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  execute(intents: Intent[] = []): void {
    this.executePrepared(
      intents.map((intent) => ({ ...intent, clientID: this.clientID })),
    );
  }

  executePrepared(intents: Array<Intent & { clientID?: string }> = []): void {
    this.assertOpen();
    const turn: Turn = {
      turnNumber: this.turns.length,
      intents: intents.map((intent) => ({
        ...intent,
        clientID: intent.clientID ?? this.clientID,
      })),
    };
    this.turns.push(turn);
    this.runner.addTurn(turn);
    if (!this.runner.executeNextTick() || this.fatalError !== null) {
      throw new Error(
        this.fatalError ?? `OpenFront rejected eval turn ${turn.turnNumber}`,
      );
    }
  }

  createReplayRecord(startedAt: Date = new Date(0)): GameRecord {
    this.assertOpen();
    const simulatedSeconds = this.game.elapsedGameSeconds();
    const winner = this.game.getWinner();
    return GameRecordSchema.parse({
      info: {
        ...this.gameStart,
        players: this.gameStart.players.map((record) => ({
          ...record,
          persistentID: null,
          stats: this.game.stats().stats()[record.clientID],
        })),
        start: startedAt.getTime(),
        end: startedAt.getTime() + simulatedSeconds * 1000,
        duration: Math.floor(simulatedSeconds),
        num_turns: this.turns.length,
        winner: this.winUpdate?.winner ?? winnerValue(winner),
        lobbyFillTime: 0,
      },
      version: "v0.0.2",
      gitCommit: OPENFRONT_COMMIT,
      subdomain: "harness-eval",
      domain: "openfront-harness",
      turns: this.turns.filter(
        (turn) => turn.intents.length > 0 || turn.hash !== undefined,
      ),
    });
  }

  advance(ticks: number): void {
    if (!Number.isInteger(ticks) || ticks < 0) {
      throw new Error(
        `Eval ticks must be a non-negative integer, got ${ticks}`,
      );
    }
    for (let tick = 0; tick < ticks; tick++) this.execute();
  }

  spawnScenarioPlayer(): Player {
    const spawnTile = this.game.ref(SCENARIO.spawn.x, SCENARIO.spawn.y);
    if (!this.game.isLand(spawnTile)) {
      throw new Error("Configured Kanto eval spawn is not a land tile");
    }
    this.execute([{ type: "spawn", tile: spawnTile }]);
    for (let tick = 0; tick < 20; tick++) {
      const allSpawned =
        this.game.players().length === 4 &&
        this.game.players().every((player) => player.hasSpawned());
      if (allSpawned && !this.game.inSpawnPhase()) break;
      this.execute();
    }

    const player = this.game.playerByClientID(SCENARIO.clientID);
    if (!player?.hasSpawned()) throw new Error("Eval player did not spawn");

    const actualNations = this.game
      .players()
      .filter((candidate) => candidate.type() === PlayerType.Nation)
      .map((candidate) => candidate.name())
      .sort();
    const expectedNations = [...SCENARIO.expectedNations].sort();
    if (JSON.stringify(actualNations) !== JSON.stringify(expectedNations)) {
      throw new Error(
        `Eval scenario drift: expected ${expectedNations.join(", ")}, got ${actualNations.join(", ")}`,
      );
    }
    return player;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.listeners.clear();
    this.callbackState.session = null;
    for (const snapshot of this.mapSnapshots) restoreMap(snapshot);
  }

  private receiveUpdate(update: GameUpdateViewData | ErrorUpdate): void {
    if ("errMsg" in update) {
      this.fatalError = update.errMsg;
    } else {
      const hashes = update.updates[GameUpdateType.Hash] as HashUpdate[];
      if (hashes.length > 0) {
        this.latestHash = hashes[hashes.length - 1].hash;
        const currentTurn = this.turns[this.turns.length - 1];
        if (currentTurn && currentTurn.turnNumber % 100 === 0) {
          currentTurn.hash = this.latestHash;
        }
      }
      const wins = update.updates[GameUpdateType.Win] as WinUpdate[];
      if (wins.length > 0) this.winUpdate = wins[wins.length - 1];
    }
    for (const listener of this.listeners) listener(update);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Eval game session is closed");
  }
}
