import { z } from "zod";
import { SCENARIO } from "./Scenario";
import {
  AgentDecisionSchema,
  AgentResult,
  LegalAction,
  Observation,
} from "./Types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const PROMPT_VERSION = "agent-v2" as const;
const MODEL_SEED = 3209 as const;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_COMPLETION_TOKENS = 256;

const ResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  provider: z.string().optional(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable() }),
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

export function promptFor(
  observation: Observation,
  candidates: LegalAction[],
) {
  const candidateView = candidates.map(({ id, category, label }) => ({
    id,
    category,
    label,
  }));
  return [
    "You control the human player in a deterministic OpenFront match.",
    "Your goal is to win. Choose exactly two DIFFERENT IDs from legal_actions.",
    "Use hold:1 or hold:2 when a slot should do nothing. Never invent an ID.",
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
    // Reserve enough budget for both attempts. Most decisions use one request,
    // but malformed output must never let a retry cross the run cap.
    return (
      2 *
      (promptTokens * pricing.prompt +
        MAX_COMPLETION_TOKENS * pricing.completion)
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
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await this.request(observation, candidates);
        promptTokens += result.promptTokens;
        completionTokens += result.completionTokens;
        costUsd += result.costUsd;
        model = result.model;
        provider = result.provider;
        if (result.decision) {
          return {
            ...result,
            promptTokens,
            completionTokens,
            costUsd,
            attempts: attempt,
            latencyMs: performance.now() - started,
          };
        }
        lastError = result.error ?? "OpenRouter returned an invalid decision";
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      decision: null,
      attempts: 2,
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
  ): Promise<Omit<AgentResult, "attempts" | "latencyMs">> {
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
        messages: [
          {
            role: "system",
            content:
              "Return only the requested JSON. Select legal action IDs exactly as provided.",
          },
          { role: "user", content: promptFor(observation, candidates) },
        ],
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
            schema: {
              type: "object",
              properties: {
                strategy: { type: "string", maxLength: 160 },
                actions: {
                  type: "array",
                  minItems: SCENARIO.actionSlots,
                  maxItems: SCENARIO.actionSlots,
                  items: { type: "string" },
                },
              },
              required: ["strategy", "actions"],
              additionalProperties: false,
            },
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
    const content = parsed.choices[0].message.content;
    let decision: AgentResult["decision"] = null;
    let error: string | undefined;
    try {
      if (!content) throw new Error("OpenRouter returned empty content");
      const parsedDecision = AgentDecisionSchema.parse(JSON.parse(content));
      const legalIds = new Set(candidates.map((candidate) => candidate.id));
      if (
        new Set(parsedDecision.actions).size !==
          parsedDecision.actions.length ||
        parsedDecision.actions.some((id) => !legalIds.has(id))
      ) {
        throw new Error(
          "OpenRouter selected an unknown or duplicate action ID",
        );
      }
      decision = parsedDecision;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    return {
      decision,
      promptTokens: parsed.usage?.prompt_tokens ?? 0,
      completionTokens: parsed.usage?.completion_tokens ?? 0,
      costUsd: parsed.usage?.cost ?? 0,
      model: parsed.model,
      provider: parsed.provider ?? this.provider ?? null,
      error,
    };
  }
}
