import path from "node:path";
import { describe, expect, it } from "vitest";
import { createGameRunner } from "../OpenFrontIO/src/core/GameRunner";
import { StampedIntent, Turn } from "../OpenFrontIO/src/core/Schemas";
import { NodeGameMapLoader } from "../src/NodeGameMapLoader";
import { createScenarioStartInfo, SCENARIO } from "../src/Scenario";
import { continueVisualBaselineInCore } from "../src/VisualBaselineCoreContinuation";

const mapsDir = path.join(import.meta.dirname, "../OpenFrontIO/resources/maps");

describe("visual baseline core continuation", () => {
  it(
    "replays a captured eliminated-player stream to OpenFront's declared winner",
    async () => {
      const gameStart = createScenarioStartInfo("test/model");
      const runner = await createGameRunner(
        gameStart,
        SCENARIO.clientID,
        new NodeGameMapLoader(mapsDir),
        () => {},
      );
      const turns: Turn[] = [];
      const execute = (intents: StampedIntent[] = []) => {
        const turn = { turnNumber: turns.length, intents };
        turns.push(turn);
        runner.addTurn(turn);
        expect(runner.executeNextTick()).toBe(true);
      };

      execute([
        {
          type: "spawn",
          tile: runner.game.ref(SCENARIO.spawn.x, SCENARIO.spawn.y),
          clientID: SCENARIO.clientID,
        },
      ]);
      while (
        runner.game.ticks() < 5_000 &&
        runner.game.playerByClientID(SCENARIO.clientID)?.isAlive() !== false
      ) {
        execute();
      }
      expect(
        runner.game.playerByClientID(SCENARIO.clientID)?.isAlive(),
      ).toBe(false);

      const result = await continueVisualBaselineInCore(
        turns,
        "test/model",
        new Date(0),
        mapsDir,
      );
      expect(result.winner).toBeDefined();
      expect(result.snapshot.tick).toBeLessThanOrEqual(12_020);
      expect(result.replay.info.num_turns).toBe(result.snapshot.tick);
      expect(result.replay.info.winner).toEqual(result.winner);
    },
    30_000,
  );
});
