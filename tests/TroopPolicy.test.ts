import path from "path";
import { describe, expect, test } from "vitest";
import { createGameRunner } from "../OpenFrontIO/src/core/GameRunner";
import { Intent, Turn } from "../OpenFrontIO/src/core/Schemas";
import { NodeGameMapLoader } from "../src/NodeGameMapLoader";
import {
  budgetedTroopAmounts,
  calculateTroopBudget,
  counterTroopCap,
  createLegalActions,
  createObservation,
  ordinaryAttackEligible,
  selectTroopPolicyMode,
  TROOP_POLICY,
} from "../src/ObservationActions";
import { promptFor } from "../src/OpenRouterAgent";
import { createScenarioStartInfo, SCENARIO } from "../src/Scenario";
import { LegalAction } from "../src/Types";

function troopCommitment(candidate: LegalAction): number {
  const intent = candidate.intent;
  return intent?.type === "attack" || intent?.type === "boat"
    ? (intent.troops ?? 0)
    : 0;
}

describe("troop policy", () => {
  test("allocates a shared two-slot budget above the mode reserve", () => {
    const budget = calculateTroopBudget(100_000, 200_000, "expansion");
    expect(budget.reserveFloorTroops).toBe(30_000);
    expect(budget.spendableTroops).toBe(70_000);
    expect(budget.perActionTroopBudget).toBe(35_000);

    const amounts = budgetedTroopAmounts(budget);
    for (const first of amounts) {
      for (const second of amounts) {
        expect(first.troops + second.troops).toBeLessThanOrEqual(
          budget.spendableTroops,
        );
      }
    }

    expect(calculateTroopBudget(20_000, 200_000, "combat")).toMatchObject({
      reserveFloorTroops: 70_000,
      spendableTroops: 0,
      perActionTroopBudget: 0,
    });
  });

  test("uses emergency precedence and gates ordinary attacks", () => {
    expect(
      selectTroopPolicyMode({
        hostileIncoming: true,
        hostileBorder: true,
        eligibleNavalTarget: true,
      }),
    ).toBe("emergency");
    expect(
      selectTroopPolicyMode({
        hostileIncoming: false,
        hostileBorder: true,
        eligibleNavalTarget: false,
      }),
    ).toBe("combat");
    expect(
      selectTroopPolicyMode({
        hostileIncoming: false,
        hostileBorder: false,
        eligibleNavalTarget: false,
      }),
    ).toBe("expansion");

    expect(ordinaryAttackEligible(54_999, 100_000, 20_000)).toBe(false);
    expect(ordinaryAttackEligible(55_000, 100_000, 55_000)).toBe(false);
    expect(ordinaryAttackEligible(55_001, 100_000, 55_000)).toBe(true);
  });

  test("caps bounded counters by the incoming force", () => {
    const budget = calculateTroopBudget(100_000, 200_000, "emergency");
    const cap = counterTroopCap(12_000, 12_000);
    const amounts = budgetedTroopAmounts(budget, cap);
    expect(Math.max(...amounts.map((item) => item.troops))).toBe(6_000);
    expect(
      amounts.every((item) => item.troops <= 6_000 && item.troops <= 35_000),
    ).toBe(true);
    expect(counterTroopCap(8_000, 20_000)).toBe(8_000);
  });

  test("repeated maximum expansion cannot spend through the reserve", async () => {
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

    const spawn = runner.game.ref(SCENARIO.spawn.x, SCENARIO.spawn.y);
    execute([{ type: "spawn", tile: spawn }]);
    for (let tick = 0; tick < 20; tick++) {
      if (
        runner.game.players().length === 4 &&
        runner.game.players().every((player) => player.hasSpawned()) &&
        !runner.game.inSpawnPhase()
      ) {
        break;
      }
      execute();
    }
    const player = runner.game.playerByClientID(SCENARIO.clientID)!;

    for (let decision = 0; decision < 20; decision++) {
      const observation = createObservation(runner.game, player, decision, []);
      const candidates = createLegalActions(runner.game, player);
      const self = observation.self as Record<string, number | string>;
      const currentTroops = Number(self.troops);
      const reserveFloor = Number(self.reserveFloorTroops);
      const spendable = Number(self.spendableTroops);
      const troopCandidates = candidates.filter(
        (candidate) => troopCommitment(candidate) > 0,
      );

      for (let first = 0; first < troopCandidates.length; first++) {
        for (let second = first; second < troopCandidates.length; second++) {
          expect(
            troopCommitment(troopCandidates[first]) +
              troopCommitment(troopCandidates[second]),
          ).toBeLessThanOrEqual(spendable);
        }
      }

      const selected = candidates
        .filter((candidate) => candidate.category === "expand")
        .sort((a, b) => troopCommitment(b) - troopCommitment(a))
        .slice(0, 2);
      const intents = selected
        .map((candidate) => candidate.intent)
        .filter((intent): intent is Intent => intent !== null);
      if (selected.length > 0) {
        expect(
          currentTroops -
            selected.reduce(
              (sum, candidate) => sum + troopCommitment(candidate),
              0,
            ),
        ).toBeGreaterThanOrEqual(reserveFloor);
      }
      execute(intents);
      for (let tick = 1; tick < SCENARIO.decisionIntervalTicks; tick++) {
        execute();
      }

      if (spendable === 0) {
        expect(selected).toHaveLength(0);
      }
    }

    const finalObservation = createObservation(runner.game, player, 20, []);
    const finalCandidates = createLegalActions(runner.game, player);
    const prompt = promptFor(finalObservation, finalCandidates);
    expect(prompt).toContain("troop growth approaches zero near 100% capacity");
    expect(prompt).toContain("troopCapacityPercent");
    expect(prompt).toContain(
      "instantVictoryTerritoryPercent is the territory threshold",
    );
    expect(prompt).toContain("the living player with the most land tiles wins");
    expect(prompt).not.toContain('"winPercent"');
    expect(finalObservation).toMatchObject({
      instantVictoryTerritoryPercent: 80,
      currentRank: expect.any(Number),
      territoryLeader: {
        id: expect.any(String),
        name: expect.any(String),
        territoryPercent: expect.any(Number),
      },
      territoryGapToLeader: expect.any(Number),
    });
    expect(finalObservation).not.toHaveProperty("winPercent");
    expect(finalObservation.self).toMatchObject({
      troopPolicyMode: expect.stringMatching(/expansion|combat|emergency/),
      reserveFloorPercent: expect.any(Number),
      troopGrowthPerSecond: expect.any(Number),
    });
    expect(TROOP_POLICY.combatTriggerRatio).toBe(0.55);
  }, 30_000);
});
