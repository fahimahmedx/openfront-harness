import { describe, expect, it } from "vitest";
import {
  formatExactTroops,
  formatAttemptTiming,
  formatLatency,
  presentReplayAction,
  statDelta,
} from "../src/client/ReplayTraceState";

describe("replay trace presentation", () => {
  it("uses the recorded human label and separates policy detail", () => {
    expect(
      presentReplayAction(
        "attack:player:100",
        [
          {
            id: "attack:player:100",
            label:
              "Attack Hokkaido by land with 12,000 troops (100% of this slot's safe budget; 35% capacity reserve)",
            intent: {
              type: "attack",
              troops: 12_000,
            },
          },
        ],
        "queued as a legal core intent",
      ),
    ).toEqual({
      label: "Attack Hokkaido by land with 1.20K troops",
      detail: "100% of this slot's safe budget · 35% capacity reserve",
      outcome: "Queued successfully",
    });
  });

  it("renders recorded raw troop units on the same scale as the game HUD", () => {
    expect(
      presentReplayAction(
        "expand:neutral:100",
        [
          {
            id: "expand:neutral:100",
            label:
              "Expand into neutral land with 67,809 troops (100% of this slot's safe budget; 15% capacity reserve)",
            intent: {
              type: "attack",
              troops: 67_809,
            },
          },
        ],
        "queued as a legal core intent",
      ).label,
    ).toBe("Expand into neutral land with 6.78K troops");
    expect(formatExactTroops(299_679)).toBe("29,967");
  });

  it("humanizes holds and falls back to an unmatched raw action ID", () => {
    expect(presentReplayAction("hold:1", [], "held")).toEqual({
      label: "hold:1",
      detail: null,
      outcome: "No action taken",
    });
  });

  it("keeps meaningful trailing coordinates in the primary label", () => {
    expect(
      presentReplayAction(
        "build:City:123",
        [
          {
            id: "build:City:123",
            label: "Build City near (1613, 1133)",
          },
        ],
        "queued as a legal core intent",
      ),
    ).toMatchObject({
      label: "Build City near (1613, 1133)",
      detail: null,
    });
  });

  it("formats compact latency values", () => {
    expect(formatLatency(782)).toBe("782ms");
    expect(formatLatency(7_766)).toBe("7.8s");
    expect(formatLatency(null)).toBe("—");
  });

  it("formats an attempt timing breakdown without inventing queue data", () => {
    expect(
      formatAttemptTiming({
        attempt: 2,
        totalMs: 2_750,
        timeToFirstTokenMs: 1_200,
        generationMs: 1_550,
        completionTokens: 101,
        timePerOutputTokenMs: 15.5,
        queueMs: null,
      }),
    ).toBe("A2 2.8s / TTFT 1.2s / gen 1.6s / TPOT 16ms / queue —");
  });

  it("describes positive, negative, unchanged, and unavailable deltas", () => {
    expect(statDelta(125, 100)).toMatchObject({
      direction: "up",
      label: "↑ 25.0%",
    });
    expect(statDelta(75, 100)).toMatchObject({
      direction: "down",
      label: "↓ 25.0%",
    });
    expect(statDelta(100, 100)).toMatchObject({
      direction: "flat",
      label: "0.0%",
    });
    expect(statDelta(100, undefined)).toMatchObject({
      direction: "unavailable",
      label: "—",
    });
    expect(statDelta(100, 0)).toMatchObject({
      direction: "unavailable",
      label: "—",
    });
  });
});
