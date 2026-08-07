import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { Player, Team } from "../OpenFrontIO/src/core/game/Game";
import {
  GameUpdateType,
  HashUpdate,
  WinUpdate,
} from "../OpenFrontIO/src/core/game/GameUpdates";
import { createGameRunner } from "../OpenFrontIO/src/core/GameRunner";
import {
  GameRecord,
  GameRecordSchema,
  Intent,
  Turn,
  Winner,
} from "../OpenFrontIO/src/core/Schemas";
import { replacer } from "../OpenFrontIO/src/core/Util";
import {
  actionOutcomes,
  beginActionTracking,
  hasUnresolvedActions,
  observeActionUpdates,
  TrackedAction,
  updateActionTracking,
} from "./ActionLifecycle";
import { NodeGameMapLoader } from "./NodeGameMapLoader";
import {
  createLegalActions,
  createObservation,
  resolveDecisionAction,
} from "./ObservationActions";
import { OpenRouterAgent } from "./OpenRouterAgent";
import { RunStore } from "./RunStore";
import {
  createScenarioStartInfo,
  OPENFRONT_COMMIT,
  publicScenario,
  SCENARIO,
} from "./Scenario";
import {
  BENCHMARK_CLIENT_ID,
  BENCHMARK_LIMITS,
  BENCHMARK_MAPS,
  BenchmarkMatchTask,
  createBenchmarkStartInfo,
  publicBenchmarkTask,
} from "./benchmark/BenchmarkConfig";
import { matchPoints } from "./benchmark/BenchmarkStatistics";
import {
  AgentResult,
  DecisionRecord,
  RunArtifact,
  RunArtifactSchema,
  RunProgress,
} from "./Types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");

export interface AgentPolicy {
  requestedModel: string;
  provider?: string;
  promptVersion?: string;
  estimateNextCost(
    observation: ReturnType<typeof createObservation>,
    candidates: ReturnType<typeof createLegalActions>,
  ): Promise<number>;
  decide(
    observation: ReturnType<typeof createObservation>,
    candidates: ReturnType<typeof createLegalActions>,
  ): Promise<AgentResult>;
}

function winnerValue(winner: Player | Team | null): Winner {
  if (winner === null) return undefined;
  if (typeof winner === "string") return ["team", winner];
  const clientID = winner.clientID();
  return clientID === null ? ["nation", winner.name()] : ["player", clientID];
}

function winnerLabel(winner: Player | Team | null): string {
  if (winner === null) return "No winner";
  return typeof winner === "string" ? winner : winner.name();
}

export type PlacementEntry = {
  id: string;
  alive: boolean;
  tiles: number;
  eliminatedAt?: number;
};

export function calculateFinalPlacement(
  entries: PlacementEntry[],
  playerId: string,
  winnerId?: string,
): number {
  const ranked = entries
    .map((entry, order) => ({ entry, order }))
    .sort((left, right) => {
      if (left.entry.id === winnerId) return -1;
      if (right.entry.id === winnerId) return 1;
      if (left.entry.alive !== right.entry.alive) {
        return left.entry.alive ? -1 : 1;
      }
      if (left.entry.alive) {
        return right.entry.tiles - left.entry.tiles || left.order - right.order;
      }
      return (
        (right.entry.eliminatedAt ?? -1) - (left.entry.eliminatedAt ?? -1) ||
        right.entry.tiles - left.entry.tiles ||
        left.order - right.order
      );
    });
  const index = ranked.findIndex(({ entry }) => entry.id === playerId);
  return index < 0 ? entries.length : index + 1;
}

export class HarnessRunner {
  constructor(
    private readonly store: RunStore,
    private readonly agent: AgentPolicy,
    private readonly mapsDir = path.join(
      PROJECT_ROOT,
      "OpenFrontIO/resources/maps",
    ),
    private readonly benchmarkTask?: BenchmarkMatchTask,
  ) {}

  static fromEnvironment(store: RunStore): HarnessRunner {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey)
      throw new Error("OPENROUTER_API_KEY is required to run matches");
    return new HarnessRunner(store, new OpenRouterAgent(apiKey));
  }

  static benchmarkFromEnvironment(
    store: RunStore,
    task: BenchmarkMatchTask,
  ): HarnessRunner {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey)
      throw new Error("OPENROUTER_API_KEY is required to run matches");
    return new HarnessRunner(
      store,
      new OpenRouterAgent(apiKey),
      path.join(PROJECT_ROOT, "OpenFrontIO/resources/maps"),
      task,
    );
  }

  async run(runId: string = randomUUID()): Promise<RunArtifact> {
    const limits = this.benchmarkTask ? BENCHMARK_LIMITS : SCENARIO;
    const clientID = this.benchmarkTask
      ? BENCHMARK_CLIENT_ID
      : SCENARIO.clientID;
    const startedAt = new Date();
    let progress: RunProgress = {
      runId,
      status: "running",
      startedAt: startedAt.toISOString(),
      tick: 0,
      decisionCount: 0,
      maxDecisionCount: limits.maxDecisionCount,
      latestStrategy: this.benchmarkTask
        ? `Loading ${this.benchmarkTask.map} and initializing the field…`
        : "Loading Japan and initializing the four players…",
      costUsd: 0,
    };
    this.store.setProgress(progress);
    await this.store.savePending(progress);

    const gameStart = this.benchmarkTask
      ? createBenchmarkStartInfo(this.benchmarkTask, this.agent.requestedModel)
      : createScenarioStartInfo(this.agent.requestedModel);
    const turns: Turn[] = [];
    const decisions: DecisionRecord[] = [];
    let lastHash: number | null = null;
    let winUpdate: WinUpdate | undefined;
    let fatalError: string | undefined;
    let currentTurn: Turn | undefined;
    let trackEliminations = false;
    const eliminatedAt = new Map<string, number>();
    const openActionLifecycles: Array<{
      trackers: TrackedAction[];
      record: DecisionRecord;
    }> = [];
    const lifecycleGroups = new Set<TrackedAction[]>();
    const runner = await createGameRunner(
      gameStart,
      clientID,
      new NodeGameMapLoader(
        this.mapsDir,
        this.benchmarkTask ? BENCHMARK_MAPS : undefined,
      ),
      (update) => {
        if ("errMsg" in update) {
          fatalError = update.errMsg;
          if (update.stack) console.error(update.stack);
          return;
        }
        for (const trackers of lifecycleGroups) {
          observeActionUpdates(trackers, update);
        }
        const hashes = update.updates[GameUpdateType.Hash] as HashUpdate[];
        if (hashes.length > 0) {
          lastHash = hashes[hashes.length - 1].hash;
          if (currentTurn && currentTurn.turnNumber % 100 === 0) {
            currentTurn.hash = lastHash;
          }
        }
        const wins = update.updates[GameUpdateType.Win] as WinUpdate[];
        if (wins.length > 0) winUpdate = wins[0];
      },
    );
    const game = runner.game;

    const executeTurn = (intents: Intent[] = []): void => {
      const turn: Turn = {
        turnNumber: turns.length,
        intents: intents.map((intent) => ({
          ...intent,
          clientID,
        })),
      };
      turns.push(turn);
      currentTurn = turn;
      runner.addTurn(turn);
      if (!runner.executeNextTick() || fatalError) {
        throw new Error(fatalError ?? `Core rejected turn ${turn.turnNumber}`);
      }
      if (trackEliminations) {
        for (const candidate of game.allPlayers()) {
          if (!candidate.isAlive() && !eliminatedAt.has(candidate.id())) {
            eliminatedAt.set(candidate.id(), game.ticks());
          }
        }
      }
    };

    let terminationReason = "maximum decisions reached";
    try {
      const spawn = this.benchmarkTask?.spawn ?? SCENARIO.spawn;
      const spawnTile = game.ref(spawn.x, spawn.y);
      if (!game.isLand(spawnTile)) {
        throw new Error("Configured Kanto spawn is not a land tile");
      }
      executeTurn([{ type: "spawn", tile: spawnTile }]);
      for (let i = 0; i < 20; i++) {
        const allSpawned =
          game.players().length ===
            (this.benchmarkTask
              ? 1 +
                this.benchmarkTask.nationCount +
                this.benchmarkTask.tribeBotCount
              : 4) && game.players().every((player) => player.hasSpawned());
        if (allSpawned && !game.inSpawnPhase()) break;
        executeTurn();
      }

      const player = game.playerByClientID(clientID);
      if (!player?.hasSpawned()) throw new Error("LLM player did not spawn");
      trackEliminations = true;
      const rosterNames = game
        .players()
        .filter((candidate) => candidate.clientID() === null)
        .map((candidate) => candidate.name())
        .sort();
      const expected = [
        ...(this.benchmarkTask?.expectedRoster ?? SCENARIO.expectedNations),
      ].sort();
      if (JSON.stringify(rosterNames) !== JSON.stringify(expected)) {
        throw new Error(
          `Scenario drift: expected roster ${expected.join(", ")}, got ${rosterNames.join(", ")}`,
        );
      }

      let consecutiveFailures = 0;
      for (
        let decisionIndex = 0;
        decisionIndex < limits.maxDecisionCount &&
        game.getWinner() === null &&
        player.isAlive();
        decisionIndex++
      ) {
        if (Date.now() - startedAt.getTime() > limits.maxWallClockMs) {
          terminationReason = "wall-clock safety limit";
          break;
        }
        const observation = createObservation(
          game,
          player,
          decisionIndex,
          decisions,
        );
        const candidates = createLegalActions(game, player, {
          safeBuildAnchors: true,
        });
        const estimate = await this.agent.estimateNextCost(
          observation,
          candidates,
        );
        const spent = decisions.reduce(
          (sum, record) => sum + record.costUsd,
          0,
        );
        const maxCost = this.benchmarkTask
          ? BENCHMARK_LIMITS.maxMatchCostUsd
          : SCENARIO.maxRunCostUsd;
        if (spent + estimate > maxCost) {
          terminationReason = "model cost limit";
          break;
        }

        const agentResult = await this.agent.decide(observation, candidates);
        const selectedId = agentResult.decision?.action ?? "hold";
        const resolved = resolveDecisionAction(selectedId, candidates);
        const completeFailure = agentResult.decision === null;
        consecutiveFailures = completeFailure ? consecutiveFailures + 1 : 0;
        const strategy = completeFailure
          ? `Decision failed; holding. ${agentResult.error ?? ""}`
              .trim()
              .slice(0, 160)
          : agentResult.decision!.strategy;
        const appliedIntents = [resolved.action]
          .map((candidate) => candidate.intent)
          .filter((intent): intent is Intent => intent !== null);
        const lifecycle = beginActionTracking(game, player, [resolved.action]);
        lifecycleGroups.add(lifecycle);
        executeTurn(appliedIntents);
        updateActionTracking(lifecycle, game, game.ticks());
        for (const tracked of openActionLifecycles) {
          updateActionTracking(tracked.trackers, game, game.ticks());
        }
        for (
          let tick = 1;
          tick < limits.decisionIntervalTicks && game.getWinner() === null;
          tick++
        ) {
          executeTurn();
          updateActionTracking(lifecycle, game, game.ticks());
          for (const tracked of openActionLifecycles) {
            updateActionTracking(tracked.trackers, game, game.ticks());
          }
        }

        for (let index = openActionLifecycles.length - 1; index >= 0; index--) {
          const tracked = openActionLifecycles[index];
          const updated = actionOutcomes(tracked.trackers, game, game.ticks());
          tracked.record.actionOutcomes = updated;
          tracked.record.outcomes = updated.map(
            (item) => `${item.status}: ${item.detail}`,
          ) as [string];
          if (!hasUnresolvedActions(tracked.trackers)) {
            lifecycleGroups.delete(tracked.trackers);
            openActionLifecycles.splice(index, 1);
          }
        }

        const trackedOutcomes = actionOutcomes(lifecycle, game, game.ticks());
        const record: DecisionRecord = {
          index: decisionIndex,
          tick: observation.tick,
          observation,
          candidates,
          strategy,
          selectedActionIds: [selectedId],
          appliedActionIds: [resolved.action.id],
          outcomes: trackedOutcomes.map(
            (item) => `${item.status}: ${item.detail}`,
          ) as [string],
          actionOutcomes: trackedOutcomes as [(typeof trackedOutcomes)[number]],
          attempts: agentResult.attempts,
          attemptFailures: agentResult.attemptFailures,
          attemptTimings: agentResult.attemptTimings,
          fallback: completeFailure || resolved.fallback,
          latencyMs: agentResult.latencyMs,
          promptTokens: agentResult.promptTokens,
          completionTokens: agentResult.completionTokens,
          costUsd: agentResult.costUsd,
          model: agentResult.model,
          provider: agentResult.provider,
        };
        decisions.push(record);
        if (hasUnresolvedActions(lifecycle)) {
          openActionLifecycles.push({ trackers: lifecycle, record });
        } else {
          lifecycleGroups.delete(lifecycle);
        }
        progress = {
          ...progress,
          tick: game.ticks(),
          decisionCount: decisions.length,
          latestStrategy: strategy,
          costUsd: decisions.reduce((sum, item) => sum + item.costUsd, 0),
        };
        this.store.setProgress(progress);
        await this.store.savePending(progress);

        if (consecutiveFailures >= limits.maxConsecutiveDecisionFailures) {
          terminationReason = "five consecutive model decision failures";
          break;
        }
      }
      // Once the LLM has been eliminated, there are no meaningful actions to
      // request. Advance the deterministic simulation without spending more
      // model tokens so the replay still reaches OpenFront's declared winner.
      if (!player.isAlive() && game.getWinner() === null) {
        while (
          game.ticks() <
            limits.maxDecisionCount * limits.decisionIntervalTicks + 20 &&
          game.getWinner() === null
        ) {
          executeTurn();
          for (const tracked of openActionLifecycles) {
            updateActionTracking(tracked.trackers, game, game.ticks());
          }
        }
      }
      // The OpenFront winner check runs every ten ticks. If the final fixed
      // decision interval lands between checks, advance only to the next check
      // so maxTimerValue can produce the required deterministic winner without
      // asking the model for a 121st decision.
      if (
        game.getWinner() === null &&
        decisions.length === limits.maxDecisionCount
      ) {
        for (let tick = 0; tick < 20 && game.getWinner() === null; tick++) {
          executeTurn();
          for (const tracked of openActionLifecycles) {
            updateActionTracking(tracked.trackers, game, game.ticks());
          }
        }
      }
      if (game.getWinner() !== null)
        terminationReason = "OpenFront declared a winner";
    } catch (error) {
      terminationReason =
        error instanceof Error ? error.message : String(error);
      fatalError = terminationReason;
    }

    for (const tracked of openActionLifecycles) {
      const updated = actionOutcomes(tracked.trackers, game, game.ticks());
      tracked.record.actionOutcomes = updated;
      tracked.record.outcomes = updated.map(
        (item) => `${item.status}: ${item.detail}`,
      );
    }

    const completedAt = new Date();
    const winner = game.getWinner();
    const human = game.playerByClientID(clientID);
    const finalPlacement =
      human === null
        ? game.allPlayers().length
        : calculateFinalPlacement(
            game.allPlayers().map((candidate) => ({
              id: candidate.id(),
              alive: candidate.isAlive(),
              tiles: candidate.numTilesOwned(),
              eliminatedAt: eliminatedAt.get(candidate.id()),
            })),
            human.id(),
            typeof winner === "string" || winner === null
              ? undefined
              : winner.id(),
          );
    const status =
      !fatalError && (winner !== null || this.benchmarkTask !== undefined)
        ? "completed"
        : "failed";
    const usage = decisions.reduce(
      (total, record) => ({
        promptTokens: total.promptTokens + record.promptTokens,
        completionTokens: total.completionTokens + record.completionTokens,
        costUsd: total.costUsd + record.costUsd,
      }),
      { promptTokens: 0, completionTokens: 0, costUsd: 0 },
    );
    const sparseTurns = turns.filter(
      (turn) => turn.intents.length > 0 || turn.hash !== undefined,
    );
    const simulatedSeconds = game.elapsedGameSeconds();
    const fieldSize = game.allPlayers().length;
    const totalTiles = game
      .allPlayers()
      .reduce((sum, candidate) => sum + candidate.numTilesOwned(), 0);
    const totalTroops = game
      .allPlayers()
      .reduce((sum, candidate) => sum + candidate.troops(), 0);
    const replay: GameRecord = GameRecordSchema.parse({
      info: {
        ...gameStart,
        players: gameStart.players.map((record) => ({
          ...record,
          persistentID: null,
          stats: game.stats().stats()[record.clientID],
        })),
        start: startedAt.getTime(),
        end: startedAt.getTime() + simulatedSeconds * 1000,
        duration: Math.floor(simulatedSeconds),
        num_turns: turns.length,
        winner: winUpdate?.winner ?? winnerValue(winner),
        lobbyFillTime: 0,
      },
      version: "v0.0.2",
      gitCommit: OPENFRONT_COMMIT,
      subdomain: "harness",
      domain: "openfront-harness",
      turns: sparseTurns,
    });
    const artifact = RunArtifactSchema.parse(
      JSON.parse(
        JSON.stringify(
          {
            schemaVersion: 3,
            runId,
            status,
            scenario: this.benchmarkTask
              ? publicBenchmarkTask(
                  this.benchmarkTask,
                  this.agent.requestedModel,
                )
              : publicScenario(this.agent.requestedModel),
            model: {
              requested: this.agent.requestedModel,
              resolved:
                decisions[decisions.length - 1]?.model ??
                this.agent.requestedModel,
              provider:
                decisions[decisions.length - 1]?.provider ??
                this.agent.provider ??
                null,
              promptVersion:
                this.agent.promptVersion ?? OpenRouterAgent.promptVersion(),
              reasoningEffort: OpenRouterAgent.reasoningEffort(),
            },
            startedAt: startedAt.toISOString(),
            completedAt: completedAt.toISOString(),
            usage,
            outcome: {
              winner: winnerLabel(winner),
              llmWon: winner === human,
              ticks: game.ticks(),
              simulatedSeconds,
              finalHash: lastHash,
              finalPlacement,
              terminationReason,
              ...(this.benchmarkTask && human
                ? {
                    fieldSize,
                    survived: human.isAlive(),
                    finalLandShare:
                      totalTiles === 0 ? 0 : human.numTilesOwned() / totalTiles,
                    finalTroopShare:
                      totalTroops === 0 ? 0 : human.troops() / totalTroops,
                    matchPoints: matchPoints(fieldSize, finalPlacement),
                  }
                : {}),
            },
            decisions,
            replay,
          },
          replacer,
        ),
      ),
    );
    await this.store.saveArtifact(artifact);
    this.store.clearProgress(runId);
    return artifact;
  }
}
