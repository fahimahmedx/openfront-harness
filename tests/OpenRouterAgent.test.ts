import { afterEach, describe, expect, it, vi } from "vitest";
import {
  actionResponseJsonSchema,
  OpenRouterAgent,
  promptFor,
  validateDecisionContent,
} from "../src/OpenRouterAgent";
import { LegalAction, Observation, TIMER_VICTORY_RULE } from "../src/Types";

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
  instantVictoryTerritoryPercent: 80,
  currentRank: 2,
  territoryLeader: {
    id: "leader",
    name: "Territory Leader",
    territoryPercent: 35,
  },
  territoryGapToLeader: 10,
  timerVictoryRule: TIMER_VICTORY_RULE,
  landTiles: 478894,
  self: {},
  opponents: [],
  recentDecisions: [],
};

function completionEvents(
  content: string,
  finishReason = "stop",
  completionTokens = 5,
): string {
  const id = "generation-1";
  const events = [
    {
      id,
      model: "openai/test-model",
      provider: "OpenAI",
      choices: [
        {
          finish_reason: null,
          delta: { content },
        },
      ],
    },
    {
      id,
      model: "openai/test-model",
      provider: "OpenAI",
      choices: [{ finish_reason: finishReason, delta: {} }],
    },
    {
      id,
      model: "openai/test-model",
      provider: "OpenAI",
      choices: [],
      usage: {
        prompt_tokens: 10,
        completion_tokens: completionTokens,
        cost: 0.001,
      },
    },
  ];
  return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
}

function completion(
  content: string,
  finishReason = "stop",
  completionTokens = 5,
): Response {
  const id = "generation-1";
  return new Response(
    completionEvents(content, finishReason, completionTokens),
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "X-Generation-Id": id,
      },
    },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenRouter action output", () => {
  it("versions the neutral troop-semantics contract as agent-v6", () => {
    expect(OpenRouterAgent.promptVersion()).toBe("agent-v6");
    expect(OpenRouterAgent.reasoningEffort()).toBe("none");
  });

  it("explains troop saturation and neutral expansion without prescribing holds", () => {
    const prompt = promptFor(observation, candidates);

    expect(prompt).toContain("troop growth approaches zero near 100% capacity");
    expect(prompt).toContain(
      "Neutral expansion captures unowned land and does not require a troop advantage",
    );
    expect(prompt).toContain(
      "listed troop amounts do not violate the displayed reserve",
    );
    expect(prompt).not.toContain("Hold while rebuilding");
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
    expect(result.attemptTimings).toHaveLength(2);
    expect(result.attemptTimings).toEqual([
      expect.objectContaining({
        attempt: 1,
        queueMs: null,
        generationId: "generation-1",
      }),
      expect.objectContaining({
        attempt: 2,
        queueMs: null,
        generationId: "generation-1",
      }),
    ]);

    const secondRequest = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    ) as {
      reasoning: { effort: string };
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
      stream: boolean;
      stream_options: { include_usage: boolean };
    };
    expect(secondRequest.reasoning).toEqual({ effort: "none" });
    expect(secondRequest.stream).toBe(true);
    expect(secondRequest.stream_options).toEqual({ include_usage: true });
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

  it("measures client-observed TTFT and generation time", async () => {
    const timestamps = [0, 10, 30, 80, 90];
    vi.spyOn(performance, "now").mockImplementation(
      () => timestamps.shift() ?? 90,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        completion(
          JSON.stringify({
            strategy: "Use both safe troop budgets",
            action1: "expand:neutral:100",
            action2: "expand:neutral:100",
          }),
        ),
      ),
    );

    const result = await new OpenRouterAgent("test-key", {
      model: "openai/test-model",
      provider: "openai",
    }).decide(observation, candidates);

    expect(result.latencyMs).toBe(90);
    expect(result.attemptTimings).toEqual([
      {
        attempt: 1,
        totalMs: 70,
        timeToFirstTokenMs: 20,
        generationMs: 50,
        completionTokens: 5,
        timePerOutputTokenMs: 12.5,
        queueMs: null,
        generationId: "generation-1",
      },
    ]);
  });

  it("parses chunked SSE and ignores OpenRouter keepalive comments", async () => {
    const content = JSON.stringify({
      strategy: "Use both safe troop budgets",
      action1: "expand:neutral:100",
      action2: "expand:neutral:100",
    });
    const body = `: OPENROUTER PROCESSING\n\n${completionEvents(content)}`;
    const boundaries = [7, 31, 89, 143];
    const chunks = boundaries
      .map((end, index) =>
        body.slice(index === 0 ? 0 : boundaries[index - 1], end),
      )
      .concat(body.slice(boundaries[boundaries.length - 1]));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "X-Generation-Id": "generation-1",
          },
        }),
      ),
    );

    const result = await new OpenRouterAgent("test-key").decide(
      observation,
      candidates,
    );

    expect(result.decision?.actions).toEqual([
      "expand:neutral:100",
      "expand:neutral:100",
    ]);
    expect(result.promptTokens).toBe(10);
    expect(result.completionTokens).toBe(5);
  });

  it("leaves TPOT unavailable with fewer than two completion tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        completion(
          JSON.stringify({
            strategy: "Hold",
            action1: "hold:1",
            action2: "hold:2",
          }),
          "stop",
          1,
        ),
      ),
    );

    const result = await new OpenRouterAgent("test-key").decide(
      observation,
      candidates,
    );

    expect(result.attemptTimings[0]).toMatchObject({
      completionTokens: 1,
      timePerOutputTokenMs: null,
    });
  });

  it("retains timing for a failed request before retrying", async () => {
    const timestamps = [0, 10, 20, 30, 40, 50, 60];
    vi.spyOn(performance, "now").mockImplementation(
      () => timestamps.shift() ?? 60,
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("provider unavailable"))
        .mockResolvedValueOnce(
          completion(
            JSON.stringify({
              strategy: "Use both safe troop budgets",
              action1: "expand:neutral:100",
              action2: "expand:neutral:100",
            }),
          ),
        ),
    );

    const result = await new OpenRouterAgent("test-key").decide(
      observation,
      candidates,
    );

    expect(result.attemptFailures).toMatchObject([
      { attempt: 1, code: "request_error", message: "provider unavailable" },
    ]);
    expect(result.attemptTimings).toEqual([
      {
        attempt: 1,
        totalMs: 10,
        timeToFirstTokenMs: null,
        generationMs: null,
        completionTokens: 0,
        timePerOutputTokenMs: null,
        queueMs: null,
        generationId: null,
      },
      {
        attempt: 2,
        totalMs: 20,
        timeToFirstTokenMs: 10,
        generationMs: 10,
        completionTokens: 5,
        timePerOutputTokenMs: 2.5,
        queueMs: null,
        generationId: "generation-1",
      },
    ]);
    expect(result.latencyMs).toBe(60);
  });

  it("marks generation time unavailable after a mid-stream error", async () => {
    const failedStream = [
      `data: ${JSON.stringify({
        id: "generation-failed",
        model: "openai/test-model",
        provider: "OpenAI",
        choices: [
          {
            finish_reason: null,
            delta: { content: '{"strategy":' },
          },
        ],
      })}\n\n`,
      `data: ${JSON.stringify({
        error: { message: "provider disconnected" },
      })}\n\n`,
    ].join("");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(failedStream, {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream",
              "X-Generation-Id": "generation-failed",
            },
          }),
        )
        .mockResolvedValueOnce(
          completion(
            JSON.stringify({
              strategy: "Use both safe troop budgets",
              action1: "expand:neutral:100",
              action2: "expand:neutral:100",
            }),
          ),
        ),
    );

    const result = await new OpenRouterAgent("test-key").decide(
      observation,
      candidates,
    );

    expect(result.attemptFailures).toMatchObject([
      {
        attempt: 1,
        code: "request_error",
        message: "OpenRouter stream error: provider disconnected",
      },
    ]);
    expect(result.attemptTimings[0]).toMatchObject({
      attempt: 1,
      generationMs: null,
      queueMs: null,
      generationId: "generation-failed",
    });
    expect(result.attemptTimings[0]?.timeToFirstTokenMs).not.toBeNull();
  });
});
