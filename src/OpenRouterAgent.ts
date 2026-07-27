import { z } from "zod";
import { SCENARIO } from "./Scenario";
import {
  AgentAttemptFailure,
  AgentDecision,
  AgentDecisionSchema,
  AgentResult,
  isRepeatableLegalAction,
  LegalAction,
  Observation,
} from "./Types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const PROMPT_VERSION = "agent-v4" as const;
const MODEL_SEED = 3209 as const;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_COMPLETION_TOKENS = 512;
const MAX_RETRY_CONTENT_CHARS = 2_000;
const MAX_FAILURE_MESSAGE_CHARS = 500;

const ResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  provider: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable(),
          refusal: z.string().nullable().optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      cost: z.number().nonnegative().optional(),
    })
    .optional(),
});

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
  "attempts" | "attemptFailures" | "latencyMs"
> & {
  failures: AttemptFailure[];
  rejectedContent?: string;
};

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
        candidate.category !== "hold" || candidate.id === `hold:${slot}`,
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
  }));
  return [
    "You control the human player in a deterministic OpenFront match.",
    "Your goal is to win. Choose one legal ID for action1 and one legal ID for action2.",
    "Troop actions with maxUses 2 may be selected in both slots. Do not repeat actions with maxUses 1.",
    "Use hold:1 only for action1 or hold:2 only for action2 when that slot should do nothing. Never invent an ID.",
    "Troop discipline is essential: absolute troop growth becomes slow at low troop counts, weak reserves invite defeat, and undersized attacks fail.",
    "Read self.troopCapacityPercent, troopGrowthPerSecond, troopPolicyMode, reserveFloorTroops, and opponent troopsRelativeToSelf before spending troops.",
    "Troop actions use a shared two-slot safe budget and already preserve the displayed reserve floor. Hold while rebuilding; attack players only with a real troop advantage.",
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
      options.model ?? process.env.OPENROUTER_MODEL ?? "openai/gpt-5.6-luna";
    this.provider =
      options.provider ?? process.env.OPENROUTER_PROVIDER ?? "openai";
  }

  static promptVersion() {
    return PROMPT_VERSION;
  }

  static modelSeed() {
    return MODEL_SEED;
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
    let retryFeedback: RetryFeedback | undefined;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await this.request(
          observation,
          candidates,
          retryFeedback,
        );
        promptTokens += result.promptTokens;
        completionTokens += result.completionTokens;
        costUsd += result.costUsd;
        model = result.model;
        provider = result.provider;
        if (result.decision) {
          return {
            decision: result.decision,
            attemptFailures,
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
    retryFeedback?: RetryFeedback,
  ): Promise<RequestResult> {
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

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
        "X-Title": "OpenFront LLM Harness",
      },
      body: JSON.stringify({
        model: this.requestedModel,
        messages,
        seed: MODEL_SEED,
        // The pinned OpenAI endpoint advertises `max_tokens`; Azure advertises
        // `max_completion_tokens`. `require_parameters` makes this distinction
        // significant, so use the parameter supported by the pinned endpoint.
        max_tokens: MAX_COMPLETION_TOKENS,
        reasoning: { effort: "low" },
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "openfront_agent_decision",
            strict: true,
            schema: actionResponseJsonSchema(candidates),
          },
        },
        provider: {
          ...(this.provider ? { only: [this.provider] } : {}),
          allow_fallbacks: false,
          require_parameters: true,
          data_collection: "deny",
        },
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`OpenRouter ${response.status}: ${detail}`);
    }
    const parsed = ResponseSchema.parse(await response.json());
    const choice = parsed.choices[0];
    const content = choice.message.content;
    let validated: ValidatedDecision;
    if (choice.message.refusal) {
      validated = {
        decision: null,
        failures: [
          {
            code: "refusal",
            message: `OpenRouter refused the decision: ${choice.message.refusal.slice(0, 430)}`,
            rejectedActionIds: [],
          },
        ],
      };
    } else if (choice.finish_reason === "length") {
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
      rejectedContent: validated.decision ? undefined : (content ?? undefined),
      promptTokens: parsed.usage?.prompt_tokens ?? 0,
      completionTokens: parsed.usage?.completion_tokens ?? 0,
      costUsd: parsed.usage?.cost ?? 0,
      model: parsed.model,
      provider: parsed.provider ?? this.provider ?? null,
      error: error || undefined,
    };
  }
}
