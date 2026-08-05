import { createHash } from "crypto";
import { z } from "zod";
import {
  VISUAL_BASELINE,
  VISUAL_BASELINE_INTERFACE,
  VISUAL_NAIVE_INTERFACE,
  VisualCommand,
  VisualCommandSchema,
  type VisualBaselineInterface,
  VisualBaselineUsage,
} from "./VisualBaselineTypes";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_COMPLETION_TOKENS = 256;

export const VISUAL_CONTROLS_PROMPT = [
  "You control the human player in OpenFront through the visible game screen.",
  "Your goal is to win this four-player free-for-all on Japan.",
  "You receive screenshots only. Never assume access to hidden state, DOM data, tile coordinates, or legal-action lists.",
  "The game ends immediately at 80% territory. If the 20-minute timer expires first, the living player with the most territory wins.",
  "Neutral land is unowned. Left-clicking unowned or enemy land sends the currently selected attack percentage. The bottom control panel shows troops, gold, and attack percentage.",
  "Use T/Y to decrease/increase attack percentage by 10 points, or click the visible percentage slider. Right-click opens the contextual radial menu. Control+left-click also opens the build menu.",
  "Number keys 1-7 select City, Factory, Port, Defense Post, Missile Silo, SAM Launcher, and Warship placement. Escape closes a menu or cancels placement.",
  "Drag to pan. Scroll or Q/E zooms. C centers the camera. K requests an alliance from the player under the cursor; L breaks one. G attacks under the cursor and B sends a boat attack.",
  "The evaluator has already fixed the Kanto spawn and stops simulated time while you interact. Do not press pause or change game speed.",
  `At most ${VISUAL_BASELINE.maxGameIntentsPerDecision} gameplay intents are accepted at each decision. UI navigation commands do not consume an intent until the client emits a game action.`,
  "Choose exactly one primitive command: move, click, drag, scroll, keypress, wait, or done. Move can place the cursor over a player before a cursor-sensitive key. Coordinates use the 1280x720 screenshot: x increases rightward and y downward.",
  "Use done when no further interaction is useful at this decision. note is a concise public tactical annotation, not private reasoning.",
].join("\n");

export const VISUAL_CONTROLS_PROMPT_SHA256 = createHash("sha256")
  .update(VISUAL_CONTROLS_PROMPT)
  .digest("hex");

export const VISUAL_NAIVE_PROMPT = [
  "You control the human player in OpenFront through the visible game screen.",
  "Your goal is to win this four-player free-for-all on Japan.",
  "You receive screenshots only. Never assume access to hidden state, DOM data, tile coordinates, or legal-action lists.",
  "The evaluator has already fixed the spawn and stops simulated time while you interact. Do not try to alter simulation timing.",
  `At most ${VISUAL_BASELINE.maxGameIntentsPerDecision} gameplay intents are accepted at each decision. UI navigation commands do not consume an intent until the client emits a game action.`,
  "Choose exactly one primitive command: move, click, drag, scroll, keypress, wait, or done. Coordinates use the 1280x720 screenshot: x increases rightward and y downward.",
  "Use done when no further interaction is useful at this decision. note is a concise public tactical annotation, not private reasoning.",
].join("\n");

export const VISUAL_NAIVE_PROMPT_SHA256 = createHash("sha256")
  .update(VISUAL_NAIVE_PROMPT)
  .digest("hex");

export function visualInterfacePrompt(interfaceName: VisualBaselineInterface) {
  return interfaceName === VISUAL_NAIVE_INTERFACE
    ? VISUAL_NAIVE_PROMPT
    : VISUAL_CONTROLS_PROMPT;
}

export function visualInterfacePromptSha256(
  interfaceName: VisualBaselineInterface,
) {
  return interfaceName === VISUAL_NAIVE_INTERFACE
    ? VISUAL_NAIVE_PROMPT_SHA256
    : VISUAL_CONTROLS_PROMPT_SHA256;
}

const WireCommandSchema = z.object({
  command: z.enum(VISUAL_BASELINE.commandSet),
  x: z.number().int().nullable(),
  y: z.number().int().nullable(),
  x2: z.number().int().nullable(),
  y2: z.number().int().nullable(),
  button: z.enum(["left", "right"]).nullable(),
  deltaY: z.number().int().nullable(),
  key: z.string().nullable(),
  milliseconds: z.number().int().nullable(),
  note: z.string(),
});

const ResponseSchema = z
  .object({
    model: z.string().optional(),
    provider: z.string().optional(),
    choices: z.array(
      z.object({
        message: z.object({ content: z.string().nullable() }),
      }),
    ),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().optional(),
        completion_tokens: z.number().int().nonnegative().optional(),
        cost: z.number().nonnegative().optional(),
      })
      .optional(),
  })
  .passthrough();

export type VisualAgentResult = {
  command: VisualCommand;
  latencyMs: number;
  usage: VisualBaselineUsage;
  resolvedModel: string;
  provider: string | null;
};

export class VisualAgentError extends Error {
  constructor(
    message: string,
    readonly usage: VisualBaselineUsage,
  ) {
    super(message);
    this.name = "VisualAgentError";
  }
}

function commandJsonSchema() {
  const nullableInteger = { type: ["integer", "null"] } as const;
  return {
    type: "object",
    properties: {
      command: { type: "string", enum: VISUAL_BASELINE.commandSet },
      x: { ...nullableInteger, minimum: 0, maximum: 1279 },
      y: { ...nullableInteger, minimum: 0, maximum: 719 },
      x2: { ...nullableInteger, minimum: 0, maximum: 1279 },
      y2: { ...nullableInteger, minimum: 0, maximum: 719 },
      button: { type: ["string", "null"], enum: ["left", "right", null] },
      deltaY: { ...nullableInteger, minimum: -2000, maximum: 2000 },
      key: { type: ["string", "null"], maxLength: 40 },
      milliseconds: {
        ...nullableInteger,
        minimum: 0,
        maximum: VISUAL_BASELINE.maxWaitMs,
      },
      note: { type: "string", maxLength: 160 },
    },
    required: [
      "command",
      "x",
      "y",
      "x2",
      "y2",
      "button",
      "deltaY",
      "key",
      "milliseconds",
      "note",
    ],
    additionalProperties: false,
  } as const;
}

export function parseVisualCommand(content: string): VisualCommand {
  const wire = WireCommandSchema.parse(JSON.parse(firstJsonObject(content)));
  switch (wire.command) {
    case "move":
      return VisualCommandSchema.parse({
        command: wire.command,
        x: wire.x,
        y: wire.y,
        note: wire.note,
      });
    case "click":
      return VisualCommandSchema.parse({
        command: wire.command,
        x: wire.x,
        y: wire.y,
        button: wire.button ?? "left",
        note: wire.note,
      });
    case "drag":
      return VisualCommandSchema.parse({
        command: wire.command,
        x: wire.x,
        y: wire.y,
        x2: wire.x2,
        y2: wire.y2,
        note: wire.note,
      });
    case "scroll":
      return VisualCommandSchema.parse({
        command: wire.command,
        x: wire.x,
        y: wire.y,
        deltaY: wire.deltaY,
        note: wire.note,
      });
    case "keypress":
      return VisualCommandSchema.parse({
        command: wire.command,
        key: wire.key,
        note: wire.note,
      });
    case "wait":
      return VisualCommandSchema.parse({
        command: wire.command,
        milliseconds: wire.milliseconds,
        note: wire.note,
      });
    case "done":
      return VisualCommandSchema.parse({
        command: wire.command,
        note: wire.note,
      });
  }
}

function firstJsonObject(content: string): string {
  const trimmed = content.trim();
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Some otherwise schema-compliant endpoints append prose or a second copy
    // after the command. Accept only the first complete JSON object; its shape
    // and every command field are still validated below.
  }
  const start = trimmed.indexOf("{");
  if (start === -1) return trimmed;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < trimmed.length; index++) {
    const character = trimmed[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth++;
    else if (character === "}" && --depth === 0) {
      return trimmed.slice(start, index + 1);
    }
  }
  return trimmed;
}

export class VisualControlsAgent {
  readonly promptVersion: VisualBaselineInterface;

  constructor(
    private readonly apiKey: string,
    readonly requestedModel: string,
    readonly requestedProvider?: string,
    readonly interfaceName: VisualBaselineInterface = VISUAL_BASELINE_INTERFACE,
  ) {
    this.promptVersion = interfaceName;
  }

  async decide(
    screenshotPng: Buffer,
    recentPublicNotes: string[],
    options: {
      initialValidationError?: string;
      maxModelCalls?: number;
    } = {},
  ): Promise<VisualAgentResult> {
    let validationError = options.initialValidationError;
    let totalLatencyMs = 0;
    const usage: VisualBaselineUsage = {
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      modelCalls: 0,
    };
    const maxModelCalls = options.maxModelCalls ?? 2;
    for (let attempt = 0; attempt < maxModelCalls; attempt++) {
      const started = performance.now();
      const response = await fetch(OPENROUTER_URL, {
        method: "POST",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer":
            process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
          "X-Title": `OpenFront ${this.interfaceName} baseline`,
        },
        body: JSON.stringify({
          model: this.requestedModel,
          messages: [
            {
              role: "system",
              content:
                "Return only the requested JSON command. Operate only from the supplied screenshot and controls manual.",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: visualInterfacePrompt(this.interfaceName),
                },
                {
                  type: "text",
                  text:
                    recentPublicNotes.length === 0
                      ? "No earlier public notes are available."
                      : `Recent public notes: ${JSON.stringify(recentPublicNotes.slice(-VISUAL_BASELINE.recentPublicNoteCount))}`,
                },
                ...(validationError
                  ? [
                      {
                        type: "text",
                        text: `The previous command failed validation: ${validationError}. Correct it.`,
                      },
                    ]
                  : []),
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/png;base64,${screenshotPng.toString("base64")}`,
                  },
                },
              ],
            },
          ],
          max_tokens: MAX_COMPLETION_TOKENS,
          reasoning: { effort: "none" },
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "openfront_visual_command",
              strict: true,
              schema: commandJsonSchema(),
            },
          },
          provider: {
            ...(this.requestedProvider
              ? { only: [this.requestedProvider] }
              : {}),
            allow_fallbacks: false,
            require_parameters: true,
            data_collection: "deny",
          },
        }),
      });
      const latencyMs = performance.now() - started;
      totalLatencyMs += latencyMs;
      usage.modelCalls++;
      if (!response.ok) {
        throw new Error(
          `OpenRouter ${response.status}: ${(await response.text()).slice(0, 500)}`,
        );
      }
      const body = ResponseSchema.parse(await response.json());
      usage.promptTokens += body.usage?.prompt_tokens ?? 0;
      usage.completionTokens += body.usage?.completion_tokens ?? 0;
      usage.costUsd += body.usage?.cost ?? 0;
      try {
        const content = body.choices[0]?.message.content;
        if (!content) throw new Error("OpenRouter returned empty content");
        return {
          command: parseVisualCommand(content),
          latencyMs: totalLatencyMs,
          usage,
          resolvedModel: body.model ?? this.requestedModel,
          provider: body.provider ?? this.requestedProvider ?? null,
        };
      } catch (cause) {
        validationError =
          cause instanceof Error ? cause.message : String(cause);
      }
    }
    throw new VisualAgentError(
      `Visual command failed validation after ${maxModelCalls} model call${maxModelCalls === 1 ? "" : "s"}: ${validationError}`,
      usage,
    );
  }
}
