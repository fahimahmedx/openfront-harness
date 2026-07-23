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

  test("replaces duplicate and unknown selections with slot holds", () => {
    expect(
      resolveDecisionActions(
        ["expand:neutral:25", "expand:neutral:25"],
        candidates,
      ).actions.map((action) => action.id),
    ).toEqual(["expand:neutral:25", "hold:2"]);
    expect(
      resolveDecisionActions(["unknown", "hold:2"], candidates).actions.map(
        (action) => action.id,
      ),
    ).toEqual(["hold:1", "hold:2"]);
  });
});
