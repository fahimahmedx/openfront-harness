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
  resolveDecisionActions,
} from "../ObservationActions";
import { OPENFRONT_COMMIT, SCENARIO } from "../Scenario";
import {
  AgentResult,
  DecisionRecord,
  LegalAction,
  Observation,
} from "../Types";
import {
  createNeutralExpansionCheckpoint,
  NeutralExpansionAgent,
} from "./NeutralExpansionEval";
import {
  canonicalHash,
  createReplayCheckpoint,
  ReplayCheckpoint,
  ReplayFamilyId,
  replayFixtureMetadata,
  tileStateHash,
} from "./ReplayCheckpoint";

export const REMAINING_MICRO_EVAL_FAMILIES = [
  "saturated-capacity-expansion",
  "post-expansion-recovery",
  "weaker-target-selection",
  "frontier-restraint",
  "incoming-attack-response",
  "split-front-defense",
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
        "91b256093f90d381f7e773342ade79024025cbd34144cc30a8d970c82f565310",
      candidateMenu:
        "2f60d26414e070410b9fd4bdca3cc3c6105a65b18dbab45ca2aa3d0c5525dc3e",
      tileState:
        "302b018da4f21866ee2aa61e3e56b6066a0438432a03ea52bb40f831ce10db68",
    },
  },
  "post-expansion-recovery": {
    fixtureId: "post-expansion-recovery-japan-001",
    horizonTicks: 100,
    expectedCheckpoint: {
      state: 153243526461091,
      observation:
        "7bdad92ba7e9ad3057ec9de5a07b89715a7575101f84c639f3c596bc54aab409",
      candidateMenu:
        "a0871c00125cd188453590ec8e47f2f269c632c3e9a0010d77f94d338c6d35f7",
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
        "f4024f54c62dd1b8a8abee4f54660649f6aa6c8245c178ed4f32c863460bb0d8",
      candidateMenu:
        "f5b9007881da41f5b0b0f128a4e9d391d64dffeef5b08da8e9aefe4ddb619739",
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
        "d01bdd1b7728c851373a0d6238475f3e4aa490025f93bdbefedec61f6e64e0bf",
      candidateMenu:
        "3a74f932cf6acfed3827d95c120fced86ed4d3444dc81054c14e723e3de9dade",
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
        "3d64dd7da745cfbcf09a1138531ad42e1109f240b07e14bc570806a6190eb78d",
      candidateMenu:
        "adbe1cde97fae0bb8acb4e48f5bfca3ed094dcbd03b3820dba51c5eb9583a0d7",
      tileState:
        "9fd62a0db30bc50168b0205720cb6a4a9ec968c3dc84953a22918392fd5eee68",
    },
  },
  "split-front-defense": {
    fixtureId: "split-front-defense-japan-001",
    horizonTicks: 200,
    expectedCheckpoint: {
      state: 5353959940620816,
      observation:
        "ca7c9e949bfd9609227b7fb25beb5d1a24af4bf166ea366cd7ab2eabf673f02b",
      candidateMenu:
        "6c0b2d01dea6b3248f9015a9b9997859819fe64250721ff9c37de5566797de61",
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
        "080355ac5a2bd2e947435232d8259860ad18c0fde9e9239948d1f2813869e551",
      candidateMenu:
        "05e9fe8f3858f48582c13f3d82d9614d4add3594f8c4c50d5b30210a45370e86",
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
        "47c2ded8fb5b3b8848ab7c4a11c85e60677a49499dadff98c184f5926bcc3ed7",
      candidateMenu:
        "af43b31fc6ce92a51c67174cc1e82ae66591d17e0137672967b97726d2a5b677",
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
        "7a59c712ad98dd7154a86aa005cb17c5a72ffe440f1b552b1e27703dbb814d5f",
      candidateMenu:
        "9ae7e0094b0cacc894e934e46d7d4aff64710d591924d373055b148d7cfae7de",
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
  defenseZoneTiles?: Set<number>;
};

export type MicroEvalCheckpoint = ReplayCheckpoint & {
  context: TaskContext;
};

export type MicroEvalTrial = {
  runId: string;
  evalVersion: "openfront-micro-v1";
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
    selectedActionIds: [string, string];
    appliedActionIds: [string, string];
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
  reference(checkpoint: MicroEvalCheckpoint): [string, string];
  controls(checkpoint: MicroEvalCheckpoint): Array<[string, string]>;
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

function diplomacyControl(checkpoint: MicroEvalCheckpoint): [string, string] {
  return [
    checkpoint.candidates.find(
      (candidate) => candidate.category === "diplomacy",
    )?.id ?? "hold:1",
    "hold:2",
  ];
}

const definitions: Record<MicroEvalFamilyId, TaskDefinition> = {
  "saturated-capacity-expansion": {
    horizonTicks: 100,
    reference: (checkpoint) => [
      largest(checkpoint.candidates, "expand:neutral:"),
      "hold:2",
    ],
    controls: (checkpoint) => [
      ["hold:1", "hold:2"],
      diplomacyControl(checkpoint),
    ],
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
    reference: () => ["hold:1", "hold:2"],
    controls: (checkpoint) => [
      [
        largest(checkpoint.candidates, "expand:neutral:"),
        largest(checkpoint.candidates, "expand:neutral:"),
      ],
      [
        checkpoint.candidates.find(
          (candidate) => candidate.category === "retreat",
        )?.id ?? "hold:1",
        "hold:2",
      ],
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
      return [id, id];
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
        ["hold:1", "hold:2"],
        strong
          ? [
              largest(checkpoint.candidates, `attack:${strong.id}:`),
              largest(checkpoint.candidates, `attack:${strong.id}:`),
            ]
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
    reference: () => ["hold:1", "hold:2"],
    controls: (checkpoint) => {
      const id = largest(checkpoint.candidates, "attack:");
      return [[id, id], diplomacyControl(checkpoint)];
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
      return [id, id];
    },
    controls: (checkpoint) => [
      ["hold:1", "hold:2"],
      diplomacyControl(checkpoint),
    ],
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
  "split-front-defense": {
    horizonTicks: 200,
    reference: (checkpoint) =>
      checkpoint.context.attackers!.map((attacker) =>
        largest(checkpoint.candidates, `counter:${attacker.id()}:`),
      ) as [string, string],
    controls: (checkpoint) => {
      const one = largest(
        checkpoint.candidates,
        `counter:${checkpoint.context.attackers![0].id()}:`,
      );
      return [
        ["hold:1", "hold:2"],
        [one, "hold:2"],
      ];
    },
    grade: (checkpoint) => {
      const attackers = checkpoint.context.attackers!;
      const frontierAssertions = attackers.map((attacker, index) => {
        const lost = losses(
          checkpoint,
          checkpoint.context.protectedTiles!.get(attacker.id()),
        );
        const maximum = checkpoint.context.maximumAllowedLosses!.get(
          attacker.id(),
        )!;
        return assertion(
          `frontier-${index + 1}-held`,
          lost,
          "<=",
          maximum,
          lost <= maximum,
        );
      });
      return {
        assertions: [
          assertion(
            "player-alive",
            checkpoint.player.isAlive(),
            "=",
            true,
            checkpoint.player.isAlive(),
          ),
          ...frontierAssertions,
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
    reference: (checkpoint) => [
      `retreat:${checkpoint.context.originalAttackId}`,
      "hold:2",
    ],
    controls: (checkpoint) => [
      ["hold:1", "hold:2"],
      [
        largest(
          checkpoint.candidates,
          `attack:${checkpoint.context.target!.id()}:`,
        ),
        "hold:2",
      ],
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
      return [id, id];
    },
    controls: (checkpoint) => [
      ["hold:1", "hold:2"],
      diplomacyControl(checkpoint),
    ],
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
    reference: (checkpoint) => [
      checkpoint.candidates.find((candidate) =>
        candidate.id.startsWith("build:Defense Post:"),
      )!.id,
      "hold:2",
    ],
    controls: (checkpoint) => [
      ["hold:1", "hold:2"],
      diplomacyControl(checkpoint),
    ],
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
  const base = await createNeutralExpansionCheckpoint();
  try {
    const resolved = resolveDecisionActions(
      ["expand:neutral:100", "expand:neutral:75"],
      base.candidates,
    );
    base.session.execute(
      resolved.actions
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
    const recent = replayFixtureMetadata("construction-failure-recovery")
      .recentDecisions as unknown as DecisionRecord[];
    const failed = recent[recent.length - 1]?.actionOutcomes.find((outcome) =>
      outcome.actionId.startsWith("build:Defense Post:"),
    );
    if (failed !== undefined) failed.failureCode = "placement_blocked";
    const observation = createObservation(
      base.session.game,
      base.player,
      77,
      recent,
    );
    const candidates = createLegalActions(base.session.game, base.player, {
      safeBuildAnchors: true,
    });
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
      context.initialCapacity > 20 ||
      player.outgoingAttacks().filter((attack) => !attack.target().isPlayer())
        .length < 1 ||
      hostileIncoming.length > 0 ||
      !candidates.some((candidate) => candidate.category === "expand")
    )
      throw new Error("Post-expansion fixture requirements drifted");
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
    familyId === "split-front-defense"
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
    context.maximumAllowedLosses =
      familyId === "incoming-attack-response"
        ? new Map([[attackers[0].id(), 5_000]])
        : new Map([
            [attackers[0].id(), 1_500],
            [attackers[1].id(), 900],
          ]);
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
): Promise<MicroEvalCheckpoint> {
  const checkpoint =
    familyId === "post-expansion-recovery"
      ? await createPostExpansionCheckpoint()
      : familyId === "construction-failure-recovery"
        ? await createConstructionCheckpoint()
        : await createReplayCheckpoint(familyId as ReplayFamilyId);
  try {
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
    return { ...checkpoint, context: assertRequirements(familyId, checkpoint) };
  } catch (error) {
    checkpoint.session.close();
    throw error;
  }
}

export function referenceActions(
  familyId: MicroEvalFamilyId,
  checkpoint: MicroEvalCheckpoint,
): [string, string] {
  return definitions[familyId].reference(checkpoint);
}

export function controlActions(
  familyId: MicroEvalFamilyId,
  checkpoint: MicroEvalCheckpoint,
): Array<[string, string]> {
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
    const selectedActionIds = agentResult.decision?.actions ?? [
      "hold:1",
      "hold:2",
    ];
    const resolved = resolveDecisionActions(selectedActionIds, candidates);
    const intents = resolved.actions
      .map((candidate) => candidate.intent)
      .filter((intent): intent is Intent => intent !== null);
    const trackers = beginActionTracking(
      session.game,
      player,
      resolved.actions,
    );
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
      evalVersion: "openfront-micro-v1",
      graderVersion: `${familyId}-v1`,
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
        selectedActionIds: selectedActionIds as [string, string],
        appliedActionIds: resolved.actions.map((candidate) => candidate.id) as [
          string,
          string,
        ],
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
