function replaceExactlyOnce(
  code: string,
  needle: string,
  replacement: string,
  adapter: string,
): string {
  const first = code.indexOf(needle);
  if (first === -1 || code.indexOf(needle, first + needle.length) !== -1) {
    throw new Error(
      `Pinned OpenFront source no longer matches the ${adapter} adapter`,
    );
  }
  return code.replace(needle, replacement);
}

export function adaptReplaySeekInputHandler(code: string): string {
  const needle = `export class ReplaySpeedChangeEvent implements GameEvent {
  constructor(public readonly replaySpeedMultiplier: ReplaySpeedMultiplier) {}
}

export class TogglePauseIntentEvent implements GameEvent {}`;
  const replacement = `export class ReplaySpeedChangeEvent implements GameEvent {
  constructor(public readonly replaySpeedMultiplier: ReplaySpeedMultiplier) {}
}

export class ReplaySeekIntentEvent implements GameEvent {
  constructor(
    public readonly targetTick: number,
    public readonly pauseWhenReached: boolean,
  ) {}
}

export class TogglePauseIntentEvent implements GameEvent {}`;
  return replaceExactlyOnce(
    code,
    needle,
    replacement,
    "replay seek input event",
  );
}

export function adaptReplayJoinUrl(code: string): string {
  return replaceExactlyOnce(
    code,
    `    // Only update URL immediately for private lobbies, not public ones
    if (lobby.source !== "public") {
      this.updateJoinUrlForShare(lobby.gameID);
    }`,
    `    // Recorded games keep their stable replay URL. Rewriting a replay to
    // /game/:id can race with the startup router, which then mistakes the
    // recording for a private online lobby and shows a spurious join error.
    if (lobby.source !== "public" && lobby.gameRecord === undefined) {
      this.updateJoinUrlForShare(lobby.gameID);
    }`,
    "replay join URL guard",
  );
}

export function adaptReplaySeekLocalServer(code: string): string {
  let adapted = replaceExactlyOnce(
    code,
    `  GameSpeedDownIntentEvent,
  GameSpeedUpIntentEvent,
  ReplaySpeedChangeEvent,`,
    `  GameSpeedDownIntentEvent,
  GameSpeedUpIntentEvent,
  ReplaySeekIntentEvent,
  ReplaySpeedChangeEvent,`,
    "replay seek LocalServer import",
  );
  adapted = replaceExactlyOnce(
    adapted,
    `  private paused = false;
  private replaySpeedMultiplier = defaultReplaySpeedMultiplier;`,
    `  private paused = false;
  private replaySpeedMultiplier = defaultReplaySpeedMultiplier;
  private replaySeekTarget: number | null = null;
  private pauseWhenSeekCompletes = false;`,
    "replay seek LocalServer state",
  );
  adapted = replaceExactlyOnce(
    adapted,
    `    this.turnCheckInterval = setInterval(() => {
      const turnIntervalMs =
        ClientEnv.turnIntervalMs() * this.replaySpeedMultiplier;
      const backlog = Math.max(0, this.turns.length - this.turnsExecuted);
      const allowReplayBacklog =
        this.replaySpeedMultiplier === ReplaySpeedMultiplier.fastest &&
        this.lobbyConfig.gameRecord !== undefined;`,
    `    this.turnCheckInterval = setInterval(() => {
      if (
        this.replaySeekTarget !== null &&
        this.turns.length >= this.replaySeekTarget
      ) {
        this.paused = this.pauseWhenSeekCompletes;
        this.replaySeekTarget = null;
        return;
      }

      const isSeeking = this.replaySeekTarget !== null;
      const turnIntervalMs =
        isSeeking
          ? 0
          : ClientEnv.turnIntervalMs() * this.replaySpeedMultiplier;
      const backlog = Math.max(0, this.turns.length - this.turnsExecuted);
      const allowReplayBacklog =
        (isSeeking ||
          this.replaySpeedMultiplier === ReplaySpeedMultiplier.fastest) &&
        this.lobbyConfig.gameRecord !== undefined;`,
    "replay seek LocalServer turn loop",
  );
  return replaceExactlyOnce(
    adapted,
    `    this.eventBus.on(ReplaySpeedChangeEvent, (event) => {
      this.replaySpeedMultiplier = event.replaySpeedMultiplier;
    });

    if (!this.isReplay) {`,
    `    this.eventBus.on(ReplaySpeedChangeEvent, (event) => {
      this.replaySpeedMultiplier = event.replaySpeedMultiplier;
    });

    this.eventBus.on(ReplaySeekIntentEvent, (event) => {
      if (!this.isReplay) return;
      const requestedTick = Number.isFinite(event.targetTick)
        ? Math.floor(event.targetTick)
        : this.turns.length;
      this.replaySeekTarget = Math.max(
        this.turns.length,
        Math.min(
          requestedTick,
          this.replayTurns.length ||
            this.lobbyConfig.gameRecord?.info.num_turns ||
            0,
        ),
      );
      this.pauseWhenSeekCompletes = event.pauseWhenReached;
      this.paused = false;
      this.turnStartTime = 0;
    });

    if (!this.isReplay) {`,
    "replay seek LocalServer listener",
  );
}

export function adaptLeaderboardCurrentTroops(code: string): string {
  let adapted = replaceExactlyOnce(
    code,
    "  maxTroops: string;",
    "  troops: string;",
    "current-troops leaderboard entry",
  );
  adapted = replaceExactlyOnce(
    adapted,
    '  private _sortKey: "tiles" | "gold" | "maxtroops" = "tiles";',
    '  private _sortKey: "tiles" | "gold" | "troops" = "tiles";',
    "current-troops leaderboard sort state",
  );
  adapted = replaceExactlyOnce(
    adapted,
    '  private setSort(key: "tiles" | "gold" | "maxtroops") {',
    '  private setSort(key: "tiles" | "gold" | "troops") {',
    "current-troops leaderboard sort method",
  );
  adapted = replaceExactlyOnce(
    adapted,
    `
    const maxTroops = (p: PlayerView) => this.game!.config().maxTroops(p);
`,
    "",
    "current-troops leaderboard capacity helper",
  );
  adapted = replaceExactlyOnce(
    adapted,
    `      case "maxtroops":
        sorted = sorted.sort((a, b) => compare(maxTroops(a), maxTroops(b)));`,
    `      case "troops":
        sorted = sorted.sort((a, b) => compare(a.troops(), b.troops()));`,
    "current-troops leaderboard sorting",
  );
  adapted = replaceExactlyOnce(
    adapted,
    `    this.players = playersToShow.map((player, index) => {
      const maxTroops = this.game!.config().maxTroops(player);
      return {`,
    `    this.players = playersToShow.map((player, index) => {
      return {`,
    "current-troops leaderboard rows",
  );
  adapted = replaceExactlyOnce(
    adapted,
    "        maxTroops: renderTroops(maxTroops),",
    "        troops: renderTroops(player.troops()),",
    "current-troops leaderboard row value",
  );
  adapted = replaceExactlyOnce(
    adapted,
    `      if (myPlayer.isAlive()) {
        const myPlayerMaxTroops = this.game!.config().maxTroops(myPlayer);
        this.players.pop();`,
    `      if (myPlayer.isAlive()) {
        this.players.pop();`,
    "current-troops leaderboard local-player row",
  );
  adapted = replaceExactlyOnce(
    adapted,
    "          maxTroops: renderTroops(myPlayerMaxTroops),",
    "          troops: renderTroops(myPlayer.troops()),",
    "current-troops leaderboard local-player value",
  );
  adapted = replaceExactlyOnce(
    adapted,
    `              @click=\${() => this.setSort("maxtroops")}
            >
              \${translateText("leaderboard.maxtroops")}
              \${this._sortKey === "maxtroops"`,
    `              @click=\${() => this.setSort("troops")}
            >
              Troops
              \${this._sortKey === "troops"`,
    "current-troops leaderboard heading",
  );
  return replaceExactlyOnce(
    adapted,
    "                  ${player.maxTroops}",
    "                  ${player.troops}",
    "current-troops leaderboard rendered value",
  );
}

export function adaptVisualBaselineLocalServer(code: string): string {
  let adapted = replaceExactlyOnce(
    code,
    `      const isSeeking = this.replaySeekTarget !== null;
      const turnIntervalMs =`,
    `      const visualBaseline = window.openfrontVisualBaseline;
      if (visualBaseline?.active && visualBaseline.shouldGate(this.turns.length)) {
        return;
      }

      const isSeeking = this.replaySeekTarget !== null;
      const turnIntervalMs =`,
    "visual baseline LocalServer gate",
  );
  adapted = replaceExactlyOnce(
    adapted,
    `      const turnIntervalMs =
        isSeeking
          ? 0
          : ClientEnv.turnIntervalMs() * this.replaySpeedMultiplier;`,
    `      const turnIntervalMs =
        isSeeking || visualBaseline?.active
          ? 0
          : ClientEnv.turnIntervalMs() * this.replaySpeedMultiplier;`,
    "visual baseline LocalServer accelerated interval",
  );
  adapted = replaceExactlyOnce(
    adapted,
    `      const allowReplayBacklog =
        (isSeeking ||
          this.replaySpeedMultiplier === ReplaySpeedMultiplier.fastest) &&
        this.lobbyConfig.gameRecord !== undefined;`,
    `      const allowReplayBacklog =
        visualBaseline?.isFastForwarding() ||
        ((isSeeking ||
          this.replaySpeedMultiplier === ReplaySpeedMultiplier.fastest) &&
          this.lobbyConfig.gameRecord !== undefined);`,
    "visual baseline LocalServer backlog",
  );
  adapted = replaceExactlyOnce(
    adapted,
    `    this.turns.push(pastTurn);
    this.intents = [];`,
    `    this.turns.push(pastTurn);
    window.openfrontVisualBaseline?.onTurn(pastTurn);
    this.intents = [];`,
    "visual baseline LocalServer turn capture",
  );
  adapted = replaceExactlyOnce(
    adapted,
    `  onMessage(clientMsg: ClientMessage) {
    if (clientMsg.type === "rejoin") {`,
    `  onMessage(clientMsg: ClientMessage) {
    const visualBaseline = window.openfrontVisualBaseline;
    if (
      visualBaseline?.active &&
      clientMsg.type === "intent" &&
      !visualBaseline.acceptIntent(clientMsg.intent)
    ) {
      return;
    }
    if (clientMsg.type === "rejoin") {`,
    "visual baseline LocalServer intent boundary",
  );
  adapted = replaceExactlyOnce(
    adapted,
    `    if (clientMsg.type === "winner") {
      this.winner = clientMsg;
      this.allPlayersStats = clientMsg.allPlayersStats;
    }`,
    `    if (clientMsg.type === "winner") {
      this.winner = clientMsg;
      this.allPlayersStats = clientMsg.allPlayersStats;
      if (visualBaseline?.active) {
        visualBaseline.onWinner(JSON.stringify(clientMsg, replacer));
        this.endGame();
      }
    }`,
    "visual baseline LocalServer winner",
  );
  return replaceExactlyOnce(
    adapted,
    `    const jsonString = JSON.stringify(result.data, replacer);

    compress(jsonString)`,
    `    const jsonString = JSON.stringify(result.data, replacer);
    window.openfrontVisualBaseline?.onReplay(jsonString);

    compress(jsonString)`,
    "visual baseline LocalServer replay",
  );
}

export function adaptVisualBaselineClientGameRunner(code: string): string {
  let adapted = replaceExactlyOnce(
    code,
    `      this.gameView.update(gu);
      this.webglBuilder?.update(this.gameView);
      this.renderer.tick();`,
    `      this.gameView.update(gu);
      window.openfrontVisualBaseline?.onUpdate({
        tick: gu.tick,
        landTiles: this.gameView.numLandTiles(),
        players: this.gameView.players().map((player) => ({
          id: player.id(),
          clientID: player.clientID(),
          name: player.name(),
          alive: player.isAlive(),
          tiles: player.numTilesOwned(),
          troops: player.state.troops,
          gold: player.state.gold,
        })),
      });
      if (!window.openfrontVisualBaseline?.isFastForwarding()) {
        this.webglBuilder?.update(this.gameView);
        this.renderer.tick();
      }`,
    "visual baseline score-only snapshot",
  );
  return replaceExactlyOnce(
    adapted,
    `      if (message.type === "start") {
        console.log("starting game! in client game runner");

        if (this.gameView.config().isRandomSpawn()) {`,
    `      if (message.type === "start") {
        console.log("starting game! in client game runner");

        const visualBaseline = window.openfrontVisualBaseline;
        if (visualBaseline?.active && !this.gameView.myPlayer()?.hasSpawned()) {
          this.eventBus.emit(
            new SendSpawnIntentEvent(
              this.gameView.ref(
                visualBaseline.spawn.x,
                visualBaseline.spawn.y,
              ),
            ),
          );
        }

        if (this.gameView.config().isRandomSpawn()) {`,
    "visual baseline fixed spawn",
  );
}
