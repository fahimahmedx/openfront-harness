# I Put an LLM Inside a Deterministic Strategy Game—and Made Every Move Replayable

I wanted an agent project that was more convincing than a chat box wrapped around an API. The result is an LLM harness for [OpenFront](https://openfront.io/), an open-source real-time strategy game: one model plays a fixed match on Japan against three built-in nations, and anyone can replay the entire game while inspecting what the model saw, chose, cost, and changed.

The interesting part was not getting a model to return a command. It was building a trustworthy boundary between a probabilistic service and a deterministic game.

## The constraint that shaped the project

I want this harness to become a benchmark with a leaderboard. That changes the engineering question from “can an LLM play?” to “can two runs be compared honestly?”

The current `japan-v2` scenario therefore fixes everything I can reasonably fix:

- OpenFront v0.32.9 at one exact commit;
- Japan at Normal size;
- Free For All with one LLM and three Medium nation players;
- game seed `JAPAN01A`;
- a Kanto spawn at tile `(1613, 1133)`;
- Hokkaido, Shikoku, and Kansai as opponents;
- one decision every 100 ticks;
- exactly two action slots;
- a 120-decision and 20-simulated-minute ceiling.

If one of those values changes, it is a new scenario—not a quiet configuration tweak.

## I used the game, not a simplified clone

The fastest route would have been to model OpenFront as a small grid and declare success when an LLM moved around it. That would have discarded the hard and useful parts: real attacks, boats, structures, diplomacy, built-in AI, timing, map geometry, victory logic, state hashes, and native replay.

Instead, the harness runs OpenFront's deterministic core directly in Node. The LLM occupies the normal human-player path. Its choices become ordinary OpenFront intents, and the existing client renderer plays the resulting `GameRecord`.

I kept this integration outside the game repository. `OpenFrontIO/` remains a clean checkout of the pinned tag. The harness imports the core from that read-only tree, owns its own server and UI, and builds the renderer externally. A small Vite transform adds the replay-tick event in memory and fails if its pinned source marker moves; it never patches the checkout on disk.

This cost more integration work, but it means the replay is evidence. It is not a video generated after the fact and it is not an animation driven by a second approximation of the rules.

## The model never writes raw game commands

Giving a model an intent schema and hoping it fills every field correctly is a fragile interface. It also lets the model propose actions that the current state cannot support.

At each decision point, the harness builds a deterministic menu of currently legal candidates. It covers explicit holds, neutral expansion, attacks at several troop levels, boats, retreats, structures, upgrades, and diplomacy. Every candidate has a stable ID, a human-readable label, and the exact native intent it will produce.

Version 2 also treats the two action slots as one resource decision. It first subtracts a capacity-based reserve from current troops, then divides the remaining surplus across both slots. Expansion preserves 15% of capacity; combat preserves 35%; emergency defense preserves 15%. Each troop candidate is 25%, 50%, 75%, or 100% of one slot's budget, so two choices cannot independently spend percentages of the same garrison.

The menu also encodes the strategic preconditions the raw v1 interface hid. Ordinary attacks appear only after recovery to 55% capacity, only when the LLM has more troops than the target, and only when a candidate can commit at least 20% of the defender's force. Hostile incoming troops take precedence: expansion and unrelated offense disappear, while counterattacks are capped by the safe slot budget and the recorded incoming force. The observation states troop capacity, absolute growth per second, incoming and outgoing troops, reserve mode and floor, safe spend per slot, and relative opponent strength instead of expecting the model to infer all of that from two raw integers.

The model sees a normalized observation plus that menu and must fill two named slots:

```json
{
  "strategy": "Expand early, then protect the coast.",
  "action1": "expand:neutral:100",
  "action2": "expand:neutral:100"
}
```

OpenRouter enforces a strict JSON Schema. Agent v4 introduced the current slot shape: the schema is generated from the current menu, with separate legal-ID enums for `action1` and `action2`. Troop candidates advertise `maxUses: 2` and may fill both slots because each exact commitment was calculated from one half of the shared safe budget. Other actions have `maxUses: 1`; repeating one deterministically turns the second use into a hold.

The `agent-v5` contract also makes the end condition explicit. The old `winPercent` name was dangerously easy to read as a probability; it was actually the territory threshold for immediate victory. The observation now calls it `instantVictoryTerritoryPercent`, reports current rank and the territory leader, and states that the living player with the most land wins when the timer expires. Agent v6 added troop-capacity saturation, reserve-safe listed budgets, and the distinction between neutral expansion and attacking an opponent without prescribing when the model must hold. The current `agent-v7` contract replaces the unsigned territory gap with explicit leader status and separate lead/deficit fields, and makes clear that holding at maximum capacity cannot rebuild reserves further.

These versions came from observed failures rather than speculative prompt tuning. In the agent-v5 DeepSeek replay `e5165ff3-d610-4705-acce-76b5e7102da8`, 118 of 122 action slots were holds; the model saturated its troops, stopped at 0.57% territory, and finished fourth while safe neutral expansion was still available. Agent v6 fixed that opening stall, and DeepSeek won replay `b379c919-17ed-453b-a7f4-008258e3b471`, but the trace exposed a second failure: it double-held for the final 66 decisions, remained at 99.99% troop capacity, and described a 0.942-point deficit while ranked second as “Leading by 0.94%.” It won only after rival nations reduced Hokkaido's lead. Those two traces motivated the saturation clarification and the split between unambiguous territory-lead and territory-deficit fields.

A malformed or invented action is retried once. The retry includes the rejected JSON and a specific validation error, instead of blindly sending the same request again. If it also fails, both slots become holds. Every failed attempt is recorded with a stable error code and any rejected IDs, while the raw rejected response is not persisted. Provider refusals and token-limit truncation have distinct diagnostics. Five consecutive complete failures stop the run.

This changed how I think about agents: the most important prompt is often the API you design around the prompt.

## Determinism has layers

The game is deterministic for a given start configuration and intent sequence. The hosted model is not deterministic in the same strong sense.

I record two different seeds because they solve different problems:

- the game seed controls the environment;
- the model seed asks the provider for more repeatable sampling.

The model route is also pinned to one provider with fallbacks disabled. That reduces hidden variance, but it does not freeze a hosted model's weights or infrastructure. A future benchmark cannot claim bit-for-bit model reproducibility from a seed alone. It needs to treat the submitted action trace as the reproducible object and replay that trace server-side against a content-addressed game build.

That distinction—deterministic environment versus deterministic policy—is probably the most important thing I learned.

## Replay became the observability system

A normal agent log tells me what a model requested. A game replay tells me what the system actually simulated.

Each artifact contains:

- the exact scenario, source commit, model, provider, prompt version, and seeds;
- every normalized observation and legal candidate menu;
- selected and applied action IDs;
- structured post-execution status for both actions—started, failed, completed, or destroyed—with lifecycle ticks and an entity ID when available;
- for `agent-v3` and newer runs, per-attempt validation codes and rejected IDs; older artifacts default this list to empty;
- fallback status, total latency, per-attempt client-observed TTFT, generation time, time per output token (TPOT), token usage, and reported cost;
- winner, placement, terminal tick, simulated time, and final state hash;
- a native OpenFront replay record.

During playback, a trace panel follows the replay tick. It shows the latest public strategy note, both actions and their actual lifecycle status, state summary, latency, tokens, and cost next to the real renderer.

Fresh runs stream structured model output to measure each attempt from the harness. The artifact records total attempt time, time to first received token, time from that token to stream completion, and TPOT as generation time divided by one fewer than the reported completion-token count. Provider queue time remains null because OpenRouter does not expose it separately; TTFT necessarily includes network transit, routing, queueing, and prompt processing. Legacy artifacts default the attempt-timing list to empty.

The replay record stores only turns with intents or periodic hashes, while retaining the original total turn count. That keeps the bundled artifact small without weakening the engine's normal reconstruction path.

I also added a no-network verification command. It feeds the bundled sample's recorded decisions back through the game and requires the final winner, terminal tick, and state hash to match. This is a much stronger fixture than “the JSON parsed successfully.”

## A real sample, including the failures

I deliberately bundled a real run rather than a hand-written golden path. The default model was `openai/gpt-5.6-luna` through OpenRouter's OpenAI route.

The sample produced:

| Metric                        |             Result |
| ----------------------------- | -----------------: |
| Model decisions while alive   |                106 |
| Prompt tokens                 |            180,599 |
| Completion tokens             |             20,095 |
| Reported inference cost       |        $0.31777925 |
| Decisions requiring a retry   |                 15 |
| Complete validation fallbacks |                  8 |
| Average model latency         |       3.35 seconds |
| Winner                        |          LLM Agent |
| LLM placement                 |                1st |
| Terminal tick                 |             10,561 |
| Simulated time                |      1,056 seconds |
| Final state hash              | `4090602815772241` |

The v2 LLM won. That is an encouraging regression result, but one match is anecdotal rather than proof that the policy is generally strong. The more important harness result is mechanical: across all 106 decisions, the combined troop commitments selected for the two slots never exceeded the observation's shared spendable budget. Ordinary land attacks passed the 55% readiness and troop-advantage gates, and bounded counterattacks never exceeded the recorded incoming force.

The run was not cosmetically cleaned up. Fifteen decisions needed the allowed retry and eight still fell back to two holds after both responses failed validation. The immutable sample predates the structured diagnostics, so it retains the older combined “unknown or duplicate action ID” message and does not contain the rejected raw response needed to classify Decision 2 retroactively. A later v3 audit showed why distinctness was the wrong rule: every duplicate selected the `100%` version of a troop action twice, exactly consuming the two safe slot budgets. The v4 contract makes that choice valid while retaining precise diagnostics for genuine provider failures. The sample still records its fallbacks and billable usage, then continues through the same deterministic game path. The original v1 sample also remains useful historical evidence: it finished fourth after repeatedly draining its garrison, which is what exposed the shared-resource defect fixed by v2.

I validated v4 with a fresh live run rather than relying only on unit tests. The model reused a troop action in 75 of 84 decisions—18 expansions, 55 land attacks or counters, and two boats. All 75 stayed within the shared spendable budget, none caused a duplicate validation failure or action fallback, and the LLM won at tick 8,321. One provider request timed out and succeeded on retry; that remained a genuine transport failure rather than an action-contract failure.

I then replayed the artifact without network access. The engine reproduced the LLM victory at tick 10,561 with final state hash `4090602815772241`. The suite passed all 36 tests, TypeScript checking passed, and the production client built successfully. A second offline replay of a timer-ended trace corrected the surviving LLM from the old hard-coded second place to third; its nine Defense Post attempts resolved as one completed, five destroyed, and three failed. Those checks establish that the v2 trajectories remain reproducible and the v5 observation, placement, and lifecycle boundary is enforced; they do not turn individual runs into a broad benchmark claim.

## Bugs that only appeared at the boundaries

Several of the best lessons came from integration failures.

### Strict provider routing exposed a parameter mismatch

My first live sample made no billable calls. Every request returned “no endpoints found.” The selected model supported structured output, reasoning, and a seed, so the request looked valid at a glance.

The live endpoint metadata showed the actual mismatch: the pinned OpenAI route advertised `max_tokens`, while I sent `max_completion_tokens`, which was available on the Azure route. Because `require_parameters` was enabled and fallback was disabled, OpenRouter correctly refused to route the request.

Strictness created an early failure instead of silently dropping a parameter or switching infrastructure. That was exactly the behavior a benchmark needs.

### Living players are not all players

The first completed artifact said the eliminated LLM finished first. The reason was subtle: OpenFront's `players()` method returns living players only. Sorting that list and looking for the dead human produced index `-1`, which my defensive `Math.max` turned into first place.

The first fix was to record each player's elimination tick from `allPlayers()` and derive eliminated placements from elimination order. The corrected v1 artifact reported the eliminated LLM in fourth place; the replacement v2 sample reports first because the core actually declared the LLM the winner.

A later timer-ended run exposed the other half of the bug: every living non-winner was hard-coded to second place, even when two surviving players owned more territory. Terminal placement now ranks all survivors by final land tiles before applying elimination order to dead players.

### Two legal actions could spend the same troops twice

The v1 menu described each attack as a percentage of “current troops,” but both slots were materialized from the same snapshot. A `75%` expansion followed by `25%` therefore committed the entire garrison; `75% + 50%` asked the core for 125%, and the second execution consumed whatever remained. The model repeated that pattern while calling a 1–2% capacity position a “large reserve.”

This was an interface defect, not just weak play. In v2, exact troop amounts come from a shared two-slot surplus above deterministic reserve floors. Ordinary attacks also require recovery to 55% capacity, a troop advantage over the target, and a meaningful commitment. Incoming attacks switch the menu to bounded counters rather than opening an unrestricted all-in exception.

### “Legal when proposed” is not “valid when executed”

The action menu is derived from one state snapshot, but OpenFront applies intents inside a changing simulation. During verification, a Defense Post and a Factory intent were legal candidates when proposed and were later rejected by the core as state changed.

Schema 2 now follows each applied action after submission. It records whether the core actually started it, rejected it, completed it, or destroyed the entity before completion, along with start/resolution ticks and an attack or unit ID where one exists. Long-running attacks and construction update the original decision record on later ticks, and the next observations include those results. Legacy schema-v1 artifacts remain readable but use `unknown` where their old “queued as a legal core intent” string cannot prove execution.

### Production HTML was not actually static

The local dashboard worked, and the production build succeeded, but a server smoke test showed literal EJS expressions in script URLs. OpenFront's Vite pipeline intentionally emits runtime placeholders so its normal server can apply a hashed asset manifest and optional CDN prefix.

Serving the built HTML with `sendFile` was therefore wrong. The harness server now renders both HTML entry points against the runtime asset manifest and caches the result. This is the kind of defect a type-check and unit test cannot find.

## Treating cost and abuse controls as product features

The deployed app can spend money, so operational limits are part of correctness.

Before a model request, the harness estimates a conservative worst-case price for both possible attempts. A run cannot begin the next decision if that reservation would cross $1. It also stops at ten wall-clock minutes, 120 live decisions, or five consecutive model failures.

Public Railway deployment allows one active match globally, five launches per UTC day, and one launch per source network per day. It stores an HMAC of the IP rather than the raw address. Run files and quota state use atomic writes on a Railway Volume.

Those limits are intentionally simple. They fit a portfolio deployment, not a horizontally scaled service. The design document says so explicitly.

## What I would build next

The harness is ready to demonstrate an inspectable agent run, but a credible leaderboard needs more:

1. Define a public scoring formula that separates outcome, placement, survival, cost, and latency.
2. Add several hidden, versioned seeds to reduce memorization.
3. Accept signed action traces and replay every submission server-side.
4. Pin a content-addressed engine/container for each season.
5. Split model/provider configurations into explicit divisions.
6. Add browser-level replay screenshots and visual regression tests.
7. Move jobs and artifacts to shared infrastructure before horizontal scaling.

I would not start by adding more models. The hard part is making one result interpretable and reproducible. Once that contract is solid, adding competitors is easy.

## The takeaway

An agent demo becomes substantially more credible when a viewer can answer four questions:

1. What did the model know?
2. What was it allowed to do?
3. What did the real system execute?
4. Can I replay and verify the result?

This project is my answer for a strategy game. The model is only one component. The harness—the constraints, legal-action boundary, artifacts, replay, verification, cost controls, and honest failure modes—is the actual product.

The complete trade-offs are documented in the [design decision log](/docs/decisions). The harness is published under compatible AGPL terms and preserves OpenFront's attribution and asset licensing notices; the OpenFront checkout itself remains untouched.
