import { describe, expect, test } from "vitest";
import { Relation, UnitType } from "../OpenFrontIO/src/core/game/Game";
import {
  allianceRequestHistory,
  relationStatus,
  resolveDecisionAction,
  selectSafestBuildAnchor,
} from "../src/ObservationActions";
import { LegalAction } from "../src/Types";

const candidates: LegalAction[] = [
  { id: "hold", category: "hold", label: "Hold", intent: null },
  {
    id: "expand:neutral:25",
    category: "expand",
    label: "Expand",
    intent: { type: "attack", targetID: null, troops: 25 },
  },
  {
    id: "alliance:request:opponent",
    category: "diplomacy",
    label: "Request alliance",
    intent: { type: "allianceRequest", recipient: "opponent" },
  },
  {
    id: "embargo:start:opponent",
    category: "diplomacy",
    label: "Embargo opponent",
    intent: { type: "embargo", targetID: "opponent", action: "start" },
  },
  {
    id: "attack:opponent:25",
    category: "attack",
    label: "Attack opponent",
    intent: { type: "attack", targetID: "opponent", troops: 25 },
  },
  {
    id: "attack:other:25",
    category: "attack",
    label: "Attack another opponent",
    intent: { type: "attack", targetID: "other", troops: 25 },
  },
  {
    id: "counter:opponent:25",
    category: "attack",
    label: "Counter opponent",
    intent: { type: "attack", targetID: "opponent", troops: 25 },
  },
  {
    id: "counter:other:25",
    category: "attack",
    label: "Counter another opponent",
    intent: { type: "attack", targetID: "other", troops: 25 },
  },
  {
    id: "boat:opponent:25",
    category: "boat",
    label: "Invade opponent by sea",
    intent: { type: "boat", dst: 789, troops: 25 },
  },
  {
    id: "embargo:start:other",
    category: "diplomacy",
    label: "Embargo another opponent",
    intent: { type: "embargo", targetID: "other", action: "start" },
  },
  {
    id: "alliance:extend:opponent",
    category: "diplomacy",
    label: "Extend alliance",
    intent: { type: "allianceExtension", recipient: "opponent" },
  },
  {
    id: "alliance:break:opponent",
    category: "diplomacy",
    label: "Break alliance",
    intent: { type: "breakAlliance", recipient: "opponent" },
  },
  {
    id: "build:City:123",
    category: "build",
    label: "Build City near (1, 2)",
    intent: { type: "build_unit", unit: UnitType.City, tile: 123 },
  },
  {
    id: "build:Defense Post:123",
    category: "build",
    label: "Build Defense Post near (1, 2)",
    intent: {
      type: "build_unit",
      unit: UnitType.DefensePost,
      tile: 123,
    },
  },
  {
    id: "build:Factory:456",
    category: "build",
    label: "Build Factory near (3, 4)",
    intent: { type: "build_unit", unit: UnitType.Factory, tile: 456 },
  },
  {
    id: "build:Port:789",
    category: "build",
    label: "Build Port near (5, 6)",
    intent: { type: "build_unit", unit: UnitType.Port, tile: 789 },
  },
];

describe("single-action decisions", () => {
  test("exposes semantic relations and persistent alliance request history", () => {
    expect([
      relationStatus(Relation.Hostile),
      relationStatus(Relation.Distrustful),
      relationStatus(Relation.Neutral),
      relationStatus(Relation.Friendly),
    ]).toEqual(["hostile", "distrustful", "neutral", "friendly"]);

    expect(
      allianceRequestHistory(
        [
          {
            actionOutcomes: [
              {
                actionId: "alliance:request:opponent",
                status: "completed",
                startedAtTick: 100,
                resolvedAtTick: 110,
                entityId: null,
                detail: "Alliance request to Opponent was rejected",
              },
            ],
          },
        ],
        "opponent",
      ),
    ).toEqual({ sentCount: 1, lastResult: "rejected" });
  });

  test("selects the legal build anchor farthest from a hostile front", () => {
    const spawnByAnchor = new Map<number, number | false>([
      [10, 11],
      [20, 21],
      [30, false],
    ]);
    const distanceByTile = new Map([
      [10, 3],
      [11, 2],
      [20, 8],
      [21, 7],
    ]);

    expect(
      selectSafestBuildAnchor(
        [10, 20, 30],
        (anchor) => spawnByAnchor.get(anchor) ?? false,
        (tile) => distanceByTile.get(tile) ?? 0,
      ),
    ).toBe(20);
  });

  test("preserves deterministic anchor order when safety is tied", () => {
    expect(
      selectSafestBuildAnchor(
        [20, 10],
        (anchor) => anchor + 1,
        () => 5,
      ),
    ).toBe(20);
  });

  test("keeps one legal action", () => {
    const result = resolveDecisionAction("expand:neutral:25", candidates);
    expect(result.action.id).toBe("expand:neutral:25");
    expect(result.fallback).toBe(false);
  });

  test("keeps gold-spending actions without slot rules", () => {
    const result = resolveDecisionAction("build:City:123", candidates);
    expect(result.action.id).toBe("build:City:123");
    expect(result.fallback).toBe(false);
  });

  test("replaces an unknown selection with the one hold", () => {
    const result = resolveDecisionAction("unknown", candidates);
    expect(result.action.id).toBe("hold");
    expect(result.fallback).toBe(true);
  });
});
