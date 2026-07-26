import { ReplaySpeedMultiplier } from "../../OpenFrontIO/src/client/utilities/ReplaySpeedMultiplier";

export const REPLAY_TICKS_PER_SECOND = 10;

export const replayRates = [
  {
    id: "slow",
    label: "0.5×",
    multiplier: ReplaySpeedMultiplier.slow,
  },
  {
    id: "normal",
    label: "1×",
    multiplier: ReplaySpeedMultiplier.normal,
  },
  {
    id: "fast",
    label: "2×",
    multiplier: ReplaySpeedMultiplier.fast,
  },
  {
    id: "fastest",
    label: "Max",
    multiplier: ReplaySpeedMultiplier.fastest,
  },
] as const;

export type ReplayRate = (typeof replayRates)[number];

export function clampReplayTick(tick: number, totalTicks: number): number {
  if (!Number.isFinite(tick) || tick <= 0) return 0;
  if (!Number.isFinite(totalTicks) || totalTicks <= 0) return Math.floor(tick);
  return Math.min(Math.floor(tick), Math.floor(totalTicks));
}

export function formatReplayTime(tick: number): string {
  const totalSeconds = Math.max(0, Math.floor(tick / REPLAY_TICKS_PER_SECOND));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function replayProgressPercent(
  tick: number,
  totalTicks: number,
): number {
  if (!Number.isFinite(totalTicks) || totalTicks <= 0) return 0;
  return (clampReplayTick(tick, totalTicks) / Math.floor(totalTicks)) * 100;
}

export function isReplayComplete(tick: number, totalTicks: number): boolean {
  return totalTicks > 0 && tick >= totalTicks;
}
