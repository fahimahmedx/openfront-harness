import { randomUUID } from "node:crypto";
import { Player, UnitType } from "../../OpenFrontIO/src/core/game/Game";
import { GameRecord, Intent } from "../../OpenFrontIO/src/core/Schemas";
import {
  actionOutcomes,
  beginActionTracking,
  observeActionUpdates,
  updateActionTracking,
} from "../ActionLifecycle";
import {
  createLegalActions,
  createObservation,
  resolveDecisionAction,
} from "../ObservationActions";
import { OPENFRONT_COMMIT, SCENARIO } from "../Scenario";
import { AgentResult, LegalAction, Observation } from "../Types";
import {
  createNeutralExpansionCheckpoint,
  NeutralExpansionAgent,
} from "./NeutralExpansionEval";
import {
  canonicalHash,
  createReplayCheckpoint,
  ReplayCheckpoint,
  ReplayFamilyId,
  tileStateHash,
} from "./ReplayCheckpoint";

export const REMAINING_MICRO_EVAL_FAMILIES = [
  "saturated-capacity-expansion",
  "post-expansion-recovery",
  "weaker-target-selection",
  "frontier-restraint",
  "incoming-attack-response",
  "split-front-prioritization",
  "losing-attack-retreat",
  "naval-target-recognition",
  "construction-failure-recovery",
] as const;

export type MicroEvalFamilyId = (typeof REMAINING_MICRO_EVAL_FAMILIES)[number];
export type MicroEvalAgent = NeutralExpansionAgent;

export const MICRO_EVAL_FIXTURES: Record<
  MicroEvalFamilyId,
  {
    fixtureId: string;
    horizonTicks: number;
    expectedCheckpoint: {
      state: number;
      observation: string;
      candidateMenu: string;
      tileState: string;
    };
  }
> = {
  "saturated-capacity-expansion": {
    fixtureId: "saturated-capacity-expansion-japan-001",
    horizonTicks: 100,
    expectedCheckpoint: {
      state: 873239509169658,
      observation:
        "0cd65b09bfbb979d81d11e9a6be183a36d527c2dc0bb68276fe4f6e5fad79da5",
      candidateMenu:
        "a45da8af0705f6dfbb984b4d061361779a76fecca28df35720e1bddd7238746e",
      tileState:
        "302b018da4f21866ee2aa61e3e56b6066a0438432a03ea52bb40f831ce10db68",
    },
  },
  "post-expansion-recovery": {
    fixtureId: "post-expansion-recovery-japan-001",
    horizonTicks: 100,
    expectedCheckpoint: {
      state: 160101488001483,
      observation:
        "968c55045e4db0efdb5ed2375ce51000f36d170915912847bb72d4608ac555e0",
      candidateMenu:
        "0d00432189934848773fe4e67b1e7bd044fa70ab095e98435b6097fd5e361dbf",
      tileState:
        "0ae8153a4fa1946f1816b768ebec3d33f052337db4920f2c6f8aabde492de98c",
    },
  },
  "weaker-target-selection": {
    fixtureId: "weaker-target-selection-japan-001",
    horizonTicks: 200,
    expectedCheckpoint: {
      state: 5048400175491223,
      observation:
        "833b30a64aa30fa074319ece6ea0b119b7ff2574bebf24b3441d11a7c3481f7b",
      candidateMenu:
        "b2066072b51e8f1c7f1115d157353453b74b8957a9bffa4381806dd668ec5f6d",
      tileState:
        "1bbd3b0a730fd82a18725b44f8f5c67c8fc3f8545a17e42df6840fd1cb4081e2",
    },
  },
  "frontier-restraint": {
    fixtureId: "frontier-restraint-japan-001",
    horizonTicks: 200,
    expectedCheckpoint: {
      state: 4044227782518706,
      observation:
        "9339292ea506f296f5507a1649e2252bab6d269ebeff2069a199eec31cea66cc",
      candidateMenu:
        "824a474d9625607fad784d1e6f80f97ad7548f5b12728e382f60f82451b8452e",
      tileState:
        "111d4398274ef975334ae73458d6220fe2cc2a999b5fc2b24a4d3c7e556bd43c",
    },
  },
  "incoming-attack-response": {
    fixtureId: "incoming-attack-response-japan-001",
    horizonTicks: 200,
    expectedCheckpoint: {
      state: 3574141668933355,
      observation:
        "686cbbce6ea338706fbafc3dfc0180598f4c5c1f00bbbe9c7d946e636eae9753",
      candidateMenu:
        "af7fea1ca62badb2e30211add6296f4e3540a36872513ee55afc7bd50be84fcc",
      tileState:
        "9fd62a0db30bc50168b0205720cb6a4a9ec968c3dc84953a22918392fd5eee68",
    },
  },
  "split-front-prioritization": {
    fixtureId: "split-front-prioritization-japan-001",
    horizonTicks: 200,
    expectedCheckpoint: {
      state: 5353959940620816,
      observation:
        "dbdb89bcb1b98d643abf76cc746ada703314520b57ca38625901606e087f8f8a",
      candidateMenu:
        "ebab016aa3cdd6cbcab26d02becc2aafd9802e78f782745d10c05e4c43588429",
      tileState:
        "0f6942f3ec35f144bc40f3198e7fed23b641c46befa44caad1a0fea55150339f",
    },
  },
  "losing-attack-retreat": {
    fixtureId: "losing-attack-retreat-japan-001",
    horizonTicks: 100,
    expectedCheckpoint: {
      state: 3942302880356315,
      observation:
        "edf6d3e273a93ceae9cd7c060b565c7bafb44bdf53527444b67fbe43680372d1",
      candidateMenu:
        "54d8552a037995e08144d5eedee61b40db9fb877991fc459e884f89703b455a6",
      tileState:
        "f08dcd6800c0152f79cefbfbffb5d60aa08a75a01d76658c9a47cef83ee47e61",
    },
  },
  "naval-target-recognition": {
    fixtureId: "naval-target-recognition-japan-001",
    horizonTicks: 300,
    expectedCheckpoint: {
      state: 3202099624156893,
      observation:
        "623b9d115334cd844de878e4128986c016a37decff030cd6d3df9358add0927d",
      candidateMenu:
        "990002c071ee9c6f453c3aa24eb94f53def24bf853396cbdcb3864e4d88cafb6",
      tileState:
        "5232e56c53215cd6de6a7ed24f55b4f29e8b47f543823af9803c3567bbc7958f",
    },
  },
  "construction-failure-recovery": {
    fixtureId: "construction-failure-recovery-japan-001",
    horizonTicks: 200,
    expectedCheckpoint: {
      state: 4221862867433330,
      observation:
        "a018d26da99ea5f5745dca933c2d59a103d913a428a40832ed075912b58ef0c0",
      candidateMenu:
        "d3cbaae4fbd5356e38e0e749a0309c96dcb2a6d98608685c8160a7636afad49c",
      tileState:
        "f8a02264fa34ad9f34c588dccb9c0034b2d57aa082b11af6b3014c719326b3da",
    },
  },
};

export type MicroAssertion = {
  id: string;
  observed: number | boolean | string;
  operator: string;
  expected: number | boolean | string;
  passed: boolean;
};

type TaskContext = {
  initialCapacity: number;
  initialTiles: number;
  initialTroops: number;
  checkpointOwnerTiles: Set<number>;
  target?: Player;
  targetCheckpointTiles?: Set<number>;
  attackers?: Player[];
  protectedTiles?: Map<string, Set<number>>;
  originalAttackId?: string;
  minimumRecoveredTroops?: number;
  maximumAllowedLosses?: Map<string, number>;
  combinedMaximumAllowedLoss?: number;
  defenseZoneTiles?: Set<number>;
};

export type MicroEvalCheckpoint = ReplayCheckpoint & {
  context: TaskContext;
};

export type MicroEvalTrial = {
  runId: string;
  evalVersion: "openfront-micro-v2";
  graderVersion: string;
  familyId: MicroEvalFamilyId;
  fixtureId: string;
  split: "development";
  startedAt: string;
  completedAt: string;
  configuration: {
    scenarioId: string;
    openfrontCommit: string;
    model: string;
    resolvedModel: string;
    provider: string | null;
    promptVersion: string | null;
  };
  checkpoint: {
    tick: number;
    stateHash: number;
    observationHash: string;
    candidateMenuHash: string;
    tileStateHash: string;
    initialTileCount: number;
    troopCapacityPercent: number;
    sourceArtifact: string;
    sourceArtifactSha256: string;
    sourceDecisionIndex: number;
  };
  trace: {
    observation: Observation;
    candidates: LegalAction[];
    strategy: string;
    selectedActionIds: [string];
    appliedActionIds: [string];
    actionOutcomes: ReturnType<typeof actionOutcomes>;
    attempts: number;
    attemptFailures: AgentResult["attemptFailures"];
    attemptTimings: AgentResult["attemptTimings"];
    fallback: boolean;
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
  };
  outcome: {
    finalTick: number;
    finalStateHash: number | null;
    finalTileCount: number;
    finalTroops: number;
    finalTroopCapacityPercent: number;
    assertions: MicroAssertion[];
    diagnostics: Record<string, number | boolean | string>;
    componentCoverage: number;
    taskPass: boolean;
    taskScore: 0 | 100;
  };
  replay: GameRecord;
};

type TaskDefinition = {
  horizonTicks: number;
  reference(checkpoint: MicroEvalCheckpoint): string;
  controls(checkpoint: MicroEvalCheckpoint): string[];
  grade(checkpoint: MicroEvalCheckpoint): {
    assertions: MicroAssertion[];
    diagnostics: Record<string, number | boolean | string>;
  };
};

const OWNER_ID_MASK = 0xfff;

function capacity(checkpoint: MicroEvalCheckpoint): number {
  const max = checkpoint.session.game.config().maxTroops(checkpoint.player);
  return max === 0 ? 0 : (checkpoint.player.troops() / max) * 100;
}

function ownedCheckpointTiles(player: Player): Set<number> {
  return new Set(player.tiles());
}

function tilesCapturedFrom(
  player: Player,
  checkpointTiles: Set<number> | undefined,
): number {
  if (checkpointTiles === undefined) return 0;
  let captured = 0;
  for (const tile of checkpointTiles) if (player.tiles().has(tile)) captured++;
  return captured;
}

function neutralTilesGained(checkpoint: MicroEvalCheckpoint): number {
  let gained = 0;
  for (const tile of checkpoint.player.tiles()) {
    if ((checkpoint.checkpointTileStates[tile] & OWNER_ID_MASK) === 0) gained++;
  }
  return gained;
}

function losses(
  checkpoint: MicroEvalCheckpoint,
  protectedTiles: Set<number> | undefined,
): number {
  if (protectedTiles === undefined) return 0;
  let lost = 0;
  for (const tile of protectedTiles) {
    if (checkpoint.session.game.owner(tile) !== checkpoint.player) lost++;
  }
  return lost;
}

function frontierTiles(
  checkpoint: ReplayCheckpoint,
  attacker: Player,
): Set<number> {
  const seeds = new Set(
    Array.from(checkpoint.player.borderTiles()).filter((tile) =>
      checkpoint.session.game
        .neighbors(tile)
        .some(
          (neighbor) => checkpoint.session.game.owner(neighbor) === attacker,
        ),
    ),
  );
  const region = new Set(seeds);
  let frontier = Array.from(seeds);
  for (let depth = 0; depth < 40 && frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const tile of frontier) {
      for (const neighbor of checkpoint.session.game.neighbors(tile)) {
        if (
          !region.has(neighbor) &&
          checkpoint.session.game.owner(neighbor) === checkpoint.player
        ) {
          region.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return region;
}

function targetFrontierTiles(
  checkpoint: ReplayCheckpoint,
  target: Player,
): Set<number> {
  const seeds = new Set(
    Array.from(target.borderTiles()).filter((tile) =>
      checkpoint.session.game
        .neighbors(tile)
        .some(
          (neighbor) =>
            checkpoint.session.game.owner(neighbor) === checkpoint.player,
        ),
    ),
  );
  const region = new Set(seeds);
  let frontier = Array.from(seeds);
  for (let depth = 0; depth < 40 && frontier.length > 0; depth++) {
    const next: number[] = [];
    for (const tile of frontier) {
      for (const neighbor of checkpoint.session.game.neighbors(tile)) {
        if (
          !region.has(neighbor) &&
          checkpoint.session.game.owner(neighbor) === target
        ) {
          region.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return region;
}

function assertion(
  id: string,
  observed: number | boolean | string,
  operator: string,
  expected: number | boolean | string,
  passed: boolean,
): MicroAssertion {
  return { id, observed, operator, expected, passed };
}

function largest(candidates: LegalAction[], prefix: string): string {
  const matches = candidates.filter((candidate) =>
    candidate.id.startsWith(prefix),
  );
  if (matches.length === 0) throw new Error(`Missing eval action ${prefix}*`);
  return matches.sort((left, right) => {
    const leftParts = left.id.split(":");
    const rightParts = right.id.split(":");
    const lf = Number(leftParts[leftParts.length - 1]);
    const rf = Number(rightParts[rightParts.length - 1]);
    return rf - lf;
  })[0].id;
}

function diplomacyControl(checkpoint: MicroEvalCheckpoint): string {
  return (
    checkpoint.candidates.find(
      (candidate) => candidate.category === "diplomacy",
    )?.id ?? "hold"
  );
}

const definitions: Record<MicroEvalFamilyId, TaskDefinition> = {
  "saturated-capacity-expansion": {
    horizonTicks: 100,
    reference: (checkpoint) =>
      largest(checkpoint.candidates, "expand:neutral:"),
    controls: (checkpoint) => ["hold", diplomacyControl(checkpoint)],
    grade: (checkpoint) => {
      const gained = neutralTilesGained(checkpoint);
      return {
        assertions: [
          assertion(
            "owns-checkpoint-neutral-tile",
            gained,
            ">=",
            1,
            gained >= 1,
          ),
        ],
        diagnostics: {
          neutralTilesGained: gained,
          finalTroopCapacityPercent: capacity(checkpoint),
        },
      };
    },
  },
  "post-expansion-recovery": {
    horizonTicks: 100,
    reference: () => "hold",
    controls: (checkpoint) => [
      largest(checkpoint.candidates, "expand:neutral:"),
      checkpoint.candidates.find(
        (candidate) => candidate.category === "retreat",
      )?.id ?? "hold",
    ],
    grade: (checkpoint) => {
      const finalCapacity = capacity(checkpoint);
      const finalTiles = checkpoint.player.numTilesOwned();
      const assertions = [
        assertion(
          "player-alive",
          checkpoint.player.isAlive(),
          "=",
          true,
          checkpoint.player.isAlive(),
        ),
        assertion(
          "capacity-recovered",
          finalCapacity,
          ">",
          checkpoint.context.initialCapacity,
          finalCapacity > checkpoint.context.initialCapacity,
        ),
        assertion(
          "territory-preserved",
          finalTiles,
          ">=",
          checkpoint.context.initialTiles,
          finalTiles >= checkpoint.context.initialTiles,
        ),
      ];
      return {
        assertions,
        diagnostics: {
          capacityChange: finalCapacity - checkpoint.context.initialCapacity,
          territoryChange: finalTiles - checkpoint.context.initialTiles,
        },
      };
    },
  },
  "weaker-target-selection": {
    horizonTicks: 200,
    reference: (checkpoint) => {
      const id = largest(
        checkpoint.candidates,
        `attack:${checkpoint.context.target!.id()}:`,
      );
      return id;
    },
    controls: (checkpoint) => {
      const strong = checkpoint.observation.opponents.find(
        (opponent) =>
          opponent.sharedBorder &&
          opponent.id !== checkpoint.context.target!.id() &&
          checkpoint.candidates.some((candidate) =>
            candidate.id.startsWith(`attack:${opponent.id}:`),
          ),
      );
      return [
        "hold",
        strong
          ? largest(checkpoint.candidates, `attack:${strong.id}:`)
          : diplomacyControl(checkpoint),
      ];
    },
    grade: (checkpoint) => {
      const captured = tilesCapturedFrom(
        checkpoint.player,
        checkpoint.context.targetCheckpointTiles,
      );
      return {
        assertions: [
          assertion(
            "captures-weak-target-tile",
            captured,
            ">=",
            1,
            captured >= 1,
          ),
        ],
        diagnostics: {
          weakTargetTilesCaptured: captured,
          territoryChange:
            checkpoint.player.numTilesOwned() - checkpoint.context.initialTiles,
        },
      };
    },
  },
  "frontier-restraint": {
    horizonTicks: 200,
    reference: () => "hold",
    controls: (checkpoint) => {
      const id = largest(checkpoint.candidates, "attack:");
      return [id, diplomacyControl(checkpoint)];
    },
    grade: (checkpoint) => {
      const opponent = checkpoint.context.attackers![0];
      const protectedLoss = losses(
        checkpoint,
        checkpoint.context.protectedTiles!.get(opponent.id()),
      );
      const maximum = checkpoint.context.maximumAllowedLosses!.get(
        opponent.id(),
      )!;
      const finalCapacity = capacity(checkpoint);
      const assertions = [
        assertion(
          "player-alive",
          checkpoint.player.isAlive(),
          "=",
          true,
          checkpoint.player.isAlive(),
        ),
        assertion(
          "capacity-increased",
          finalCapacity,
          ">",
          checkpoint.context.initialCapacity,
          finalCapacity > checkpoint.context.initialCapacity,
        ),
        assertion(
          "protected-frontier-held",
          protectedLoss,
          "<=",
          maximum,
          protectedLoss <= maximum,
        ),
      ];
      return {
        assertions,
        diagnostics: {
          protectedTilesLost: protectedLoss,
          capacityChange: finalCapacity - checkpoint.context.initialCapacity,
          territoryChange:
            checkpoint.player.numTilesOwned() - checkpoint.context.initialTiles,
        },
      };
    },
  },
  "incoming-attack-response": {
    horizonTicks: 200,
    reference: (checkpoint) => {
      const id = largest(
        checkpoint.candidates,
        `counter:${checkpoint.context.attackers![0].id()}:`,
      );
      return id;
    },
    controls: (checkpoint) => ["hold", diplomacyControl(checkpoint)],
    grade: (checkpoint) => {
      const attacker = checkpoint.context.attackers![0];
      const protectedLoss = losses(
        checkpoint,
        checkpoint.context.protectedTiles!.get(attacker.id()),
      );
      const maximum = checkpoint.context.maximumAllowedLosses!.get(
        attacker.id(),
      )!;
      const assertions = [
        assertion(
          "player-alive",
          checkpoint.player.isAlive(),
          "=",
          true,
          checkpoint.player.isAlive(),
        ),
        assertion(
          "protected-frontier-held",
          protectedLoss,
          "<=",
          maximum,
          protectedLoss <= maximum,
        ),
      ];
      return {
        assertions,
        diagnostics: {
          protectedTilesLost: protectedLoss,
          incomingTroopsRemaining: Math.floor(
            checkpoint.player
              .incomingAttacks()
              .reduce((sum, attack) => sum + attack.troops(), 0),
          ),
        },
      };
    },
  },
  "split-front-prioritization": {
    horizonTicks: 200,
    reference: (checkpoint) => {
      const [priority] = [...checkpoint.context.attackers!].sort((a, b) => {
        const incoming = (attacker: Player) =>
          checkpoint.player
            .incomingAttacks()
            .filter((attack) => attack.attacker() === attacker)
            .reduce((sum, attack) => sum + attack.troops(), 0);
        return incoming(b) - incoming(a) || a.id().localeCompare(b.id());
      });
      return largest(checkpoint.candidates, `counter:${priority.id()}:`);
    },
    controls: (checkpoint) => {
      const lesser = [...checkpoint.context.attackers!].sort((a, b) => {
        const incoming = (attacker: Player) =>
          checkpoint.player
            .incomingAttacks()
            .filter((attack) => attack.attacker() === attacker)
            .reduce((sum, attack) => sum + attack.troops(), 0);
        return incoming(a) - incoming(b) || b.id().localeCompare(a.id());
      })[0];
      const one = largest(checkpoint.candidates, `counter:${lesser.id()}:`);
      return ["hold", one];
    },
    grade: (checkpoint) => {
      const attackers = checkpoint.context.attackers!;
      const priority = [...attackers].sort((left, right) => {
        const incoming = (attacker: Player) =>
          checkpoint.player
            .incomingAttacks()
            .filter((attack) => attack.attacker() === attacker)
            .reduce((sum, attack) => sum + attack.troops(), 0);
        return incoming(right) - incoming(left);
      })[0];
      const priorityLoss = losses(
        checkpoint,
        checkpoint.context.protectedTiles!.get(priority.id()),
      );
      const combinedLoss = attackers.reduce(
        (sum, attacker) =>
          sum +
          losses(
            checkpoint,
            checkpoint.context.protectedTiles!.get(attacker.id()),
          ),
        0,
      );
      const priorityMaximum = checkpoint.context.maximumAllowedLosses!.get(
        priority.id(),
      )!;
      const combinedMaximum = checkpoint.context.combinedMaximumAllowedLoss!;
      return {
        assertions: [
          assertion(
            "player-alive",
            checkpoint.player.isAlive(),
            "=",
            true,
            checkpoint.player.isAlive(),
          ),
          assertion(
            "priority-frontier-held",
            priorityLoss,
            "<=",
            priorityMaximum,
            priorityLoss <= priorityMaximum,
          ),
          assertion(
            "combined-frontier-loss-limited",
            combinedLoss,
            "<=",
            combinedMaximum,
            combinedLoss <= combinedMaximum,
          ),
        ],
        diagnostics: Object.fromEntries(
          attackers.map((attacker, index) => [
            `frontier${index + 1}TilesLost`,
            losses(
              checkpoint,
              checkpoint.context.protectedTiles!.get(attacker.id()),
            ),
          ]),
        ),
      };
    },
  },
  "losing-attack-retreat": {
    horizonTicks: 100,
    reference: (checkpoint) => `retreat:${checkpoint.context.originalAttackId}`,
    controls: (checkpoint) => [
      "hold",
      largest(
        checkpoint.candidates,
        `attack:${checkpoint.context.target!.id()}:`,
      ),
    ],
    grade: (checkpoint) => {
      const originalActive = checkpoint.player
        .outgoingAttacks()
        .some((attack) => attack.id() === checkpoint.context.originalAttackId);
      const troops = Math.floor(checkpoint.player.troops());
      const finalTiles = checkpoint.player.numTilesOwned();
      const assertions = [
        assertion(
          "player-alive",
          checkpoint.player.isAlive(),
          "=",
          true,
          checkpoint.player.isAlive(),
        ),
        assertion(
          "original-attack-ended",
          originalActive,
          "=",
          false,
          !originalActive,
        ),
        assertion(
          "troops-recovered",
          troops,
          ">=",
          checkpoint.context.minimumRecoveredTroops!,
          troops >= checkpoint.context.minimumRecoveredTroops!,
        ),
        assertion(
          "territory-preserved",
          finalTiles,
          ">=",
          checkpoint.context.initialTiles,
          finalTiles >= checkpoint.context.initialTiles,
        ),
      ];
      return {
        assertions,
        diagnostics: {
          originalAttackActive: originalActive,
          availableTroops: troops,
          minimumRecoveredTroops: checkpoint.context.minimumRecoveredTroops!,
          territoryChange: finalTiles - checkpoint.context.initialTiles,
        },
      };
    },
  },
  "naval-target-recognition": {
    horizonTicks: 300,
    reference: (checkpoint) => {
      const id = largest(
        checkpoint.candidates,
        `boat:${checkpoint.context.target!.id()}:`,
      );
      return id;
    },
    controls: (checkpoint) => ["hold", diplomacyControl(checkpoint)],
    grade: (checkpoint) => {
      const captured = tilesCapturedFrom(
        checkpoint.player,
        checkpoint.context.targetCheckpointTiles,
      );
      return {
        assertions: [
          assertion(
            "captures-naval-target-tile",
            captured,
            ">=",
            1,
            captured >= 1,
          ),
        ],
        diagnostics: {
          targetTilesCaptured: captured,
          territoryChange:
            checkpoint.player.numTilesOwned() - checkpoint.context.initialTiles,
        },
      };
    },
  },
  "construction-failure-recovery": {
    horizonTicks: 200,
    reference: (checkpoint) =>
      checkpoint.candidates.find((candidate) =>
        candidate.id.startsWith("build:Defense Post:"),
      )!.id,
    controls: (checkpoint) => ["hold", diplomacyControl(checkpoint)],
    grade: (checkpoint) => {
      const posts = checkpoint.player
        .units(UnitType.DefensePost)
        .filter(
          (unit) =>
            unit.isActive() &&
            !unit.isUnderConstruction() &&
            checkpoint.context.defenseZoneTiles!.has(unit.tile()),
        );
      const assertions = [
        assertion(
          "player-alive",
          checkpoint.player.isAlive(),
          "=",
          true,
          checkpoint.player.isAlive(),
        ),
        assertion(
          "active-defense-post-in-zone",
          posts.length,
          ">=",
          1,
          posts.length >= 1,
        ),
      ];
      return {
        assertions,
        diagnostics: {
          completedDefensePostsInZone: posts.length,
          totalDefensePosts: checkpoint.player.unitCount(UnitType.DefensePost),
        },
      };
    },
  },
};

async function createPostExpansionCheckpoint(): Promise<ReplayCheckpoint> {
  const base = await createNeutralExpansionCheckpoint({ verifyHashes: false });
  try {
    const resolved = resolveDecisionAction(
      "expand:neutral:75",
      base.candidates,
    );
    base.session.execute(
      [resolved.action]
        .map((candidate) => candidate.intent)
        .filter((intent): intent is Intent => intent !== null),
    );
    base.session.advance(12);
    const observation = createObservation(
      base.session.game,
      base.player,
      1,
      [],
    );
    const candidates = createLegalActions(base.session.game, base.player, {
      safeBuildAnchors: true,
    });
    const checkpointTileStates = base.session.game.tileStateBuffer().slice();
    return {
      session: base.session,
      player: base.player,
      observation,
      candidates,
      checkpointTileStates,
      source: {
        sourceArtifact: "constructed:neutral-expansion-japan-kanto-001",
        sourceArtifactSha256: base.hashes.tileState,
        sourceDecisionIndex: 1,
      },
      hashes: {
        state: base.session.lastHash!,
        observation: canonicalHash(observation),
        candidateMenu: canonicalHash(candidates),
        tileState: tileStateHash(checkpointTileStates),
      },
    };
  } catch (error) {
    base.session.close();
    throw error;
  }
}

async function createConstructionCheckpoint(): Promise<ReplayCheckpoint> {
  const base = await createReplayCheckpoint("construction-failure-recovery");
  try {
    const incoming = base.player.incomingAttacks()[0];
    if (incoming === undefined)
      throw new Error("Construction fixture is missing its preparation attack");
    base.session.execute([
      {
        type: "attack",
        targetID: incoming.attacker().id(),
        troops: Math.ceil(incoming.troops()),
      },
    ]);
    if (base.player.incomingAttacks().length > 0)
      throw new Error(
        "Construction fixture preparation did not clear incoming attack",
      );
    const candidates = createLegalActions(base.session.game, base.player, {
      safeBuildAnchors: true,
    });
    const replacement = candidates.find((candidate) =>
      candidate.id.startsWith("build:Defense Post:"),
    );
    if (replacement?.intent?.type !== "build_unit") {
      throw new Error("Construction fixture is missing its replacement build");
    }
    const failedActionId = `build:Defense Post:${replacement.intent.tile + 1}`;
    const observation = createObservation(base.session.game, base.player, 77, [
      {
        tick: Math.max(0, base.session.game.ticks() - 100),
        strategy: "Replace the failed defensive structure at a safe anchor.",
        appliedActionIds: [failedActionId],
        outcomes: ["failed: placement blocked"],
        actionOutcomes: [
          {
            actionId: failedActionId,
            status: "failed",
            failureCode: "placement_blocked",
            startedAtTick: null,
            resolvedAtTick: base.session.game.ticks(),
            entityId: null,
            detail: "The previous placement was blocked.",
          },
        ],
      },
    ]);
    const checkpointTileStates = base.session.game.tileStateBuffer().slice();
    return {
      ...base,
      observation,
      candidates,
      checkpointTileStates,
      hashes: {
        state: base.session.lastHash!,
        observation: canonicalHash(observation),
        candidateMenu: canonicalHash(candidates),
        tileState: tileStateHash(checkpointTileStates),
      },
    };
  } catch (error) {
    base.session.close();
    throw error;
  }
}

function assertRequirements(
  familyId: MicroEvalFamilyId,
  checkpoint: ReplayCheckpoint,
): TaskContext {
  const { observation, candidates, player, session } = checkpoint;
  const opponents = observation.opponents as Array<{
    id: string;
    sharedBorder: boolean;
    relation: string;
    troopsRelativeToSelf: number;
  }>;
  const context: TaskContext = {
    initialCapacity: Number(observation.self.troopCapacityPercent),
    initialTiles: player.numTilesOwned(),
    initialTroops: Math.floor(player.troops()),
    checkpointOwnerTiles: ownedCheckpointTiles(player),
  };
  const hostileIncoming = player
    .incomingAttacks()
    .filter((attack) => !player.isFriendly(attack.attacker()));
  if (familyId === "saturated-capacity-expansion") {
    if (
      context.initialCapacity < 98 ||
      Number(observation.self.spendableTroops) <= 0 ||
      hostileIncoming.length > 0 ||
      !candidates.some((candidate) => candidate.category === "expand")
    )
      throw new Error("Saturated-capacity fixture requirements drifted");
  } else if (familyId === "post-expansion-recovery") {
    if (
      context.initialCapacity > 30 ||
      player.outgoingAttacks().filter((attack) => !attack.target().isPlayer())
        .length < 1 ||
      hostileIncoming.length > 0 ||
      !candidates.some((candidate) => candidate.category === "expand")
    )
      throw new Error(
        `Post-expansion fixture requirements drifted: capacity=${context.initialCapacity}, neutralOutgoing=${player.outgoingAttacks().filter((attack) => !attack.target().isPlayer()).length}, hostileIncoming=${hostileIncoming.length}, expandCandidates=${candidates.filter((candidate) => candidate.category === "expand").length}`,
      );
  } else if (familyId === "weaker-target-selection") {
    const attackable = opponents.filter(
      (opponent) =>
        opponent.sharedBorder &&
        candidates.some((candidate) =>
          candidate.id.startsWith(`attack:${opponent.id}:`),
        ),
    );
    const weak = attackable.find(
      (opponent) => opponent.troopsRelativeToSelf <= 0.4,
    );
    const strong = attackable.find(
      (opponent) =>
        opponent.troopsRelativeToSelf >= 0.8 &&
        opponent.troopsRelativeToSelf <= 0.99,
    );
    if (
      attackable.length !== 2 ||
      weak === undefined ||
      strong === undefined ||
      hostileIncoming.length > 0
    )
      throw new Error("Weaker-target fixture requirements drifted");
    context.target = session.game.player(weak.id);
    context.targetCheckpointTiles = targetFrontierTiles(
      checkpoint,
      context.target,
    );
  } else if (familyId === "frontier-restraint") {
    const attackable = opponents.filter(
      (opponent) =>
        opponent.sharedBorder &&
        candidates.some((candidate) =>
          candidate.id.startsWith(`attack:${opponent.id}:`),
        ),
    );
    if (
      attackable.length !== 1 ||
      context.initialCapacity < 55 ||
      context.initialCapacity > 70 ||
      hostileIncoming.length > 0 ||
      player.outgoingAttacks().length > 0
    )
      throw new Error("Frontier-restraint fixture requirements drifted");
    const opponent = session.game.player(attackable[0].id);
    context.attackers = [opponent];
    context.protectedTiles = new Map([
      [opponent.id(), frontierTiles(checkpoint, opponent)],
    ]);
    context.maximumAllowedLosses = new Map([[opponent.id(), 0]]);
  } else if (
    familyId === "incoming-attack-response" ||
    familyId === "split-front-prioritization"
  ) {
    const expected = familyId === "incoming-attack-response" ? 1 : 2;
    const attackers = Array.from(
      new Set(hostileIncoming.map((attack) => attack.attacker())),
    ).sort((a, b) => a.id().localeCompare(b.id()));
    if (attackers.length !== expected)
      throw new Error(`${familyId} incoming attacker requirements drifted`);
    if (familyId === "incoming-attack-response") {
      const fractions = candidates
        .filter((candidate) =>
          candidate.id.startsWith(`counter:${attackers[0].id()}:`),
        )
        .map((candidate) => {
          const parts = candidate.id.split(":");
          return Number(parts[parts.length - 1]);
        })
        .sort((a, b) => a - b);
      if (JSON.stringify(fractions) !== JSON.stringify([25, 50, 75, 100]))
        throw new Error("Incoming-response counter menu drifted");
    } else {
      const totals = attackers.map((attacker) =>
        hostileIncoming
          .filter((attack) => attack.attacker() === attacker)
          .reduce((sum, attack) => sum + attack.troops(), 0),
      );
      if (Math.abs(totals[0] - totals[1]) / Math.max(...totals) > 0.1)
        throw new Error("Split-front incoming forces drifted");
    }
    context.attackers = attackers;
    context.protectedTiles = new Map(
      attackers.map((attacker) => [
        attacker.id(),
        frontierTiles(checkpoint, attacker),
      ]),
    );
    if (attackers.length === 2) {
      const first = context.protectedTiles.get(attackers[0].id())!;
      const second = context.protectedTiles.get(attackers[1].id())!;
      for (const tile of first) second.delete(tile);
    }
    if (familyId === "incoming-attack-response") {
      context.maximumAllowedLosses = new Map([[attackers[0].id(), 5_000]]);
    } else {
      const priority = [...attackers].sort((left, right) => {
        const incoming = (attacker: Player) =>
          hostileIncoming
            .filter((attack) => attack.attacker() === attacker)
            .reduce((sum, attack) => sum + attack.troops(), 0);
        return incoming(right) - incoming(left);
      })[0];
      context.maximumAllowedLosses = new Map([[priority.id(), 1_500]]);
      context.combinedMaximumAllowedLoss = 3_000;
    }
  } else if (familyId === "losing-attack-retreat") {
    const outgoing = player.outgoingAttacks();
    const target = outgoing[0]?.target();
    if (
      outgoing.length !== 1 ||
      target === undefined ||
      !target.isPlayer() ||
      hostileIncoming.length > 0 ||
      outgoing[0].troops() > target.troops() * 0.25 ||
      !candidates.some(
        (candidate) => candidate.id === `retreat:${outgoing[0].id()}`,
      )
    )
      throw new Error("Retreat fixture requirements drifted");
    context.originalAttackId = outgoing[0].id();
    context.target = target;
    context.minimumRecoveredTroops = 2_320_000;
  } else if (familyId === "naval-target-recognition") {
    const eligible = opponents.filter(
      (opponent) =>
        !opponent.sharedBorder &&
        opponent.troopsRelativeToSelf <= 0.4 &&
        candidates.some((candidate) =>
          candidate.id.startsWith(`boat:${opponent.id}:`),
        ),
    );
    const targetSummary = eligible.sort(
      (a, b) => a.troopsRelativeToSelf - b.troopsRelativeToSelf,
    )[0];
    if (
      targetSummary === undefined ||
      candidates.some((candidate) => candidate.id.startsWith("attack:")) ||
      hostileIncoming.length > 0
    )
      throw new Error("Naval fixture requirements drifted");
    context.target = session.game.player(targetSummary.id);
    context.targetCheckpointTiles = new Set(context.target.tiles());
  } else {
    const recent = observation.recentDecisions as Array<{
      actionOutcomes: Array<{
        actionId: string;
        status: string;
        failureCode?: string;
      }>;
    }>;
    const failure = recent[recent.length - 1]?.actionOutcomes.find(
      (outcome) =>
        outcome.actionId.startsWith("build:Defense Post:") &&
        outcome.status === "failed",
    );
    const build = candidates.find((candidate) =>
      candidate.id.startsWith("build:Defense Post:"),
    );
    if (
      failure === undefined ||
      !["anchor_lost", "placement_blocked"].includes(
        failure.failureCode ?? "",
      ) ||
      build?.intent?.type !== "build_unit" ||
      hostileIncoming.length > 0 ||
      !opponents.some(
        (opponent) => opponent.sharedBorder && opponent.relation === "hostile",
      )
    )
      throw new Error("Construction-recovery fixture requirements drifted");
    const failedParts = failure.actionId.split(":");
    const failedAnchor = Number(failedParts[failedParts.length - 1]);
    if (build.intent.tile === failedAnchor)
      throw new Error("Construction replacement reused failed anchor");
    const buildAnchor = build.intent.tile;
    context.defenseZoneTiles = new Set<number>();
    session.game.forEachTile((tile) => {
      if (session.game.manhattanDist(tile, buildAnchor) <= 100)
        context.defenseZoneTiles!.add(tile);
    });
  }
  return context;
}

export async function createMicroEvalCheckpoint(
  familyId: MicroEvalFamilyId,
  options: { verifyHashes?: boolean } = {},
): Promise<MicroEvalCheckpoint> {
  const checkpoint =
    familyId === "post-expansion-recovery"
      ? await createPostExpansionCheckpoint()
      : familyId === "construction-failure-recovery"
        ? await createConstructionCheckpoint()
        : await createReplayCheckpoint(familyId as ReplayFamilyId);
  try {
    if (options.verifyHashes !== false) {
      const expected = MICRO_EVAL_FIXTURES[familyId].expectedCheckpoint;
      for (const field of [
        "state",
        "observation",
        "candidateMenu",
        "tileState",
      ] as const) {
        if (checkpoint.hashes[field] !== expected[field]) {
          throw new Error(
            `${familyId} ${field} hash drift: expected ${expected[field]}, got ${checkpoint.hashes[field]}`,
          );
        }
      }
    }
    return { ...checkpoint, context: assertRequirements(familyId, checkpoint) };
  } catch (error) {
    checkpoint.session.close();
    throw error;
  }
}

export function referenceActions(
  familyId: MicroEvalFamilyId,
  checkpoint: MicroEvalCheckpoint,
): string {
  return definitions[familyId].reference(checkpoint);
}

export function controlActions(
  familyId: MicroEvalFamilyId,
  checkpoint: MicroEvalCheckpoint,
): string[] {
  return definitions[familyId].controls(checkpoint);
}

export async function runMicroEvalTrial(
  familyId: MicroEvalFamilyId,
  agent: MicroEvalAgent,
): Promise<MicroEvalTrial> {
  const runId = randomUUID();
  const startedAt = new Date();
  const checkpoint = await createMicroEvalCheckpoint(familyId);
  const { session, player, observation, candidates } = checkpoint;
  try {
    const agentResult = await agent.decide(observation, candidates);
    const selectedActionId = agentResult.decision?.action ?? "hold";
    const resolved = resolveDecisionAction(selectedActionId, candidates);
    const intents = [resolved.action]
      .map((candidate) => candidate.intent)
      .filter((intent): intent is Intent => intent !== null);
    const trackers = beginActionTracking(session.game, player, [
      resolved.action,
    ]);
    const stop = session.onUpdate((update) => {
      if (!("errMsg" in update)) observeActionUpdates(trackers, update);
    });
    session.execute(intents);
    updateActionTracking(trackers, session.game, session.game.ticks());
    for (
      let tick = 1;
      tick < definitions[familyId].horizonTicks &&
      session.game.getWinner() === null;
      tick++
    ) {
      session.execute();
      updateActionTracking(trackers, session.game, session.game.ticks());
    }
    stop();
    const graded = definitions[familyId].grade(checkpoint);
    const passedCount = graded.assertions.filter((item) => item.passed).length;
    const taskPass = passedCount === graded.assertions.length;
    const completedAt = new Date();
    return {
      runId,
      evalVersion: "openfront-micro-v2",
      graderVersion: `${familyId}-v2`,
      familyId,
      fixtureId: MICRO_EVAL_FIXTURES[familyId].fixtureId,
      split: "development",
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      configuration: {
        scenarioId: SCENARIO.id,
        openfrontCommit: OPENFRONT_COMMIT,
        model: agent.requestedModel,
        resolvedModel: agentResult.model,
        provider: agentResult.provider,
        promptVersion: agent.promptVersion ?? null,
      },
      checkpoint: {
        tick: observation.tick,
        stateHash: checkpoint.hashes.state,
        observationHash: checkpoint.hashes.observation,
        candidateMenuHash: checkpoint.hashes.candidateMenu,
        tileStateHash: checkpoint.hashes.tileState,
        initialTileCount: checkpoint.context.initialTiles,
        troopCapacityPercent: checkpoint.context.initialCapacity,
        ...checkpoint.source,
      },
      trace: {
        observation,
        candidates,
        strategy:
          agentResult.decision?.strategy ??
          `Decision failed; holding. ${agentResult.error ?? ""}`
            .trim()
            .slice(0, 160),
        selectedActionIds: [selectedActionId],
        appliedActionIds: [resolved.action.id],
        actionOutcomes: actionOutcomes(
          trackers,
          session.game,
          session.game.ticks(),
        ),
        attempts: agentResult.attempts,
        attemptFailures: agentResult.attemptFailures,
        attemptTimings: agentResult.attemptTimings,
        fallback: agentResult.decision === null || resolved.fallback,
        latencyMs: agentResult.latencyMs,
        promptTokens: agentResult.promptTokens,
        completionTokens: agentResult.completionTokens,
        costUsd: agentResult.costUsd,
      },
      outcome: {
        finalTick: session.game.ticks(),
        finalStateHash: session.lastHash,
        finalTileCount: player.numTilesOwned(),
        finalTroops: Math.floor(player.troops()),
        finalTroopCapacityPercent: capacity(checkpoint),
        assertions: graded.assertions,
        diagnostics: graded.diagnostics,
        componentCoverage:
          graded.assertions.length === 0
            ? 0
            : passedCount / graded.assertions.length,
        taskPass,
        taskScore: taskPass ? 100 : 0,
      },
      replay: session.createReplayRecord(startedAt),
    };
  } finally {
    session.close();
  }
}
