import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  adaptLeaderboardCurrentTroops,
  adaptReplaySeekInputHandler,
  adaptReplaySeekLocalServer,
  adaptVisualBaselineClientGameRunner,
  adaptVisualBaselineLocalServer,
} from "../src/OpenFrontAdapters";

const openFrontRoot = path.join(import.meta.dirname, "..", "OpenFrontIO");

describe("OpenFront harness adapters", () => {
  it("adds replay seeking to pristine bundled source", async () => {
    const inputHandlerPath = path.join(
      openFrontRoot,
      "src/client/InputHandler.ts",
    );
    const localServerPath = path.join(
      openFrontRoot,
      "src/client/LocalServer.ts",
    );
    const inputHandler = await fs.readFile(inputHandlerPath, "utf8");
    const localServer = await fs.readFile(localServerPath, "utf8");

    expect(inputHandler).not.toContain("ReplaySeekIntentEvent");
    expect(localServer).not.toContain("replaySeekTarget");

    expect(adaptReplaySeekInputHandler(inputHandler)).toContain(
      "export class ReplaySeekIntentEvent implements GameEvent",
    );
    const adaptedServer = adaptReplaySeekLocalServer(localServer);
    expect(adaptedServer).toContain("this.eventBus.on(ReplaySeekIntentEvent");
    expect(adaptedServer).toContain("const isSeeking =");
  });

  it("renders and sorts current troops without changing the game checkout", async () => {
    const leaderboardPath = path.join(
      openFrontRoot,
      "src/client/hud/layers/Leaderboard.ts",
    );
    const leaderboard = await fs.readFile(leaderboardPath, "utf8");

    expect(leaderboard).toContain("maxTroops: string;");
    expect(leaderboard).not.toContain("troops: string;");

    const adapted = adaptLeaderboardCurrentTroops(leaderboard);
    expect(adapted).toContain("troops: renderTroops(player.troops())");
    expect(adapted).toContain("compare(a.troops(), b.troops())");
    expect(adapted).toContain("Troops");
    expect(adapted).not.toContain("player.maxTroops");
  });

  it("adds visual baseline gates and score-only hooks outside pristine source", async () => {
    const localServer = await fs.readFile(
      path.join(openFrontRoot, "src/client/LocalServer.ts"),
      "utf8",
    );
    const clientRunner = await fs.readFile(
      path.join(openFrontRoot, "src/client/ClientGameRunner.ts"),
      "utf8",
    );

    expect(localServer).not.toContain("openfrontVisualBaseline");
    expect(clientRunner).not.toContain("openfrontVisualBaseline");

    const adaptedServer = adaptVisualBaselineLocalServer(
      adaptReplaySeekLocalServer(localServer),
    );
    expect(adaptedServer).toContain("visualBaseline.shouldGate");
    expect(adaptedServer).toContain("visualBaseline.acceptIntent");
    expect(adaptedServer).toContain("onTurn(pastTurn)");
    expect(adaptedServer).toContain("isSeeking || visualBaseline?.active");
    expect(adaptedServer).toContain("visualBaseline?.isFastForwarding() ||");
    expect(adaptedServer).toContain("visualBaseline.onWinner");

    const adaptedClient = adaptVisualBaselineClientGameRunner(clientRunner);
    expect(adaptedClient).toContain("visualBaseline.spawn.x");
    expect(adaptedClient).toContain("this.gameView.numLandTiles()");
    expect(adaptedClient).toContain("player.numTilesOwned()");
    expect(adaptedClient).toContain("isFastForwarding()");
  });
});
