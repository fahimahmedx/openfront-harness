import path from "path";
import { describe, expect, test } from "vitest";
import { PlayerType } from "../OpenFrontIO/src/core/game/Game";
import { createGameRunner } from "../OpenFrontIO/src/core/GameRunner";
import { Intent, Turn } from "../OpenFrontIO/src/core/Schemas";
import { NodeGameMapLoader } from "../src/NodeGameMapLoader";
import {
  createScenarioStartInfo,
  modelPlayerName,
  SCENARIO,
  SCENARIO_GAME_CONFIG,
} from "../src/Scenario";

describe("japan-v4 scenario", () => {
  test("locks the benchmark knobs", () => {
    expect(SCENARIO.id).toBe("japan-v4");
    expect(SCENARIO_GAME_CONFIG.gameMap).toBe("Japan");
    expect(SCENARIO_GAME_CONFIG.nations).toBe(3);
    expect(SCENARIO_GAME_CONFIG.bots).toBe(0);
    expect(SCENARIO_GAME_CONFIG.difficulty).toBe("Medium");
    expect(SCENARIO.decisionIntervalTicks).toBe(100);
    expect(SCENARIO.actionSlots).toBe(2);
    expect(SCENARIO.troopPolicy).toEqual({
      expansionReserveRatio: 0.15,
      combatReserveRatio: 0.35,
      combatTriggerRatio: 0.55,
      minimumAttackToDefenderRatio: 0.2,
      emergencyReserveRatio: 0.15,
    });
  });

  test("uses a schema-safe model name for the player", () => {
    expect(modelPlayerName("z-ai/glm-5.2")).toBe("GLM 5.2");
    expect(modelPlayerName("openai/gpt-5.6-luna")).toBe("GPT 5.6");
    expect(createScenarioStartInfo("z-ai/glm-5.2").players[0].username).toBe(
      "GLM 5.2",
    );
  });

  test("loads the real map and deterministically spawns the intended players", async () => {
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
    const tile = runner.game.ref(SCENARIO.spawn.x, SCENARIO.spawn.y);
    expect(runner.game.isLand(tile)).toBe(true);
    execute([{ type: "spawn", tile }]);
    for (let i = 0; i < 10; i++) {
      if (
        runner.game.players().length === 4 &&
        runner.game.players().every((player) => player.hasSpawned())
      ) {
        break;
      }
      execute();
    }
    expect(runner.game.playerByClientID(SCENARIO.clientID)?.hasSpawned()).toBe(
      true,
    );
    expect(
      runner.game
        .players()
        .filter((player) => player.type() === PlayerType.Nation)
        .map((player) => player.name())
        .sort(),
    ).toEqual([...SCENARIO.expectedNations].sort());
  }, 30_000);
});
