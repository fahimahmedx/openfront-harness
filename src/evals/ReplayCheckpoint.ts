import { createHash } from "node:crypto";
import { Intent } from "../../OpenFrontIO/src/core/Schemas";
import { createLegalActions, createObservation } from "../ObservationActions";
import { SCENARIO } from "../Scenario";
import { LegalAction, Observation } from "../Types";
import { EvalGameSession } from "./EvalGameSession";
import replayPrefixes from "./fixtures/replay-prefixes.json";

export type ReplayFamilyId = keyof typeof replayPrefixes;

type ReplayPrefix = {
  sourceArtifact: string;
  sourceArtifactSha256: string;
  sourceDecisionIndex: number;
  checkpointTick: number;
  preparationTurns: Array<{ turnNumber: number; intents: Intent[] }>;
  recentDecisions: Array<Record<string, unknown>>;
};

export type ReplayCheckpoint = {
  session: EvalGameSession;
  player: NonNullable<ReturnType<EvalGameSession["game"]["playerByClientID"]>>;
  observation: Observation;
  candidates: LegalAction[];
  checkpointTileStates: Uint16Array;
  source: Pick<
    ReplayPrefix,
    "sourceArtifact" | "sourceArtifactSha256" | "sourceDecisionIndex"
  >;
  hashes: {
    state: number;
    observation: string;
    candidateMenu: string;
    tileState: string;
  };
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

export function canonicalHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}

export function tileStateHash(states: Uint16Array): string {
  return createHash("sha256")
    .update(Buffer.from(states.buffer, states.byteOffset, states.byteLength))
    .digest("hex");
}

export function replayFixtureMetadata(familyId: ReplayFamilyId): ReplayPrefix {
  return replayPrefixes[familyId] as ReplayPrefix;
}

export async function createReplayCheckpoint(
  familyId: ReplayFamilyId,
): Promise<ReplayCheckpoint> {
  const fixture = replayFixtureMetadata(familyId);
  const session = await EvalGameSession.create("micro-eval-replay");
  try {
    const turns = new Map(
      fixture.preparationTurns.map((turn) => [turn.turnNumber, turn.intents]),
    );
    while (session.game.ticks() < fixture.checkpointTick) {
      session.execute(turns.get(session.game.ticks()) ?? []);
    }
    if (session.game.ticks() !== fixture.checkpointTick) {
      throw new Error(
        `${familyId} replay expected tick ${fixture.checkpointTick}, got ${session.game.ticks()}`,
      );
    }
    const player = session.game.playerByClientID(SCENARIO.clientID);
    if (player === null || !player.hasSpawned()) {
      throw new Error(`${familyId} replay did not produce the scenario player`);
    }
    const observation = createObservation(
      session.game,
      player,
      fixture.sourceDecisionIndex,
      [],
    );
    const candidates = createLegalActions(session.game, player, {
      safeBuildAnchors: true,
    });
    const checkpointTileStates = session.game.tileStateBuffer().slice();
    if (session.lastHash === null) {
      throw new Error(`${familyId} replay did not emit a state hash`);
    }
    return {
      session,
      player,
      observation,
      candidates,
      checkpointTileStates,
      source: {
        sourceArtifact: fixture.sourceArtifact,
        sourceArtifactSha256: fixture.sourceArtifactSha256,
        sourceDecisionIndex: fixture.sourceDecisionIndex,
      },
      hashes: {
        state: session.lastHash,
        observation: canonicalHash(observation),
        candidateMenu: canonicalHash(candidates),
        tileState: tileStateHash(checkpointTileStates),
      },
    };
  } catch (error) {
    session.close();
    throw error;
  }
}
