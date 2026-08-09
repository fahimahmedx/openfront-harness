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

type ReplayStrategyContext = {
  observation?: {
    self?: Record<string, unknown>;
    opponents?: Array<Record<string, unknown>>;
  };
  candidates?: ReplayActionCandidate[];
};

const NUMERIC_QUANTITY =
  /\b(\d[\d,]*(?:\.\d+)?)(?:\s*([KMB]))?(?![\dA-Za-z]|\.\d)/gi;

function parseCompactNumber(value: string, suffix: string | undefined): number {
  const amount = Number(value.replaceAll(",", ""));
  const multiplier =
    suffix?.toUpperCase() === "B"
      ? 1_000_000_000
      : suffix?.toUpperCase() === "M"
        ? 1_000_000
        : suffix?.toUpperCase() === "K"
          ? 1_000
          : 1;
  return amount * multiplier;
}

function knownTroopValues(context: ReplayStrategyContext | undefined): number[] {
  const values: number[] = [];
  const visit = (value: unknown, key = "") => {
    if (
      typeof value === "number" &&
      /troops?/i.test(key) &&
      !/(?:percent|ratio|relative)/i.test(key)
    ) {
      values.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => visit(entry, key));
      return;
    }
    if (value && typeof value === "object") {
      Object.entries(value).forEach(([childKey, child]) =>
        visit(child, childKey),
      );
    }
  };
  visit(context?.observation?.self);
  visit(context?.observation?.opponents);
  visit(context?.candidates);
  return values.filter(Number.isFinite);
}

function matchesKnownTroopValue(
  rawValue: number,
  value: string,
  suffix: string | undefined,
  knownValues: number[],
): boolean {
  const decimalPlaces = value.includes(".")
    ? (value.split(".")[1]?.length ?? 0)
    : 0;
  const multiplier = suffix
    ? suffix.toUpperCase() === "B"
      ? 1_000_000_000
      : suffix.toUpperCase() === "M"
        ? 1_000_000
        : 1_000
    : 1;
  const tolerance = suffix
    ? multiplier / 10 ** decimalPlaces / 2 + 1
    : 0.5 / 10 ** decimalPlaces;
  return knownValues.some((known) => Math.abs(known - rawValue) <= tolerance);
}

/**
 * Agent-v13 observations used OpenFront's raw engine troop units. Replays keep
 * those exact responses in the artifact, but present troop quantities on the
 * same one-tenth scale as the game HUD.
 */
export function presentReplayStrategy(
  strategy: string,
  context?: ReplayStrategyContext,
): string {
  const knownValues = knownTroopValues(context);
  return strategy.replace(
    NUMERIC_QUANTITY,
    (
      match,
      value: string,
      suffix: string | undefined,
      offset: number,
      source: string,
    ) => {
      const before = source.slice(Math.max(0, offset - 28), offset);
      const after = source.slice(offset + match.length, offset + match.length + 28);
      const isUnscaledQuantity =
        /^\s*(?:%|x\b|(?:st|nd|rd|th)\b|s(?:ec(?:onds?)?)?\b|min(?:utes?)?\b|h(?:ours?)?\b|(?:tiles?|gold|coins?|tokens?)\b)/i.test(
          after,
        ) ||
        /(?:gold|coins?|tokens?)\s*(?::|=|at|of|is|has|with)?\s*$/i.test(
          before,
        );
      if (isUnscaledQuantity) return match;
      const rawTroops = parseCompactNumber(value, suffix);
      const explicitlyTroops = /^\s*-?\s*troops?\b/i.test(after);
      const shouldScale =
        suffix !== undefined ||
        explicitlyTroops ||
        matchesKnownTroopValue(rawTroops, value, suffix, knownValues);
      return shouldScale && Number.isFinite(rawTroops)
        ? renderTroops(rawTroops)
        : match;
    },
  );
}

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
