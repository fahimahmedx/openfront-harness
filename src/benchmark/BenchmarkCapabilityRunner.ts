import path from "node:path";
import { fileURLToPath } from "node:url";
import { UnitType } from "../../OpenFrontIO/src/core/game/Game";
import { Intent } from "../../OpenFrontIO/src/core/Schemas";
import {
  actionOutcomes,
  beginActionTracking,
  observeActionUpdates,
  updateActionTracking,
} from "../ActionLifecycle";
import { AgentPolicy } from "../HarnessRunner";
import {
  createLegalActions,
  createObservation,
  resolveDecisionActions,
} from "../ObservationActions";
import { DecisionRecord } from "../Types";
import { EvalGameSession } from "../evals/EvalGameSession";
import { canonicalHash, tileStateHash } from "../evals/ReplayCheckpoint";
import { benchmarkTask } from "./BenchmarkConfig";
import { BENCHMARK_LIMITS } from "./BenchmarkConfig";
import { BenchmarkAssertion } from "./BenchmarkSchemas";
import {
  applyBenchmarkPreparation,
  BenchmarkPreparationOperation,
} from "./BenchmarkPreparation";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export type FrozenCapabilityFixture = {
  id: string;
  family: string;
  sourceTaskId: string;
  preparationTurns: Array<{
    turnNumber: number;
    intents?: Array<
      (Intent & { clientID?: string }) | BenchmarkPreparationOperation
    >;
  }>;
  decisionIndex: number;
  recentDecisions: Array<Record<string, unknown>>;
  checkpointTick: number;
  hashes: {
    state: number | string;
    observation: string;
    candidateMenu: string;
    tileState: string;
  };
  horizonTicks: number;
  semanticRoles: Record<string, unknown>;
  thresholds: Record<string, unknown>;
  ownershipSets: Record<string, number[]>;
};

type Snapshot = {
  capacityPercent: number;
  tileCount: number;
  troops: number;
  ownerByTile: Uint16Array;
};

function capacityPercent(
  game: EvalGameSession["game"],
  player: NonNullable<ReturnType<EvalGameSession["game"]["playerByClientID"]>>,
): number {
  const maximum = game.config().maxTroops(player);
  return maximum === 0 ? 0 : (player.troops() / maximum) * 100;
}

function assertion(
  id: string,
  observed: number | boolean | string,
  operator: string,
  threshold: number | boolean | string,
  passed: boolean,
): BenchmarkAssertion {
  return { id, observed, operator, threshold, passed };
}

function ownedCount(
  tiles: readonly number[],
  owner: { tiles(): ReadonlySet<number> },
): number {
  const owned = owner.tiles();
  return tiles.reduce((count, tile) => count + Number(owned.has(tile)), 0);
}

function losses(
  tiles: readonly number[],
  player: { tiles(): ReadonlySet<number> },
): number {
  return tiles.length - ownedCount(tiles, player);
}

function numeric(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Fixture threshold ${key} must be numeric`);
  }
  return value;
}

function grade(
  fixture: FrozenCapabilityFixture,
  session: EvalGameSession,
  player: NonNullable<ReturnType<EvalGameSession["game"]["playerByClientID"]>>,
  initial: Snapshot,
): BenchmarkAssertion[] {
  const capacity = capacityPercent(session.game, player);
  const alive = player.isAlive();
  const tiles = player.numTilesOwned();
  const aliveAssertion = () =>
    assertion("player-alive", alive, "=", true, alive);
  const territoryAssertion = () =>
    assertion(
      "territory-preserved",
      tiles,
      ">=",
      initial.tileCount,
      tiles >= initial.tileCount,
    );
  switch (fixture.family) {
    case "neutral-expansion":
    case "saturated-capacity-expansion": {
      const gained = ownedCount(
        fixture.ownershipSets.neutralAtCheckpoint ?? [],
        player,
      );
      return [
        assertion("owns-checkpoint-neutral-tile", gained, ">=", 1, gained >= 1),
      ];
    }
    case "post-expansion-recovery":
      return [
        aliveAssertion(),
        assertion(
          "capacity-increased",
          capacity,
          ">",
          initial.capacityPercent,
          capacity > initial.capacityPercent,
        ),
        territoryAssertion(),
      ];
    case "weaker-target-selection":
    case "naval-target-recognition": {
      const captured = ownedCount(
        fixture.ownershipSets.targetAtCheckpoint ?? [],
        player,
      );
      return [
        assertion("captures-target-tile", captured, ">=", 1, captured >= 1),
      ];
    }
    case "frontier-restraint":
    case "incoming-attack-response": {
      const lost = losses(fixture.ownershipSets.protectedTiles ?? [], player);
      const maximum = numeric(fixture.thresholds, "maximumAllowedTileLoss");
      return [
        aliveAssertion(),
        ...(fixture.family === "frontier-restraint"
          ? [
              assertion(
                "capacity-increased",
                capacity,
                ">",
                initial.capacityPercent,
                capacity > initial.capacityPercent,
              ),
            ]
          : []),
        assertion(
          "protected-frontier-held",
          lost,
          "<=",
          maximum,
          lost <= maximum,
        ),
      ];
    }
    case "split-front-defense":
      return [
        aliveAssertion(),
        ...([1, 2] as const).map((index) => {
          const lost = losses(
            fixture.ownershipSets[`frontier${index}`] ?? [],
            player,
          );
          const maximum = numeric(
            fixture.thresholds,
            `frontier${index}MaximumAllowedTileLoss`,
          );
          return assertion(
            `frontier-${index}-held`,
            lost,
            "<=",
            maximum,
            lost <= maximum,
          );
        }),
      ];
    case "losing-attack-retreat": {
      const targetName = fixture.semanticRoles.targetName;
      const originalActive = player.outgoingAttacks().some((attack) => {
        const target = attack.target();
        return target.isPlayer() && target.name() === targetName;
      });
      const minimum = numeric(fixture.thresholds, "minimumRecoveredTroops");
      return [
        aliveAssertion(),
        assertion(
          "original-attack-ended",
          originalActive,
          "=",
          false,
          !originalActive,
        ),
        assertion(
          "troops-recovered",
          Math.floor(player.troops()),
          ">=",
          minimum,
          player.troops() >= minimum,
        ),
        territoryAssertion(),
      ];
    }
    case "construction-failure-recovery": {
      const zone = new Set(fixture.ownershipSets.defenseZoneTiles ?? []);
      const completed = player
        .units(UnitType.DefensePost)
        .some((unit) => unit.isActive() && zone.has(unit.tile()));
      return [
        aliveAssertion(),
        assertion(
          "active-defense-post-in-zone",
          completed,
          "=",
          true,
          completed,
        ),
      ];
    }
    default:
      throw new Error(`Unsupported capability family ${fixture.family}`);
  }
}

export async function runBenchmarkCapabilityTrial(
  fixture: FrozenCapabilityFixture,
  agent: AgentPolicy,
  mapsDir = path.join(PROJECT_ROOT, "OpenFrontIO/resources/maps"),
) {
  const source = benchmarkTask(fixture.sourceTaskId);
  const session = await EvalGameSession.create(
    agent.requestedModel,
    mapsDir,
    source,
  );
  try {
    const turns = new Map(
      fixture.preparationTurns.map((turn) => [
        turn.turnNumber,
        turn.intents ?? [],
      ]),
    );
    while (session.game.ticks() < fixture.checkpointTick) {
      const prepared = turns.get(session.game.ticks()) ?? [];
      session.executePrepared(applyBenchmarkPreparation(session, prepared));
    }
    const checkpointIntents = applyBenchmarkPreparation(
      session,
      turns.get(fixture.checkpointTick) ?? [],
    );
    if (checkpointIntents.length > 0)
      throw new Error(
        "Ordinary preparation intents cannot execute at the checkpoint tick",
      );
    const player = session.game.playerByClientID("LLMAGENT");
    if (!player?.isAlive())
      throw new Error("Capability checkpoint player is not alive");
    const observation = createObservation(
      session.game,
      player,
      fixture.decisionIndex,
      fixture.recentDecisions as DecisionRecord[],
    );
    const candidates = createLegalActions(session.game, player, {
      safeBuildAnchors: true,
    });
    const stateHash = session.lastHash!;
    const actualHashes = {
      state: Number.isSafeInteger(stateHash) ? stateHash : String(stateHash),
      observation: canonicalHash(observation),
      candidateMenu: canonicalHash(candidates),
      tileState: tileStateHash(session.game.tileStateBuffer()),
    };
    if (JSON.stringify(actualHashes) !== JSON.stringify(fixture.hashes)) {
      throw new Error(
        `Capability checkpoint hash mismatch for ${fixture.id}: expected ${JSON.stringify(fixture.hashes)}, got ${JSON.stringify(actualHashes)}`,
      );
    }
    const initial: Snapshot = {
      capacityPercent: capacityPercent(session.game, player),
      tileCount: player.numTilesOwned(),
      troops: player.troops(),
      ownerByTile: session.game.tileStateBuffer().slice(),
    };
    const estimate = await agent.estimateNextCost(observation, candidates);
    const result =
      estimate > BENCHMARK_LIMITS.maxCapabilityCostUsd
        ? {
            decision: null,
            attempts: 1,
            attemptFailures: [
              {
                attempt: 1 as const,
                code: "cost_limit" as const,
                message: "Capability model cost ceiling reached before request",
                rejectedActionIds: [],
              },
            ],
            attemptTimings: [],
            latencyMs: 0,
            promptTokens: 0,
            completionTokens: 0,
            costUsd: 0,
            model: agent.requestedModel,
            provider: agent.provider ?? null,
            error: "model cost limit",
          }
        : await agent.decide(observation, candidates);
    const selected = result.decision?.actions ?? ["hold:1", "hold:2"];
    const resolved = resolveDecisionActions(selected, candidates);
    const tracking = beginActionTracking(
      session.game,
      player,
      resolved.actions,
    );
    const stop = session.onUpdate((update) => {
      if (!("errMsg" in update)) observeActionUpdates(tracking, update);
    });
    session.execute(
      resolved.actions
        .map((action) => action.intent)
        .filter((intent): intent is Intent => intent !== null),
    );
    updateActionTracking(tracking, session.game, session.game.ticks());
    for (
      let tick = 1;
      tick < fixture.horizonTicks && session.game.getWinner() === null;
      tick++
    ) {
      session.execute();
      updateActionTracking(tracking, session.game, session.game.ticks());
    }
    stop();
    const assertions = grade(fixture, session, player, initial);
    const passed = assertions.every((item) => item.passed);
    return {
      observation,
      candidates,
      selectedActionIds: selected,
      appliedActionIds: resolved.actions.map((action) => action.id),
      actionOutcomes: actionOutcomes(
        tracking,
        session.game,
        session.game.ticks(),
      ),
      agent: result,
      checkpointHashes: actualHashes,
      finalHash: session.lastHash,
      assertions,
      componentCoverage:
        assertions.filter((item) => item.passed).length / assertions.length,
      taskPass: passed,
      taskScore: passed ? 100 : 0,
      diagnostics: {
        finalTick: session.game.ticks(),
        finalTileCount: player.numTilesOwned(),
        finalTroops: Math.floor(player.troops()),
        finalTroopCapacityPercent: capacityPercent(session.game, player),
        initialTileCount: initial.tileCount,
        initialTroops: Math.floor(initial.troops),
        initialTroopCapacityPercent: initial.capacityPercent,
        territoryChange: player.numTilesOwned() - initial.tileCount,
        terminal: session.game.getWinner() !== null || !player.isAlive(),
      },
      replay: session.createReplayRecord(),
    };
  } finally {
    session.close();
  }
}
