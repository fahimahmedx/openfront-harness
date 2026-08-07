import { afterEach, describe, expect, it, vi } from "vitest";
import { UnitType } from "../OpenFrontIO/src/core/game/Game";
import {
  actionResponseJsonSchema,
  OpenRouterAgent,
  promptFor,
  validateDecisionContent,
} from "../src/OpenRouterAgent";
import {
  AgentAttemptFailureSchema,
  LegacyObservationSchema,
  LegalAction,
  Observation,
  ObservationSchema,
  TIMER_VICTORY_RULE,
} from "../src/Types";

const candidates: LegalAction[] = [
  { id: "hold", category: "hold", label: "Take no action", intent: null },
  {
    id: "expand:neutral:100",
    category: "expand",
    label: "Expand into neutral land",
    intent: { type: "attack", targetID: null, troops: 100 },
  },
  {
    id: "build:Factory:456",
    category: "build",
    label: "Build Factory",
    intent: { type: "build_unit", unit: UnitType.Factory, tile: 456 },
  },
];

const observation: Observation = {
  scenarioId: "japan-v6",
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
  isTerritoryLeader: false,
  territoryLeadPercent: 0,
  territoryDeficitPercent: 10,
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
  const events = [
    {
      id: "generation-1",
      model: "openai/test-model",
      provider: "OpenAI",
      choices: [{ finish_reason: null, delta: { content } }],
    },
    {
      id: "generation-1",
      model: "openai/test-model",
      provider: "OpenAI",
      choices: [{ finish_reason: finishReason, delta: {} }],
    },
    {
      id: "generation-1",
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
  return new Response(
    completionEvents(content, finishReason, completionTokens),
    {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "X-Generation-Id": "generation-1",
      },
    },
  );
}

function requestError(status: number, retryAfter?: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        message: "Provider returned error",
        code: status,
      },
    }),
    {
      status,
      headers: retryAfter === undefined ? {} : { "Retry-After": retryAfter },
    },
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("OpenRouter one-action output", () => {
  it("versions and describes the singular decision contract", () => {
    expect(OpenRouterAgent.promptVersion()).toBe("agent-v13");
    expect(OpenRouterAgent.reasoningEffort()).toBe("none");
    const prompt = promptFor(observation, candidates);
    expect(prompt).toContain("Choose exactly one legal action ID");
    expect(prompt).toContain("Use hold when no other action should be taken");
    expect(prompt).toContain("safe action budget");
    expect(prompt).not.toMatch(/action1|action2|slot/i);
  });

  it("places every legal action in one strict enum", () => {
    const schema = actionResponseJsonSchema(candidates);
    expect(schema.required).toEqual(["strategy", "action"]);
    expect(schema.properties.action).toEqual({
      type: "string",
      description: "The one legal action ID to execute this decision.",
      enum: ["hold", "expand:neutral:100", "build:Factory:456"],
    });
    expect(schema).not.toHaveProperty("properties.action1");
    expect(schema).not.toHaveProperty("properties.action2");
  });

  it("accepts one legal action and rejects unknown or old two-slot shapes", () => {
    expect(
      validateDecisionContent(
        JSON.stringify({
          strategy: "Expand safely",
          action: "expand:neutral:100",
        }),
        candidates,
      ),
    ).toEqual({
      decision: { strategy: "Expand safely", action: "expand:neutral:100" },
      failures: [],
    });
    expect(
      validateDecisionContent(
        JSON.stringify({ strategy: "Invent", action: "unknown" }),
        candidates,
      ),
    ).toMatchObject({
      decision: null,
      failures: [{ code: "unknown_action_id", rejectedActionIds: ["unknown"] }],
    });
    expect(
      validateDecisionContent(
        JSON.stringify({ strategy: "Old", action1: "hold", action2: "hold" }),
        candidates,
      ),
    ).toMatchObject({ decision: null, failures: [{ code: "invalid_shape" }] });
  });

  it("keeps legacy observation normalization out of the current schema", () => {
    const legacy = {
      ...observation,
      territoryGapToLeader: 0.942,
      isTerritoryLeader: undefined,
      territoryLeadPercent: undefined,
      territoryDeficitPercent: undefined,
    };
    expect(() => ObservationSchema.parse(legacy)).toThrow();
    expect(LegacyObservationSchema.parse(legacy)).toMatchObject({
      isTerritoryLeader: false,
      territoryLeadPercent: 0,
      territoryDeficitPercent: 0.942,
    });
  });

  it("retries an unknown action with singular corrective feedback", async () => {
    const rejected = JSON.stringify({ strategy: "Invent", action: "unknown" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(completion(rejected))
      .mockResolvedValueOnce(
        completion(JSON.stringify({ strategy: "Hold", action: "hold" })),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenRouterAgent("test-key").decide(
      observation,
      candidates,
    );
    expect(result).toMatchObject({
      decision: { strategy: "Hold", action: "hold" },
      attempts: 2,
      attemptFailures: [
        {
          attempt: 1,
          code: "unknown_action_id",
          rejectedActionIds: ["unknown"],
        },
      ],
    });
    const request = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    ) as { messages: Array<{ role: string; content: string }> };
    expect(request.messages[request.messages.length - 2]).toEqual({
      role: "assistant",
      content: rejected,
    });
    expect(request.messages[request.messages.length - 1]?.content).toContain(
      "exactly one legal ID in action",
    );
  });

  it("diagnoses truncation and sends the one-action JSON Schema", async () => {
    const rejected = JSON.stringify({ strategy: "Expand" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(completion(rejected, "length"))
      .mockResolvedValueOnce(
        completion(
          JSON.stringify({ strategy: "Expand", action: "expand:neutral:100" }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenRouterAgent("test-key", {
      model: "openai/test-model",
      provider: "openai",
    }).decide(observation, candidates);
    expect(result.decision?.action).toBe("expand:neutral:100");
    expect(result.attemptFailures).toMatchObject([
      { attempt: 1, code: "truncated_response" },
    ]);
    expect(result.promptTokens).toBe(20);
    expect(result.completionTokens).toBe(10);

    const request = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    ) as {
      seed?: number;
      reasoning: { effort: string };
      response_format: { json_schema: { schema: unknown } };
    };
    expect(request).not.toHaveProperty("seed");
    expect(request.reasoning).toEqual({ effort: "none" });
    expect(request.response_format.json_schema.schema).toEqual(
      actionResponseJsonSchema(candidates),
    );
  });

  it("parses chunked SSE and records generation timing", async () => {
    const content = JSON.stringify({
      strategy: "Expand",
      action: "expand:neutral:100",
    });
    const body = `: OPENROUTER PROCESSING\n\n${completionEvents(content)}`;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let index = 0; index < body.length; index += 37) {
          controller.enqueue(
            new TextEncoder().encode(body.slice(index, index + 37)),
          );
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
    expect(result.decision?.action).toBe("expand:neutral:100");
    expect(result.promptTokens).toBe(10);
    expect(result.attemptTimings[0]).toMatchObject({
      attempt: 1,
      completionTokens: 5,
      queueMs: null,
      generationId: "generation-1",
    });
  });

  it("retains failed-request timing before retrying", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("provider unavailable"))
        .mockResolvedValueOnce(
          completion(JSON.stringify({ strategy: "Hold", action: "hold" })),
        ),
    );
    const result = await new OpenRouterAgent("test-key").decide(
      observation,
      candidates,
    );
    expect(result.decision?.action).toBe("hold");
    expect(result.attemptFailures).toMatchObject([
      { attempt: 1, code: "request_error", message: "provider unavailable" },
    ]);
    expect(result.attemptTimings).toHaveLength(2);
  });

  it("honors Retry-After seconds before retrying a 429", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(requestError(429, "2"))
      .mockResolvedValueOnce(
        completion(JSON.stringify({ strategy: "Hold", action: "hold" })),
      );
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = new OpenRouterAgent("test-key").decide(
      observation,
      candidates,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    const result = await resultPromise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.decision?.action).toBe("hold");
    expect(result.attemptFailures).toMatchObject([
      {
        attempt: 1,
        code: "rate_limited",
        httpStatus: 429,
        retryDelayMs: 2_000,
      },
    ]);
    expect(() =>
      AgentAttemptFailureSchema.parse(result.attemptFailures[0]),
    ).not.toThrow();
    const firstRequest = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body),
    ) as { messages: unknown[] };
    const retryRequest = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    ) as { messages: unknown[] };
    expect(retryRequest.messages).toEqual(firstRequest.messages);
    expect(result.latencyMs).toBeGreaterThanOrEqual(2_000);
  });

  it("accepts an HTTP-date Retry-After value", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-06T12:00:00.000Z"));
    const retryAt = new Date(Date.now() + 7_000).toUTCString();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(requestError(429, retryAt))
      .mockResolvedValueOnce(
        completion(JSON.stringify({ strategy: "Hold", action: "hold" })),
      );
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = new OpenRouterAgent("test-key").decide(
      observation,
      candidates,
    );
    await vi.advanceTimersByTimeAsync(6_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    const result = await resultPromise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.attemptFailures[0]).toMatchObject({ retryDelayMs: 7_000 });
  });

  it("uses the bounded fallback delay for absent, invalid, or excessive Retry-After values", async () => {
    vi.useFakeTimers();
    for (const [retryAfter, expectedDelay] of [
      [undefined, 5_000],
      ["not-a-delay", 5_000],
      ["120", 60_000],
    ] as const) {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(requestError(429, retryAfter))
        .mockResolvedValueOnce(
          completion(JSON.stringify({ strategy: "Hold", action: "hold" })),
        );
      vi.stubGlobal("fetch", fetchMock);

      const resultPromise = new OpenRouterAgent("test-key").decide(
        observation,
        candidates,
      );
      await vi.advanceTimersByTimeAsync(expectedDelay - 1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);

      const result = await resultPromise;
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.attemptFailures[0]).toMatchObject({
        retryDelayMs: expectedDelay,
      });
      vi.unstubAllGlobals();
    }
  });

  it("stops after a second 429 and leaves the safe-hold fallback to the harness", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(requestError(429, "1"))
      .mockResolvedValueOnce(requestError(429, "30"));
    vi.stubGlobal("fetch", fetchMock);

    const resultPromise = new OpenRouterAgent("test-key").decide(
      observation,
      candidates,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    const result = await resultPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.decision).toBeNull();
    expect(result.attemptFailures).toMatchObject([
      { attempt: 1, code: "rate_limited", retryDelayMs: 1_000 },
      { attempt: 2, code: "rate_limited" },
    ]);
    expect(result.attemptFailures[1]).not.toHaveProperty("retryDelayMs");
  });
});
