import { describe, expect, test } from "vitest";
import { UnitType } from "../OpenFrontIO/src/core/game/Game";
import { resolveDecisionActions } from "../src/ObservationActions";
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
];

describe("fixed action slots", () => {
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

  test("replaces a second structure build at the same coordinate with a hold", () => {
    const result = resolveDecisionActions(
      ["build:City:123", "build:Defense Post:123"],
      candidates,
    );

    expect(result.actions.map((action) => action.id)).toEqual([
      "build:City:123",
      "hold:2",
    ]);
    expect(result.fallback).toBe(true);
  });

  test("keeps structure builds at different coordinates", () => {
    const result = resolveDecisionActions(
      ["build:City:123", "build:Factory:456"],
      candidates,
    );

    expect(result.actions.map((action) => action.id)).toEqual([
      "build:City:123",
      "build:Factory:456",
    ]);
    expect(result.fallback).toBe(false);
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
});
