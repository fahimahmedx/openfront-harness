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

export const SCENARIO = {
  id: "japan-v2",
  seed: "JAPAN01A",
  clientID: "LLMAGENT",
  playerName: "LLM Agent",
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

export function createScenarioStartInfo(): GameStartInfo {
  return {
    gameID: SCENARIO.seed,
    lobbyCreatedAt: 0,
    config: SCENARIO_GAME_CONFIG,
    players: [
      {
        clientID: SCENARIO.clientID,
        username: SCENARIO.playerName,
        clanTag: null,
        isLobbyCreator: true,
      },
    ],
  };
}

export function publicScenario() {
  return {
    ...SCENARIO,
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
