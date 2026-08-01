import { closestTwoTiles } from "../OpenFrontIO/src/core/execution/Util";
import {
  Game,
  Player,
  Structures,
  UnitType,
} from "../OpenFrontIO/src/core/game/Game";
import { canBuildTransportShip } from "../OpenFrontIO/src/core/game/TransportShipUtils";
import { Intent } from "../OpenFrontIO/src/core/Schemas";
import { SCENARIO } from "./Scenario";
import {
  areConflictingLegalActions,
  DecisionRecord,
  isRepeatableLegalAction,
  LegalAction,
  Observation,
  ObservationSchema,
  TIMER_VICTORY_RULE,
} from "./Types";

const TROOP_BUDGET_FRACTIONS = [25, 50, 75, 100] as const;
export const TROOP_POLICY = SCENARIO.troopPolicy;

export type TroopPolicyMode = "expansion" | "combat" | "emergency";

export type TroopBudget = {
  mode: TroopPolicyMode;
  reserveRatio: number;
  reserveFloorTroops: number;
  spendableTroops: number;
  perActionTroopBudget: number;
};
const STRUCTURE_TYPES = [
  UnitType.City,
  UnitType.DefensePost,
  UnitType.Port,
  UnitType.Factory,
  UnitType.SAMLauncher,
  UnitType.MissileSilo,
] as const;
const NUKE_TYPES = [
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
] as const;

function compactGold(value: bigint): string {
  return value.toString();
}

function playerSummary(game: Game, player: Player) {
  const unitCounts = Object.values(UnitType)
    .map((type) => [type, player.unitCount(type)] as const)
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  const maxTroops = game.config().maxTroops(player);
  const troops = player.troops();
  const totalIncomingTroops = player
    .incomingAttacks()
    .reduce((sum, attack) => sum + attack.troops(), 0);
  const totalOutgoingTroops = player
    .outgoingAttacks()
    .reduce((sum, attack) => sum + attack.troops(), 0);
  return {
    id: player.id(),
    name: player.name(),
    type: player.type(),
    alive: player.isAlive(),
    tiles: player.numTilesOwned(),
    territoryPercent:
      game.numLandTiles() === 0
        ? 0
        : Number(
            ((player.numTilesOwned() / game.numLandTiles()) * 100).toFixed(3),
          ),
    troops: Math.floor(troops),
    maxTroops: Math.floor(maxTroops),
    troopCapacityPercent:
      maxTroops === 0 ? 0 : Number(((troops / maxTroops) * 100).toFixed(2)),
    troopGrowthPerSecond: Number(
      (game.config().troopIncreaseRate(player) * 10).toFixed(1),
    ),
    totalIncomingTroops: Math.floor(totalIncomingTroops),
    totalOutgoingTroops: Math.floor(totalOutgoingTroops),
    gold: compactGold(player.gold()),
    units: Object.fromEntries(unitCounts),
    incomingAttacks: player.incomingAttacks().map((attack) => ({
      id: attack.id(),
      from: attack.attacker().id(),
      troops: Math.floor(attack.troops()),
      naval: attack.sourceTile() !== null,
    })),
    outgoingAttacks: player.outgoingAttacks().map((attack) => ({
      id: attack.id(),
      target: attack.target().id(),
      troops: Math.floor(attack.troops()),
      naval: attack.sourceTile() !== null,
    })),
  };
}

export function createObservation(
  game: Game,
  player: Player,
  decision: number,
  recent: DecisionRecord[],
): Observation {
  const elapsedSeconds = game.elapsedGameSeconds();
  const policy = troopPolicyState(game, player);
  const standings = [...game.players()]
    .map((candidate, order) => ({ candidate, order }))
    .sort(
      (a, b) =>
        b.candidate.numTilesOwned() - a.candidate.numTilesOwned() ||
        a.order - b.order,
    );
  const currentRank =
    standings.findIndex(({ candidate }) => candidate === player) + 1;
  const territoryLeader = standings[0]?.candidate ?? player;
  const leaderTerritoryPercent =
    game.numLandTiles() === 0
      ? 0
      : Number(
          (
            (territoryLeader.numTilesOwned() / game.numLandTiles()) *
            100
          ).toFixed(3),
        );
  const selfTerritoryPercent =
    game.numLandTiles() === 0
      ? 0
      : Number(
          ((player.numTilesOwned() / game.numLandTiles()) * 100).toFixed(3),
        );
  const isTerritoryLeader = standings[0]?.candidate === player;
  const runnerUp = standings.find(({ candidate }) => candidate !== player);
  const runnerUpTerritoryPercent =
    runnerUp === undefined || game.numLandTiles() === 0
      ? selfTerritoryPercent
      : Number(
          (
            (runnerUp.candidate.numTilesOwned() / game.numLandTiles()) *
            100
          ).toFixed(3),
        );
  const opponents = game
    .players()
    .filter((candidate) => candidate !== player)
    .sort((a, b) => a.id().localeCompare(b.id()))
    .map((candidate) => ({
      ...playerSummary(game, candidate),
      sharedBorder: player.sharesBorderWith(candidate),
      allied: player.isAlliedWith(candidate),
      relation: player.relation(candidate),
      canAttack: player.canAttackPlayer(candidate),
      troopsRelativeToSelf: Number(
        (candidate.troops() / Math.max(1, player.troops())).toFixed(3),
      ),
    }));

  return ObservationSchema.parse({
    scenarioId: SCENARIO.id,
    decision,
    tick: game.ticks(),
    elapsedSeconds,
    timeRemainingSeconds: Math.max(
      0,
      SCENARIO.maxSimulatedMinutes * 60 - elapsedSeconds,
    ),
    instantVictoryTerritoryPercent: game.config().percentageTilesOwnedToWin(),
    currentRank: Math.max(1, currentRank),
    territoryLeader: {
      id: territoryLeader.id(),
      name: territoryLeader.name(),
      territoryPercent: leaderTerritoryPercent,
    },
    isTerritoryLeader,
    territoryLeadPercent: Number(
      (isTerritoryLeader
        ? Math.max(0, selfTerritoryPercent - runnerUpTerritoryPercent)
        : 0
      ).toFixed(3),
    ),
    territoryDeficitPercent: Number(
      (isTerritoryLeader
        ? 0
        : Math.max(0, leaderTerritoryPercent - selfTerritoryPercent)
      ).toFixed(3),
    ),
    timerVictoryRule: TIMER_VICTORY_RULE,
    landTiles: game.numLandTiles(),
    self: {
      ...playerSummary(game, player),
      spawn: player.spawnTile()
        ? {
            x: game.x(player.spawnTile()!),
            y: game.y(player.spawnTile()!),
          }
        : null,
      allies: player
        .allies()
        .map((ally) => ally.id())
        .sort(),
      traitor: player.isTraitor(),
      immune: player.isImmune(),
      troopPolicyMode: policy.mode,
      reserveFloorTroops: policy.reserveFloorTroops,
      reserveFloorPercent: Number((policy.reserveRatio * 100).toFixed(1)),
      spendableTroops: policy.spendableTroops,
      perActionTroopBudget: policy.perActionTroopBudget,
    },
    opponents,
    recentDecisions: recent.slice(-3).map((record) => ({
      tick: record.tick,
      strategy: record.strategy,
      actions: record.appliedActionIds,
      outcomes: record.outcomes,
      actionOutcomes: record.actionOutcomes,
    })),
  });
}

function action(
  id: string,
  category: LegalAction["category"],
  label: string,
  intent: Intent | null,
): LegalAction {
  return { id, category, label, intent };
}

export function calculateTroopBudget(
  currentTroops: number,
  maxTroops: number,
  mode: TroopPolicyMode,
  actionSlots: number = SCENARIO.actionSlots,
): TroopBudget {
  const reserveRatio =
    mode === "combat"
      ? TROOP_POLICY.combatReserveRatio
      : mode === "emergency"
        ? TROOP_POLICY.emergencyReserveRatio
        : TROOP_POLICY.expansionReserveRatio;
  const reserveFloorTroops = Math.ceil(maxTroops * reserveRatio);
  const spendableTroops = Math.max(
    0,
    Math.floor(currentTroops) - reserveFloorTroops,
  );
  return {
    mode,
    reserveRatio,
    reserveFloorTroops,
    spendableTroops,
    perActionTroopBudget: Math.floor(spendableTroops / actionSlots),
  };
}

function hasUnownedLandBorder(game: Game, player: Player): boolean {
  for (const border of player.borderTiles()) {
    for (const neighbor of game.neighbors(border)) {
      if (game.isLand(neighbor) && !game.hasOwner(neighbor)) return true;
    }
  }
  return false;
}

function deterministicAnchors(game: Game, player: Player): number[] {
  const anchors = new Set<number>();
  if (player.spawnTile() !== undefined) anchors.add(player.spawnTile()!);
  const tiles = Array.from(player.tiles()).sort((a, b) => a - b);
  if (tiles.length > 0) {
    for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
      anchors.add(
        tiles[
          Math.min(tiles.length - 1, Math.floor((tiles.length - 1) * ratio))
        ],
      );
    }
  }
  const borders = Array.from(player.borderTiles()).sort((a, b) => a - b);
  if (borders.length > 0) {
    for (const ratio of [0, 0.33, 0.66, 1]) {
      anchors.add(
        borders[
          Math.min(borders.length - 1, Math.floor((borders.length - 1) * ratio))
        ],
      );
    }
  }
  return Array.from(anchors).filter((tile) => game.owner(tile) === player);
}

function firstBuildTile(
  player: Player,
  type: UnitType,
  anchors: number[],
): number | false {
  for (const anchor of anchors) {
    const tile = player.canBuild(type, anchor);
    if (tile !== false) return anchor;
  }
  return false;
}

function boatDestination(
  game: Game,
  player: Player,
  opponent: Player,
): number | null {
  const closest = closestTwoTiles(
    game,
    Array.from(player.borderTiles()).filter((tile) => game.isShore(tile)),
    Array.from(opponent.borderTiles()).filter((tile) => game.isShore(tile)),
  );
  if (
    closest === null ||
    canBuildTransportShip(game, player, closest.y) === false
  ) {
    return null;
  }
  return closest.y;
}

export function ordinaryAttackEligible(
  currentTroops: number,
  maxTroops: number,
  targetTroops: number,
): boolean {
  return (
    currentTroops / Math.max(1, maxTroops) >= TROOP_POLICY.combatTriggerRatio &&
    currentTroops > targetTroops
  );
}

export function selectTroopPolicyMode(input: {
  hostileIncoming: boolean;
  hostileBorder: boolean;
  eligibleNavalTarget: boolean;
}): TroopPolicyMode {
  if (input.hostileIncoming) return "emergency";
  return input.hostileBorder || input.eligibleNavalTarget
    ? "combat"
    : "expansion";
}

function troopPolicyState(game: Game, player: Player): TroopBudget {
  const hostileIncoming = player
    .incomingAttacks()
    .some((attack) => !player.isFriendly(attack.attacker()));

  const opponents = game
    .players()
    .filter(
      (candidate) =>
        candidate !== player &&
        candidate.isAlive() &&
        player.canAttackPlayer(candidate),
    );
  const maxTroops = game.config().maxTroops(player);
  const capacityRatio = player.troops() / Math.max(1, maxTroops);
  const hasHostileBorder = opponents.some((opponent) =>
    player.sharesBorderWith(opponent),
  );
  const hasEligibleNavalTarget =
    capacityRatio >= TROOP_POLICY.combatTriggerRatio &&
    opponents.some(
      (opponent) =>
        !player.sharesBorderWith(opponent) &&
        ordinaryAttackEligible(player.troops(), maxTroops, opponent.troops()) &&
        boatDestination(game, player, opponent) !== null,
    );
  const mode = selectTroopPolicyMode({
    hostileIncoming,
    hostileBorder: hasHostileBorder,
    eligibleNavalTarget: hasEligibleNavalTarget,
  });
  return calculateTroopBudget(
    player.troops(),
    game.config().maxTroops(player),
    mode,
  );
}

export function budgetedTroopAmounts(
  budget: TroopBudget,
  maximum: number = Number.POSITIVE_INFINITY,
): Array<{ fraction: number; troops: number }> {
  const amounts: Array<{ fraction: number; troops: number }> = [];
  const seen = new Set<number>();
  for (const fraction of TROOP_BUDGET_FRACTIONS) {
    const troops = Math.min(
      Math.floor((budget.perActionTroopBudget * fraction) / 100),
      Math.floor(maximum),
    );
    if (troops < 1 || seen.has(troops)) continue;
    seen.add(troops);
    amounts.push({ fraction, troops });
  }
  return amounts;
}

export function counterTroopCap(
  incomingFromAttacker: number,
  totalHostileIncoming: number,
  actionSlots: number = SCENARIO.actionSlots,
): number {
  return Math.floor(
    Math.min(incomingFromAttacker, totalHostileIncoming / actionSlots),
  );
}

function budgetLabel(
  troops: number,
  fraction: number,
  budget: TroopBudget,
): string {
  return `${troops.toLocaleString("en-US")} troops (${fraction}% of this slot's safe budget; ${Math.round(budget.reserveRatio * 100)}% capacity reserve)`;
}

export function createLegalActions(game: Game, player: Player): LegalAction[] {
  const actions: LegalAction[] = [
    action("hold:1", "hold", "Hold the first action slot", null),
    action("hold:2", "hold", "Hold the second action slot", null),
  ];

  if (!player.isAlive()) return actions;
  const opponents = game
    .players()
    .filter((candidate) => candidate !== player && candidate.isAlive())
    .sort((a, b) => a.id().localeCompare(b.id()));
  const policy = troopPolicyState(game, player);
  const totalHostileIncoming = player
    .incomingAttacks()
    .filter((attack) => !player.isFriendly(attack.attacker()))
    .reduce((sum, attack) => sum + attack.troops(), 0);

  if (policy.mode !== "emergency" && hasUnownedLandBorder(game, player)) {
    for (const { fraction, troops } of budgetedTroopAmounts(policy)) {
      actions.push(
        action(
          `expand:neutral:${fraction}`,
          "expand",
          `Expand into neutral land with ${budgetLabel(troops, fraction, policy)}`,
          { type: "attack", targetID: null, troops },
        ),
      );
    }
  }

  for (const opponent of opponents) {
    const incomingTroops = player
      .incomingAttacks()
      .filter(
        (attack) =>
          attack.attacker() === opponent &&
          !player.isFriendly(attack.attacker()),
      )
      .reduce((sum, attack) => sum + attack.troops(), 0);
    const countering = policy.mode === "emergency" && incomingTroops > 0;
    const ordinaryOffense =
      policy.mode !== "emergency" &&
      ordinaryAttackEligible(
        player.troops(),
        game.config().maxTroops(player),
        opponent.troops(),
      );
    const troopAmounts = countering
      ? budgetedTroopAmounts(
          policy,
          counterTroopCap(incomingTroops, totalHostileIncoming),
        )
      : ordinaryOffense
        ? budgetedTroopAmounts(policy).filter(
            ({ troops }) =>
              troops >=
              Math.ceil(
                opponent.troops() * TROOP_POLICY.minimumAttackToDefenderRatio,
              ),
          )
        : [];

    if (
      troopAmounts.length > 0 &&
      player.sharesBorderWith(opponent) &&
      player.canAttackPlayer(opponent)
    ) {
      for (const { fraction, troops } of troopAmounts) {
        actions.push(
          action(
            `${countering ? "counter" : "attack"}:${opponent.id()}:${fraction}`,
            "attack",
            `${countering ? "Counter" : "Attack"} ${opponent.name()} by land with ${budgetLabel(troops, fraction, policy)}`,
            {
              type: "attack",
              targetID: opponent.id(),
              troops,
            },
          ),
        );
      }
    } else if (troopAmounts.length > 0 && player.canAttackPlayer(opponent)) {
      const destination = boatDestination(game, player, opponent);
      if (destination !== null) {
        for (const { fraction, troops } of troopAmounts) {
          actions.push(
            action(
              `${countering ? "counter-boat" : "boat"}:${opponent.id()}:${fraction}`,
              "boat",
              `${countering ? "Counter" : "Invade"} ${opponent.name()} by sea with ${budgetLabel(troops, fraction, policy)}`,
              {
                type: "boat",
                dst: destination,
                troops,
              },
            ),
          );
        }
      }
    }

    if (player.canSendAllianceRequest(opponent)) {
      actions.push(
        action(
          `alliance:request:${opponent.id()}`,
          "diplomacy",
          `Request an alliance with ${opponent.name()}`,
          { type: "allianceRequest", recipient: opponent.id() },
        ),
      );
    }
    if (player.isAlliedWith(opponent)) {
      actions.push(
        action(
          `alliance:break:${opponent.id()}`,
          "diplomacy",
          `Break the alliance with ${opponent.name()}`,
          { type: "breakAlliance", recipient: opponent.id() },
        ),
      );
      const alliance = player.allianceInfo(opponent);
      if (alliance?.canExtend) {
        actions.push(
          action(
            `alliance:extend:${opponent.id()}`,
            "diplomacy",
            `Extend the alliance with ${opponent.name()}`,
            { type: "allianceExtension", recipient: opponent.id() },
          ),
        );
      }
    }
    if (!player.hasEmbargoAgainst(opponent)) {
      actions.push(
        action(
          `embargo:start:${opponent.id()}`,
          "diplomacy",
          `Start an embargo against ${opponent.name()}`,
          { type: "embargo", targetID: opponent.id(), action: "start" },
        ),
      );
    }
  }

  for (const outgoing of player.outgoingAttacks()) {
    actions.push(
      action(
        `retreat:${outgoing.id()}`,
        "retreat",
        `Retreat attack ${outgoing.id()} with ${Math.floor(outgoing.troops())} troops`,
        { type: "cancel_attack", attackID: outgoing.id() },
      ),
    );
  }

  const anchors = deterministicAnchors(game, player);
  for (const type of STRUCTURE_TYPES) {
    const anchor = firstBuildTile(player, type, anchors);
    if (anchor !== false) {
      actions.push(
        action(
          `build:${type}:${anchor}`,
          "build",
          `Build ${type} near (${game.x(anchor)}, ${game.y(anchor)})`,
          { type: "build_unit", unit: type, tile: anchor },
        ),
      );
    }
  }

  for (const unit of player
    .units(...Structures.types)
    .sort((a, b) => a.id() - b.id())) {
    if (player.canUpgradeUnit(unit)) {
      actions.push(
        action(
          `upgrade:${unit.type()}:${unit.id()}`,
          "upgrade",
          `Upgrade level ${unit.level()} ${unit.type()}`,
          { type: "upgrade_structure", unit: unit.type(), unitId: unit.id() },
        ),
      );
    }
  }

  const ports = player.units(UnitType.Port).sort((a, b) => a.id() - b.id());
  for (const port of ports.slice(0, 1)) {
    const water = game
      .neighbors(port.tile())
      .filter((tile) => game.isWater(tile))
      .sort((a, b) => a - b)[0];
    if (
      water !== undefined &&
      player.canBuild(UnitType.Warship, water) !== false
    ) {
      actions.push(
        action(
          `build:${UnitType.Warship}:${water}`,
          "build",
          `Build a warship from port ${port.id()}`,
          { type: "build_unit", unit: UnitType.Warship, tile: water },
        ),
      );
    }
  }

  for (const opponent of opponents) {
    const target = Array.from(opponent.tiles()).sort((a, b) => a - b)[0];
    if (target === undefined) continue;
    for (const type of NUKE_TYPES) {
      if (player.canBuild(type, target) !== false) {
        actions.push(
          action(
            `nuke:${type}:${opponent.id()}`,
            "build",
            `Launch ${type} at ${opponent.name()}`,
            { type: "build_unit", unit: type, tile: target },
          ),
        );
      }
    }
  }

  const categoryOrder: Record<LegalAction["category"], number> = {
    hold: 0,
    retreat: 1,
    expand: 2,
    attack: 3,
    boat: 4,
    build: 5,
    upgrade: 6,
    diplomacy: 7,
  };
  actions.sort(
    (a, b) =>
      categoryOrder[a.category] - categoryOrder[b.category] ||
      a.id.localeCompare(b.id),
  );

  if (actions.length <= SCENARIO.maxCandidates) return actions;
  const holds = actions.filter((candidate) => candidate.category === "hold");
  const buckets = new Map<LegalAction["category"], LegalAction[]>();
  for (const candidate of actions.filter(
    (candidate) => candidate.category !== "hold",
  )) {
    const bucket = buckets.get(candidate.category) ?? [];
    bucket.push(candidate);
    buckets.set(candidate.category, bucket);
  }
  const selected = [...holds];
  const categories = Array.from(buckets.keys()).sort(
    (a, b) => categoryOrder[a] - categoryOrder[b],
  );
  for (let round = 0; selected.length < SCENARIO.maxCandidates; round++) {
    let added = false;
    for (const category of categories) {
      const candidate = buckets.get(category)?.[round];
      if (candidate && selected.length < SCENARIO.maxCandidates) {
        selected.push(candidate);
        added = true;
      }
    }
    if (!added) break;
  }
  return selected;
}

export function resolveDecisionActions(
  selectedIds: string[],
  candidates: LegalAction[],
): { actions: LegalAction[]; fallback: boolean } {
  const byId = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const uses = new Map<string, number>();
  const structureBuildTiles = new Set<number>();
  let fallback = false;
  const resolved = [0, 1].map((slot) => {
    const id = selectedIds[slot];
    const candidate = id === undefined ? undefined : byId.get(id);
    const slotHoldId = `hold:${slot + 1}`;
    const allowedInSlot =
      candidate !== undefined &&
      (candidate.category !== "hold" || candidate.id === slotHoldId);
    const priorUses = id === undefined ? 0 : (uses.get(id) ?? 0);
    const repeatAllowed =
      candidate !== undefined &&
      (priorUses === 0 || isRepeatableLegalAction(candidate));
    const structureBuildTile =
      candidate?.intent?.type === "build_unit" &&
      Structures.has(candidate.intent.unit)
        ? candidate.intent.tile
        : undefined;
    const coordinateAvailable =
      structureBuildTile === undefined ||
      !structureBuildTiles.has(structureBuildTile);
    if (!allowedInSlot || !repeatAllowed || !coordinateAvailable) {
      fallback = true;
      return byId.get(slotHoldId)!;
    }
    uses.set(id!, priorUses + 1);
    if (structureBuildTile !== undefined) {
      structureBuildTiles.add(structureBuildTile);
    }
    return candidate;
  });
  if (areConflictingLegalActions(resolved[0], resolved[1])) {
    return {
      actions: [byId.get("hold:1")!, byId.get("hold:2")!],
      fallback: true,
    };
  }

  return { actions: resolved, fallback };
}
