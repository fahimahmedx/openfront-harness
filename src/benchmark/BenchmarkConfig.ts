import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
} from "../../OpenFrontIO/src/core/game/Game";
import {
  GameConfig,
  GameConfigSchema,
  GameStartInfo,
} from "../../OpenFrontIO/src/core/Schemas";
import {
  modelPlayerName,
  OPENFRONT_COMMIT,
  OPENFRONT_VERSION,
} from "../Scenario";
import { replaySafeGameId } from "./BenchmarkSeed";

export const BENCHMARK_VERSION = "openfront-bench-v0.1" as const;
export const BENCHMARK_CLIENT_ID = "LLMAGENT";

export const BENCHMARK_LIMITS = Object.freeze({
  decisionIntervalTicks: 100,
  actionSlots: 2,
  maxCandidates: 64,
  maxDecisionCount: 120,
  maxSimulatedMinutes: 20,
  maxWallClockMs: 10 * 60 * 1000,
  maxCapabilityWallClockMs: 2 * 60 * 1000,
  maxMatchCostUsd: 1,
  maxCapabilityCostUsd: 0.1,
  maxConsecutiveDecisionFailures: 5,
  troopPolicy: {
    expansionReserveRatio: 0.15,
    combatReserveRatio: 0.35,
    combatTriggerRatio: 0.55,
    minimumAttackToDefenderRatio: 0.2,
    emergencyReserveRatio: 0.15,
  },
});

export type BenchmarkMatchTask = {
  id: `match-${string}`;
  map: GameMapType;
  mapSlug: string;
  mapStratum: string;
  seed: string;
  spawn: { x: number; y: number; label: string };
  difficulty: Difficulty;
  nationCount: number;
  tribeBotCount: number;
  expectedRoster: readonly string[];
};

export const BENCHMARK_MATCH_TASKS: readonly BenchmarkMatchTask[] = [
  {
    id: "match-01",
    map: GameMapType.Japan,
    mapSlug: "japan",
    mapStratum: "japan",
    seed: "OFB101",
    spawn: { x: 1613, y: 1133, label: "Kanto" },
    difficulty: Difficulty.Medium,
    nationCount: 3,
    tribeBotCount: 0,
    expectedRoster: ["Shikoku", "Tokyo", "Chubu"],
  },
  {
    id: "match-02",
    map: GameMapType.Japan,
    mapSlug: "japan",
    mapStratum: "japan",
    seed: "OFB102",
    spawn: { x: 397, y: 2283, label: "Okinawa" },
    difficulty: Difficulty.Hard,
    nationCount: 3,
    tribeBotCount: 2,
    expectedRoster: [
      "Kanto",
      "Tokyo",
      "Kyoto",
      "Filipino Republics",
      "Mapuche Regime",
    ],
  },
  {
    id: "match-03",
    map: GameMapType.EuropeClassic,
    mapSlug: "europeclassic",
    mapStratum: "europe-classic",
    seed: "OFB103",
    spawn: { x: 729, y: 648, label: "France" },
    difficulty: Difficulty.Medium,
    nationCount: 5,
    tribeBotCount: 0,
    expectedRoster: ["Portugal", "Lithuania", "Italy", "Poland", "Tunisia"],
  },
  {
    id: "match-04",
    map: GameMapType.EuropeClassic,
    mapSlug: "europeclassic",
    mapStratum: "europe-classic",
    seed: "OFB104",
    spawn: { x: 171, y: 171, label: "Iceland" },
    difficulty: Difficulty.Hard,
    nationCount: 3,
    tribeBotCount: 3,
    expectedRoster: [
      "France",
      "Romania",
      "Ukraine",
      "Palmyrene Ascendancy",
      "Romanov Assembly",
      "Iroquois Sisterhood",
    ],
  },
  {
    id: "match-05",
    map: GameMapType.FourIslands,
    mapSlug: "fourislands",
    mapStratum: "four-islands",
    seed: "OFB105A",
    spawn: { x: 403, y: 1296, label: "Korinthal" },
    difficulty: Difficulty.Medium,
    nationCount: 3,
    tribeBotCount: 0,
    expectedRoster: ["Myrkwind", "Lunareth", "Sylvoria"],
  },
  {
    id: "match-06",
    map: GameMapType.FourIslands,
    mapSlug: "fourislands",
    mapStratum: "four-islands",
    seed: "OFB106",
    spawn: { x: 1328, y: 322, label: "Sylvoria" },
    difficulty: Difficulty.Hard,
    nationCount: 1,
    tribeBotCount: 4,
    expectedRoster: [
      "Myrkwind",
      "Danish Alliance",
      "Zuni Hierarchy",
      "York Kingdom",
      "Hopi Army",
    ],
  },
  {
    id: "match-07",
    map: GameMapType.GreatLakes,
    mapSlug: "greatlakes",
    mapStratum: "great-lakes",
    seed: "OFB107A",
    spawn: { x: 1120, y: 1098, label: "Detroit" },
    difficulty: Difficulty.Medium,
    nationCount: 5,
    tribeBotCount: 0,
    expectedRoster: [
      "Toronto",
      "Goderich",
      "Parry Sound",
      "Rouyn-Noranda",
      "Green Bay",
    ],
  },
  {
    id: "match-08",
    map: GameMapType.GreatLakes,
    mapSlug: "greatlakes",
    mapStratum: "great-lakes",
    seed: "OFB108",
    spawn: { x: 38, y: 326, label: "Duluth" },
    difficulty: Difficulty.Hard,
    nationCount: 3,
    tribeBotCount: 3,
    expectedRoster: [
      "Marquette",
      "Marathon",
      "Wausau",
      "Tuareg Supremacy",
      "Ptolemaic District",
      "Almohad Protectorate",
    ],
  },
  {
    id: "match-09",
    map: GameMapType.StraitOfGibraltar,
    mapSlug: "straitofgibraltar",
    mapStratum: "strait-of-gibraltar",
    seed: "OFB109",
    spawn: { x: 1555, y: 258, label: "Andalusia" },
    difficulty: Difficulty.Medium,
    nationCount: 3,
    tribeBotCount: 2,
    expectedRoster: [
      "Spain",
      "Portugal",
      "Rif",
      "Stuart Duchy",
      "Mongolian Monkdom",
    ],
  },
  {
    id: "match-10",
    map: GameMapType.StraitOfGibraltar,
    mapSlug: "straitofgibraltar",
    mapStratum: "strait-of-gibraltar",
    seed: "OFB110",
    spawn: { x: 1287, y: 1175, label: "Morocco" },
    difficulty: Difficulty.Hard,
    nationCount: 1,
    tribeBotCount: 5,
    expectedRoster: [
      "Shilha",
      "Rashidun Territory",
      "Latin Colony",
      "Norwegian Matriarchy",
      "Wolof Free State",
      "Kazakh Queendom",
    ],
  },
  {
    id: "match-11",
    map: GameMapType.World,
    mapSlug: "world",
    mapStratum: "world",
    seed: "OFB111",
    spawn: { x: 990, y: 195, label: "Germany" },
    difficulty: Difficulty.Medium,
    nationCount: 7,
    tribeBotCount: 0,
    expectedRoster: [
      "Cuba",
      "South Africa",
      "Japan",
      "Peru",
      "Chad",
      "Oman",
      "Antarctica",
    ],
  },
  {
    id: "match-12",
    map: GameMapType.World,
    mapSlug: "world",
    mapStratum: "world",
    seed: "OFB112",
    spawn: { x: 1890, y: 775, label: "New Zealand" },
    difficulty: Difficulty.Hard,
    nationCount: 5,
    tribeBotCount: 4,
    expectedRoster: [
      "India",
      "Poland",
      "Romania",
      "Antarctica",
      "Iran",
      "Hittite Republic",
      "British Monkdom",
      "Mapuche Federation",
      "Filipino Army",
    ],
  },
] as const;

export const BENCHMARK_MAPS = Object.freeze(
  Array.from(new Set(BENCHMARK_MATCH_TASKS.map((task) => task.map))),
);

export function benchmarkGameConfig(task: BenchmarkMatchTask): GameConfig {
  return GameConfigSchema.parse({
    gameMap: task.map,
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Singleplayer,
    difficulty: task.difficulty,
    nations: task.nationCount,
    bots: task.tribeBotCount,
    donateGold: false,
    donateTroops: false,
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    maxTimerValue: BENCHMARK_LIMITS.maxSimulatedMinutes,
  });
}

export function createBenchmarkStartInfo(
  task: BenchmarkMatchTask,
  model: string,
): GameStartInfo {
  return {
    gameID: replaySafeGameId(task.seed),
    lobbyCreatedAt: 0,
    config: benchmarkGameConfig(task),
    players: [
      {
        clientID: BENCHMARK_CLIENT_ID,
        // Model identity is report metadata, not agent-visible task state.
        username: "Evaluated Agent",
        clanTag: null,
        isLobbyCreator: true,
      },
    ],
  };
}

export function publicBenchmarkTask(task: BenchmarkMatchTask, model: string) {
  return {
    ...task,
    playerName: "Evaluated Agent",
    fieldSize: 1 + task.nationCount + task.tribeBotCount,
    limits: BENCHMARK_LIMITS,
    openfront: { version: OPENFRONT_VERSION, commit: OPENFRONT_COMMIT },
  };
}

export function benchmarkTask(id: string): BenchmarkMatchTask {
  const task = BENCHMARK_MATCH_TASKS.find((candidate) => candidate.id === id);
  if (!task) throw new Error(`Unknown benchmark task: ${id}`);
  return task;
}
