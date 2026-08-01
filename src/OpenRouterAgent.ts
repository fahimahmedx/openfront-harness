import { z } from "zod";
import { createParser } from "eventsource-parser";
import { DEFAULT_OPENROUTER_MODEL, SCENARIO } from "./Scenario";
import {
  areConflictingLegalActions,
  AgentAttemptFailure,
  AgentAttemptTiming,
  AgentDecision,
  AgentDecisionSchema,
  AgentResult,
  isGoldSpendingLegalAction,
  isRepeatableLegalAction,
  LegalAction,
  Observation,
  TIMER_VICTORY_RULE,
} from "./Types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const PROMPT_VERSION = "agent-v9" as const;
const REASONING_EFFORT = "none" as const;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_COMPLETION_TOKENS = 512;
const MAX_RETRY_CONTENT_CHARS = 2_000;
const MAX_FAILURE_MESSAGE_CHARS = 500;
const MAX_STREAM_BUFFER_CHARS = 1_000_000;

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
  ) {
    super(message);
    this.name = "TimedRequestError";
  }
}

const SlotDecisionSchema = z.object({
  strategy: z.string().trim().max(160),
  action1: z.string().min(1).max(160),
  action2: z.string().min(1).max(160),
});

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function actionIdsForSlot(candidates: LegalAction[], slot: 1 | 2): string[] {
  return candidates
    .filter(
      (candidate) =>
        (candidate.category !== "hold" || candidate.id === `hold:${slot}`) &&
        (slot === 1 || !isGoldSpendingLegalAction(candidate)),
    )
    .map((candidate) => candidate.id);
}

export function actionResponseJsonSchema(candidates: LegalAction[]) {
  return {
    type: "object",
    properties: {
      strategy: { type: "string", maxLength: 160 },
      action1: {
        type: "string",
        description: "The legal action ID to execute in the first slot.",
        enum: actionIdsForSlot(candidates, 1),
      },
      action2: {
        type: "string",
        description: "The legal action ID to execute in the second slot.",
        enum: actionIdsForSlot(candidates, 2),
      },
    },
    required: ["strategy", "action1", "action2"],
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

  const parsed = SlotDecisionSchema.safeParse(decoded);
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

  const legalIdsBySlot = [
    new Set(actionIdsForSlot(candidates, 1)),
    new Set(actionIdsForSlot(candidates, 2)),
  ];
  const selectedIds = [parsed.data.action1, parsed.data.action2];
  const unknownIds = unique(
    selectedIds.filter((id, slot) => !legalIdsBySlot[slot].has(id)),
  );
  const failures: AttemptFailure[] = [];
  if (unknownIds.length > 0) {
    failures.push({
      code: "unknown_action_id",
      message: `OpenRouter selected unknown action ID${unknownIds.length === 1 ? "" : "s"}: ${unknownIds.join(", ")}`,
      rejectedActionIds: unknownIds,
    });
  }
  if (unknownIds.length === 0) {
    const selectedActions = selectedIds.map((id) =>
      candidates.find((candidate) => candidate.id === id),
    );
    if (
      selectedActions[0] !== undefined &&
      selectedActions[1] !== undefined &&
      areConflictingLegalActions(selectedActions[0], selectedActions[1])
    ) {
      failures.push({
        code: "conflicting_action_ids",
        message: `OpenRouter selected actions with conflicting same-target postures: ${selectedIds.join(", ")}`,
        rejectedActionIds: selectedIds,
      });
    }
  }
  return {
    decision:
      failures.length === 0
        ? AgentDecisionSchema.parse({
            strategy: parsed.data.strategy,
            actions: selectedIds,
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
    maxUses: isRepeatableLegalAction(candidate) ? SCENARIO.actionSlots : 1,
    allowedSlots: ([1, 2] as const).filter((slot) =>
      actionIdsForSlot([candidate], slot).includes(candidate.id),
    ),
  }));
  return [
    "You control the human player in a deterministic OpenFront match.",
    "Your goal is to win. Choose one legal ID for action1 and one legal ID for action2.",
    "Both action slots execute simultaneously on the next tick. action2 cannot depend on action1's outcome.",
    "Do not combine cooperative and hostile actions toward the same opponent in one decision (for example, alliance plus attack, embargo, or alliance break).",
    "Troop actions with maxUses 2 may be selected in both slots. Do not repeat actions with maxUses 1.",
    "Build and upgrade actions are legal only in action1, so choose at most one gold-spending action per decision. Follow each action's allowedSlots.",
    "Use hold:1 only for action1 or hold:2 only for action2 when that slot should do nothing. Never invent an ID.",
    "self.troopCapacityPercent is current troops divided by self.maxTroops; troop growth approaches zero near 100% capacity, so holding at maximum capacity cannot rebuild or increase reserves further.",
    "Every listed troop action already preserves self.reserveFloorTroops. self.spendableTroops is safe surplus divided across the two slots, so listed troop amounts do not violate the displayed reserve.",
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
        attemptFailures.push({
          attempt,
          code: "request_error",
          message: lastError.slice(0, MAX_FAILURE_MESSAGE_CHARS),
          rejectedActionIds: [],
        });
        retryFeedback = {
          error: lastError.slice(0, MAX_FAILURE_MESSAGE_CHARS),
        };
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
          "Return only the requested JSON. Select one legal action ID for each named slot exactly as provided.",
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
        content: `The previous response failed validation: ${retryFeedback.error}. Return a corrected response with one legal ID in action1 and one legal ID in action2.`,
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
        throw new Error(`OpenRouter ${response.status}: ${detail}`);
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
      throw new TimedRequestError(message, timing(performance.now(), false));
    }
  }
}
