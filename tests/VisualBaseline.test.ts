import { describe, expect, it } from "vitest";
import {
  parseVisualCommand,
  VISUAL_CONTROLS_PROMPT,
  VISUAL_NAIVE_PROMPT,
  visualInterfacePrompt,
} from "../src/VisualControlsAgent";
import {
  selectedVisualBaselineInterface,
  territoryAreaUnderCurve,
} from "../src/VisualBaselineRunner";
import {
  VISUAL_BASELINE_INTERFACE,
  VISUAL_NAIVE_INTERFACE,
  VisualBaselineArtifactSchema,
  VisualCommandSchema,
} from "../src/VisualBaselineTypes";

function wire(overrides: Record<string, unknown>) {
  return JSON.stringify({
    command: "done",
    x: null,
    y: null,
    x2: null,
    y2: null,
    button: null,
    deltaY: null,
    key: null,
    milliseconds: null,
    note: "Hold this decision.",
    ...overrides,
  });
}

function artifactCommon() {
  return {
    runId: "cdbd0b72-aebb-42ad-8a9c-2443920c3a1a",
    status: "completed" as const,
    startedAt: "2026-08-04T00:00:00.000Z",
    completedAt: "2026-08-04T00:01:00.000Z",
    scenario: {
      id: "japan-v5",
      seed: "JAPAN01A",
      clientID: "LLMAGENT",
      spawn: { x: 1613, y: 1133, label: "Kanto" },
      decisionIntervalTicks: 100,
      actionSlots: 2,
      maxDecisionCount: 120,
      maxSimulatedMinutes: 20,
      openfront: { version: "v0.32.9", commit: "dcc18d5" },
    },
    decisions: [],
    usage: {
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      modelCalls: 0,
    },
    outcome: {
      winner: null,
      llmWon: false,
      finalPlacement: 4,
      terminalTick: 0,
      finalTerritoryPercent: 0,
      territoryAreaUnderCurve: 0,
      finalPlayers: [],
    },
    replay: null,
  };
}

describe("visual-controls baseline", () => {
  it("parses strict wire commands into bounded primitive actions", () => {
    expect(
      parseVisualCommand(
        wire({ command: "click", x: 640, y: 360, button: "right" }),
      ),
    ).toEqual({
      command: "click",
      x: 640,
      y: 360,
      button: "right",
      note: "Hold this decision.",
    });
    expect(() =>
      parseVisualCommand(wire({ command: "click", x: 1280, y: 360 })),
    ).toThrow();
    expect(
      VisualCommandSchema.parse({
        command: "keypress",
        key: "KeyC",
        note: "Center the camera.",
      }),
    ).toMatchObject({ command: "keypress", key: "KeyC" });
    expect(
      parseVisualCommand(
        `${wire({ command: "done" })}\nThe command is complete.`,
      ),
    ).toMatchObject({ command: "done" });
  });

  it("keeps the controls prompt visual and free of hidden action menus", () => {
    expect(VISUAL_CONTROLS_PROMPT).toContain("screenshots only");
    expect(VISUAL_CONTROLS_PROMPT).toContain("Right-click");
    expect(VISUAL_CONTROLS_PROMPT).not.toContain("legal_actions");
    expect(VISUAL_CONTROLS_PROMPT).not.toContain("troopsRelativeToSelf");
  });

  it("keeps the naive prompt free of OpenFront rules and controls", () => {
    expect(VISUAL_NAIVE_PROMPT).toContain("Your goal is to win");
    expect(VISUAL_NAIVE_PROMPT).toContain("primitive command");
    expect(VISUAL_NAIVE_PROMPT).toContain("screenshots only");
    expect(VISUAL_NAIVE_PROMPT).not.toContain("80% territory");
    expect(VISUAL_NAIVE_PROMPT).not.toContain("timer expires");
    expect(VISUAL_NAIVE_PROMPT).not.toContain("Left-clicking");
    expect(VISUAL_NAIVE_PROMPT).not.toContain("Right-click");
    expect(VISUAL_NAIVE_PROMPT).not.toContain("Number keys");
    expect(VISUAL_NAIVE_PROMPT).not.toContain("requests an alliance");
  });

  it("selects each visual division explicitly and rejects unknown ones", () => {
    expect(selectedVisualBaselineInterface(undefined)).toBe(
      VISUAL_BASELINE_INTERFACE,
    );
    expect(selectedVisualBaselineInterface(VISUAL_NAIVE_INTERFACE)).toBe(
      VISUAL_NAIVE_INTERFACE,
    );
    expect(visualInterfacePrompt(VISUAL_BASELINE_INTERFACE)).toBe(
      VISUAL_CONTROLS_PROMPT,
    );
    expect(visualInterfacePrompt(VISUAL_NAIVE_INTERFACE)).toBe(
      VISUAL_NAIVE_PROMPT,
    );
    expect(() =>
      selectedVisualBaselineInterface("visual-unknown-v1"),
    ).toThrow();
  });

  it("reads legacy controls artifacts and validates new division identity", () => {
    const protocol = {
      viewport: { width: 1280, height: 720 },
      firstDecisionTick: 3,
      maxPrimitiveCommandsPerDecision: 8,
      maxGameIntentsPerDecision: 2,
      minScreenshotBytes: 20_000,
    };
    expect(
      VisualBaselineArtifactSchema.parse({
        schemaVersion: 1,
        interface: VISUAL_BASELINE_INTERFACE,
        ...artifactCommon(),
        model: {
          requested: "model",
          resolved: "model",
          provider: "provider",
          reasoningEffort: "none",
          promptVersion: VISUAL_BASELINE_INTERFACE,
        },
        protocol: { ...protocol, controlsPromptSha256: "a".repeat(64) },
      }).schemaVersion,
    ).toBe(1);
    expect(
      VisualBaselineArtifactSchema.parse({
        schemaVersion: 2,
        interface: VISUAL_NAIVE_INTERFACE,
        ...artifactCommon(),
        model: {
          requested: "model",
          resolved: "model",
          provider: "provider",
          reasoningEffort: "none",
          promptVersion: VISUAL_NAIVE_INTERFACE,
        },
        protocol: {
          ...protocol,
          interfacePromptSha256: "b".repeat(64),
          recentPublicNoteCount: 3,
        },
      }).interface,
    ).toBe(VISUAL_NAIVE_INTERFACE);
    expect(() =>
      VisualBaselineArtifactSchema.parse({
        schemaVersion: 2,
        interface: VISUAL_NAIVE_INTERFACE,
        ...artifactCommon(),
        model: {
          requested: "model",
          resolved: "model",
          provider: "provider",
          reasoningEffort: "none",
          promptVersion: VISUAL_BASELINE_INTERFACE,
        },
        protocol: {
          ...protocol,
          interfacePromptSha256: "b".repeat(64),
          recentPublicNoteCount: 3,
        },
      }),
    ).toThrow("promptVersion must match");
  });

  it("computes time-normalized territory area under the curve", () => {
    const snapshots = [
      {
        tick: 3,
        landTiles: 100,
        players: [
          {
            id: "self",
            clientID: "LLMAGENT",
            name: "LLM",
            alive: true,
            tiles: 10,
            troops: 100,
            gold: 0,
          },
        ],
      },
      {
        tick: 103,
        landTiles: 100,
        players: [
          {
            id: "self",
            clientID: "LLMAGENT",
            name: "LLM",
            alive: true,
            tiles: 30,
            troops: 100,
            gold: 0,
          },
        ],
      },
    ];
    expect(territoryAreaUnderCurve(snapshots, "LLMAGENT")).toBe(20);
  });
});
