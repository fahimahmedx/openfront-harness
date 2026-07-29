import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../OpenFrontIO/src/core/game/Game";
import {
  GameConfig,
  GameConfigSchema,
  GameStartInfo,
} from "../OpenFrontIO/src/core/Schemas";

export const OPENFRONT_VERSION = "v0.32.9";
export const OPENFRONT_COMMIT = "dcc18d5231af6253b0e991bf04a4c764982fe262";
export const DEFAULT_OPENROUTER_MODEL = "openai/gpt-5.6-luna";

export function modelPlayerName(model: string): string {
  const modelParts = model.split("/");
  const slug = modelParts[modelParts.length - 1] || model;
  const knownModel = /^(gpt|glm)-(\d+(?:\.\d+)?)/i.exec(slug);
  if (knownModel) {
    // OpenFront usernames do not allow hyphens.
    return `${knownModel[1].toUpperCase()} ${knownModel[2]}`;
  }

  const safeName = slug
    .replace(/[-_]+/g, " ")
    .replace(/[^a-zA-Z0-9 .üÜ]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 27);
  return safeName.length >= 3 ? safeName : "LLM";
}

function configuredModel(): string {
  return process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
}

export const SCENARIO = {
  id: "japan-v2",
  seed: "JAPAN01A",
  clientID: "LLMAGENT",
  playerName: modelPlayerName(configuredModel()),
  spawn: { x: 1613, y: 1133, label: "Kanto" },
  expectedNations: ["Hokkaido", "Shikoku", "Kansai"],
  decisionIntervalTicks: 100,
  actionSlots: 2,
  maxDecisionCount: 120,
  maxSimulatedMinutes: 20,
  maxWallClockMs: 10 * 60 * 1000,
  maxCandidates: 64,
  maxConsecutiveDecisionFailures: 5,
  maxRunCostUsd: 1,
  troopPolicy: {
    expansionReserveRatio: 0.15,
    combatReserveRatio: 0.35,
    combatTriggerRatio: 0.55,
    minimumAttackToDefenderRatio: 0.2,
    emergencyReserveRatio: 0.15,
  },
} as const;

export const SCENARIO_GAME_CONFIG: GameConfig = GameConfigSchema.parse({
  gameMap: GameMapType.Japan,
  gameMapSize: GameMapSize.Normal,
  gameMode: GameMode.FFA,
  gameType: GameType.Singleplayer,
  difficulty: Difficulty.Medium,
  nations: 3,
  bots: 0,
  donateGold: false,
  donateTroops: false,
  infiniteGold: false,
  infiniteTroops: false,
  instantBuild: false,
  randomSpawn: false,
  maxTimerValue: SCENARIO.maxSimulatedMinutes,
});

export function createScenarioStartInfo(
  model: string = configuredModel(),
): GameStartInfo {
  return {
    gameID: SCENARIO.seed,
    lobbyCreatedAt: 0,
    config: SCENARIO_GAME_CONFIG,
    players: [
      {
        clientID: SCENARIO.clientID,
        username: modelPlayerName(model),
        clanTag: null,
        isLobbyCreator: true,
      },
    ],
  };
}

export function publicScenario(model: string = configuredModel()) {
  return {
    ...SCENARIO,
    playerName: modelPlayerName(model),
    map: GameMapType.Japan,
    mapSize: GameMapSize.Normal,
    mode: GameMode.FFA,
    difficulty: Difficulty.Medium,
    nationCount: 3,
    tribeBotCount: 0,
    openfront: {
      version: OPENFRONT_VERSION,
      commit: OPENFRONT_COMMIT,
    },
  };
}
