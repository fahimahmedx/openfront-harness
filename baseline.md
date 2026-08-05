# Visual baselines

The visual divisions measure an LLM playing the fixed `japan-v5` scenario
without the harness's structured observation or game-specific action menu. The
model sees the stock OpenFront renderer at 1280×720 and may issue only primitive
mouse, keyboard, scroll, wait, and done commands.

- `visual-naive-v1` supplies only the goal and generic screenshot/primitive-input
  contract. It contains no OpenFront rules, controls, keybindings, or strategy.
- `visual-controls-v1` additionally supplies a neutral manual of public
  OpenFront rules and controls.

The evaluator, action schema, note memory, screenshots, scenario, timing, and
budgets are identical. The public manual is the only intended experimental
difference between the two visual divisions.

This is a baseline for the value of the complete structured interface. It is
not a harness-free executable: a thin evaluator is still required to reproduce
the scenario, stop simulated time during inference, enforce the action budget,
save evidence, and score the match. Evaluator-only state is never included in a
model request.

## Run it

Requirements are the same as the main harness, plus an installed Chromium or
Google Chrome. The configured OpenRouter model must accept image input and
strict JSON Schema output.

In one terminal, build and start the app:

```bash
npm run build
RATE_LIMIT_SALT=local-development npm start
```

In another terminal, launch one match in either visual division:

```bash
npm run baseline:run:naive
npm run baseline:run:controls
```

`npm run baseline:run` remains the backward-compatible controls-manual default.
`BASELINE_INTERFACE=visual-naive-v1` or `visual-controls-v1` selects a division
when invoking the runner directly; unknown values fail before a match starts.

The runner reads `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, and
`OPENROUTER_PROVIDER` from the project `.env`. Optional settings are:

- `BASELINE_INTERFACE`, defaulting to `visual-controls-v1`;
- `BASELINE_URL`, defaulting to `http://localhost:3000`;
- `BASELINE_DATA_DIR`, defaulting to `data/baseline`;
- `PLAYWRIGHT_EXECUTABLE_PATH`, for a non-default Chrome/Chromium binary.

Each run is stored under `data/baseline/<run-id>/`. `artifact.json.gz` contains
the selected interface and prompt version, exact interface-prompt SHA-256,
protocol, model/provider identity, decisions, accepted native intents, usage,
outcome, score-only state, and stock single-player replay. Schema-version-2
artifacts support both divisions; existing schema-version-1 controls artifacts
remain readable. The `screenshots/` directory contains the exact PNG supplied
for every model call, and every PNG has a SHA-256 digest in the artifact.

## Fixed protocol

| Setting              | Value                                                |
| -------------------- | ---------------------------------------------------- |
| Interface            | `visual-naive-v1` or `visual-controls-v1`            |
| Scenario             | `japan-v5`                                           |
| Renderer             | Stock pinned OpenFront client                        |
| Viewport             | 1280×720, device scale 1, English, dark color scheme |
| First decision       | Tick 3                                               |
| Decision interval    | 100 ticks                                            |
| Gameplay intents     | At most 2 per decision                               |
| Primitive commands   | At most 8 per decision                               |
| Screenshot readiness | 20,000-byte minimum PNG payload                      |
| Model validation     | One retry, matching the structured harness           |
| Reasoning effort     | `none`                                               |
| Model cost ceiling   | $1                                                   |
| Wall-clock ceiling   | 10 minutes                                           |

The evaluator submits the fixed Kanto spawn before model control. Between
decision boundaries it advances the ordinary local single-player simulation as
fast as the client worker can process it. At a boundary it gates `LocalServer`
turn creation without entering OpenFront's paused state; this is important
because the stock pause state rejects gameplay intents. Both accepted intents
therefore remain queued for the next turn, preserving the structured harness's
simultaneous two-slot timing.

The browser-side controller rejects a third gameplay intent and all gameplay
intents submitted outside a decision boundary. UI-only activity such as opening
a radial menu or moving the camera does not consume an intent. After elimination
or the 120th and final decision, the evaluator stops model calls, replays the
browser's exact stamped turn stream through the same pinned deterministic core,
then advances empty turns until OpenFront declares a winner. This matches the
main runner's lifecycle without making terminal-state collection depend on
display throughput. The inference wall-clock limit no longer applies once model
calls stop.

## What every visual model receives

Every request contains:

1. immutable instructions for the selected visual division;
2. at most three of the model's own recent public notes;
3. the current full-page PNG screenshot.

Each primitive command is a separate model request. The three short,
self-authored notes provide bounded continuity without exposing evaluator state.
The note count and 160-character per-note cap are identical in both divisions.

### Naive instructions

The `visual-naive-v1` instructions identify OpenFront, state the goal of winning
the four-player Japan match, explain the screenshot coordinate system and
available primitive command schema, disclose the evaluator's two-intent budget
and stopped-time behavior, and explain `done` and the public note. They do not
explain any game rule, mouse gesture, keybinding, UI element, build option,
diplomacy mechanic, or strategy. The model must infer or discover gameplay from
the stock screen and the visible consequences of its own inputs.

### Controls-manual instructions

The `visual-controls-v1` manual explains visible controls and static public
rules: the immediate 80% territory win, timer victory, left-click attacks,
radial/build menus, attack-percentage controls, camera controls, and relevant
default keybindings. It contains no target coordinates, legal-action list,
troop reserve calculation, opponent ratios, relationship summary, or strategy
recommendation.

The exact fixed texts are exported as `VISUAL_NAIVE_PROMPT` and
`VISUAL_CONTROLS_PROMPT`. The selected text's SHA-256 is stored in every new
artifact as `protocol.interfacePromptSha256`.

The model returns exactly one of:

- `move(x, y)`;
- `click(x, y, button)`;
- `drag(x, y, x2, y2)`;
- `scroll(x, y, deltaY)`;
- `keypress(key)`;
- `wait(milliseconds)`;
- `done`.

Each command also includes a public note of at most 160 characters. A fresh
screenshot is taken before every command, so opening a menu or changing the
camera produces visible feedback on the next call. The evaluator waits for the
stock WebGL renderer to produce a nontrivial PNG payload before sending it; this
prevents an asset-upload frame from becoming a blank model observation without
extracting or describing any pixels.

## Information boundary

Neither visual model ever receives:

- normalized game state or core objects;
- DOM, accessibility-tree, OCR, or canvas metadata;
- tile/world coordinates or coordinate conversion;
- legal actions, action IDs, or intent schemas;
- automatic correction of a misclick or bad strategy;
- action lifecycle, engine rejection, or evaluator score state.

The evaluator may inspect outgoing native intents only to enforce the two-intent
budget and record evidence. It samples player state every tick for scoring, but
that data is marked `scoreOnlySnapshot` and remains inside the browser controller
and final artifact.

## Comparison and reporting

Use the same requested model, provider, reasoning effort, engine image, and run
window. Randomize and interleave conditions to reduce provider drift. A model
that cannot consume the screenshot is ineligible; adding OCR would define
another interface division.

The three pinned comparisons answer different questions:

- `visual-controls-v1` minus `visual-naive-v1` estimates the value of supplying
  the public game manual.
- `agent-v12` minus `visual-controls-v1` estimates the lift from the full
  structured interface bundle after controlling for basic game knowledge.
- `agent-v12` minus `visual-naive-v1` estimates the end-to-end lift from the
  entire harness, including its game instructions. It must not be described as
  the causal effect of normalized observations alone.

Win rate is the primary metric. Also report placement, final territory, the
time-normalized territory area under the curve, survival/elimination tick,
terminal tick, accepted intents, primitive commands, model calls, tokens, cost,
and latency. Misclicks, no-op decisions, malformed commands after the one retry,
and cost-limit failures remain part of the baseline result. Only predetermined
infrastructure failures should be rerun.

Use at least 30 completed attempts per condition for a directional comparison
and publish a 95% Wilson interval for win rate. `agent-v12` supplies a filtered
action menu, safety policy, semantic feedback, and additional mechanics
guidance, so comparisons involving it measure a bundle whose scope depends on
the selected visual reference condition.
