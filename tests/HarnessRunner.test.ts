import { describe, expect, it } from "vitest";
import { calculateFinalPlacement, PlacementEntry } from "../src/HarnessRunner";

describe("terminal placement", () => {
  const entries: PlacementEntry[] = [
    { id: "winner", alive: true, tiles: 194_264 },
    { id: "runner-up", alive: true, tiles: 184_702 },
    { id: "agent", alive: true, tiles: 88_526 },
    { id: "eliminated", alive: false, tiles: 0, eliminatedAt: 8_900 },
  ];

  it("ranks every surviving player by terminal territory", () => {
    expect(calculateFinalPlacement(entries, "winner")).toBe(1);
    expect(calculateFinalPlacement(entries, "runner-up")).toBe(2);
    expect(calculateFinalPlacement(entries, "agent")).toBe(3);
  });

  it("continues to rank eliminated players by elimination order", () => {
    const withTwoEliminations: PlacementEntry[] = [
      { id: "winner", alive: true, tiles: 200_000 },
      { id: "survivor", alive: true, tiles: 150_000 },
      { id: "late", alive: false, tiles: 0, eliminatedAt: 9_000 },
      { id: "early", alive: false, tiles: 0, eliminatedAt: 7_000 },
    ];

    expect(calculateFinalPlacement(withTwoEliminations, "late")).toBe(3);
    expect(calculateFinalPlacement(withTwoEliminations, "early")).toBe(4);
  });

  it("breaks equal elimination ticks by prior land then engine order", () => {
    const tied: PlacementEntry[] = [
      { id: "winner", alive: true, tiles: 100 },
      { id: "small", alive: false, tiles: 10, eliminatedAt: 50 },
      { id: "large", alive: false, tiles: 20, eliminatedAt: 50 },
      { id: "same", alive: false, tiles: 10, eliminatedAt: 50 },
    ];
    expect(calculateFinalPlacement(tied, "large")).toBe(2);
    expect(calculateFinalPlacement(tied, "small")).toBe(3);
    expect(calculateFinalPlacement(tied, "same")).toBe(4);
  });

  it("places an engine-declared winner first", () => {
    expect(
      calculateFinalPlacement(
        [
          { id: "land-leader", alive: true, tiles: 200 },
          { id: "winner", alive: true, tiles: 100 },
        ],
        "winner",
        "winner",
      ),
    ).toBe(1);
  });
});
