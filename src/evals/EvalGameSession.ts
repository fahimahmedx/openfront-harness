import path from "node:path";
import { fileURLToPath } from "node:url";
import { Player, PlayerType } from "../../OpenFrontIO/src/core/game/Game";
import { GameMap } from "../../OpenFrontIO/src/core/game/GameMap";
import {
  ErrorUpdate,
  GameUpdateType,
  GameUpdateViewData,
  HashUpdate,
} from "../../OpenFrontIO/src/core/game/GameUpdates";
import {
  createGameRunner,
  GameRunner,
} from "../../OpenFrontIO/src/core/GameRunner";
import { Intent, Turn } from "../../OpenFrontIO/src/core/Schemas";
import { NodeGameMapLoader } from "../NodeGameMapLoader";
import { createScenarioStartInfo, SCENARIO } from "../Scenario";

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
  private closed = false;

  private constructor(
    runner: GameRunner,
    mapSnapshots: MapSnapshot[],
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
  ): Promise<EvalGameSession> {
    const callbackState: {
      session: EvalGameSession | null;
      pendingUpdates: Array<GameUpdateViewData | ErrorUpdate>;
    } = { session: null, pendingUpdates: [] };
    const runner = await createGameRunner(
      createScenarioStartInfo(playerModelName),
      SCENARIO.clientID,
      new NodeGameMapLoader(mapsDir),
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
    this.assertOpen();
    const turn: Turn = {
      turnNumber: this.turns.length,
      intents: intents.map((intent) => ({
        ...intent,
        clientID: SCENARIO.clientID,
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
      }
    }
    for (const listener of this.listeners) listener(update);
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("Eval game session is closed");
  }
}
