import path from "node:path";
import { fileURLToPath } from "node:url";
import { Player, Team } from "../OpenFrontIO/src/core/game/Game";
import {
  GameUpdateType,
  WinUpdate,
} from "../OpenFrontIO/src/core/game/GameUpdates";
import { createGameRunner } from "../OpenFrontIO/src/core/GameRunner";
import {
  PartialGameRecord,
  IntentSchema,
  Turn,
  TurnSchema,
  Winner,
} from "../OpenFrontIO/src/core/Schemas";
import { createPartialGameRecord } from "../OpenFrontIO/src/core/Util";
import { NodeGameMapLoader } from "./NodeGameMapLoader";
import { createScenarioStartInfo, modelPlayerName, SCENARIO } from "./Scenario";
import {
  BaselinePlayerSnapshot,
  BaselineScoreSnapshot,
  VisualBaselineDecision,
} from "./VisualBaselineTypes";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export type VisualBaselineCoreContinuation = {
  snapshot: BaselineScoreSnapshot;
  winner: Winner;
  replay: PartialGameRecord;
};

export async function reconstructVisualBaselineTurns(
  decisions: Pick<VisualBaselineDecision, "tick" | "acceptedIntents">[],
  requestedModel: string,
  mapsDir = path.join(projectRoot, "OpenFrontIO/resources/maps"),
): Promise<Turn[]> {
  const lastDecision = decisions[decisions.length - 1];
  if (!lastDecision)
    throw new Error("Cannot reconstruct an empty decision stream");
  const turnCount = lastDecision.tick + SCENARIO.decisionIntervalTicks;
  const turns: Turn[] = Array.from({ length: turnCount }, (_, turnNumber) => ({
    turnNumber,
    intents: [],
  }));
  const gameStart = createScenarioStartInfo(requestedModel);
  const runner = await createGameRunner(
    gameStart,
    SCENARIO.clientID,
    new NodeGameMapLoader(mapsDir),
    () => {},
  );
  turns[0].intents.push({
    type: "spawn",
    tile: runner.game.ref(SCENARIO.spawn.x, SCENARIO.spawn.y),
    clientID: SCENARIO.clientID,
  });
  for (const decision of decisions) {
    if (decision.tick < 0 || decision.tick >= turns.length) {
      throw new Error(
        `Visual baseline decision tick ${decision.tick} is invalid`,
      );
    }
    turns[decision.tick].intents.push(
      ...decision.acceptedIntents.map((intent) => ({
        ...IntentSchema.parse(intent),
        clientID: SCENARIO.clientID,
      })),
    );
  }
  return turns;
}

function winnerValue(winner: Player | Team | null): Winner {
  if (winner === null) return undefined;
  if (typeof winner === "string") return ["team", winner];
  const clientID = winner.clientID();
  return clientID === null ? ["nation", winner.name()] : ["player", clientID];
}

/**
 * Replays the exact turns emitted by the stock browser client, then advances
 * empty turns through the same pinned core until OpenFront declares a winner.
 */
export async function continueVisualBaselineInCore(
  captured: unknown[],
  requestedModel: string,
  startedAt: Date,
  mapsDir = path.join(projectRoot, "OpenFrontIO/resources/maps"),
  allowAliveAtDecisionCeiling = false,
): Promise<VisualBaselineCoreContinuation> {
  const capturedTurns = captured.map((turn) => TurnSchema.parse(turn));
  capturedTurns.forEach((turn, index) => {
    if (turn.turnNumber !== index) {
      throw new Error(
        `Visual baseline turn stream is not contiguous at ${index} (received ${turn.turnNumber})`,
      );
    }
  });

  const gameStart = createScenarioStartInfo(requestedModel);
  let fatalError: string | undefined;
  let winUpdate: WinUpdate | undefined;
  const runner = await createGameRunner(
    gameStart,
    SCENARIO.clientID,
    new NodeGameMapLoader(mapsDir),
    (update) => {
      if ("errMsg" in update) {
        fatalError = update.errMsg;
        return;
      }
      const wins = update.updates[GameUpdateType.Win] as WinUpdate[];
      if (wins.length > 0) winUpdate = wins[wins.length - 1];
    },
  );
  const game = runner.game;
  const allTurns: Turn[] = [];
  const previouslyAlive = new Map<string, boolean>();
  const eliminatedAt = new Map<string, number>();

  const execute = (turn: Turn) => {
    allTurns.push(turn);
    runner.addTurn(turn);
    if (!runner.executeNextTick() || fatalError) {
      throw new Error(
        fatalError ?? `Core rejected visual baseline turn ${turn.turnNumber}`,
      );
    }
    for (const player of game.allPlayers()) {
      if (
        previouslyAlive.get(player.id()) === true &&
        !player.isAlive() &&
        !eliminatedAt.has(player.id())
      ) {
        eliminatedAt.set(player.id(), game.ticks());
      }
      previouslyAlive.set(player.id(), player.isAlive());
    }
  };

  for (const turn of capturedTurns) execute(turn);

  const handoffPlayer = game.playerByClientID(SCENARIO.clientID);
  if (
    handoffPlayer?.isAlive() !== false &&
    !(
      allowAliveAtDecisionCeiling &&
      game.ticks() >= SCENARIO.maxDecisionCount * SCENARIO.decisionIntervalTicks
    )
  ) {
    throw new Error(
      "Visual baseline core handoff requires elimination or the final decision ceiling",
    );
  }

  const terminalTurnLimit =
    SCENARIO.maxDecisionCount * SCENARIO.decisionIntervalTicks + 20;
  while (game.ticks() < terminalTurnLimit && game.getWinner() === null) {
    execute({ turnNumber: allTurns.length, intents: [] });
  }
  const winner = game.getWinner();
  if (winner === null) {
    throw new Error(
      `OpenFront did not declare a winner by tick ${game.ticks()} during visual baseline continuation`,
    );
  }

  const players: BaselinePlayerSnapshot[] = game.allPlayers().map((player) => ({
    id: player.id(),
    clientID: player.clientID(),
    name: player.name(),
    alive: player.isAlive(),
    tiles: player.numTilesOwned(),
    troops: player.troops(),
    gold: Number(player.gold()),
    ...(eliminatedAt.has(player.id())
      ? { eliminatedAt: eliminatedAt.get(player.id()) }
      : {}),
  }));
  const winnerRecord = winUpdate?.winner ?? winnerValue(winner);
  const simulatedSeconds = game.elapsedGameSeconds();
  const replay = createPartialGameRecord(
    gameStart.gameID,
    gameStart.config,
    gameStart.players.map((player) => ({
      ...player,
      persistentID: null,
      username: modelPlayerName(requestedModel),
      stats: game.stats().stats()[player.clientID],
    })),
    allTurns,
    startedAt.getTime(),
    startedAt.getTime() + simulatedSeconds * 1_000,
    winnerRecord,
    gameStart.lobbyCreatedAt,
  );

  return {
    snapshot: {
      tick: game.ticks(),
      landTiles: game.numLandTiles(),
      players,
    },
    winner: winnerRecord,
    replay,
  };
}
