import { renderTroops } from "../../OpenFrontIO/src/client/Utils";

export type ReplayActionCandidate = {
  id: string;
  label: string;
  intent?: {
    type: string;
    troops?: number;
  } | null;
};

export type ActionPresentation = {
  label: string;
  detail: string | null;
  outcome: string;
};

export type StatDelta = {
  direction: "up" | "down" | "flat" | "unavailable";
  label: string;
  description: string;
};

export function presentReplayAction(
  id: string,
  candidates: ReplayActionCandidate[],
  outcome: string | undefined,
): ActionPresentation {
  const candidate = candidates.find((entry) => entry.id === id);
  const recordedLabel = candidate?.label ?? id;
  const rawTroops = candidate?.intent?.troops;
  const humanLabel =
    typeof rawTroops === "number" && Number.isFinite(rawTroops)
      ? recordedLabel.replace(
          `${Math.floor(rawTroops).toLocaleString("en-US")} troops`,
          `${renderTroops(rawTroops)} troops`,
        )
      : recordedLabel;
  const trailingDetail = humanLabel.match(/^(.*?)\s+\(([^()]*)\)$/);
  const detailMatch =
    trailingDetail && /safe budget|capacity reserve/i.test(trailingDetail[2])
      ? trailingDetail
      : null;

  return {
    label: detailMatch?.[1] ?? humanLabel,
    detail: detailMatch?.[2].replace(/;\s*/g, " · ") ?? null,
    outcome:
      outcome === "held"
        ? "No action taken"
        : outcome === "queued as a legal core intent"
          ? "Queued successfully"
          : (outcome ?? "Outcome unavailable"),
  };
}

export function formatExactTroops(troops: number): string {
  return Math.floor(Math.max(0, troops) / 10).toLocaleString("en-US");
}

export function formatLatency(latencyMs: number | null | undefined): string {
  if (latencyMs === null || latencyMs === undefined) return "—";
  if (latencyMs < 1_000) return `${Math.round(latencyMs)}ms`;
  return `${(latencyMs / 1_000).toFixed(1)}s`;
}

export type ReplayAttemptTiming = {
  attempt: number;
  totalMs: number;
  timeToFirstTokenMs: number | null;
  generationMs: number | null;
  completionTokens: number;
  timePerOutputTokenMs: number | null;
  queueMs: number | null;
};

export function formatAttemptTiming(timing: ReplayAttemptTiming): string {
  return [
    `A${timing.attempt} ${formatLatency(timing.totalMs)}`,
    `TTFT ${formatLatency(timing.timeToFirstTokenMs)}`,
    `gen ${formatLatency(timing.generationMs)}`,
    `TPOT ${formatLatency(timing.timePerOutputTokenMs)}`,
    `queue ${formatLatency(timing.queueMs)}`,
  ].join(" / ");
}

export function statDelta(
  current: number,
  previous: number | undefined,
): StatDelta {
  if (
    previous === undefined ||
    !Number.isFinite(current) ||
    !Number.isFinite(previous) ||
    previous === 0
  ) {
    return {
      direction: "unavailable",
      label: "—",
      description: "No previous decision comparison available",
    };
  }

  const change = ((current - previous) / Math.abs(previous)) * 100;
  if (change === 0) {
    return {
      direction: "flat",
      label: "0.0%",
      description: "Unchanged from the previous decision",
    };
  }

  const direction = change > 0 ? "up" : "down";
  const amount = Math.abs(change).toFixed(1);
  return {
    direction,
    label: `${change > 0 ? "↑" : "↓"} ${amount}%`,
    description: `${change > 0 ? "Up" : "Down"} ${amount}% from the previous decision`,
  };
}
