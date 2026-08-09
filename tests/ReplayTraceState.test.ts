import { describe, expect, it } from "vitest";
import {
  formatExactTroops,
  formatAttemptTiming,
  formatLatency,
  presentReplayAction,
  presentReplayStrategy,
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

  it("renders strategy troop quantities on the same scale as the game HUD", () => {
    expect(
      presentReplayStrategy(
        "Chubu is down to 1,299 tiles/241K troops. Invade with 2,778,176 troops.",
      ),
    ).toBe(
      "Chubu is down to 1,299 tiles/24.1K troops. Invade with 277K troops.",
    );
    expect(
      presentReplayStrategy(
        "Lead 12.9%. 1.02M spendable vs 1.34M Chubu troops; capture 112K tiles.",
      ),
    ).toBe(
      "Lead 12.9%. 102K spendable vs 134K Chubu troops; capture 112K tiles.",
    );
    expect(
      presentReplayStrategy("Gold: 541K. Troops growing 18.7K/s."),
    ).toBe("Gold: 541K. Troops growing 1.87K/s.");
    expect(
      presentReplayStrategy(
        "Parry Sound attacks with 17,509. Tiny 249-troop attack. 61,344 vs 60,274 tiles.",
        {
          candidates: [
            {
              id: "attack:player:25",
              label: "Attack Parry Sound",
              intent: { type: "attack", troops: 17_509 },
            },
          ],
        },
      ),
    ).toBe(
      "Parry Sound attacks with 1.75K. Tiny 24-troop attack. 61,344 vs 60,274 tiles.",
    );
    expect(
      presentReplayStrategy("Enemy strength is 0.43 relative troops.", {
        observation: {
          self: { totalIncomingTroops: 0 },
          opponents: [{ relativeTroops: 0.43 }],
        },
      }),
    ).toBe("Enemy strength is 0.43 relative troops.");
    expect(
      presentReplayStrategy("Enemy has 10.6x our troops.", {
        observation: { self: { troopGrowthPerSecond: 10 } },
      }),
    ).toBe("Enemy has 10.6x our troops.");
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
