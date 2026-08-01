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
