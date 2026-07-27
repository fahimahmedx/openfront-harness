import { describe, expect, it } from "vitest";
import { ReplaySpeedMultiplier } from "../OpenFrontIO/src/client/utilities/ReplaySpeedMultiplier";
import {
  clampReplayTick,
  formatReplayTime,
  isReplayComplete,
  replayProgressPercent,
  replayRates,
} from "../src/client/ReplayPlaybackState";

describe("replay playback state", () => {
  it("maps viewer-facing rates to OpenFront replay multipliers", () => {
    expect(
      replayRates.map(({ label, multiplier }) => ({ label, multiplier })),
    ).toEqual([
      { label: "1×", multiplier: ReplaySpeedMultiplier.normal },
      { label: "2×", multiplier: ReplaySpeedMultiplier.fast },
      { label: "Max", multiplier: ReplaySpeedMultiplier.fastest },
    ]);
  });

  it("formats replay ticks as simulated time", () => {
    expect(formatReplayTime(0)).toBe("00:00");
    expect(formatReplayTime(10561)).toBe("17:36");
    expect(formatReplayTime(36610)).toBe("1:01:01");
  });

  it("clamps progress to the recorded replay duration", () => {
    expect(clampReplayTick(-1, 100)).toBe(0);
    expect(clampReplayTick(40.9, 100)).toBe(40);
    expect(clampReplayTick(120, 100)).toBe(100);
    expect(replayProgressPercent(25, 100)).toBe(25);
    expect(replayProgressPercent(120, 100)).toBe(100);
  });

  it("only completes once the terminal tick is reached", () => {
    expect(isReplayComplete(99, 100)).toBe(false);
    expect(isReplayComplete(100, 100)).toBe(true);
    expect(isReplayComplete(101, 100)).toBe(true);
    expect(isReplayComplete(0, 0)).toBe(false);
  });
});
