import { z } from "zod";
import { createParser } from "eventsource-parser";
import { DEFAULT_OPENROUTER_MODEL } from "./Scenario";
import {
  AgentAttemptFailure,
  AgentAttemptTiming,
  AgentDecision,
  AgentDecisionSchema,
  AgentResult,
  LegalAction,
  Observation,
  TIMER_VICTORY_RULE,
} from "./Types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const PROMPT_VERSION = "agent-v13" as const;
const REASONING_EFFORT = "none" as const;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_COMPLETION_TOKENS = 512;
const MAX_RETRY_CONTENT_CHARS = 2_000;
const MAX_FAILURE_MESSAGE_CHARS = 500;
const MAX_STREAM_BUFFER_CHARS = 1_000_000;
const DEFAULT_RATE_LIMIT_RETRY_DELAY_MS = 5_000;
const MAX_RATE_LIMIT_RETRY_DELAY_MS = 60_000;

const StreamChunkSchema = z
  .object({
    id: z.string().optional(),
    model: z.string().optional(),
    provider: z.string().optional(),
    choices: z
      .array(
        z.object({
          finish_reason: z.string().nullable().optional(),
          delta: z
            .object({
              content: z.string().nullable().optional(),
              refusal: z.string().nullable().optional(),
              reasoning: z.string().nullable().optional(),
            })
            .passthrough()
            .optional(),
        }),
      )
      .optional(),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().optional(),
        completion_tokens: z.number().int().nonnegative().optional(),
        cost: z.number().nonnegative().optional(),
      })
      .optional(),
    error: z
      .object({
        message: z.string(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const ModelsSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      pricing: z.object({
        prompt: z.string(),
        completion: z.string(),
      }),
    }),
  ),
});

type Pricing = { prompt: number; completion: number };
type AttemptFailure = Omit<AgentAttemptFailure, "attempt">;
type RetryFeedback = { content?: string; error: string };
type ValidatedDecision = {
  decision: AgentDecision | null;
  failures: AttemptFailure[];
};
type RequestResult = Omit<
  AgentResult,
  "attempts" | "attemptFailures" | "attemptTimings" | "latencyMs"
> & {
  failures: AttemptFailure[];
  rejectedContent?: string;
  attemptTiming: AgentAttemptTiming;
};

class TimedRequestError extends Error {
  constructor(
    message: string,
    readonly timing: AgentAttemptTiming,
    readonly httpStatus?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "TimedRequestError";
  }
}

class OpenRouterHttpError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = "OpenRouterHttpError";
  }
}

function parseRetryAfterMs(value: string | null): number | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  const seconds = Number(normalized);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1_000);
  }
  const retryAt = Date.parse(normalized);
  if (!Number.isFinite(retryAt)) return null;
  return Math.max(0, retryAt - Date.now());
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

const ActionDecisionSchema = z.object({
  strategy: z.string().trim().max(160),
  action: z.string().min(1).max(160),
});

export function actionResponseJsonSchema(candidates: LegalAction[]) {
  return {
    type: "object",
    properties: {
      strategy: { type: "string", maxLength: 160 },
      action: {
        type: "string",
        description: "The one legal action ID to execute this decision.",
        enum: candidates.map((candidate) => candidate.id),
      },
    },
    required: ["strategy", "action"],
    additionalProperties: false,
  } as const;
}

export function validateDecisionContent(
  content: string | null,
  candidates: LegalAction[],
): ValidatedDecision {
  if (!content) {
    return {
      decision: null,
      failures: [
        {
          code: "empty_response",
          message: "OpenRouter returned empty content",
          rejectedActionIds: [],
        },
      ],
    };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(content);
  } catch {
    return {
      decision: null,
      failures: [
        {
          code: "invalid_json",
          message: "OpenRouter returned invalid JSON",
          rejectedActionIds: [],
        },
      ],
    };
  }

  const parsed = ActionDecisionSchema.safeParse(decoded);
  if (!parsed.success) {
    return {
      decision: null,
      failures: [
        {
          code: "invalid_shape",
          message: `OpenRouter returned an invalid decision shape: ${parsed.error.issues
            .map((issue) => issue.message)
            .join(", ")
            .slice(0, 430)}`,
          rejectedActionIds: [],
        },
      ],
    };
  }

  const legalIds = new Set(candidates.map((candidate) => candidate.id));
  const unknownIds = legalIds.has(parsed.data.action)
    ? []
    : [parsed.data.action];
  const failures: AttemptFailure[] = [];
  if (unknownIds.length > 0) {
    failures.push({
      code: "unknown_action_id",
      message: `OpenRouter selected unknown action ID${unknownIds.length === 1 ? "" : "s"}: ${unknownIds.join(", ")}`,
      rejectedActionIds: unknownIds,
    });
  }
  return {
    decision:
      failures.length === 0
        ? AgentDecisionSchema.parse({
            strategy: parsed.data.strategy,
            action: parsed.data.action,
          })
        : null,
    failures,
  };
}

export function promptFor(observation: Observation, candidates: LegalAction[]) {
  const candidateView = candidates.map((candidate) => ({
    id: candidate.id,
    category: candidate.category,
    label: candidate.label,
  }));
  return [
    "You control the human player in a deterministic OpenFront match.",
    "Your goal is to win. Choose exactly one legal action ID.",
    "In free-for-all play, avoid opening proactive wars against multiple comparable opponents. An alliance can keep one front peaceful; neutral nations are more likely to accept early requests before hostilities.",
    "Diplomacy does not spend troops or gold. Use relation names and allianceRequest history instead of guessing from numeric codes.",
    "Use hold when no other action should be taken. Never invent an ID.",
    "self.troopCapacityPercent is current troops divided by self.maxTroops; troop growth approaches zero near 100% capacity, so holding at maximum capacity cannot rebuild or increase reserves further.",
    "Every listed troop action already preserves self.reserveFloorTroops and fits within the safe action budget.",
    "Neutral expansion captures unowned land and does not require a troop advantage over opponents. Judge attacks on opponents separately using troopsRelativeToSelf.",
    `${TIMER_VICTORY_RULE} instantVictoryTerritoryPercent is the territory threshold for an immediate victory, not a probability.`,
    "Standings are explicit: isTerritoryLeader is true only while self is first; territoryLeadPercent is positive only while leading, and territoryDeficitPercent is positive only while behind. Never describe a deficit as a lead.",
    "Recent actionOutcomes report whether submitted actions started, failed, completed, or were destroyed. Do not assume a submitted action took effect.",
    "strategy is a public, concise tactical note (160 characters maximum), not private reasoning.",
    JSON.stringify({ observation, legal_actions: candidateView }),
  ].join("\n");
}

export class OpenRouterAgent {
  readonly requestedModel: string;
  readonly provider: string | undefined;
  readonly promptVersion = PROMPT_VERSION;
  private pricing: Pricing | null = null;
  private pricingLoaded = false;

  constructor(
    private readonly apiKey: string,
    options: { model?: string; provider?: string } = {},
  ) {
    this.requestedModel =
      options.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_OPENROUTER_MODEL;
    this.provider =
      options.provider ?? process.env.OPENROUTER_PROVIDER ?? "openai";
  }

  static promptVersion() {
    return PROMPT_VERSION;
  }

  static reasoningEffort() {
    return REASONING_EFFORT;
  }

  private async loadPricing(): Promise<void> {
    if (this.pricingLoaded) return;
    this.pricingLoaded = true;
    try {
      const response = await fetch(OPENROUTER_MODELS_URL, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return;
      const parsed = ModelsSchema.parse(await response.json());
      const model = parsed.data.find(
        (candidate) => candidate.id === this.requestedModel,
      );
      if (!model) return;
      const prompt = Number(model.pricing.prompt);
      const completion = Number(model.pricing.completion);
      if (Number.isFinite(prompt) && Number.isFinite(completion)) {
        this.pricing = { prompt, completion };
      }
    } catch (error) {
      console.warn(
        "Could not load OpenRouter pricing; using conservative fallback",
        error,
      );
    }
  }

  async estimateNextCost(
    observation: Observation,
    candidates: LegalAction[],
  ): Promise<number> {
    await this.loadPricing();
    // UTF-8 bytes are a deliberately conservative upper bound for text tokens.
    const promptTokens = new TextEncoder().encode(
      promptFor(observation, candidates),
    ).length;
    const pricing = this.pricing ?? {
      prompt: 0.000005,
      completion: 0.00003,
    };
    // The retry can also contain the rejected response and validation error.
    // Four UTF-8 bytes per retained character is a conservative upper bound.
    const retryFeedbackTokens =
      4 * (MAX_RETRY_CONTENT_CHARS + MAX_FAILURE_MESSAGE_CHARS);
    // Reserve enough budget for both attempts. Most decisions use one request,
    // but malformed output must never let a retry cross the run cap.
    return (
      (2 * promptTokens + retryFeedbackTokens) * pricing.prompt +
      2 * MAX_COMPLETION_TOKENS * pricing.completion
    );
  }

  async decide(
    observation: Observation,
    candidates: LegalAction[],
  ): Promise<AgentResult> {
    const started = performance.now();
    let lastError = "unknown OpenRouter error";
    let promptTokens = 0;
    let completionTokens = 0;
    let costUsd = 0;
    let model = this.requestedModel;
    let provider: string | null = this.provider ?? null;
    const attemptFailures: AgentAttemptFailure[] = [];
    const attemptTimings: AgentAttemptTiming[] = [];
    let retryFeedback: RetryFeedback | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await this.request(
          observation,
          candidates,
          attempt,
          retryFeedback,
        );
        attemptTimings.push(result.attemptTiming);
        promptTokens += result.promptTokens;
        completionTokens += result.completionTokens;
        costUsd += result.costUsd;
        model = result.model;
        provider = result.provider;
        if (result.decision) {
          return {
            decision: result.decision,
            attemptFailures,
            attemptTimings,
            promptTokens,
            completionTokens,
            costUsd,
            model: result.model,
            provider: result.provider,
            attempts: attempt,
            latencyMs: performance.now() - started,
          };
        }
        const failures =
          result.failures.length > 0
            ? result.failures
            : [
                {
                  code: "invalid_shape" as const,
                  message: "OpenRouter returned an invalid decision",
                  rejectedActionIds: [],
                },
              ];
        attemptFailures.push(
          ...failures.map((failure) => ({ ...failure, attempt })),
        );
        lastError = failures.map((failure) => failure.message).join("; ");
        retryFeedback = {
          content: result.rejectedContent,
          error: lastError.slice(0, MAX_FAILURE_MESSAGE_CHARS),
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (error instanceof TimedRequestError) {
          attemptTimings.push(error.timing);
        }
        const rateLimited =
          error instanceof TimedRequestError && error.httpStatus === 429;
        const retryDelayMs =
          rateLimited && attempt < 2
            ? Math.min(
                error.retryAfterMs ?? DEFAULT_RATE_LIMIT_RETRY_DELAY_MS,
                MAX_RATE_LIMIT_RETRY_DELAY_MS,
              )
            : undefined;
        attemptFailures.push({
          attempt,
          code: rateLimited ? "rate_limited" : "request_error",
          message: lastError.slice(0, MAX_FAILURE_MESSAGE_CHARS),
          rejectedActionIds: [],
          ...(error instanceof TimedRequestError && error.httpStatus
            ? { httpStatus: error.httpStatus }
            : {}),
          ...(retryDelayMs === undefined ? {} : { retryDelayMs }),
        });
        retryFeedback = rateLimited
          ? undefined
          : { error: lastError.slice(0, MAX_FAILURE_MESSAGE_CHARS) };
        if (retryDelayMs !== undefined) await wait(retryDelayMs);
      }
    }
    return {
      decision: null,
      attempts: 2,
      attemptFailures,
      attemptTimings,
      latencyMs: performance.now() - started,
      promptTokens,
      completionTokens,
      costUsd,
      model,
      provider,
      error: lastError,
    };
  }

  private async request(
    observation: Observation,
    candidates: LegalAction[],
    attempt: number,
    retryFeedback?: RetryFeedback,
  ): Promise<RequestResult> {
    const started = performance.now();
    let firstTokenAt: number | null = null;
    let generationId: string | null = null;
    let attemptCompletionTokens = 0;
    const timing = (
      completedAt: number,
      streamCompleted: boolean,
    ): AgentAttemptTiming => {
      const generationMs =
        streamCompleted && firstTokenAt !== null
          ? completedAt - firstTokenAt
          : null;
      return {
        attempt,
        totalMs: completedAt - started,
        timeToFirstTokenMs:
          firstTokenAt === null ? null : firstTokenAt - started,
        generationMs,
        completionTokens: attemptCompletionTokens,
        timePerOutputTokenMs:
          generationMs !== null && attemptCompletionTokens > 1
            ? generationMs / (attemptCompletionTokens - 1)
            : null,
        // OpenRouter does not currently expose upstream provider queue time.
        queueMs: null,
        generationId,
      };
    };
    const messages = [
      {
        role: "system",
        content:
          "Return only the requested JSON. Select exactly one legal action ID as provided.",
      },
      { role: "user", content: promptFor(observation, candidates) },
    ];
    if (retryFeedback?.content) {
      messages.push({
        role: "assistant",
        content: retryFeedback.content.slice(0, MAX_RETRY_CONTENT_CHARS),
      });
    }
    if (retryFeedback) {
      messages.push({
        role: "user",
        content: `The previous response failed validation: ${retryFeedback.error}. Return a corrected response with exactly one legal ID in action.`,
      });
    }

    try {
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer":
            process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
          "X-Title": "OpenFront LLM Harness",
        },
        body: JSON.stringify({
          model: this.requestedModel,
          messages,
          // The pinned OpenAI endpoint advertises `max_tokens`; Azure advertises
          // `max_completion_tokens`. `require_parameters` makes this distinction
          // significant, so use the parameter supported by the pinned endpoint.
          max_tokens: MAX_COMPLETION_TOKENS,
          reasoning: { effort: REASONING_EFFORT },
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "openfront_agent_decision",
              strict: true,
              schema: actionResponseJsonSchema(candidates),
            },
          },
          stream: true,
          stream_options: { include_usage: true },
          provider: {
            ...(this.provider ? { only: [this.provider] } : {}),
            allow_fallbacks: false,
            require_parameters: true,
            data_collection: "deny",
          },
        }),
      });
      generationId = response.headers.get("X-Generation-Id");
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new OpenRouterHttpError(
          `OpenRouter ${response.status}: ${detail}`,
          response.status,
          parseRetryAfterMs(response.headers.get("Retry-After")),
        );
      }
      if (!response.body) {
        throw new Error("OpenRouter returned an empty response stream");
      }

      let content = "";
      let refusal: string | null = null;
      let finishReason: string | null | undefined;
      let promptTokens = 0;
      let completionTokens = 0;
      let costUsd = 0;
      let model = this.requestedModel;
      let provider: string | null = this.provider ?? null;
      let streamError: Error | null = null;
      let completedAt: number | null = null;
      const parser = createParser({
        maxBufferSize: MAX_STREAM_BUFFER_CHARS,
        onError(error) {
          streamError ??= error;
        },
        onEvent(event) {
          if (event.data === "[DONE]") {
            completedAt ??= performance.now();
            return;
          }
          try {
            const chunk = StreamChunkSchema.parse(JSON.parse(event.data));
            if (chunk.error) {
              streamError ??= new Error(
                `OpenRouter stream error: ${chunk.error.message}`,
              );
              return;
            }
            generationId ??= chunk.id ?? null;
            model = chunk.model ?? model;
            provider = chunk.provider ?? provider;
            if (chunk.usage) {
              promptTokens = chunk.usage.prompt_tokens ?? promptTokens;
              completionTokens =
                chunk.usage.completion_tokens ?? completionTokens;
              attemptCompletionTokens = completionTokens;
              costUsd = chunk.usage.cost ?? costUsd;
            }
            for (const choice of chunk.choices ?? []) {
              const delta = choice.delta;
              const tokenText =
                delta?.content ?? delta?.reasoning ?? delta?.refusal;
              if (tokenText && firstTokenAt === null) {
                firstTokenAt = performance.now();
              }
              if (delta?.content) content += delta.content;
              if (delta?.refusal) refusal = (refusal ?? "") + delta.refusal;
              finishReason = choice.finish_reason ?? finishReason;
            }
          } catch (error) {
            streamError ??=
              error instanceof Error ? error : new Error(String(error));
          }
        },
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        parser.feed(decoder.decode(value, { stream: true }));
        if (streamError) {
          await reader.cancel();
          throw streamError;
        }
      }
      parser.feed(decoder.decode());
      parser.reset({ consume: true });
      if (streamError) throw streamError;
      completedAt ??= performance.now();

      let validated: ValidatedDecision;
      const refusalText = refusal as string | null;
      if (refusalText) {
        validated = {
          decision: null,
          failures: [
            {
              code: "refusal",
              message: `OpenRouter refused the decision: ${refusalText.slice(0, 430)}`,
              rejectedActionIds: [],
            },
          ],
        };
      } else if (finishReason === "length") {
        validated = {
          decision: null,
          failures: [
            {
              code: "truncated_response",
              message: "OpenRouter truncated the decision at the token limit",
              rejectedActionIds: [],
            },
          ],
        };
      } else {
        validated = validateDecisionContent(content, candidates);
      }
      const error = validated.failures
        .map((failure) => failure.message)
        .join("; ");
      return {
        decision: validated.decision,
        failures: validated.failures,
        rejectedContent: validated.decision ? undefined : content || undefined,
        promptTokens,
        completionTokens,
        costUsd,
        model,
        provider,
        error: error || undefined,
        attemptTiming: timing(completedAt, true),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new TimedRequestError(
        message,
        timing(performance.now(), false),
        error instanceof OpenRouterHttpError ? error.httpStatus : undefined,
        error instanceof OpenRouterHttpError
          ? (error.retryAfterMs ?? undefined)
          : undefined,
      );
    }
  }
}
