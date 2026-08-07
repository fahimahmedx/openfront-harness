import path from "path";
import { describe, expect, it, vi } from "vitest";
import { UnitType } from "../OpenFrontIO/src/core/game/Game";
import { createGameRunner } from "../OpenFrontIO/src/core/GameRunner";
import { Intent, Turn } from "../OpenFrontIO/src/core/Schemas";
import {
  actionOutcomes,
  beginActionTracking,
  updateActionTracking,
} from "../src/ActionLifecycle";
import { NodeGameMapLoader } from "../src/NodeGameMapLoader";
import { createLegalActions } from "../src/ObservationActions";
import { createScenarioStartInfo, SCENARIO } from "../src/Scenario";
import { LegalAction } from "../src/Types";

describe("action lifecycle tracking", () => {
  it("distinguishes completed holds, failed intents, and started attacks", async () => {
    const runner = await createGameRunner(
      createScenarioStartInfo(),
      SCENARIO.clientID,
      new NodeGameMapLoader(path.resolve("OpenFrontIO/resources/maps")),
      () => undefined,
    );
    const turns: Turn[] = [];
    const execute = (intents: Intent[] = []) => {
      const turn: Turn = {
        turnNumber: turns.length,
        intents: intents.map((intent) => ({
          ...intent,
          clientID: SCENARIO.clientID,
        })),
      };
      turns.push(turn);
      runner.addTurn(turn);
      expect(runner.executeNextTick()).toBe(true);
    };

    execute([
      {
        type: "spawn",
        tile: runner.game.ref(SCENARIO.spawn.x, SCENARIO.spawn.y),
      },
    ]);
    for (let tick = 0; tick < 20; tick++) {
      if (
        runner.game.players().length === 4 &&
        runner.game.players().every((player) => player.hasSpawned()) &&
        !runner.game.inSpawnPhase()
      ) {
        break;
      }
      execute();
    }
    const player = runner.game.playerByClientID(SCENARIO.clientID)!;

    const hold = createLegalActions(runner.game, player).find(
      (candidate) => candidate.id === "hold",
    )!;
    const holdTracking = beginActionTracking(runner.game, player, [hold]);
    execute();
    updateActionTracking(holdTracking, runner.game, runner.game.ticks());
    expect(
      actionOutcomes(holdTracking, runner.game, runner.game.ticks())[0],
    ).toMatchObject({
      status: "completed",
      detail: "Held intentionally",
    });

    const invalidBuild: LegalAction = {
      id: "build:Defense Post:-1",
      category: "build",
      label: "Invalid test build",
      intent: {
        type: "build_unit",
        unit: UnitType.DefensePost,
        tile: -1,
      },
    };
    const failedTracking = beginActionTracking(runner.game, player, [
      invalidBuild,
    ]);
    const warning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    execute([invalidBuild.intent!]);
    updateActionTracking(failedTracking, runner.game, runner.game.ticks());
    execute();
    updateActionTracking(failedTracking, runner.game, runner.game.ticks());
    expect(
      actionOutcomes(failedTracking, runner.game, runner.game.ticks())[0],
    ).toMatchObject({
      status: "failed",
      startedAtTick: null,
      failureCode: "placement_blocked",
      detail: expect.stringContaining("target tile -1 is invalid"),
    });
    warning.mockRestore();

    player.addGold(1_000_000n);
    const legalBuild = createLegalActions(runner.game, player).find(
      (candidate) =>
        candidate.intent?.type === "build_unit" &&
        candidate.intent.unit === UnitType.City,
    );
    expect(legalBuild).toBeDefined();
    const staleBuildTracking = beginActionTracking(runner.game, player, [
      legalBuild!,
    ]);
    const staleIntent = legalBuild!.intent as Extract<
      Intent,
      { type: "build_unit" }
    >;
    const opponent = runner.game
      .players()
      .find((candidate) => candidate !== player)!;
    opponent.conquer(staleIntent.tile);
    const staleWarning = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    execute([staleIntent]);
    updateActionTracking(staleBuildTracking, runner.game, runner.game.ticks());
    execute();
    updateActionTracking(staleBuildTracking, runner.game, runner.game.ticks());
    expect(
      actionOutcomes(staleBuildTracking, runner.game, runner.game.ticks())[0],
    ).toMatchObject({
      status: "failed",
      startedAtTick: null,
      failureCode: "anchor_lost",
      detail: expect.stringContaining("was no longer owned"),
    });
    staleWarning.mockRestore();

    const expansion = createLegalActions(runner.game, player)
      .filter((candidate) => candidate.category === "expand")
      .sort(
        (a, b) =>
          Number(b.intent?.type === "attack" ? b.intent.troops : 0) -
          Number(a.intent?.type === "attack" ? a.intent.troops : 0),
      )[0];
    expect(expansion).toBeDefined();
    const attackTracking = beginActionTracking(runner.game, player, [
      expansion,
    ]);
    execute([expansion.intent!]);
    updateActionTracking(attackTracking, runner.game, runner.game.ticks());
    const attackResult = actionOutcomes(
      attackTracking,
      runner.game,
      runner.game.ticks(),
    )[0];
    expect(attackResult.status).not.toBe("failed");
    expect(attackResult.status).not.toBe("unknown");
    expect(attackResult.startedAtTick).not.toBeNull();
  }, 30_000);
});
