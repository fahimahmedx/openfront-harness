export type ReplayActionCandidate = {
  id: string;
  label: string;
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
  const humanLabel = candidate?.label ?? id;
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

export function formatLatency(latencyMs: number): string {
  if (latencyMs < 1_000) return `${Math.round(latencyMs)}ms`;
  return `${(latencyMs / 1_000).toFixed(1)}s`;
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
