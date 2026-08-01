import { describe, expect, test } from "vitest";
import { Relation, UnitType } from "../OpenFrontIO/src/core/game/Game";
import {
  allianceRequestHistory,
  relationStatus,
  resolveDecisionActions,
  selectSafestBuildAnchor,
} from "../src/ObservationActions";
import { LegalAction } from "../src/Types";

const candidates: LegalAction[] = [
  { id: "hold:1", category: "hold", label: "Hold one", intent: null },
  { id: "hold:2", category: "hold", label: "Hold two", intent: null },
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

describe("fixed action slots", () => {
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
              {
                actionId: "hold:2",
                status: "completed",
                startedAtTick: 100,
                resolvedAtTick: 100,
                entityId: null,
                detail: "Held intentionally",
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

  test("keeps two distinct legal actions", () => {
    const result = resolveDecisionActions(
      ["expand:neutral:25", "hold:2"],
      candidates,
    );
    expect(result.actions.map((action) => action.id)).toEqual([
      "expand:neutral:25",
      "hold:2",
    ]);
    expect(result.fallback).toBe(false);
  });

  test("allows the same repeatable troop action in both slots", () => {
    const result = resolveDecisionActions(
      ["expand:neutral:25", "expand:neutral:25"],
      candidates,
    );
    expect(result.actions.map((action) => action.id)).toEqual([
      "expand:neutral:25",
      "expand:neutral:25",
    ]);
    expect(result.fallback).toBe(false);
  });

  test("replaces repeated non-repeatable and unknown selections with slot holds", () => {
    const repeatedDiplomacy = resolveDecisionActions(
      ["alliance:request:opponent", "alliance:request:opponent"],
      candidates,
    );
    expect(repeatedDiplomacy.actions.map((action) => action.id)).toEqual([
      "alliance:request:opponent",
      "hold:2",
    ]);
    expect(repeatedDiplomacy.fallback).toBe(true);

    expect(
      resolveDecisionActions(["unknown", "hold:2"], candidates).actions.map(
        (action) => action.id,
      ),
    ).toEqual(["hold:1", "hold:2"]);
  });

  test("allows a build only in the first action slot", () => {
    const result = resolveDecisionActions(
      ["build:City:123", "build:Factory:456"],
      candidates,
    );

    expect(result.actions.map((action) => action.id)).toEqual([
      "build:City:123",
      "hold:2",
    ]);
    expect(result.fallback).toBe(true);

    const wrongSlot = resolveDecisionActions(
      ["expand:neutral:25", "build:Port:789"],
      candidates,
    );
    expect(wrongSlot.actions.map((action) => action.id)).toEqual([
      "expand:neutral:25",
      "hold:2",
    ]);
    expect(wrongSlot.fallback).toBe(true);
  });

  test.each([
    ["alliance:request:opponent", "embargo:start:opponent"],
    ["attack:opponent:25", "alliance:request:opponent"],
    ["alliance:request:opponent", "boat:opponent:25"],
    ["alliance:extend:opponent", "alliance:break:opponent"],
  ])(
    "replaces conflicting same-target actions %s and %s with holds",
    (action1, action2) => {
      const result = resolveDecisionActions([action1, action2], candidates);

      expect(result.actions.map((action) => action.id)).toEqual([
        "hold:1",
        "hold:2",
      ]);
      expect(result.fallback).toBe(true);
    },
  );

  test("allows different postures toward different opponents", () => {
    const result = resolveDecisionActions(
      ["alliance:request:opponent", "embargo:start:other"],
      candidates,
    );

    expect(result.actions.map((action) => action.id)).toEqual([
      "alliance:request:opponent",
      "embargo:start:other",
    ]);
    expect(result.fallback).toBe(false);
  });

  test("rejects proactive attacks against two different opponents", () => {
    const result = resolveDecisionActions(
      ["attack:opponent:25", "attack:other:25"],
      candidates,
    );

    expect(result.actions.map((action) => action.id)).toEqual([
      "hold:1",
      "hold:2",
    ]);
    expect(result.fallback).toBe(true);
  });

  test("allows counters against two different incoming attackers", () => {
    const result = resolveDecisionActions(
      ["counter:opponent:25", "counter:other:25"],
      candidates,
    );

    expect(result.actions.map((action) => action.id)).toEqual([
      "counter:opponent:25",
      "counter:other:25",
    ]);
    expect(result.fallback).toBe(false);
  });
});
