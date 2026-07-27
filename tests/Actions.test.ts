import { describe, expect, test } from "vitest";
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
});
