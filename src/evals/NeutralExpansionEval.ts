import { createHash, randomUUID } from "node:crypto";
import { Player } from "../../OpenFrontIO/src/core/game/Game";
import { Intent } from "../../OpenFrontIO/src/core/Schemas";
import {
  actionOutcomes,
  beginActionTracking,
  observeActionUpdates,
  updateActionTracking,
} from "../ActionLifecycle";
import {
  createLegalActions,
  createObservation,
  resolveDecisionActions,
} from "../ObservationActions";
import { OPENFRONT_COMMIT, SCENARIO } from "../Scenario";
import { AgentDecision, AgentResult, LegalAction, Observation } from "../Types";
import { EvalGameSession } from "./EvalGameSession";

const PLAYER_MODEL_NAME = "neutral-expansion-eval";
const OWNER_ID_MASK = 0xfff;

export const NEUTRAL_EXPANSION_FIXTURE = {
  evalVersion: "openfront-micro-v1",
  graderVersion: "neutral-expansion-v1",
  familyId: "neutral-expansion",
  fixtureId: "neutral-expansion-japan-kanto-001",
  split: "development",
  sourceSeed: SCENARIO.seed,
  checkpointTick: 171,
  horizonTicks: 100,
  playerModelName: PLAYER_MODEL_NAME,
  preparation: {
    spawn: SCENARIO.spawn,
    afterSpawn: "empty turns until checkpointTick",
  },
  expectedCheckpoint: {
    stateHash: 184348445389306,
    observationHash:
      "26ff6f97949dde962602a4e5b2c1f116714b9242828a8bd525095dbddeab210a",
    candidateMenuHash:
      "6ea2039143291c21fd9b0f25b8017ae17023e100b679e5dcfccb894b75e2ebd4",
    tileStateHash:
      "582f6a2a5816d5ba1a0a07f4d40c7ae66de145b4cff6fed60b68652ac5a0b84f",
  },
} as const;

export type NeutralExpansionAgent = {
  requestedModel: string;
  provider?: string;
  promptVersion?: string;
  decide(
    observation: Observation,
    candidates: LegalAction[],
  ): Promise<AgentResult>;
};

export type NeutralExpansionCheckpoint = {
  session: EvalGameSession;
  player: Player;
  observation: Observation;
  candidates: LegalAction[];
  checkpointTileStates: Uint16Array;
  hashes: {
    state: number;
    observation: string;
    candidateMenu: string;
    tileState: string;
  };
};

export type NeutralExpansionTrial = {
  runId: string;
  evalVersion: string;
  graderVersion: string;
  familyId: string;
  fixtureId: string;
  split: string;
  startedAt: string;
  completedAt: string;
  configuration: {
    scenarioId: string;
    openfrontCommit: string;
    model: string;
    resolvedModel: string;
    provider: string | null;
    promptVersion: string | null;
  };
  checkpoint: {
    tick: number;
    stateHash: number;
    observationHash: string;
    candidateMenuHash: string;
    tileStateHash: string;
    initialTileCount: number;
    troopCapacityPercent: number;
  };
  trace: {
    observation: Observation;
    candidates: LegalAction[];
    strategy: string;
    selectedActionIds: [string, string];
    appliedActionIds: [string, string];
    actionOutcomes: ReturnType<typeof actionOutcomes>;
    attempts: number;
    attemptFailures: AgentResult["attemptFailures"];
    attemptTimings: AgentResult["attemptTimings"];
    fallback: boolean;
    latencyMs: number;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
  };
  outcome: {
    finalTick: number;
    finalStateHash: number | null;
    finalTileCount: number;
    neutralTilesGained: number;
    assertion: {
      id: "owns-checkpoint-neutral-tile";
      observed: number;
      operator: ">=";
      expected: 1;
      passed: boolean;
    };
    componentCoverage: number;
    taskPass: boolean;
    taskScore: 0 | 100;
  };
};

export type NeutralExpansionSummary = {
  validTrials: number;
  successes: number;
  passAt1: number;
  passAt1Wilson95: { lower: number; upper: number };
  estimatedPassPower3: number;
  meanComponentCoverage: number;
  firstAttemptValidityRate: number;
  retryRate: number;
  fallbackRate: number;
  medianLatencyMs: number;
  p95LatencyMs: number;
  meanPromptTokens: number;
  meanCompletionTokens: number;
  meanCostUsd: number;
  totalCostUsd: number;
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
}

function canonicalHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

function tileStateHash(states: Uint16Array): string {
  return createHash("sha256")
    .update(Buffer.from(states.buffer, states.byteOffset, states.byteLength))
    .digest("hex");
}

function rate(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil(percentileValue * sorted.length) - 1),
  );
  return sorted[index];
}

function wilson95(successes: number, trials: number) {
  if (trials === 0) return { lower: 0, upper: 0 };
  const z = 1.96;
  const observed = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = observed + (z * z) / (2 * trials);
  const margin =
    z *
    Math.sqrt(
      (observed * (1 - observed)) / trials + (z * z) / (4 * trials * trials),
    );
  return {
    lower: Math.max(0, (center - margin) / denominator),
    upper: Math.min(1, (center + margin) / denominator),
  };
}

export function summarizeNeutralExpansionTrials(
  trials: NeutralExpansionTrial[],
): NeutralExpansionSummary {
  const successes = trials.filter((trial) => trial.outcome.taskPass).length;
  const passAt1 = rate(successes, trials.length);
  const firstAttemptValid = trials.filter(
    (trial) =>
      trial.trace.attempts === 1 && trial.trace.attemptFailures.length === 0,
  ).length;
  const retries = trials.filter((trial) => trial.trace.attempts > 1).length;
  const fallbacks = trials.filter((trial) => trial.trace.fallback).length;
  const costs = trials.map((trial) => trial.trace.costUsd);
  return {
    validTrials: trials.length,
    successes,
    passAt1,
    passAt1Wilson95: wilson95(successes, trials.length),
    estimatedPassPower3: passAt1 ** 3,
    meanComponentCoverage: mean(
      trials.map((trial) => trial.outcome.componentCoverage),
    ),
    firstAttemptValidityRate: rate(firstAttemptValid, trials.length),
    retryRate: rate(retries, trials.length),
    fallbackRate: rate(fallbacks, trials.length),
    medianLatencyMs: percentile(
      trials.map((trial) => trial.trace.latencyMs),
      0.5,
    ),
    p95LatencyMs: percentile(
      trials.map((trial) => trial.trace.latencyMs),
      0.95,
    ),
    meanPromptTokens: mean(trials.map((trial) => trial.trace.promptTokens)),
    meanCompletionTokens: mean(
      trials.map((trial) => trial.trace.completionTokens),
    ),
    meanCostUsd: mean(costs),
    totalCostUsd: costs.reduce((sum, cost) => sum + cost, 0),
  };
}

function assertFixtureRequirements(checkpoint: NeutralExpansionCheckpoint) {
  const { candidates, observation, player, session } = checkpoint;
  const capacity = Number(observation.self.troopCapacityPercent);
  if (capacity < 70 || capacity > 90) {
    throw new Error(
      `Neutral-expansion capacity must be 70–90%, got ${capacity}%`,
    );
  }
  if (
    session.game
      .players()
      .some(
        (opponent) => opponent !== player && player.sharesBorderWith(opponent),
      )
  ) {
    throw new Error("Neutral-expansion checkpoint has an opponent border");
  }
  if (player.incomingAttacks().length > 0) {
    throw new Error("Neutral-expansion checkpoint has an incoming attack");
  }
  if (player.outgoingAttacks().length > 0) {
    throw new Error("Neutral-expansion checkpoint has an outgoing attack");
  }

  const expectedFractions = [25, 50, 75, 100];
  const actualFractions = candidates
    .filter((candidate) => candidate.category === "expand")
    .map((candidate) => {
      const parts = candidate.id.split(":");
      return Number(parts[parts.length - 1]);
    })
    .sort((left, right) => left - right);
  if (JSON.stringify(actualFractions) !== JSON.stringify(expectedFractions)) {
    throw new Error(
      `Neutral-expansion menu drift: expected fractions ${expectedFractions.join(", ")}, got ${actualFractions.join(", ")}`,
    );
  }
  for (const fraction of expectedFractions) {
    const id = `expand:neutral:${fraction}`;
    const repeated = resolveDecisionActions([id, id], candidates);
    if (
      repeated.fallback ||
      repeated.actions.some((candidate) => candidate.id !== id)
    ) {
      throw new Error(`${id} is not legal in both eval action slots`);
    }
  }
}

function assertCheckpointHashes(checkpoint: NeutralExpansionCheckpoint): void {
  const expected = NEUTRAL_EXPANSION_FIXTURE.expectedCheckpoint;
  const actual = checkpoint.hashes;
  if (actual.state !== expected.stateHash) {
    throw new Error(
      `Neutral-expansion state hash drift: expected ${expected.stateHash}, got ${actual.state}`,
    );
  }
  if (actual.observation !== expected.observationHash) {
    throw new Error(
      `Neutral-expansion observation hash drift: expected ${expected.observationHash}, got ${actual.observation}`,
    );
  }
  if (actual.candidateMenu !== expected.candidateMenuHash) {
    throw new Error(
      `Neutral-expansion candidate hash drift: expected ${expected.candidateMenuHash}, got ${actual.candidateMenu}`,
    );
  }
  if (actual.tileState !== expected.tileStateHash) {
    throw new Error(
      `Neutral-expansion tile-state hash drift: expected ${expected.tileStateHash}, got ${actual.tileState}`,
    );
  }
}

export async function createNeutralExpansionCheckpoint(
  options: { verifyHashes?: boolean } = {},
): Promise<NeutralExpansionCheckpoint> {
  const session = await EvalGameSession.create(PLAYER_MODEL_NAME);
  try {
    const player = session.spawnScenarioPlayer();
    const remainingTicks =
      NEUTRAL_EXPANSION_FIXTURE.checkpointTick - session.game.ticks();
    if (remainingTicks < 0) {
      throw new Error(
        `Neutral-expansion setup overshot tick ${NEUTRAL_EXPANSION_FIXTURE.checkpointTick}`,
      );
    }
    session.advance(remainingTicks);
    if (session.game.ticks() !== NEUTRAL_EXPANSION_FIXTURE.checkpointTick) {
      throw new Error(
        `Neutral-expansion checkpoint expected tick ${NEUTRAL_EXPANSION_FIXTURE.checkpointTick}, got ${session.game.ticks()}`,
      );
    }

    const observation = createObservation(session.game, player, 0, []);
    const candidates = createLegalActions(session.game, player, {
      safeBuildAnchors: true,
    });
    const checkpointTileStates = session.game.tileStateBuffer().slice();
    const stateHash = session.lastHash;
    if (stateHash === null) {
      throw new Error("Neutral-expansion checkpoint did not emit a state hash");
    }
    const checkpoint: NeutralExpansionCheckpoint = {
      session,
      player,
      observation,
      candidates,
      checkpointTileStates,
      hashes: {
        state: stateHash,
        observation: canonicalHash(observation),
        candidateMenu: canonicalHash(candidates),
        tileState: tileStateHash(checkpointTileStates),
      },
    };
    assertFixtureRequirements(checkpoint);
    if (options.verifyHashes !== false) assertCheckpointHashes(checkpoint);
    return checkpoint;
  } catch (error) {
    session.close();
    throw error;
  }
}

export function selectNeutralExpansionReferenceActions(
  candidates: LegalAction[],
): [string, string] {
  if (!candidates.some((candidate) => candidate.id === "expand:neutral:100")) {
    throw new Error("Reference expansion action is missing from the menu");
  }
  return ["expand:neutral:100", "hold:2"];
}

export function selectNeutralExpansionHoldControl(): [string, string] {
  return ["hold:1", "hold:2"];
}

export function selectNeutralExpansionDiplomacyControl(
  candidates: LegalAction[],
): [string, string] {
  const diplomacy = candidates.find(
    (candidate) => candidate.category === "diplomacy",
  );
  if (diplomacy === undefined) {
    throw new Error("Diplomacy control is missing from the eval menu");
  }
  return [diplomacy.id, "hold:2"];
}

export function scriptedAgentResult(
  model: string,
  strategy: string,
  actions: [string, string],
): AgentResult {
  const decision: AgentDecision = { strategy, actions };
  return {
    decision,
    attempts: 1,
    attemptFailures: [],
    attemptTimings: [],
    latencyMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
    model,
    provider: null,
  };
}

function countCheckpointNeutralTilesGained(
  player: Player,
  checkpointTileStates: Uint16Array,
): number {
  let gained = 0;
  for (const tile of player.tiles()) {
    if ((checkpointTileStates[tile] & OWNER_ID_MASK) === 0) gained++;
  }
  return gained;
}

export async function runNeutralExpansionTrial(
  agent: NeutralExpansionAgent,
): Promise<NeutralExpansionTrial> {
  const runId = randomUUID();
  const startedAt = new Date();
  const checkpoint = await createNeutralExpansionCheckpoint();
  const { candidates, observation, player, session } = checkpoint;
  try {
    const agentResult = await agent.decide(observation, candidates);
    const selectedActionIds = agentResult.decision?.actions ?? [
      "hold:1",
      "hold:2",
    ];
    const resolved = resolveDecisionActions(selectedActionIds, candidates);
    const appliedIntents = resolved.actions
      .map((candidate) => candidate.intent)
      .filter((intent): intent is Intent => intent !== null);
    const trackers = beginActionTracking(
      session.game,
      player,
      resolved.actions,
    );
    const stopObserving = session.onUpdate((update) => {
      if (!("errMsg" in update)) observeActionUpdates(trackers, update);
    });
    session.execute(appliedIntents);
    updateActionTracking(trackers, session.game, session.game.ticks());
    for (
      let tick = 1;
      tick < NEUTRAL_EXPANSION_FIXTURE.horizonTicks &&
      session.game.getWinner() === null;
      tick++
    ) {
      session.execute();
      updateActionTracking(trackers, session.game, session.game.ticks());
    }
    stopObserving();

    const neutralTilesGained = countCheckpointNeutralTilesGained(
      player,
      checkpoint.checkpointTileStates,
    );
    const passed = neutralTilesGained >= 1;
    const completedAt = new Date();
    return {
      runId,
      evalVersion: NEUTRAL_EXPANSION_FIXTURE.evalVersion,
      graderVersion: NEUTRAL_EXPANSION_FIXTURE.graderVersion,
      familyId: NEUTRAL_EXPANSION_FIXTURE.familyId,
      fixtureId: NEUTRAL_EXPANSION_FIXTURE.fixtureId,
      split: NEUTRAL_EXPANSION_FIXTURE.split,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      configuration: {
        scenarioId: SCENARIO.id,
        openfrontCommit: OPENFRONT_COMMIT,
        model: agent.requestedModel,
        resolvedModel: agentResult.model,
        provider: agentResult.provider,
        promptVersion: agent.promptVersion ?? null,
      },
      checkpoint: {
        tick: observation.tick,
        stateHash: checkpoint.hashes.state,
        observationHash: checkpoint.hashes.observation,
        candidateMenuHash: checkpoint.hashes.candidateMenu,
        tileStateHash: checkpoint.hashes.tileState,
        initialTileCount: Number(observation.self.tiles),
        troopCapacityPercent: Number(observation.self.troopCapacityPercent),
      },
      trace: {
        observation,
        candidates,
        strategy:
          agentResult.decision?.strategy ??
          `Decision failed; holding. ${agentResult.error ?? ""}`
            .trim()
            .slice(0, 160),
        selectedActionIds: selectedActionIds as [string, string],
        appliedActionIds: resolved.actions.map((candidate) => candidate.id) as [
          string,
          string,
        ],
        actionOutcomes: actionOutcomes(
          trackers,
          session.game,
          session.game.ticks(),
        ),
        attempts: agentResult.attempts,
        attemptFailures: agentResult.attemptFailures,
        attemptTimings: agentResult.attemptTimings,
        fallback: agentResult.decision === null || resolved.fallback,
        latencyMs: agentResult.latencyMs,
        promptTokens: agentResult.promptTokens,
        completionTokens: agentResult.completionTokens,
        costUsd: agentResult.costUsd,
      },
      outcome: {
        finalTick: session.game.ticks(),
        finalStateHash: session.lastHash,
        finalTileCount: player.numTilesOwned(),
        neutralTilesGained,
        assertion: {
          id: "owns-checkpoint-neutral-tile",
          observed: neutralTilesGained,
          operator: ">=",
          expected: 1,
          passed,
        },
        componentCoverage: passed ? 1 : 0,
        taskPass: passed,
        taskScore: passed ? 100 : 0,
      },
    };
  } finally {
    session.close();
  }
}
