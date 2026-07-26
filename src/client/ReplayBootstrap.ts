import { GameRecordSchema } from "../../OpenFrontIO/src/core/Schemas";
import { installHarnessReplayControls } from "./ReplayPlaybackControls";
import { installHarnessReplayPanel } from "./ReplayTracePanel";

async function startHarnessReplay() {
  const match = window.location.pathname.match(/^\/replay\/([0-9a-f-]{36})$/i);
  if (!match) return;
  const runId = match[1];
  const replayPath = window.location.pathname;

  try {
    const response = await fetch(`/api/runs/${runId}/replay`);
    if (!response.ok) {
      throw new Error(`Replay request failed: ${response.status}`);
    }
    const gameRecord = GameRecordSchema.parse(await response.json());

    // Main.ts registers its join listener during initialization. Waiting for
    // the modal definition and one task boundary avoids coupling this adapter
    // to a private Client instance while leaving OpenFront's source untouched.
    await customElements.whenDefined("join-lobby-modal");
    await new Promise((resolve) => setTimeout(resolve, 0));

    installHarnessReplayPanel(runId);
    installHarnessReplayControls(gameRecord.info.num_turns);
    document.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: gameRecord.info.gameID,
          gameRecord,
          gameStartInfo: gameRecord.info,
          source: "singleplayer",
        },
      }),
    );

    // OpenFront normally rewrites the URL to its lobby route after joining.
    // Restore the stable harness replay URL once the renderer enters the game.
    const observer = new MutationObserver(() => {
      if (!document.body.classList.contains("in-game")) return;
      history.replaceState(null, "", replayPath);
      observer.disconnect();
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["class"],
    });
  } catch (error) {
    console.error("Could not load harness replay", error);
    document.body.innerHTML = `<main style="max-width:680px;margin:15vh auto;padding:24px;color:white;font:16px system-ui"><h1>Replay unavailable</h1><p>The artifact could not be loaded by the pinned OpenFront renderer.</p><p><a style="color:#71e4a8" href="/">Return to the harness</a></p></main>`;
  }
}

void startHarnessReplay();
