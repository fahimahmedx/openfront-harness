import {
  Attack,
  Game,
  Player,
  Structures,
  Unit,
  UnitType,
} from "../OpenFrontIO/src/core/game/Game";
import {
  GameUpdateType,
  GameUpdateViewData,
} from "../OpenFrontIO/src/core/game/GameUpdates";
import { Intent } from "../OpenFrontIO/src/core/Schemas";
import { ActionOutcome, ActionOutcomeFailureCode, LegalAction } from "./Types";

type AllianceRequestRef = ReturnType<
  Player["outgoingAllianceRequests"]
>[number];

type ActionTracker = {
  action: LegalAction;
  player: Player;
  beforeSelfTiles: number;
  beforeTroops: number;
  beforeUnitIds: Set<number>;
  beforeAttackTroops: Map<string, number>;
  beforeIncomingTroops: number;
  beforeTargetTiles: number | null;
  beforeAllied: boolean | null;
  beforeUpgradeLevel: number | null;
  targetSmallId: number | null;
  targetName: string | null;
  submittedAtTick: number;
  attack?: Attack;
  unit?: Unit;
  allianceRequest?: AllianceRequestRef;
  outcome?: ActionOutcome;
};

export type TrackedAction = ActionTracker;

function intentTarget(game: Game, intent: Intent): Player | null {
  let targetId: string | null | undefined;
  switch (intent.type) {
    case "attack":
      targetId = intent.targetID;
      break;
    case "allianceRequest":
    case "breakAlliance":
    case "allianceExtension":
      targetId = intent.recipient;
      break;
    case "embargo":
      targetId = intent.targetID;
      break;
    default:
      return null;
  }
  return targetId !== null && targetId !== undefined && game.hasPlayer(targetId)
    ? game.player(targetId)
    : null;
}

function incomingFrom(player: Player, target: Player | null): number {
  if (target === null) return 0;
  return player
    .incomingAttacks()
    .filter((attack) => attack.attacker() === target)
    .reduce((sum, attack) => sum + attack.troops(), 0);
}

function attacksToward(player: Player, targetId: string | null): Attack[] {
  return player
    .outgoingAttacks()
    .filter((attack) => attack.target().id() === targetId);
}

function outcome(
  tracker: ActionTracker,
  status: ActionOutcome["status"],
  tick: number,
  detail: string,
  entityId: string | number | null = null,
  failureCode?: ActionOutcomeFailureCode,
): ActionOutcome {
  const started =
    status === "failed" ? null : (tracker.outcome?.startedAtTick ?? tick);
  return {
    actionId: tracker.action.id,
    status,
    startedAtTick: started,
    resolvedAtTick:
      status === "started" ? null : (tracker.outcome?.resolvedAtTick ?? tick),
    entityId,
    detail,
    ...(failureCode ? { failureCode } : {}),
  };
}

function failedBuildOutcome(
  tracker: ActionTracker,
  game: Game,
  tick: number,
  intent: Extract<Intent, { type: "build_unit" }>,
): ActionOutcome {
  const prefix = `${intent.unit} build became invalid before execution`;
  if (!tracker.player.isAlive()) {
    return outcome(
      tracker,
      "failed",
      tick,
      `${prefix}: the player was eliminated`,
      null,
      "player_eliminated",
    );
  }
  if (!game.isValidRef(intent.tile)) {
    return outcome(
      tracker,
      "failed",
      tick,
      `${prefix}: target tile ${intent.tile} is invalid`,
      null,
      "placement_blocked",
    );
  }
  if (
    Structures.has(intent.unit) &&
    game.owner(intent.tile) !== tracker.player
  ) {
    return outcome(
      tracker,
      "failed",
      tick,
      `${prefix}: anchor tile ${intent.tile} was no longer owned`,
      null,
      "anchor_lost",
    );
  }
  const cost = game.unitInfo(intent.unit).cost(game, tracker.player);
  if (tracker.player.gold() < cost) {
    return outcome(
      tracker,
      "failed",
      tick,
      `${prefix}: required ${cost.toString()} gold but only ${tracker.player.gold().toString()} remained`,
      null,
      "insufficient_gold",
    );
  }
  if (tracker.player.canBuild(intent.unit, intent.tile) === false) {
    return outcome(
      tracker,
      "failed",
      tick,
      `${prefix}: no valid placement remained near tile ${intent.tile}`,
      null,
      "placement_blocked",
    );
  }
  return outcome(
    tracker,
    "failed",
    tick,
    `${intent.unit} build was rejected without an observable start or state change`,
    null,
    "runtime_rejected",
  );
}

function completeImmediate(
  tracker: ActionTracker,
  tick: number,
  detail: string,
  entityId: string | number | null = null,
): void {
  tracker.outcome = outcome(tracker, "completed", tick, detail, entityId);
}

function detectAttackStart(
  tracker: ActionTracker,
  game: Game,
  tick: number,
  intent: Extract<Intent, { type: "attack" }>,
): void {
  const target = intentTarget(game, intent);
  const targetId = intent.targetID;
  const active = attacksToward(tracker.player, targetId).find(
    (attack) =>
      !tracker.beforeAttackTroops.has(attack.id()) ||
      attack.troops() >
        (tracker.beforeAttackTroops.get(attack.id()) ?? attack.troops()),
  );
  const incomingAfter = incomingFrom(tracker.player, target);

  if (active) {
    tracker.attack = active;
    tracker.outcome = outcome(
      tracker,
      "started",
      tick,
      `Attack ${active.id()} started with ${Math.floor(active.troops())} troops`,
      active.id(),
    );
    return;
  }
  if (incomingAfter < tracker.beforeIncomingTroops) {
    completeImmediate(
      tracker,
      tick,
      `Counter resolved immediately; hostile incoming troops fell from ${Math.floor(
        tracker.beforeIncomingTroops,
      )} to ${Math.floor(incomingAfter)}`,
    );
    return;
  }
  const targetTilesAfter = target?.numTilesOwned() ?? null;
  if (
    tracker.player.numTilesOwned() > tracker.beforeSelfTiles ||
    (tracker.beforeTargetTiles !== null &&
      targetTilesAfter !== null &&
      targetTilesAfter < tracker.beforeTargetTiles)
  ) {
    completeImmediate(
      tracker,
      tick,
      "Attack resolved immediately and captured territory",
    );
    return;
  }
  if (tracker.player.troops() < tracker.beforeTroops) {
    completeImmediate(
      tracker,
      tick,
      "Attack force was committed and resolved during the execution tick",
    );
  }
}

function detectUnitStart(
  tracker: ActionTracker,
  tick: number,
  unitType: UnitType,
  trackActiveUnit = false,
): void {
  const created = tracker.player
    .units(unitType)
    .find((unit) => !tracker.beforeUnitIds.has(unit.id()));
  if (!created) return;
  tracker.unit = created;
  const stillConstructing =
    Structures.has(unitType) && created.isUnderConstruction();
  tracker.outcome = outcome(
    tracker,
    stillConstructing || trackActiveUnit ? "started" : "completed",
    tick,
    stillConstructing
      ? `${unitType} ${created.id()} started construction`
      : trackActiveUnit
        ? `${unitType} ${created.id()} started its journey`
        : `${unitType} ${created.id()} was created`,
    created.id(),
  );
}

function detectStart(tracker: ActionTracker, game: Game, tick: number): void {
  if (tracker.outcome) return;
  const intent = tracker.action.intent;
  if (intent === null) {
    completeImmediate(tracker, tick, "Held intentionally");
    return;
  }
  const target = intentTarget(game, intent);

  switch (intent.type) {
    case "attack":
      detectAttackStart(tracker, game, tick, intent);
      return;
    case "boat":
      detectUnitStart(tracker, tick, UnitType.TransportShip, true);
      return;
    case "build_unit":
      detectUnitStart(tracker, tick, intent.unit);
      // New executions are initialized after the current tick's active
      // executions and first run on the following tick. If no unit exists two
      // ticks after submission, the core has rejected the build.
      if (!tracker.outcome && tick >= tracker.submittedAtTick + 2) {
        tracker.outcome = failedBuildOutcome(tracker, game, tick, intent);
      }
      return;
    case "cancel_attack": {
      const attack =
        tracker.attack ??
        tracker.player
          .outgoingAttacks()
          .find((candidate) => candidate.id() === intent.attackID);
      if (!attack) return;
      tracker.attack = attack;
      if (attack.retreating() || attack.retreated()) {
        tracker.outcome = outcome(
          tracker,
          attack.retreated() ? "completed" : "started",
          tick,
          attack.retreated()
            ? `Attack ${attack.id()} completed its retreat`
            : `Attack ${attack.id()} started retreating`,
          attack.id(),
        );
      }
      return;
    }
    case "upgrade_structure": {
      const unit = game.unit(intent.unitId);
      if (!unit) return;
      tracker.unit = unit;
      if (
        tracker.beforeUpgradeLevel !== null &&
        unit.level() > tracker.beforeUpgradeLevel
      ) {
        completeImmediate(
          tracker,
          tick,
          `${unit.type()} ${unit.id()} upgraded to level ${unit.level()}`,
          unit.id(),
        );
      }
      return;
    }
    case "allianceRequest": {
      if (target && tracker.player.isAlliedWith(target)) {
        completeImmediate(
          tracker,
          tick,
          `Alliance with ${target.name()} was formed`,
        );
        return;
      }
      const request = tracker.player
        .outgoingAllianceRequests()
        .find((candidate) => candidate.recipient() === target);
      if (request) {
        tracker.allianceRequest = request;
        tracker.outcome = outcome(
          tracker,
          "started",
          tick,
          `Alliance request to ${request.recipient().name()} is pending`,
        );
      }
      return;
    }
    case "breakAlliance":
      if (
        target &&
        tracker.beforeAllied &&
        !tracker.player.isAlliedWith(target)
      ) {
        completeImmediate(
          tracker,
          tick,
          `Alliance with ${target.name()} was broken`,
        );
      }
      return;
    case "allianceExtension": {
      const info = target ? tracker.player.allianceInfo(target) : null;
      if (target && info?.myPlayerAgreedToExtend) {
        completeImmediate(
          tracker,
          tick,
          `Alliance extension with ${target.name()} was submitted`,
        );
      }
      return;
    }
    case "embargo": {
      if (!target) return;
      const embargoed = tracker.player.hasEmbargoAgainst(target);
      if (
        (intent.action === "start" && embargoed) ||
        (intent.action === "stop" && !embargoed)
      ) {
        completeImmediate(
          tracker,
          tick,
          `Embargo against ${target.name()} was ${intent.action === "start" ? "started" : "stopped"}`,
        );
      }
      return;
    }
    default:
      return;
  }
}

function refreshStarted(
  tracker: ActionTracker,
  game: Game,
  tick: number,
): void {
  if (tracker.outcome?.status !== "started") return;
  const intent = tracker.action.intent;
  if (intent === null) return;

  switch (intent.type) {
    case "attack": {
      const attack = tracker.attack;
      if (attack?.isActive()) {
        tracker.outcome = outcome(
          tracker,
          "started",
          tick,
          `Attack ${attack.id()} remains active with ${Math.floor(attack.troops())} troops`,
          attack.id(),
        );
        return;
      }
      const target = intentTarget(game, intent);
      const gainedTerritory =
        tracker.player.numTilesOwned() > tracker.beforeSelfTiles ||
        (tracker.beforeTargetTiles !== null &&
          target !== null &&
          target.numTilesOwned() < tracker.beforeTargetTiles);
      tracker.outcome = outcome(
        tracker,
        gainedTerritory || attack?.retreated() ? "completed" : "destroyed",
        tick,
        gainedTerritory
          ? `Attack ${attack?.id() ?? ""} ended after capturing territory`.trim()
          : attack?.retreated()
            ? `Attack ${attack.id()} completed its retreat`
            : `Attack ${attack?.id() ?? ""} ended without capturing territory`.trim(),
        attack?.id() ?? null,
      );
      return;
    }
    case "boat":
    case "build_unit": {
      const unit = tracker.unit;
      if (!unit) return;
      if (!unit.isActive() || unit.owner() !== tracker.player) {
        tracker.outcome = outcome(
          tracker,
          unit.wasDestroyedByEnemy() || unit.owner() !== tracker.player
            ? "destroyed"
            : "completed",
          tick,
          unit.wasDestroyedByEnemy()
            ? `${unit.type()} ${unit.id()} was destroyed by ${unit.destroyer()?.name() ?? "an enemy"}`
            : unit.owner() !== tracker.player
              ? `${unit.type()} ${unit.id()} was lost to ${unit.owner().name()}`
              : `${unit.type()} ${unit.id()} finished its lifecycle`,
          unit.id(),
        );
        return;
      }
      if (Structures.has(unit.type()) && !unit.isUnderConstruction()) {
        completeImmediate(
          tracker,
          tick,
          `${unit.type()} ${unit.id()} completed construction`,
          unit.id(),
        );
        return;
      }
      tracker.outcome = outcome(
        tracker,
        "started",
        tick,
        Structures.has(unit.type())
          ? `${unit.type()} ${unit.id()} remains under construction`
          : `${unit.type()} ${unit.id()} remains active`,
        unit.id(),
      );
      return;
    }
    case "cancel_attack": {
      const attack = tracker.attack;
      if (!attack) return;
      if (attack.retreated() || !attack.isActive()) {
        completeImmediate(
          tracker,
          tick,
          `Attack ${attack.id()} completed its retreat`,
          attack.id(),
        );
      } else {
        tracker.outcome = outcome(
          tracker,
          "started",
          tick,
          `Attack ${attack.id()} remains in retreat`,
          attack.id(),
        );
      }
      return;
    }
    case "allianceRequest": {
      const request = tracker.allianceRequest;
      const target = intentTarget(game, intent);
      if (target && tracker.player.isAlliedWith(target)) {
        completeImmediate(
          tracker,
          tick,
          `Alliance request to ${target.name()} was accepted`,
        );
      } else if (request?.status() === "rejected") {
        completeImmediate(
          tracker,
          tick,
          `Alliance request to ${request.recipient().name()} was rejected`,
        );
      } else {
        tracker.outcome = outcome(
          tracker,
          "started",
          tick,
          `Alliance request to ${request?.recipient().name() ?? target?.name() ?? "opponent"} remains pending`,
        );
      }
      return;
    }
    default:
      return;
  }
}

export function beginActionTracking(
  game: Game,
  player: Player,
  actions: LegalAction[],
): TrackedAction[] {
  return actions.map((selected) => {
    const intent = selected.intent;
    const target = intent ? intentTarget(game, intent) : null;
    const beforeAttackTroops = new Map(
      player
        .outgoingAttacks()
        .map((attack) => [attack.id(), attack.troops()] as const),
    );
    const upgradeUnit =
      intent?.type === "upgrade_structure"
        ? game.unit(intent.unitId)
        : undefined;
    const tracker: ActionTracker = {
      action: selected,
      player,
      beforeSelfTiles: player.numTilesOwned(),
      beforeTroops: player.troops(),
      beforeUnitIds: new Set(player.units().map((unit) => unit.id())),
      beforeAttackTroops,
      beforeIncomingTroops: incomingFrom(player, target),
      beforeTargetTiles: target?.numTilesOwned() ?? null,
      beforeAllied: target ? player.isAlliedWith(target) : null,
      beforeUpgradeLevel: upgradeUnit?.level() ?? null,
      targetSmallId: target?.smallID() ?? null,
      targetName: target?.name() ?? null,
      submittedAtTick: game.ticks(),
    };
    if (intent?.type === "cancel_attack") {
      tracker.attack = player
        .outgoingAttacks()
        .find((attack) => attack.id() === intent.attackID);
    }
    return tracker;
  });
}

export function updateActionTracking(
  trackers: TrackedAction[],
  game: Game,
  tick: number,
): void {
  for (const tracker of trackers) {
    detectStart(tracker, game, tick);
    refreshStarted(tracker, game, tick);
  }
}

export function observeActionUpdates(
  trackers: TrackedAction[],
  update: GameUpdateViewData,
): void {
  const requests = update.updates[GameUpdateType.AllianceRequest];
  const replies = update.updates[GameUpdateType.AllianceRequestReply];
  for (const tracker of trackers) {
    const intent = tracker.action.intent;
    if (intent?.type !== "allianceRequest") continue;

    const request = requests.find(
      (candidate) =>
        candidate.requestorID === tracker.player.smallID() &&
        candidate.recipientID === tracker.targetSmallId,
    );
    if (request && !tracker.outcome) {
      tracker.outcome = outcome(
        tracker,
        "started",
        update.tick,
        `Alliance request to ${tracker.targetName ?? intent.recipient} started`,
      );
    }

    const reply = replies.find(
      (candidate) =>
        candidate.request.requestorID === tracker.player.smallID() &&
        candidate.request.recipientID === tracker.targetSmallId,
    );
    if (reply) {
      tracker.outcome = outcome(
        tracker,
        "completed",
        update.tick,
        `Alliance request to ${tracker.targetName ?? intent.recipient} was ${
          reply.accepted ? "accepted" : "rejected"
        }`,
      );
    }
  }
}

export function actionOutcomes(
  trackers: TrackedAction[],
  game: Game,
  tick: number,
): ActionOutcome[] {
  updateActionTracking(trackers, game, tick);
  return trackers.map((tracker) => {
    if (!tracker.outcome) {
      tracker.outcome = outcome(
        tracker,
        "failed",
        tick,
        "The core produced no observable start or state change",
        null,
        "runtime_rejected",
      );
    }
    return { ...tracker.outcome };
  });
}

export function hasUnresolvedActions(trackers: TrackedAction[]): boolean {
  return trackers.some((tracker) => tracker.outcome?.status === "started");
}
