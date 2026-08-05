import {
  BrowserBaselineController,
  BrowserBaselineStatus,
  BaselineScoreSnapshot,
  VISUAL_BASELINE,
} from "../VisualBaselineTypes";

type BaselineBootstrap = {
  gameStartInfo: unknown;
  spawn: { x: number; y: number };
};

function createController(spawn: { x: number; y: number }) {
  let nextGateTick: number = VISUAL_BASELINE.firstDecisionTick;
  let gatedAt: number | null = null;
  let decisionIndex = 0;
  let intents: unknown[] = [];
  let latestSnapshot: BaselineScoreSnapshot | null = null;
  let winnerJson: string | null = null;
  let replayJson: string | null = null;
  let finished = false;
  let error: string | null = null;
  let setupSpawnAccepted = false;
  let fastForwarding = false;
  const turns: unknown[] = [];
  const previouslyAlive = new Map<string, boolean>();
  const eliminatedAt = new Map<string, number>();

  const controller: BrowserBaselineController = {
    active: true,
    spawn,
    shouldGate(turn) {
      if (finished || turn < nextGateTick) return false;
      gatedAt ??= turn;
      return true;
    },
    acceptIntent(intent) {
      if (
        !setupSpawnAccepted &&
        typeof intent === "object" &&
        intent !== null &&
        "type" in intent &&
        intent.type === "spawn"
      ) {
        setupSpawnAccepted = true;
        return true;
      }
      if (finished || gatedAt === null) return false;
      if (intents.length >= VISUAL_BASELINE.maxGameIntentsPerDecision) {
        return false;
      }
      intents.push(structuredClone(intent));
      return true;
    },
    release() {
      if (finished || gatedAt === null) return;
      nextGateTick = gatedAt + VISUAL_BASELINE.decisionIntervalTicks;
      gatedAt = null;
      decisionIndex++;
      intents = [];
    },
    fastForward() {
      fastForwarding = true;
      gatedAt = null;
      nextGateTick = Number.MAX_SAFE_INTEGER;
      intents = [];
    },
    isFastForwarding() {
      return fastForwarding;
    },
    onTurn(turn) {
      turns.push(structuredClone(turn));
    },
    capturedTurns() {
      return structuredClone(turns);
    },
    onUpdate(snapshot) {
      for (const player of snapshot.players) {
        if (
          previouslyAlive.get(player.id) === true &&
          !player.alive &&
          !eliminatedAt.has(player.id)
        ) {
          eliminatedAt.set(player.id, snapshot.tick);
        }
        previouslyAlive.set(player.id, player.alive);
        const tick = eliminatedAt.get(player.id);
        if (tick !== undefined) player.eliminatedAt = tick;
      }
      latestSnapshot = structuredClone(snapshot);
    },
    onWinner(json) {
      winnerJson = json;
      finished = true;
    },
    onReplay(json) {
      replayJson = json;
    },
    fail(message) {
      error = message;
      finished = true;
    },
    status(): BrowserBaselineStatus {
      return {
        active: true,
        gatedAt,
        nextGateTick,
        decisionIndex,
        intents: structuredClone(intents),
        latestSnapshot: structuredClone(latestSnapshot),
        winnerJson,
        replayJson,
        finished,
        error,
      };
    },
  };
  return controller;
}

async function startVisualBaseline() {
  if (!/^\/baseline(?:\.html)?$/.test(window.location.pathname)) return;
  try {
    const model = new URLSearchParams(window.location.search).get("model");
    const response = await fetch(
      `/api/baseline/bootstrap${model ? `?model=${encodeURIComponent(model)}` : ""}`,
    );
    if (!response.ok) {
      throw new Error(`Baseline bootstrap failed: ${response.status}`);
    }
    const bootstrap = (await response.json()) as BaselineBootstrap;
    window.openfrontVisualBaseline = createController(bootstrap.spawn);

    await customElements.whenDefined("join-lobby-modal");
    await new Promise((resolve) => setTimeout(resolve, 0));
    document.dispatchEvent(
      new CustomEvent("join-lobby", {
        detail: {
          gameID: (bootstrap.gameStartInfo as { gameID: string }).gameID,
          gameStartInfo: bootstrap.gameStartInfo,
          source: "singleplayer",
        },
      }),
    );
    history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}`,
    );
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    window.openfrontVisualBaseline?.fail(message);
    console.error("Could not start visual-controls baseline", cause);
  }
}

void startVisualBaseline();
