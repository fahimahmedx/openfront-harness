import { AgentPolicy } from "../HarnessRunner";
import { LegalAction, Observation } from "../Types";
import { sha256 } from "./CanonicalJson";
import { BenchmarkManifest } from "./BenchmarkSchemas";

export const ACCEPTANCE_POLICY_VERSION = "benchmark-acceptance-v3";

export type CapabilityTask = Extract<
  BenchmarkManifest["tasks"][number],
  { suite: "capability" }
>;

export const ACCEPTANCE_CONTROL_MODES = ["control1", "control2"] as const;
export type AcceptanceControlMode = (typeof ACCEPTANCE_CONTROL_MODES)[number];
export type AcceptancePolicyMode = "reference" | AcceptanceControlMode;

function largest(candidates: LegalAction[], prefix: string): string {
  const matches = candidates.filter((item) => item.id.startsWith(prefix));
  if (matches.length === 0)
    throw new Error(`No acceptance action matching ${prefix}`);
  return matches.sort((left, right) => {
    const rightParts = right.id.split(":");
    const leftParts = left.id.split(":");
    return (
      Number(rightParts[rightParts.length - 1]) -
      Number(leftParts[leftParts.length - 1])
    );
  })[0].id;
}

function firstDifferent(
  candidates: LegalAction[],
  prefixes: readonly string[],
  excluded: ReadonlySet<string> = new Set(),
): string {
  for (const prefix of prefixes) {
    const candidate = candidates.find(
      (item) => item.id.startsWith(prefix) && !excluded.has(item.id),
    );
    if (candidate) return candidate.id;
  }
  throw new Error(
    `No distinct acceptance control matching ${prefixes.join(", ")}`,
  );
}

function opponentId(observation: Observation, name: unknown): string {
  const opponent = observation.opponents.find((item) => item.name === name);
  if (!opponent) throw new Error(`Acceptance opponent is missing: ${name}`);
  if (typeof opponent.id !== "string") {
    throw new Error(`Acceptance opponent has no stable ID: ${name}`);
  }
  return opponent.id;
}

export function acceptanceAction(
  task: CapabilityTask,
  mode: AcceptancePolicyMode,
  observation: Observation,
  candidates: LegalAction[],
): string {
  if (mode === "reference") {
    switch (task.family) {
      case "neutral-expansion":
      case "saturated-capacity-expansion":
        return largest(candidates, "expand:neutral:");
      case "post-expansion-recovery":
      case "frontier-restraint":
        return "hold";
      case "weaker-target-selection":
        return largest(
          candidates,
          `attack:${opponentId(observation, task.semanticRoles.targetName)}:`,
        );
      case "incoming-attack-response":
        return largest(candidates, "counter:");
      case "split-front-prioritization":
        return largest(
          candidates,
          `counter:${opponentId(
            observation,
            task.semanticRoles.priorityAttackerName,
          )}:`,
        );
      case "losing-attack-retreat":
        return firstDifferent(candidates, ["retreat:"]);
      case "naval-target-recognition":
        return largest(
          candidates,
          `boat:${opponentId(observation, task.semanticRoles.targetName)}:`,
        );
      case "construction-failure-recovery":
        return firstDifferent(candidates, ["build:Defense Post:"]);
    }
  }

  switch (task.family) {
    case "neutral-expansion":
      return mode === "control1"
        ? "hold"
        : firstDifferent(candidates, ["alliance:", "embargo:"]);
    case "saturated-capacity-expansion":
      return mode === "control1"
        ? "hold"
        : firstDifferent(candidates, ["build:", "alliance:", "embargo:"]);
    case "post-expansion-recovery":
      return mode === "control1"
        ? largest(candidates, "expand:neutral:")
        : firstDifferent(candidates, ["expand:neutral:25"]);
    case "weaker-target-selection": {
      if (mode === "control2") return "hold";
      const target = task.semanticRoles.targetName;
      const other = observation.opponents
        .filter((item) => item.name !== target)
        .find((item) =>
          candidates.some((candidate) =>
            candidate.id.startsWith(`attack:${item.id}:`),
          ),
        );
      if (!other) throw new Error("No stronger-target acceptance control");
      return largest(candidates, `attack:${other.id}:`);
    }
    case "frontier-restraint":
      return mode === "control1"
        ? largest(candidates, "attack:")
        : largest(candidates, "boat:");
    case "incoming-attack-response":
      return mode === "control1"
        ? "hold"
        : firstDifferent(candidates, ["build:", "alliance:", "embargo:"]);
    case "split-front-prioritization": {
      if (mode === "control2") return "hold";
      const priority = task.semanticRoles.priorityAttackerName;
      const other = observation.opponents
        .filter((item) => item.name !== priority)
        .find((item) =>
          candidates.some((candidate) =>
            candidate.id.startsWith(`counter:${item.id}:`),
          ),
        );
      if (!other) throw new Error("No lower-priority acceptance control");
      return largest(candidates, `counter:${other.id}:`);
    }
    case "losing-attack-retreat":
      return mode === "control1"
        ? "hold"
        : firstDifferent(candidates, ["boat:", "build:", "alliance:"]);
    case "naval-target-recognition":
      return mode === "control1"
        ? "hold"
        : firstDifferent(candidates, ["build:", "alliance:", "embargo:"]);
    case "construction-failure-recovery":
      return mode === "control1"
        ? "hold"
        : firstDifferent(candidates, [
            "build:City:",
            "build:Factory:",
            "alliance:",
            "embargo:",
          ]);
  }
}

export function acceptancePolicyHash(
  task: Pick<CapabilityTask, "family">,
  mode: AcceptancePolicyMode,
): string {
  return sha256(`${ACCEPTANCE_POLICY_VERSION}:${task.family}:${mode}`);
}

export function acceptancePolicy(
  task: CapabilityTask,
  mode: AcceptancePolicyMode,
): AgentPolicy {
  return {
    requestedModel: `fixture-${mode}`,
    provider: "deterministic-local",
    promptVersion: ACCEPTANCE_POLICY_VERSION,
    async estimateNextCost() {
      return 0;
    },
    async decide(observation, candidates) {
      const action = acceptanceAction(task, mode, observation, candidates);
      return {
        decision: { strategy: `${mode} acceptance policy`, action },
        attempts: 1,
        attemptFailures: [],
        attemptTimings: [],
        latencyMs: 0,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        model: `fixture-${mode}`,
        provider: "deterministic-local",
      };
    },
  };
}
