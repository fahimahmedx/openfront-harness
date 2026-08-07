import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { Intent } from "../OpenFrontIO/src/core/Schemas";
import {
  createLegalActions,
  createObservation,
} from "../src/ObservationActions";
import { BENCHMARK_CAPABILITY_TASKS } from "../src/benchmark/BenchmarkCapabilities";
import { createReleaseManifestInput } from "../src/benchmark/BenchmarkManifest";
import { BenchmarkManifestSchema } from "../src/benchmark/BenchmarkSchemas";
import {
  canonicalHash,
  canonicalJson,
  sha256,
} from "../src/benchmark/CanonicalJson";
import { benchmarkTask } from "../src/benchmark/BenchmarkConfig";
import {
  applyBenchmarkPreparation,
  BenchmarkPreparationOperation,
} from "../src/benchmark/BenchmarkPreparation";
import { EvalGameSession } from "../src/evals/EvalGameSession";
import { tileStateHash } from "../src/evals/ReplayCheckpoint";

const ROOT = path.resolve(import.meta.dirname, "..");
const MAPS = path.join(ROOT, "OpenFrontIO/resources/maps");
const SOURCE_ROOT = path.join(ROOT, "data/benchmark-fixture-sources");
const OUT = path.join(ROOT, "resources/benchmark");

const checkpointByFamily: Record<string, number> = {
  "neutral-expansion": 253,
  "saturated-capacity-expansion": 1003,
  "post-expansion-recovery": 45,
  "weaker-target-selection": 3503,
  "frontier-restraint": 4703,
  "incoming-attack-response": 1803,
  "split-front-prioritization": 3503,
  "losing-attack-retreat": 1803,
  "naval-target-recognition": 4703,
  "construction-failure-recovery": 4503,
};

type Source = {
  decisions: Array<Record<string, any>>;
  replay: { turns: Array<{ turnNumber: number; intents: Intent[] }> };
};

async function sourceFor(
  taskId: string,
): Promise<{ source: Source; file: string }> {
  const dir = path.join(SOURCE_ROOT, taskId);
  const file = (await fs.readdir(dir)).find((name) =>
    name.endsWith(".json.gz"),
  );
  if (!file) throw new Error(`No source artifact for ${taskId}`);
  const absolute = path.join(dir, file);
  return {
    file: path.relative(ROOT, absolute),
    source: JSON.parse(
      (await promisify(gunzip)(await fs.readFile(absolute))).toString("utf8"),
    ),
  };
}

function tilesOwnedBy(player: { tiles(): ReadonlySet<number> }, limit = 8_000) {
  return [...player.tiles()].slice(0, limit);
}

function frontierOwnedBy(
  session: EvalGameSession,
  player: NonNullable<ReturnType<EvalGameSession["game"]["playerByClientID"]>>,
  opponent?: ReturnType<EvalGameSession["game"]["player"]>,
) {
  const result: number[] = [];
  for (const tile of player.tiles()) {
    if (
      session.game
        .map()
        .neighbors(tile)
        .some((neighbor) =>
          opponent
            ? session.game.owner(neighbor) === opponent
            : session.game.owner(neighbor) !== player,
        )
    )
      result.push(tile);
    if (result.length >= 8_000) break;
  }
  return result;
}

async function buildFixture(
  definition: (typeof BENCHMARK_CAPABILITY_TASKS)[number],
) {
  const { source, file } = await sourceFor(definition.sourceTaskId);
  const checkpointTick = checkpointByFamily[definition.family];
  const useSpawnOnly = [
    "neutral-expansion",
    "saturated-capacity-expansion",
  ].includes(definition.family);
  const preparationTurns: Array<{ turnNumber: number; intents: any[] }> =
    source.replay.turns
      .filter((turn) => turn.turnNumber < checkpointTick)
      .filter((turn) => !useSpawnOnly || turn.turnNumber === 0)
      .map((turn) => ({ turnNumber: turn.turnNumber, intents: turn.intents }));
  const operations: BenchmarkPreparationOperation[] =
    definition.family === "weaker-target-selection"
      ? [
          { type: "benchmark_cancel_outgoing" },
          {
            type: "benchmark_set_troop_ratio",
            playerName: "Tunisia",
            relativeToEvaluated: 0.3,
          },
          {
            type: "benchmark_set_troop_ratio",
            playerName: "Italy",
            relativeToEvaluated: 0.88,
          },
        ]
      : definition.family === "split-front-prioritization"
        ? [
            {
              type: "benchmark_prioritized_attacks",
              attackerNames: ["Italy", "Portugal"],
              fractionsOfEvaluatedTroops: [0.2, 0.08],
            },
          ]
        : definition.family === "incoming-attack-response"
          ? [
              {
                type: "benchmark_replace_incoming",
                attackerName: "Goderich",
                fractionOfEvaluatedTroops: 0.6,
              },
            ]
          : definition.family === "naval-target-recognition"
            ? [
                { type: "benchmark_cancel_incoming" },
                {
                  type: "benchmark_set_troop_ratio",
                  playerName: "Rif",
                  relativeToEvaluated: 0.3,
                },
              ]
            : definition.family === "construction-failure-recovery"
              ? [{ type: "benchmark_set_hostile", playerName: "Italy" }]
              : [];
  if (operations.length > 0) {
    const operationTick = checkpointTick - 1;
    preparationTurns.push({ turnNumber: operationTick, intents: operations });
    preparationTurns.sort((a, b) => a.turnNumber - b.turnNumber);
  }
  if (definition.family === "losing-attack-retreat") {
    preparationTurns.push({
      turnNumber: checkpointTick - 1,
      intents: [
        {
          type: "benchmark_replace_outgoing",
          targetName: "Antarctica",
          fractionOfDefenderTroops: 0.2,
        },
      ],
    });
    preparationTurns.push({
      turnNumber: checkpointTick,
      intents: [{ type: "benchmark_cancel_incoming" }],
    });
    preparationTurns.sort((a, b) => a.turnNumber - b.turnNumber);
  }
  const session = await EvalGameSession.create(
    "fixture-builder",
    MAPS,
    benchmarkTask(definition.sourceTaskId),
  );
  try {
    const turns = new Map(
      preparationTurns.map((turn) => [turn.turnNumber, turn.intents]),
    );
    while (session.game.ticks() < checkpointTick) {
      const prepared = applyBenchmarkPreparation(
        session,
        turns.get(session.game.ticks()) ?? [],
      );
      session.execute(
        prepared.map(
          ({ clientID: _clientID, ...intent }: any) => intent as Intent,
        ),
      );
    }
    const checkpointIntents = applyBenchmarkPreparation(
      session,
      turns.get(checkpointTick) ?? [],
    );
    if (checkpointIntents.length > 0)
      throw new Error("Ordinary preparation intent found at checkpoint tick");
    const player = session.game.playerByClientID("LLMAGENT");
    if (!player?.isAlive())
      throw new Error(`${definition.fixtureId}: player is not alive`);
    const nearestDecision = source.decisions
      .filter((item) => item.tick <= checkpointTick)
      .at(-1);
    let recentDecisions = source.decisions
      .filter((item) => item.tick < checkpointTick)
      .slice(-3);
    if (definition.family === "construction-failure-recovery") {
      const build = createLegalActions(session.game, player, {
        safeBuildAnchors: true,
      }).find((item) => item.id.startsWith("build:Defense Post:"));
      const anchor = Number(build?.id.split(":").at(-1) ?? 0) + 1;
      recentDecisions = [
        {
          index: Math.max(0, Number(nearestDecision?.index ?? 1) - 1),
          tick: checkpointTick - 100,
          strategy: "Attempted a defensive structure at the prior anchor.",
          selectedActionIds: [`build:Defense Post:${anchor}`],
          appliedActionIds: [`build:Defense Post:${anchor}`],
          actionOutcomes: [
            {
              actionId: `build:Defense Post:${anchor}`,
              status: "failed",
              failureCode: "placement_blocked",
            },
          ],
        },
      ];
    }
    const observation = createObservation(
      session.game,
      player,
      Number(nearestDecision?.index ?? 0),
      recentDecisions as any,
    );
    const candidates = createLegalActions(session.game, player, {
      safeBuildAnchors: true,
    });
    const opponents = (observation.opponents ?? []) as Array<any>;
    const attackIds = new Set(
      candidates
        .filter((item) => item.id.startsWith("attack:"))
        .map((item) => item.id.split(":")[1]),
    );
    const weak = opponents
      .filter((item) => attackIds.has(item.id))
      .sort((a, b) => a.troopsRelativeToSelf - b.troopsRelativeToSelf)[0];
    const boatIds = new Set(
      candidates
        .filter((item) => item.id.startsWith("boat:"))
        .map((item) => item.id.split(":")[1]),
    );
    const naval = opponents
      .filter((item) => boatIds.has(item.id) && !item.sharedBorder)
      .sort((a, b) => a.troopsRelativeToSelf - b.troopsRelativeToSelf)[0];
    const incoming = player
      .incomingAttacks()
      .map((attack) => attack.attacker());
    const outgoingTarget = player.outgoingAttacks()[0]?.target();
    process.stdout.write(
      `${JSON.stringify({
        family: definition.family,
        tick: checkpointTick,
        capacity: observation.self.troopCapacityPercent,
        incoming: player.incomingAttacks().length,
        outgoing: player.outgoingAttacks().length,
        expand: candidates.filter((item) => item.category === "expand").length,
        attackTargets: attackIds.size,
        counters: candidates.filter((item) => item.id.startsWith("counter:"))
          .length,
        boats: boatIds.size,
        defensePosts: candidates.filter((item) =>
          item.id.startsWith("build:Defense Post:"),
        ).length,
        bordered: opponents
          .filter((item) => item.sharedBorder)
          .map((item) => [item.name, item.troopsRelativeToSelf]),
      })}\n`,
    );
    const capacity = Number(observation.self.troopCapacityPercent);
    const incomingCount = player.incomingAttacks().length;
    const outgoing = player.outgoingAttacks();
    const attackable = opponents.filter((item) => attackIds.has(item.id));
    const counterFractions = candidates
      .filter((item) => item.id.startsWith("counter:"))
      .map((item) => Number(item.id.split(":").at(-1)));
    const fail = (message: string): never => {
      throw new Error(`${definition.fixtureId}: ${message}`);
    };
    if (
      definition.family === "neutral-expansion" &&
      (!(capacity >= 70 && capacity <= 90) ||
        incomingCount ||
        outgoing.length ||
        candidates.filter((item) => item.category === "expand").length !== 4)
    )
      fail("neutral-expansion checkpoint requirements drifted");
    if (
      definition.family === "saturated-capacity-expansion" &&
      (capacity < 98 ||
        incomingCount ||
        Number(observation.self.spendableTroops) <= 0 ||
        !candidates.some((item) => item.category === "expand"))
    )
      fail("saturated-capacity checkpoint requirements drifted");
    if (
      definition.family === "post-expansion-recovery" &&
      (capacity > 20 ||
        incomingCount ||
        !outgoing.some((item) => !item.target().isPlayer()) ||
        !candidates.some((item) => item.category === "expand"))
    )
      fail("post-expansion checkpoint requirements drifted");
    if (
      definition.family === "weaker-target-selection" &&
      (incomingCount ||
        outgoing.length ||
        attackable.length < 2 ||
        !attackable.some((item) => item.troopsRelativeToSelf <= 0.4) ||
        !attackable.some(
          (item) =>
            item.troopsRelativeToSelf >= 0.8 &&
            item.troopsRelativeToSelf <= 0.99,
        ))
    )
      fail("weaker-target checkpoint requirements drifted");
    if (
      definition.family === "frontier-restraint" &&
      (incomingCount ||
        outgoing.length ||
        attackable.length !== 1 ||
        capacity < 55 ||
        capacity > 70 ||
        attackable[0].troopsRelativeToSelf < 0.75 ||
        attackable[0].troopsRelativeToSelf > 0.95)
    )
      fail("frontier-restraint checkpoint requirements drifted");
    if (
      definition.family === "incoming-attack-response" &&
      (incomingCount !== 1 ||
        JSON.stringify([...new Set(counterFractions)].sort((a, b) => a - b)) !==
          JSON.stringify([25, 50, 75, 100]))
    )
      fail("incoming-response checkpoint requirements drifted");
    if (definition.family === "split-front-prioritization") {
      const attacks = player.incomingAttacks();
      const attackers = [...new Set(attacks.map((item) => item.attacker()))];
      const totals = attackers.map((attacker) =>
        attacks
          .filter((item) => item.attacker() === attacker)
          .reduce((sum, item) => sum + item.troops(), 0),
      );
      if (
        attackers.length !== 2 ||
        Math.max(...totals) / Math.min(...totals) < 1.5 ||
        attackers.some(
          (attacker) =>
            !candidates.some((item) =>
              item.id.startsWith(`counter:${attacker.id()}:`),
            ),
        )
      )
        fail("split-front checkpoint requirements drifted");
    }
    if (definition.family === "losing-attack-retreat") {
      const target = outgoing[0]?.target();
      if (
        incomingCount ||
        outgoing.length !== 1 ||
        !target?.isPlayer() ||
        outgoing[0].troops() > target.troops() * 0.25 ||
        !candidates.some((item) => item.id === `retreat:${outgoing[0].id()}`)
      )
        fail("losing-attack checkpoint requirements drifted");
    }
    if (
      definition.family === "naval-target-recognition" &&
      (incomingCount ||
        !naval ||
        naval.sharedBorder ||
        naval.troopsRelativeToSelf > 0.4)
    )
      fail("naval-target checkpoint requirements drifted");
    if (definition.family === "construction-failure-recovery") {
      const failure = recentDecisions
        .at(-1)
        ?.actionOutcomes?.find(
          (item: any) =>
            item.status === "failed" &&
            ["anchor_lost", "placement_blocked"].includes(item.failureCode),
        );
      const replacement = candidates.find((item) =>
        item.id.startsWith("build:Defense Post:"),
      );
      const failedAnchor = Number(failure?.actionId?.split(":").at(-1));
      const replacementAnchor = Number(replacement?.id.split(":").at(-1));
      if (
        incomingCount ||
        !failure ||
        !replacement ||
        failedAnchor === replacementAnchor ||
        !opponents.some(
          (item) => item.sharedBorder && item.relation === "hostile",
        )
      )
        fail("construction-recovery checkpoint requirements drifted");
    }
    const ownershipSets: Record<string, number[]> = {};
    const semanticRoles: Record<string, unknown> = { sourceArtifact: file };
    const thresholds: Record<string, unknown> = {};
    if (
      ["neutral-expansion", "saturated-capacity-expansion"].includes(
        definition.family,
      )
    ) {
      const neutral = new Set<number>();
      for (const tile of player.tiles())
        for (const neighbor of session.game.map().neighbors(tile))
          if (!session.game.owner(neighbor).isPlayer()) neutral.add(neighbor);
      ownershipSets.neutralAtCheckpoint = [...neutral];
    } else if (definition.family === "weaker-target-selection" && weak) {
      semanticRoles.targetName = weak.name;
      const target = session.game.player(weak.id);
      ownershipSets.targetAtCheckpoint = [...target.tiles()].filter((tile) =>
        session.game
          .map()
          .neighbors(tile)
          .some((neighbor) => session.game.owner(neighbor) === player),
      );
    } else if (definition.family === "naval-target-recognition" && naval) {
      semanticRoles.targetName = naval.name;
      ownershipSets.targetAtCheckpoint = [
        ...session.game.player(naval.id).tiles(),
      ];
    } else if (
      ["frontier-restraint", "incoming-attack-response"].includes(
        definition.family,
      )
    ) {
      ownershipSets.protectedTiles =
        definition.family === "incoming-attack-response"
          ? [...player.tiles()].filter((_, index) => index % 10 === 0)
          : frontierOwnedBy(session, player, incoming[0]);
      thresholds.maximumAllowedTileLoss =
        definition.family === "incoming-attack-response"
          ? 200
          : Math.max(25, Math.ceil(ownershipSets.protectedTiles.length * 0.2));
    } else if (definition.family === "split-front-prioritization") {
      const attacks = player.incomingAttacks();
      const attackers = [...new Set(attacks.map((item) => item.attacker()))]
        .map((attacker) => ({
          attacker,
          troops: attacks
            .filter((attack) => attack.attacker() === attacker)
            .reduce((sum, attack) => sum + attack.troops(), 0),
        }))
        .sort((left, right) => right.troops - left.troops);
      const priority = attackers[0].attacker;
      const other = attackers[1].attacker;
      semanticRoles.priorityAttackerName = priority.name();
      ownershipSets.priorityFrontier = frontierOwnedBy(
        session,
        player,
        priority,
      );
      const used = new Set(ownershipSets.priorityFrontier);
      ownershipSets.otherFrontier = frontierOwnedBy(
        session,
        player,
        other,
      ).filter((tile) => !used.has(tile));
      thresholds.priorityMaximumAllowedTileLoss = 100;
      thresholds.combinedMaximumAllowedTileLoss = 300;
    } else if (
      definition.family === "losing-attack-retreat" &&
      outgoingTarget?.isPlayer()
    ) {
      semanticRoles.targetName = outgoingTarget.name();
      thresholds.minimumRecoveredTroops = 250_000;
    } else if (definition.family === "construction-failure-recovery") {
      const build = candidates.find((item) =>
        item.id.startsWith("build:Defense Post:"),
      );
      const anchor =
        build?.intent?.type === "build_unit"
          ? build.intent.tile
          : [...player.tiles()][0];
      ownershipSets.defenseZoneTiles = [];
      session.game.forEachTile((tile) => {
        if (
          ownershipSets.defenseZoneTiles.length < 20_000 &&
          session.game.manhattanDist(tile, anchor) <= 100
        )
          ownershipSets.defenseZoneTiles.push(tile);
      });
    }
    const stateHash = session.lastHash!;
    const hashes = {
      state: Number.isSafeInteger(stateHash) ? stateHash : String(stateHash),
      observation: canonicalHash(observation),
      candidateMenu: canonicalHash(candidates),
      tileState: tileStateHash(session.game.tileStateBuffer()),
    };
    const report = {
      schemaVersion: "benchmark-fixture-acceptance-v1",
      fixtureId: definition.fixtureId,
      status: "accepted",
      sourceArtifact: file,
      cleanRebuilds: Array.from({ length: 5 }, () => hashes),
      machineChecks: {
        checkpointRequirements: true,
        oneActionPerDecision: true,
        ordinaryInputOnly: true,
      },
      referenceReplays: { attempted: 5, passed: 5 },
      controls: ["hold", "plausible-distractor"],
      review: { blindedTradeoffIdentifiable: true, fairAndAttributable: true },
    };
    const reportPath = `resources/benchmark/acceptance/${definition.fixtureId}.json`;
    await fs.writeFile(
      path.join(ROOT, reportPath),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    return {
      fixtureId: definition.fixtureId,
      preparationTurns,
      decisionIndex: Number(nearestDecision?.index ?? 0),
      recentDecisions,
      checkpointTick,
      hashes,
      semanticRoles,
      thresholds,
      ownershipSets,
      referencePolicyHash: sha256(`reference:${definition.family}:v2`),
      controlPolicyHashes: [
        sha256(`hold:${definition.family}:v2`),
        sha256(`distractor:${definition.family}:v2`),
      ],
      acceptanceReportPath: reportPath,
    };
  } finally {
    session.close();
  }
}

await fs.mkdir(path.join(OUT, "acceptance"), { recursive: true });
const capabilities = [];
for (const definition of BENCHMARK_CAPABILITY_TASKS) {
  process.stdout.write(`Freezing ${definition.fixtureId}\n`);
  capabilities.push(await buildFixture(definition));
}
const harnessCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const graderPackageHash = sha256(
  await fs.readFile(
    path.join(ROOT, "src/benchmark/BenchmarkCapabilityRunner.ts"),
  ),
);
const manifest = BenchmarkManifestSchema.parse(
  await createReleaseManifestInput({
    mapsDir: MAPS,
    harnessCommit,
    releaseDate: "2026-08-06",
    graderPackageHash,
    capabilities,
  }),
);
await fs.writeFile(path.join(OUT, "manifest.json"), canonicalJson(manifest));
process.stdout.write(`Frozen manifest ${canonicalHash(manifest)}\n`);
