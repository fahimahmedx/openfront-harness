import { describe, expect, it } from "vitest";
import {
  parseVisualCommand,
  VISUAL_CONTROLS_PROMPT,
} from "../src/VisualControlsAgent";
import { territoryAreaUnderCurve } from "../src/VisualBaselineRunner";
import { VisualCommandSchema } from "../src/VisualBaselineTypes";

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
