import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { Player, PlayerType, Team } from "../OpenFrontIO/src/core/game/Game";
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
import { NodeGameMapLoader } from "./NodeGameMapLoader";
import {
  createLegalActions,
  createObservation,
  resolveDecisionActions,
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

export class HarnessRunner {
  constructor(
    private readonly store: RunStore,
    private readonly agent: AgentPolicy,
    private readonly mapsDir = path.join(
      PROJECT_ROOT,
      "OpenFrontIO/resources/maps",
    ),
  ) {}

  static fromEnvironment(store: RunStore): HarnessRunner {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey)
      throw new Error("OPENROUTER_API_KEY is required to run matches");
    return new HarnessRunner(store, new OpenRouterAgent(apiKey));
  }

  async run(runId: string = randomUUID()): Promise<RunArtifact> {
    const startedAt = new Date();
    let progress: RunProgress = {
      runId,
      status: "running",
      startedAt: startedAt.toISOString(),
      tick: 0,
      decisionCount: 0,
      maxDecisionCount: SCENARIO.maxDecisionCount,
      latestStrategy: "Loading Japan and initializing the four players…",
      costUsd: 0,
    };
    this.store.setProgress(progress);
    await this.store.savePending(progress);

    const gameStart = createScenarioStartInfo();
    const turns: Turn[] = [];
    const decisions: DecisionRecord[] = [];
    let lastHash: number | null = null;
    let winUpdate: WinUpdate | undefined;
    let fatalError: string | undefined;
    let currentTurn: Turn | undefined;
    let trackEliminations = false;
    const eliminatedAt = new Map<string, number>();
    const runner = await createGameRunner(
      gameStart,
      SCENARIO.clientID,
      new NodeGameMapLoader(this.mapsDir),
      (update) => {
        if ("errMsg" in update) {
          fatalError = update.errMsg;
          if (update.stack) console.error(update.stack);
          return;
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
          clientID: SCENARIO.clientID,
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
      const spawnTile = game.ref(SCENARIO.spawn.x, SCENARIO.spawn.y);
      if (!game.isLand(spawnTile)) {
        throw new Error("Configured Kanto spawn is not a land tile");
      }
      executeTurn([{ type: "spawn", tile: spawnTile }]);
      for (let i = 0; i < 20; i++) {
        const allSpawned =
          game.players().length === 4 &&
          game.players().every((player) => player.hasSpawned());
        if (allSpawned && !game.inSpawnPhase()) break;
        executeTurn();
      }

      const player = game.playerByClientID(SCENARIO.clientID);
      if (!player?.hasSpawned()) throw new Error("LLM player did not spawn");
      trackEliminations = true;
      const nationNames = game
        .players()
        .filter((candidate) => candidate.type() === PlayerType.Nation)
        .map((candidate) => candidate.name())
        .sort();
      const expected = [...SCENARIO.expectedNations].sort();
      if (JSON.stringify(nationNames) !== JSON.stringify(expected)) {
        throw new Error(
          `Scenario drift: expected nations ${expected.join(", ")}, got ${nationNames.join(", ")}`,
        );
      }

      let consecutiveFailures = 0;
      for (
        let decisionIndex = 0;
        decisionIndex < SCENARIO.maxDecisionCount &&
        game.getWinner() === null &&
        player.isAlive();
        decisionIndex++
      ) {
        if (Date.now() - startedAt.getTime() > SCENARIO.maxWallClockMs) {
          terminationReason = "wall-clock safety limit";
          break;
        }
        const observation = createObservation(
          game,
          player,
          decisionIndex,
          decisions,
        );
        const candidates = createLegalActions(game, player);
        const estimate = await this.agent.estimateNextCost(
          observation,
          candidates,
        );
        const spent = decisions.reduce(
          (sum, record) => sum + record.costUsd,
          0,
        );
        if (spent + estimate > SCENARIO.maxRunCostUsd) {
          terminationReason = "model cost limit";
          break;
        }

        const agentResult = await this.agent.decide(observation, candidates);
        const selectedIds = agentResult.decision?.actions ?? [
          "hold:1",
          "hold:2",
        ];
        const resolved = resolveDecisionActions(selectedIds, candidates);
        const completeFailure = agentResult.decision === null;
        consecutiveFailures = completeFailure ? consecutiveFailures + 1 : 0;
        const strategy = completeFailure
          ? `Decision failed; holding. ${agentResult.error ?? ""}`
              .trim()
              .slice(0, 160)
          : agentResult.decision!.strategy;
        const appliedIntents = resolved.actions
          .map((candidate) => candidate.intent)
          .filter((intent): intent is Intent => intent !== null);

        const record: DecisionRecord = {
          index: decisionIndex,
          tick: game.ticks(),
          observation,
          candidates,
          strategy,
          selectedActionIds: selectedIds as [string, string],
          appliedActionIds: resolved.actions.map(
            (candidate) => candidate.id,
          ) as [string, string],
          outcomes: resolved.actions.map((candidate) =>
            candidate.intent === null
              ? "held"
              : "queued as a legal core intent",
          ) as [string, string],
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
        executeTurn(appliedIntents);
        for (
          let tick = 1;
          tick < SCENARIO.decisionIntervalTicks && game.getWinner() === null;
          tick++
        ) {
          executeTurn();
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

        if (consecutiveFailures >= SCENARIO.maxConsecutiveDecisionFailures) {
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
            SCENARIO.maxDecisionCount * SCENARIO.decisionIntervalTicks + 20 &&
          game.getWinner() === null
        ) {
          executeTurn();
        }
      }
      // The OpenFront winner check runs every ten ticks. If the final fixed
      // decision interval lands between checks, advance only to the next check
      // so maxTimerValue can produce the required deterministic winner without
      // asking the model for a 121st decision.
      if (
        game.getWinner() === null &&
        decisions.length === SCENARIO.maxDecisionCount
      ) {
        for (let tick = 0; tick < 20 && game.getWinner() === null; tick++) {
          executeTurn();
        }
      }
      if (game.getWinner() !== null)
        terminationReason = "OpenFront declared a winner";
    } catch (error) {
      terminationReason =
        error instanceof Error ? error.message : String(error);
      fatalError = terminationReason;
    }

    const completedAt = new Date();
    const winner = game.getWinner();
    const human = game.playerByClientID(SCENARIO.clientID);
    const humanEliminatedAt = human ? eliminatedAt.get(human.id()) : undefined;
    const finalPlacement =
      human === null
        ? 4
        : winner === human
          ? 1
          : humanEliminatedAt === undefined
            ? 2
            : 1 +
              game
                .allPlayers()
                .filter(
                  (candidate) =>
                    candidate !== human &&
                    (candidate.isAlive() ||
                      (eliminatedAt.get(candidate.id()) ?? -1) >
                        humanEliminatedAt),
                ).length;
    const status = winner !== null && !fatalError ? "completed" : "failed";
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
            schemaVersion: 1,
            runId,
            status,
            scenario: publicScenario(),
            model: {
              requested: this.agent.requestedModel,
              resolved:
                decisions[decisions.length - 1]?.model ??
                this.agent.requestedModel,
              provider:
                decisions[decisions.length - 1]?.provider ??
                this.agent.provider ??
                null,
              promptVersion: OpenRouterAgent.promptVersion(),
              seed: OpenRouterAgent.modelSeed(),
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
