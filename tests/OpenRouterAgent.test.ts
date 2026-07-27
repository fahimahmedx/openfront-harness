import { afterEach, describe, expect, it, vi } from "vitest";
import {
  actionResponseJsonSchema,
  OpenRouterAgent,
  validateDecisionContent,
} from "../src/OpenRouterAgent";
import { LegalAction, Observation } from "../src/Types";

const candidates: LegalAction[] = [
  {
    id: "hold:1",
    category: "hold",
    label: "Hold the first action slot",
    intent: null,
  },
  {
    id: "hold:2",
    category: "hold",
    label: "Hold the second action slot",
    intent: null,
  },
  {
    id: "expand:neutral:100",
    category: "expand",
    label: "Expand into neutral land",
    intent: { type: "attack", targetID: null, troops: 100 },
  },
];

const observation: Observation = {
  scenarioId: "japan-v2",
  decision: 1,
  tick: 103,
  elapsedSeconds: 10.2,
  timeRemainingSeconds: 1189.8,
  winPercent: 80,
  landTiles: 478894,
  self: {},
  opponents: [],
  recentDecisions: [],
};

function completion(content: string, finishReason = "stop"): Response {
  return new Response(
    JSON.stringify({
      id: "generation-1",
      model: "openai/test-model",
      provider: "OpenAI",
      choices: [{ finish_reason: finishReason, message: { content } }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        cost: 0.001,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenRouter action output", () => {
  it("versions the slot-based request contract as agent-v4", () => {
    expect(OpenRouterAgent.promptVersion()).toBe("agent-v4");
  });

  it("constrains each named slot to its legal action IDs", () => {
    const schema = actionResponseJsonSchema(candidates);

    expect(schema.required).toEqual(["strategy", "action1", "action2"]);
    expect(schema.properties.action1).toMatchObject({
      type: "string",
      enum: ["hold:1", "expand:neutral:100"],
    });
    expect(schema.properties.action2).toMatchObject({
      type: "string",
      enum: ["hold:2", "expand:neutral:100"],
    });
  });

  it("accepts a repeatable troop action in both slots", () => {
    const validated = validateDecisionContent(
      JSON.stringify({
        strategy: "Use both safe troop budgets",
        action1: "expand:neutral:100",
        action2: "expand:neutral:100",
      }),
      candidates,
    );

    expect(validated).toEqual({
      decision: {
        strategy: "Use both safe troop budgets",
        actions: ["expand:neutral:100", "expand:neutral:100"],
      },
      failures: [],
    });
  });

  it("reports malformed JSON and slot-invalid holds precisely", () => {
    expect(validateDecisionContent("{", candidates)).toMatchObject({
      decision: null,
      failures: [{ code: "invalid_json" }],
    });

    const wrongHolds = validateDecisionContent(
      JSON.stringify({
        strategy: "Use the wrong holds",
        action1: "hold:2",
        action2: "hold:1",
      }),
      candidates,
    );
    expect(wrongHolds).toEqual({
      decision: null,
      failures: [
        {
          code: "unknown_action_id",
          message: "OpenRouter selected unknown action IDs: hold:2, hold:1",
          rejectedActionIds: ["hold:2", "hold:1"],
        },
      ],
    });
  });

  it("diagnoses truncation and feeds the rejected response into the retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        completion(
          JSON.stringify({
            strategy: "Use both safe troop budgets",
            action1: "expand:neutral:100",
          }),
          "length",
        ),
      )
      .mockResolvedValueOnce(
        completion(
          JSON.stringify({
            strategy: "Use both safe troop budgets",
            action1: "expand:neutral:100",
            action2: "expand:neutral:100",
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenRouterAgent("test-key", {
      model: "openai/test-model",
      provider: "openai",
    }).decide(observation, candidates);

    expect(result).toMatchObject({
      decision: {
        strategy: "Use both safe troop budgets",
        actions: ["expand:neutral:100", "expand:neutral:100"],
      },
      attempts: 2,
      attemptFailures: [
        {
          attempt: 1,
          code: "truncated_response",
          rejectedActionIds: [],
        },
      ],
    });
    expect(result.promptTokens).toBe(20);
    expect(result.completionTokens).toBe(10);
    expect(result.costUsd).toBe(0.002);

    const secondRequest = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    ) as {
      messages: Array<{ role: string; content: string }>;
      response_format: {
        json_schema: {
          schema: {
            properties: {
              action1: { enum: string[] };
              action2: { enum: string[] };
            };
          };
        };
      };
    };
    expect(secondRequest.messages[secondRequest.messages.length - 2]).toEqual({
      role: "assistant",
      content: JSON.stringify({
        strategy: "Use both safe troop budgets",
        action1: "expand:neutral:100",
      }),
    });
    expect(
      secondRequest.messages[secondRequest.messages.length - 1]?.content,
    ).toContain("OpenRouter truncated the decision at the token limit");
    expect(secondRequest.response_format.json_schema.schema.properties).toEqual(
      {
        strategy: { type: "string", maxLength: 160 },
        action1: {
          type: "string",
          description: "The legal action ID to execute in the first slot.",
          enum: ["hold:1", "expand:neutral:100"],
        },
        action2: {
          type: "string",
          description: "The legal action ID to execute in the second slot.",
          enum: ["hold:2", "expand:neutral:100"],
        },
      },
    );
  });
});
