# OpenFront LLM Harness — Design Decisions

Status: implemented for benchmark scenario `japan-v6`, prompt contract
`agent-v13`, and run schema 3. Each decision requires exactly one legal action
ID in `{ strategy, action }`; `hold` is the explicit no-op. A troop action may
use the full safe surplus above its reserve floor. Schema-v1/v2 two-action runs
remain available only through the read-only replay, trace, and download paths.

Sections describing agent-v1 through agent-v12 are retained as chronological
history of the former two-action harness. They do not define the current runner
or public benchmark contract. The current public `openfront-bench-v0.1` release
requires `actionsPerDecision: 1`, `single-action-v1`, and `agent-v13` and rejects
the former benchmark shape.

This document records every material decision made for the harness. A scenario-affecting change must create a new scenario ID instead of silently changing an existing benchmark, because future leaderboard results need to remain comparable.

## 1. Extend OpenFront instead of recreating the game

**Decision:** Keep the harness outside OpenFrontIO, treat its clean v0.32.9 checkout as a read-only source dependency, and execute the real deterministic core through imports.

**Pros:** Rules, nations, map geometry, timing, hashes, intent schemas, and rendering stay faithful to the actual game; upstream replay code can be reused; the game repository remains reviewably pristine; harness ownership and upgrade boundaries are explicit.

**Cons:** The harness inherits a large dependency graph, client bundle, licenses, and internal APIs; external imports couple it to OpenFront's directory layout; upgrades require drift testing; two dependency installations are needed in Docker.

## 2. Pin the upstream source

**Decision:** Pin tag `v0.32.9` and commit `dcc18d5231af6253b0e991bf04a4c764982fe262` in configuration and artifacts.

**Pros:** A replay identifies the exact ruleset that generated it; state hashes remain meaningful; benchmark results do not silently mix engine versions.

**Cons:** Upstream fixes and features do not arrive automatically; supporting a new version requires a new benchmark scenario and migration work.

## 3. One immutable Japan scenario

**Decision:** Expose only Japan at Normal size under current scenario ID
`japan-v6`. The game preset and seed remain unchanged; v6 replaces the former
two-action contract with exactly one action per decision.

**Pros:** A narrow surface is easier to validate and explain; every run is directly comparable; Railway images can omit all other map binaries.

**Cons:** It measures performance on one geography; strategies may overfit Japan; it does not test cross-map generalization.

## 4. Free-for-all with one LLM and three nations

**Decision:** Use Singleplayer Free For All with exactly one human-type LLM player, three built-in `Nation` players, zero `Bot`/tribe players, and Medium difficulty.

**Pros:** Satisfies the intended four-player match; nation AI uses map-aware identities and behavior; medium difficulty is understandable and stable; the LLM goes through the same human intent path as a player.

**Cons:** Nation AI differs from ordinary tribe bots; one opponent configuration is a limited benchmark; built-in AI changes require a new engine pin.

## 5. Fixed game seed and asserted nation identities

**Decision:** Use game ID/seed `JAPAN01A` and fail initialization unless the generated nations are Hokkaido, Shikoku, and Kansai.

**Pros:** Spawn allocation and built-in behavior are reproducible; a future code or asset drift becomes an explicit failure; results share the same opponent lineup.

**Cons:** One seed can reward memorization; an internal RNG change breaks the scenario; broader statistical claims need additional versioned seeds later.

## 6. Fixed Kanto spawn

**Decision:** Spawn the LLM at map tile `(1613, 1133)`, labeled Kanto, and validate that it is land before starting.

**Pros:** Removes spawn luck; makes openings comparable; gives replay viewers a clear point of reference.

**Cons:** Encourages spawn-specific policies; the coordinate is coupled to the pinned Japan map; it does not measure spawn robustness.

## 7. Fixed simulation cadence

**Decision:** Ask for a decision every 100 core ticks, equivalent to 10 simulated seconds.

**Pros:** Reduces API traffic; gives actions time to affect state; creates a simple tick-to-decision mapping for traces and future scoring.

**Cons:** The agent cannot react inside the interval; important attacks may develop between decisions; another cadence would produce a different task.

## 8. Exactly one action slot

**Decision:** Agent v13 requires exactly one action ID per decision. The model
still receives a deterministic menu of individually legal actions and may
choose `hold`, but the harness no longer asks it to compose two actions that
must also be valid together.

**Why:** The DeepSeek V4 Flash evaluation repeatedly exposed cross-slot action
conflicts. The model could select two actions that were each legal in isolation
but invalid as a pair because they competed for the same resources, repeated a
non-repeatable operation, mixed incompatible diplomatic postures, or launched
proactive attacks against different opponents. The validator kept invalid
commands out of the game, but the frequency of these errors showed that the
two-slot interface was making the model solve a harness-specific constraint
problem in addition to choosing a strategy.

Keeping two slots would require one of two unsatisfactory designs:

- The harness could generate only valid paired actions and ask the model to
  choose one pair. With `n` individually legal actions, however, the candidate
  space can grow on the order of `n²`. Even after filtering invalid pairs, this
  substantially enlarges the prompt and structured-output enum, duplicates the
  same action across many entries, and makes the interface harder for both the
  model and a human reviewing the trace.
- The resolver could preserve the first action and replace a conflicting second
  action with a hold. That silently rewrites the model's decision, gives the
  first slot arbitrary priority, and may execute only half of a strategy whose
  actions were intended to work together. Although safe, it does not feel like
  a faithful or correct interpretation of the model's output.

Rejecting a conflicting pair and retrying was more faithful than silently
rewriting it, but it still spent latency, tokens, and retry budget on a failure
mode created by the harness interface itself. Requiring one action removes the
pairwise-conflict class structurally, keeps the candidate space linear, and
makes the selected action correspond exactly to the action executed.

**Pros:** The response contract and trace are simpler; every offered action is
independently executable; safe troop surplus no longer has to be divided across
slots; no slot has implicit priority; and the harness does not need pairwise
conflict, repeatability, or gold-slot rules.

**Cons:** The agent has less action bandwidth at each 100-tick decision gate and
cannot intentionally combine two compatible commands on the same tick. This is
accepted in exchange for a smaller and more faithful decision boundary.

## 8.1 Historical: exactly two action slots (agent-v4 through agent-v12)

**Decision:** Require exactly two named action slots, `action1` and `action2`. Both execute together on the next core tick; neither slot is sequential or conditional on the other. Each slot has its own legal-ID enum and its own hold. Expansion, attack, and boat candidates may be selected in both slots because their troop amount is already bounded to one slot's half of the shared safe budget. Repeated retreat, diplomacy, or hold actions are normalized deterministically to the appropriate slot hold. Build and upgrade actions are legal only in `action1`; `action2` cannot contain a gold-spending action.

Agent v8 classifies same-opponent actions by posture. Alliance requests and extensions are cooperative; attacks, naval invasions, embargo starts, and alliance breaks are hostile. A pair that mixes cooperative and hostile postures toward the same opponent is invalid even when each ID is individually legal. Local response validation rejects the whole pair and uses the existing corrective retry. As defense in depth, action resolution converts a conflicting pair that somehow bypasses response validation into two holds, so it cannot partially execute the hostile half. Different non-proactive postures toward different opponents remain legal.

**Why:** GPT-5.6 run `46e5e62e-a646-48e1-8cd1-087b010cece8` (archived at `data/previous/runs/46e5e62e-a646-48e1-8cd1-087b010cece8.json.gz`) selected an alliance request and an embargo against Kansai in one decision while describing the embargo as conditional on rejection. The core correctly executed both intents on the same tick: the alliance was rejected and the embargo started. This exposed a harness ambiguity rather than a core failure—the prompt did not state simultaneous execution, and slot-local enums could not express pairwise incompatibility. The run subsequently faced all three nations and was eliminated. Agent v8 makes the execution model explicit and enforces the missing cross-slot invariant.

Agent v9 makes the resource invariant structural instead of predicting pairs of dynamic prices. The strict response schema includes build and upgrade IDs in the `action1` enum and excludes them from the `action2` enum. The prompt's candidate view reports each action's allowed slots and explicitly limits the model to one gold-spending action per decision. Local slot validation rejects and retries a response that puts a build or upgrade in `action2`. As defense in depth, action resolution converts such an action to `hold:2` if an invalid response somehow bypasses schema and local validation.

Agent v12 adds the one-front proactive-offense invariant. Two land or naval attacks against different opponents are an invalid pair and receive a corrective retry; two counters against different opponents that are already attacking remain legal. Runtime resolution applies the same rule and converts an invalid pair that bypasses model validation into two holds. This narrows only simultaneous proactive target selection: it does not prevent a second opponent from attacking the LLM or prohibit defensive responses on two active fronts.

**Why the single gold-spending slot:** GPT-5.6 Luna run `aa349af6-5b78-482d-8175-858833b2ff95` (archived at `data/previous/gpt-5.6-luna/aa349af6-5b78-482d-8175-858833b2ff95.json.gz`) had 145,100 gold at decision 42 and selected a 125,000-gold Factory followed by a Port. Candidate generation had validated each choice independently against the same pre-action balance. The Factory executed first and left 20,100 gold; because Factory and Port share an escalating price pool, the Port then cost 250,000. The core correctly rejected it, and lifecycle tracking reported that no start or state change was observable. This was a harness defect: two individually legal menu entries did not form a jointly executable pair. Restricting gold-spending actions to one slot prevents the invalid pair from being generated under strict structured output and avoids duplicating or simulating OpenFront's dynamic pricing rules. The archived winning run remains replayable but is excluded from current `japan-v5` benchmark results.

**Why diplomacy and one-front offense:** Two otherwise comparable `agent-v10` Luna runs diverged at the same decision-14 state. Winning run `7e321604-9615-45b8-b777-58adb0331ffd` paired its City with an accepted Kansai alliance, kept that front peaceful, and won; losing run `e47a87ae-61af-4641-9fc5-090c06b1e7ff` paired the City with a hold, remained unallied, and finished third. The observation exposed `relation` only as an unexplained number, did not preserve compact alliance-request history, and the prompt did not explain that diplomacy could use the otherwise idle second slot. Agent v11 replaces the numeric relation with `hostile`, `distrustful`, `neutral`, or `friendly`, reports the early-alliance window, request availability and history, and hostile-front counts, and explains that early neutral alliances can prevent a multi-front war. Agent v12 then makes the most dangerous proactive pair structurally invalid instead of relying only on strategy text.

**Agent-v12 live validation:** Two sequential, unseeded GPT-5.6 Luna runs used the pinned OpenAI provider, reasoning disabled, and strict structured output. [Replay `8463f549-e335-4114-b39f-a6c87755bd9f`](/replay/8463f549-e335-4114-b39f-a6c87755bd9f) won first place at tick 7,481 after 75 decisions; its final observation led with 74.094% territory. [Replay `5c3016b7-10bf-4583-af24-b27b8de4e378`](/replay/5c3016b7-10bf-4583-af24-b27b8de4e378) won first place at tick 8,051 after 81 decisions; its final observation led with 70.755%. Both requested alliances immediately, received an accepted Kansai alliance at decision 1, and never selected proactive attacks against more than one opponent in a decision. Across all 156 decisions, every response succeeded on its first attempt: there were no 429s, provider failures, schema or local-validation failures, fallbacks, or multi-front retries. The lack of a live retry means these runs demonstrate model compliance rather than exercise rejection; focused tests cover proactive multi-target rejection, runtime fallback, and legal two-attacker counters.

The runs cost $0.025617 and $0.029966. Every LLM-selected construction completed. The second run and its deterministic replay emitted one core `cannot build Defense Post` warning from a built-in nation's structure policy: the nation queued a legal front-line tile, combat changed that state before `ConstructionExecution` rechecked it on the next tick, and the placement was rejected. All six of Luna's construction or upgrade actions completed and its artifact contains no lifecycle failure code, so this was not a model, schema, provider, or selected-action failure. Isolated deterministic replay reproduced each winner, placement, terminal tick, and final hash (`3709556552269718` and `2358106522307384`). The artifacts are stored at `data/gpt-5.6-luna/8463f549-e335-4114-b39f-a6c87755bd9f.json.gz` and `data/gpt-5.6-luna/5c3016b7-10bf-4583-af24-b27b8de4e378.json.gz`.

**Pros:** Every model gets the same action bandwidth; choosing the strongest safe troop action in both slots is valid rather than a model error; slot-specific enums prevent the wrong hold ID and prevent two build/upgrade selections by construction; repeated non-repeatable and contradictory same-target side effects cannot reach the core; no shadow state or duplicated pricing logic is required; the trace clearly distinguishes an intentional hold from missing output.

**Cons:** Some states need one or three useful actions; two same-target troop intents may be strategically redundant even though they are budget-safe; the model cannot make two build or upgrade purchases in one decision even when both would be affordable; a gold action must occupy `action1`; the conflict taxonomy is harness-owned and must evolve with new intent types; the artificial slot count is not a native UI constraint.

## 9. Server-generated legal action menu with shared troop reserves

**Decision:** Deterministically enumerate at most 64 legal candidates from current state, including expansion, attacks, boats, retreats, construction, upgrades, diplomacy, and holds. Troop actions split one safe surplus across both slots. The reserve floor is a percentage of current troop capacity: 15% during expansion, 35% during combat, and 15% during an emergency. Spendable troops are `max(0, current troops - reserve floor)` and each of the two slots receives at most half of that snapshot surplus. The menu offers 25%, 50%, 75%, and 100% variants of the per-slot budget rather than percentages of the whole garrison.

Incoming hostile troops take precedence and switch the policy to emergency mode. Neutral expansion and ordinary offense are suppressed; only attackers receive counterattack candidates. A counter is bounded by the safe per-slot budget, that attacker's incoming force, and half of all hostile incoming troops. Outside an emergency, ordinary attacks unlock only at 55% troop capacity, require the attacker to have more troops than the target, and omit commitments smaller than 20% of the defender's troops.

**Pros:** Prevents arbitrary commands and schema hallucinations; keeps prompts bounded; IDs are auditable and map directly to native intents; candidate ordering is reproducible; two individually legal choices cannot spend the same troops twice or drain the garrison.

**Cons:** The menu is an opinionated abstraction and deliberately withholds risky all-in or understrength attacks; legality can change between enumeration and core execution; maintaining coverage requires understanding new game mechanics.

## 10. Normalized observations, not hidden core objects

**Decision:** Send a compact JSON observation containing public self/opponent state, attacks, semantic relations, units, time, map totals, and the last three decisions. Version 2 explicitly includes troop-capacity percentage, absolute troop growth per second, total incoming and outgoing troops, the active policy mode, reserve floor and percentage, spendable troops, per-action budget, and each opponent's troops relative to the LLM. Agent v5 renames the ambiguous `winPercent` field to `instantVictoryTerritoryPercent`, adds the LLM's current territory rank, the territory leader, the percentage-point gap to that leader, and the explicit rule that the living player with the most land tiles wins when the timer expires. Agent v11 adds semantic relation names, the early-alliance window, persistent per-opponent alliance-request history, and hostile-opponent/front counts. Recent decisions include structured action lifecycle outcomes rather than implying that submission equals execution.

**Why the rename:** `winPercent` sounded like a prediction of the player's chance of winning, but its value was actually the fixed territory threshold for an immediate victory. That ambiguity caused a real policy error: in the GLM evaluation, the model repeatedly interpreted `winPercent: 80` as an 80% win probability and used it to justify holding, even though it controlled far less than 80% of the map and was behind on territory. `instantVictoryTerritoryPercent` names both what is measured and when the rule applies. It also distinguishes the threshold-based instant-victory condition from the separate timer-victory rule, where the surviving territory leader wins without reaching that threshold. Because this is a semantic clarification to the model-facing contract, it is versioned as `agent-v5`; schema-v1 artifacts are normalized to the new name only for replay compatibility.

**Agent v6 troop semantics:** The earlier prompt prescribed “Hold while rebuilding” and warned about low-count growth without explaining that troop growth also approaches zero near full capacity. In the agent-v5 DeepSeek run `e5165ff3-d610-4705-acce-76b5e7102da8`, the model used 118 of 122 action slots to hold. Its territory stopped at 2,730 tiles (0.57%) from decision 4 onward, even though neutral expansion remained legal through decision 22 and its troop capacity eventually reached 99.96%. It finished fourth after waiting until opponents enclosed and eliminated it. Agent v6 removes the prescriptive hold language and instead defines capacity saturation, explains that listed troop amounts already preserve the reserve floor, and distinguishes neutral expansion from attacks on opponents. The contract supplies mechanics rather than choosing a strategy for the model.

**Agent v7 standings and saturation semantics:** The first agent-v6 DeepSeek win, `b379c919-17ed-453b-a7f4-008258e3b471`, confirmed that the opening fix worked: DeepSeek expanded aggressively and reached first place. It then selected 66 consecutive double-holds from decisions 54 through 119, reached 99.99% troop capacity with 1.84 million safely spendable troops, and left legal attacks and construction unused. More seriously, it was ranked second behind Hokkaido during decisions 85–91 but interpreted the positive unsigned `territoryGapToLeader` deficit as its own lead. At the largest 0.942-point deficit it wrote “Leading by 0.94%” and held both slots. It recovered and won only after the other nations attacked Hokkaido, so the result did not validate the policy. Agent v7 replaces the ambiguous field with `isTerritoryLeader`, `territoryLeadPercent`, and `territoryDeficitPercent`; the lead and deficit fields are mutually exclusive by construction. It also states the mechanical consequence of saturation directly: holding at maximum capacity cannot rebuild or increase reserves further. Legacy observations derive the new fields from their recorded rank and unsigned gap during artifact parsing.

**Pros:** The model sees structured, stable data; prompts stay inspectable; engine implementation details and cyclic objects do not leak; artifacts can be analyzed without running the game.

**Cons:** Information omitted by normalization is unavailable to the policy; large-scale spatial geometry is summarized rather than rendered; rank and leader fields duplicate values a sufficiently careful model could calculate; changing observation fields changes the prompt contract and requires a new version.

## 11. Public strategy note instead of chain of thought

**Decision:** Ask for a concise strategy string of at most 160 characters and action IDs. Do not request or store private reasoning.

**Pros:** Gives viewers an understandable annotation without relying on hidden reasoning; bounds output and artifact size; avoids presenting a strategy note as privileged internal cognition.

**Cons:** The note may be post-hoc or shallow; it cannot fully explain complex choices; it provides less debugging information than a long rationale.

## 12. Structured output plus local validation

**Decision:** Use OpenRouter JSON Schema output in strict mode. Build separate `action1` and `action2` enum properties from the current candidate menu, excluding the other slot's hold from each property and excluding all build and upgrade IDs from `action2`. Parse independently with Zod, verify membership for each slot locally, and reject incompatible cross-slot action pairs before execution. Include `maxUses` and `allowedSlots` in the candidate view so repeatability and slot eligibility are explicit. Agent v4 introduced the slot-based request shape, replacing v3's array-level distinctness rule. Agent v5 retained that shape and added explicit timer-victory guidance plus the renamed observation fields and post-execution feedback. Agent v8 states that slots execute simultaneously and adds same-target posture validation that dynamic per-property enums cannot express. Agent v9 limits gold-spending actions to `action1`, preventing build/build, build/upgrade, and upgrade/upgrade pairs at generation time. Agent v12 adds pairwise rejection for proactive attacks against different opponents while preserving multi-attacker counters.

**Pros:** The provider prevents invented and wrong-slot IDs during generation; property names encode slot identity without unsupported JSON Schema keywords; local validation enforces cross-slot invariants and remains defense in depth; application types and API schema agree; failure behavior is measurable.

**Cons:** Strict structured output and dynamic enums narrow compatible endpoints; schema requests add tokens and provider coupling; repeatability remains a harness-owned semantic rule; local validation and retry logic remain necessary because the provider boundary is untrusted; v4 and v5 results must not be treated as the same prompt division.

## 13. Default model and pinned provider route

**Decision:** Default to `openai/gpt-5.6-luna`, provider tag `openai`, disable provider fallback, require all requested parameters, and deny data-collecting routes. Both remain environment-configurable for private experiments.

**Pros:** Provider changes do not contaminate a run; supported-parameter enforcement fails loudly; recorded model/provider metadata is meaningful; the default is fast enough for interactive generation.

**Cons:** Availability is lower than multi-provider routing; a provider parameter change can stop all runs; model behavior may still change behind a stable slug; alternative model results are not leaderboard-comparable without a new benchmark division.

## 14. Fixed game seed and unseeded model generation

**Decision:** Keep game seed `JAPAN01A`, but do not send a model seed. Historical artifacts may retain their recorded model seed for compatibility; new artifacts omit it.

**Pros:** Measures the model/provider's natural sampling behavior; supports endpoints that do not implement model seeds; avoids presenting a best-effort hosted parameter as a reproducibility guarantee. Exact replay remains deterministic from the recorded action trace.

**Cons:** Repeated generations can produce different decisions and outcomes; controlled prompt comparisons have more sampling variance; meaningful model comparisons require multiple runs and distributional reporting.

## 15. Retry once, then hold

**Decision:** Retry one failed/invalid model request. For a validation failure, include the rejected response and its specific error in the retry conversation so the second attempt can correct itself; do not persist the raw rejected response. Record every failed attempt with its attempt number, stable failure code, message, and any rejected action IDs. Record provider refusals and token-limit truncation separately, and allow 512 completion tokens to reduce reasoning-only or truncated responses. Preserve the legacy duplicate failure code for old artifacts even though repeated troop selections are valid in v4. If both attempts fail, apply two holds. Abort after five consecutive complete decision failures. Count usage from invalid billable responses as well as successful responses.

**Pros:** A transient or malformed response does not immediately destroy a match; corrective context makes the retry materially different from the failed request; structured diagnostics make replay failures auditable; deterministic holds preserve replay validity; consecutive-failure aborts prevent a dead integration from consuming the full runtime; accounting remains honest.

**Cons:** A retry increases latency, prompt size, and cost; echoing rejected output back to the same provider slightly enlarges the request; holding can materially change the outcome; HTTP failures without usage data cannot be priced locally.

### 15a. Measure streamed provider timing

**Decision:** Stream structured responses and record client-observed timing for every attempt: total request time, time to first received model token, generation time from that token through successful stream completion, and time per output token (TPOT). Compute TPOT as generation time divided by `completionTokens - 1`, leaving it null for incomplete streams or fewer than two reported completion tokens. Keep provider queue time nullable rather than deriving a misleading estimate; OpenRouter does not expose that phase separately. Preserve the existing decision latency as the complete duration across retries and local validation.

**Pros:** Normal requests, slow first-token responses, slow generation, and retry timeouts become distinguishable in replay artifacts without an additional provider-metadata request.

**Cons:** Streaming adds SSE parsing and mid-stream error handling. TTFT still combines client network transit, gateway routing, provider queueing, and prompt processing, so it cannot identify true provider queue duration by itself. TPOT is an average based on provider-reported completion tokens, not a distribution of individual token arrival intervals, and may include hidden reasoning tokens.

## 16. Stop inference after elimination

**Decision:** Once the LLM is eliminated, stop calling the model and fast-forward empty deterministic turns until OpenFront declares a winner or the scenario limit is reached.

**Pros:** Avoids paying for meaningless hold decisions; still produces a complete match replay and final placement; preserves the same simulation because an eliminated player has no legal effects.

**Cons:** Decision counts differ according to survival time; post-elimination trace panels stop updating; policies are partly rewarded for merely staying alive if decision count is used naively.

## 17. Bounded run lifecycle

**Decision:** Cap inference at 120 decisions while alive, simulation at 20 minutes, wall time at 10 minutes, and recorded model cost at $1. Before each decision, reserve a conservative worst case for both allowed attempts.

**Pros:** A public run has predictable financial and operational risk; stuck matches terminate; conservative preflight avoids crossing the cap through a retry.

**Cons:** A match can end without a winner and be marked failed; conservative byte-based token estimation may stop early; OpenRouter-reported cost is authoritative only after a response.

## 18. Winner required for a completed benchmark run

**Decision:** Mark a run completed only when the core declares a winner and no fatal error occurred. Cost, wall-clock, initialization, and core failures produce failed artifacts rather than partial successes.

**Pros:** Completed results share a clear terminal condition; failed runs remain diagnosable; dashboards do not imply that a timeout is a valid finish.

**Cons:** Useful partial trajectories are excluded from leaderboard-style results; some long strategic games may fail at the cap.

## 19. Placement from territory and elimination order

**Decision:** Track the first tick at which each player becomes non-alive. Rank every player still alive at termination by final land tiles, using deterministic player order for exact ties; rank eliminated players after all survivors by elimination order.

**Pros:** Works even though OpenFront's `players()` method returns only living players; avoids ranking all eliminated zero-tile players incorrectly; no longer labels every surviving non-winner as second place; matches the timer's territory-based winner rule.

**Cons:** Simultaneous elimination and exact territory ties require deterministic conventions; placement is harness-derived rather than a native OpenFront field.

### 19a. Post-execution action lifecycle outcomes

**Decision:** For every applied action, track core state and game updates from submission onward and record a structured status: `started`, `failed`, `completed`, or `destroyed`. Include the actual start tick, resolution tick, associated attack/unit ID when available, and a human-readable detail. Holds complete immediately; rejected actions fail when no observable core start or state change occurs; construction and retreats remain started while active; completed or destroyed entities update their original decision record on later ticks. Feed the latest structured outcomes back in `recentDecisions`. Schema-v1 artifacts remain readable and receive `unknown` only where their old string annotation cannot establish an execution result.

**Agent v10 stale-build handling:** Construction candidates remain legal-at-observation attempts because existing combat can invalidate a tile before OpenFront runs the queued construction. Rank otherwise legal anchors by their minimum distance from hostile borders, considering both the requested anchor and the spawn tile resolved by the core. Do not change OpenFront execution order or guarantee future validity. If no unit appears on the first tick where construction could have executed, record one of `anchor_lost`, `insufficient_gold`, `placement_blocked`, `player_eliminated`, or `runtime_rejected` and show the code in the replay trace. This distinguishes simulation-time state changes from model, schema, and provider failures.

**Pros:** Submission is no longer misrepresented as success; models can react to failed construction or still-active actions; the replay panel exposes the same lifecycle evidence as the artifact; long-lived effects remain connected to the decision that created them.

**Cons:** OpenFront does not expose one uniform execution receipt for every intent, so lifecycle classification combines update events with observable state transitions; safer anchors reduce but cannot eliminate stale construction because combat still advances before the queued build; repeated troop actions can legitimately point to the same merged attack; an action still active when the match ends remains `started`.

## 20. Native intent replay with sparse turn storage

**Decision:** Build a native OpenFront `GameRecord`, store every intent-bearing turn and each periodic hashed turn, and keep the original total turn count. Replay through the existing client renderer.

**Pros:** Visual output uses the real game; sparse storage keeps a sample small; periodic hashes detect divergence; no video encoding or browser automation is required.

**Cons:** Replays require the compatible client code and map assets; sparse records are not self-rendering; renderer bundle size remains large.

## 21. Decision trace synchronized to replay ticks

**Decision:** During the external Vite build, transform `ClientGameRunner.ts` in memory to emit a browser event after each replay update. Display the latest decision whose tick is not greater than that event's tick in a harness-owned shadow-DOM panel. Never write the transformed source back to OpenFrontIO.

**Pros:** Viewers can connect visible game state to model action, cost, and observation; shadow DOM limits CSS collisions with the upstream UI; the panel can be hidden without affecting playback.

**Cons:** The adapter depends on a pinned source marker and intentionally fails the build if upstream moves it; mobile screen space is constrained; the trace reflects the observation at decision time, not every intermediate tick.

## 22. Dashboard before replay

**Decision:** Use a dedicated portfolio landing page for the immutable preset, quota, active progress, run cards, sample, artifacts, and architecture; keep the existing renderer for playback.

**Pros:** The project is understandable before launching a game; operational limits are visible; presentation code stays separate from simulation code; upstream rendering work is reused.

**Cons:** Two HTML entry points complicate production rendering and build configuration; visual styles differ between dashboard and game.

## 23. Bundle a real-model v2 sample

**Decision:** Ship one gzipped `japan-v2` sample generated by the default live model. Provide a no-network verifier that replays its recorded actions and requires winner, terminal tick, and final hash to match. Continue accepting legacy schema-v1 and `japan-v1`/`agent-v1` artifacts for replay. Keep the immutable bundled winning sample identified as `agent-v2`; new live runs use `japan-v5` and `agent-v12`, and replacing the sample requires a new real model run rather than rewriting its recorded decisions.

**Pros:** Recruiters can inspect the result without a key or waiting; deployment remains useful when generation is disabled; the verifier turns the sample into a reproducibility fixture.

**Cons:** The sample adds repository data and will age; one match is anecdotal; its model cost and latency reflect one provider run, not a performance guarantee.

## 24. Versioned, transparent artifacts

**Decision:** Store schema-versioned JSON containing full normalized observations, candidate menus, decisions, per-attempt validation diagnostics, post-execution action lifecycles, metrics, outcome, and replay, compressed with gzip. Schema 2 introduces the renamed timer-aware observation and structured action outcomes. Diagnostic entries contain stable codes and rejected action IDs but not raw model responses. Normalize schema-v1 observations and missing diagnostic/lifecycle fields when parsing older artifacts.

**Pros:** Data is portable, auditable, and easy to analyze; replay and agent trace cannot become detached; request failures and core execution outcomes are distinct; old artifacts remain viewable; gzip reduces the bundled sample substantially.

**Cons:** Full observations duplicate state and can grow; rejected IDs expose a small part of invalid output; JSON is less query-efficient than a database; schema evolution needs explicit migrations.

## 25. Atomic filesystem persistence on a Railway Volume

**Decision:** Write gzip artifacts and quota state to `RUN_DATA_DIR`, use temporary-file-plus-rename atomic writes, checkpoint pending progress, and mount Railway storage at `/data`.

**Pros:** Simple deployment with no external database; writes are resilient to partial files; artifacts survive restarts when a volume is attached; local development uses the same storage abstraction.

**Cons:** A single volume limits horizontal scaling; listing files is less capable than indexed storage; backup and retention are operator responsibilities; a deployment without a volume loses generated runs.

## 26. Conservative public abuse controls

**Decision:** Permit one active run globally, five launches per UTC day, and one launch per source IP per UTC day. Persist only an HMAC of the IP using required production `RATE_LIMIT_SALT`.

**Pros:** Bounds spend and CPU use; avoids storing raw IP addresses; global serialization prevents volume races and resource contention; limits are visible in the UI.

**Cons:** Shared networks allow only one run; filesystem counters are single-instance; determined attackers can rotate IPs; quotas are not user-authenticated.

## 27. Background generation with polling

**Decision:** `POST /api/runs` returns `202` immediately, runs the match in-process, checkpoints progress, and lets the dashboard poll once per second.

**Pros:** Avoids a long HTTP request; implementation is small; users see tick, decision, strategy, and spend progress.

**Cons:** A process restart interrupts the in-memory job; polling is less efficient than server-sent events; a production job queue would scale better.

## 28. Same-origin, read-mostly HTTP API

**Decision:** Serve dashboard, artifacts, replay shell, and API from one Express process. Limit JSON bodies to 16 KB and set basic browser hardening headers.

**Pros:** Railway deployment and CORS are simple; replay fetches are same-origin; the attack surface is small.

**Cons:** Simulation, storage, and web traffic share one process; there is no authenticated administration API; stronger CSP and reverse-proxy controls would be needed for a larger service.

## 29. Runtime rendering of Vite's HTML templates

**Decision:** Render the external production `replay.html` and `harness.html` shells with EJS before sending them, resolving OpenFront's runtime asset manifest and optional CDN prefix.

**Pros:** Hashed assets, favicon, map resources, and optional CDN work with the upstream build pipeline; replay and dashboard share one production image.

**Cons:** Serving the built HTML as a static file is insufficient; template/render behavior is coupled to upstream Vite conventions; the server must cache and safely populate all template values.

## 30. Multi-stage Docker deployment

**Decision:** Build the external Vite client in one Node 24 stage, install harness and untouched OpenFront dependencies in separate layers, and run the TypeScript harness server with `tsx` in the final image. Docker context includes only the Japan map.

**Pros:** Railway deploys from one self-contained definition; build dependencies do not all enter the runtime dependency layer; excluding maps reduces context and image size.

**Cons:** Source TypeScript and `tsx` remain in the runtime image; native dependency installation can make builds slower; Node/version changes require explicit testing.

## 31. Focused tests plus a full deterministic probe

**Decision:** Unit-test scenario invariants, action resolution, rate limits, and bundled artifact schema; type-check and production-build; separately replay the sample through the full core and compare winner/tick/hash.

**Pros:** Fast tests cover boundary logic while the integration verifier covers the most important end-to-end property; failures are easier to localize.

**Cons:** There is no automated browser screenshot test; live OpenRouter behavior is not in CI; the full upstream suite is broader and slower than the harness-focused gate.

**Current acceptance evidence:** The live v2 sample (`fadf8cc4-40e0-4c81-91d3-6da5b507c636`) won in first place after 106 model decisions at tick 10,561. It used 180,599 prompt tokens and 20,095 completion tokens, cost $0.31777925, retried 15 decisions, and fell back to two holds eight times. An artifact audit found no decision where combined troop commitments exceeded `spendableTroops`, no ordinary land attack below the readiness/troop-advantage gates, and no counterattack total above the recorded incoming force. The no-network verifier reproduced winner, placement, terminal tick, and final hash `4090602815772241`; all 36 focused tests, TypeScript checking, and the production build passed. A second no-network replay of a timer-ended trace corrected the surviving LLM from the old hard-coded second place to third and classified all nine Defense Post attempts as one completed, five destroyed, and three failed. This validates the implemented boundary and these recorded trajectories, not general strategic competence from individual runs.

**Agent-v5 GLM comparison:** A fresh `z-ai/glm-5.2` run through the same pinned CoreWeave route (`d64701f9-0804-4ac9-af30-29c21c8d5d48`) won first place on the timer with 59.827% territory at its final observation. The earlier agent-v4 run (`fa907146-94dc-426b-b49b-a8ea6c641f19`) finished with 18.486% territory and was third under the corrected placement rule, although its schema-v1 artifact had incorrectly reported second. The new run was ranked first for 109 of 120 decisions, versus 78 previously. Its public strategy used rank explicitly in 116 decisions, referred correctly to timer victory in 42, and never repeated the earlier ambiguous “80% win” phrasing, which appeared in 45 agent-v4 decisions; it instead described 80% as the instant-victory threshold. At the final decision, agent v4 held while ranked third because it incorrectly expected the clock to secure victory, whereas agent v5 held while ranked first with a 26-percentage-point lead because the explicit timer rule correctly favored it. The improvement appeared before the holding endgame: at decision 80, agent v5 led with 51.0% territory while agent v4 was second with 33.8%.

The new lifecycle trace recorded 232 completed and eight destroyed action slots, with no failed or unresolved actions. All four Defense Posts completed, compared with one completion, five destructions, and three failures across the earlier run's nine attempts. Richer observations increased prompt usage from 190,700 to 258,774 tokens and cost from $0.15623482 to $0.20269708; neither run used a fallback, although the new run retried one timed-out request successfully. This paired result is direct evidence that the renamed threshold and explicit rank/timer fields corrected the observed semantic error, but one stochastic model run cannot isolate every field's causal effect or establish a statistically reliable win-rate improvement. Lifecycle feedback improved the evidence available to the policy and artifact, but the new strategy notes did not explicitly cite lifecycle statuses, so this run alone does not prove that feedback caused the win.

## 32. Preserve attribution and publish the harness

**Decision:** Keep OpenFront's visible copyright notices, upstream link, AGPL-3.0 source terms, and CC BY-SA asset notice in the dashboard and README, while publishing the external harness source and leaving the pinned game checkout unmodified.

**Pros:** Meets the project's licensing obligations; makes the portfolio provenance honest; encourages upstream reuse and scrutiny.

**Cons:** A deployed fork must keep corresponding source available; asset and source licenses need continued attention when deployment contents change.

## 33. Visual-controls baseline as a separate benchmark division

**Decision:** Add `visual-controls-v1` as a separate `japan-v5` interface division. A thin evaluator starts the identical fixed scenario, submits the fixed spawn, gates the stock local client at the same 100-tick cadence, and records replay and score state. The model receives only 1280×720 screenshots, a neutral public controls manual, and a generic primitive input schema. The evaluator accepts at most two UI-generated gameplay intents and never exposes its game snapshots to the model. It accelerates simulation between gates, stops inference after elimination, retries one malformed model command, and retains the existing $1 and ten-minute limits. Full details are versioned in `baseline.md`.

**Pros:** Establishes a concrete measurement of the complete structured interface's lift; includes perception, grounding, menu navigation, and misclick costs instead of silently correcting them; preserves the same engine, seed, spawn, opponents, cadence, action count, and replay evidence; does not modify the tracked OpenFront checkout; stores the exact screenshots and prompt hash needed for audit.

**Cons:** It measures the full interface bundle rather than isolating normalized observations; image-capable models and text-only models cannot share the division; primitive UI operation often needs more model calls and tokens than semantic action selection; fixed viewport and controls documentation are benchmark-owned choices; hosted multimodal behavior remains nondeterministic; score-only instrumentation must be carefully kept out of requests.

## 34. Naive visual division as a manual ablation

**Decision:** Add `visual-naive-v1` beside `visual-controls-v1`. Both divisions
use the identical stock renderer, primitive command schema, three-note memory,
two-intent budget, fixed scenario, evaluator lifecycle, validation policy, and
scoring. At elimination or the final decision ceiling, deterministic core
continuation collects the winner without another model call. The naive prompt retains only the objective and generic interaction
contract; it removes the territory and timer rules, attack behavior, menus,
attack-ratio guidance, camera controls, build/diplomacy mechanics, and
keybindings. Select the division explicitly with `BASELINE_INTERFACE`, keep the
existing controls condition as the default, and record the interface plus exact
prompt hash in schema-version-2 visual artifacts. Existing schema-version-1
controls artifacts remain readable.

**Pros:** Separates the benefit of a public game manual from the benefit of the
structured harness; supports an end-to-end comparison against a model dropped
into the visible game with only a computer-use contract; changes one intended
independent variable between visual conditions; preserves model-authored memory
so the naive condition is not accidentally a memoryless policy; makes mixed run
directories auditable by interface and prompt hash.

**Cons:** A pretrained model may already know OpenFront, so the condition cannot
prove that behavior was learned during the run; the required primitive-command
contract is still a thin harness; three notes are a benchmark-owned memory
choice; models may spend scarce commands exploring controls; comparing
`agent-v12` directly with the naive division measures the full instruction and
interface bundle rather than structured observations alone; adding a second
visual condition increases the run budget needed for useful intervals.

## 35. Canonicalize primitive key aliases and retry execution rejection

**Decision:** Treat capitalization and common aliases of standard browser key
names as primitive-transport syntax, canonicalizing values such as `escape`,
`esc`, and `ESCAPE` to Playwright's `Escape`. Canonicalize modifiers, physical
letter/digit codes, arrow keys, navigation keys, and function keys similarly
without changing ordinary single-character input. If Playwright still rejects a
keypress, return that public syntax error to the model only when one call remains
in the existing two-call validation budget. Do not retry other input execution
errors, which might have produced partial UI effects.

**Pros:** A schema-accepted lowercase key no longer aborts a match; the
implemented behavior matches the documented one-retry policy; both visual
divisions receive identical generic keyboard handling; canonicalization does not
reveal a game keybinding or evaluator state; limiting execution retry to
keypresses avoids duplicating potentially partial clicks and drags.

**Cons:** Alias normalization is an evaluator-owned convenience and slightly
reduces the cost of grounding browser key syntax; arbitrary invalid key names can
still consume the one retry; a rejected key selected after an earlier malformed
response has no remaining retry; historical `visual-controls-v1` artifacts that
failed on lowercase `escape` remain evidence of the earlier implementation and
must not be silently reclassified.

## 36. Separate model termination from evaluator failure

**Decision:** Visual artifact schema version 3 gives run lifecycle and failure
attribution separate fields. A successfully recorded attempt that reaches the
wall-clock or model-cost ceiling, stalls the client through model interaction,
or exhausts command validation has `status: "terminated"` and
`termination.classification: "model-failure"`. `status: "failed"` is reserved
for evaluator and infrastructure errors. Terminated outcomes are explicitly
nonterminal and report the last recorded score observation; schema versions 1
and 2 remain readable.

**Pros:** A model failure no longer implies that the evaluator failed to run;
attempt counts remain honest; fixed-budget losses stay in the evaluated sample;
and infrastructure errors remain separately eligible for rerun.

**Cons:** Consumers must understand three lifecycle states and avoid treating a
terminated observation as a terminal placement; older schema-version-2
artifacts need an explicit migration before they carry the new attribution.

## 37. Outcome-based neutral-expansion micro-eval

**Decision:** Implement the first `openfront-micro-v1` capability as a pinned
tick-171 checkpoint derived from the production Japan scenario. Verify the core
state, normalized observation, legal menu, and tile-state hashes before every
trial; apply one production-shaped two-slot agent decision; advance exactly 100
ticks; and pass only when the player owns land that was neutral at the
checkpoint. Grade ownership rather than the selected action ID. Run trials
sequentially and restore OpenFront's module-cached mutable maps after each one.

The live CLI defaults to ten development trials, records full trial traces and
invalid infrastructure attempts, calculates `pass@1`, a Wilson interval,
estimated `pass^3`, interface reliability, latency, tokens, and cost, and writes
the report atomically under `data/evals/`.

**Pros:** The fixture is cheap, deterministic, reproducible, resistant to
trajectory overfitting, and sensitive to the real passive-opening failure found
in full-match traces; reference, alternative-expansion, double-hold, and
diplomacy-control policies establish that the grader rewards the outcome rather
than a hard-coded move; resetting cached maps makes repeated in-process trials
independent without modifying the pinned OpenFront checkout.

**Cons:** This is one development fixture rather than the two fixtures required
for a released capability family; sequential execution does not exploit
parallelism; the fixed player label and checkpoint can be overfit; restoring a
large map costs memory and time; and hosted model trials still depend on mutable
provider behavior even though the engine rollout is deterministic.

## 38. Replay-backed implementation of the remaining micro-evals

**Decision:** Implement capability families 2–10 with one shared replay,
isolation, trace, rollout, and outcome-grading layer. Seven fixtures replay
prefixes mined from real full-match traces; post-expansion recovery adds a
deterministic mid-expansion checkpoint; construction recovery adds a
deterministic preparation counter so the model sees the recent classified
placement failure at a hostile border without an active incoming attack. Every
prefix records the source archive and its SHA-256, and every accepted checkpoint
pins core-state, normalized-observation, candidate-menu, and tile-state hashes.

Protected-frontier sets are derived from checkpoint ownership by expanding 40
land steps inward from the relevant hostile border. Split-front regions are
made disjoint. The weaker-target capture set uses the same land-front method so
two already-in-flight legacy transports cannot let a hold control satisfy the
land-target outcome. The calibrated loss ceilings are 5,000 tiles for the single
incoming fixture and 1,500/900 for the split frontiers. The retreat fixture's
minimum recovered force is 2,320,000 troops. These are fixture metadata, not
model-facing goals; graders inspect survival, ownership, capacity, attacks,
troops, and completed active structures rather than requiring particular action
IDs.

The suite CLI randomizes/interleaves the requested family schedule, preserves
provider failures as valid agent-harness trials, reports invalid infrastructure
attempts separately, macro-averages family pass rates, and writes an atomic JSON
trace. Reference and control calibration demonstrated the intended outcome
boundary for all lightweight rollouts; the weaker-target offensive rollout is
intentionally left out of the routine test gate because advancing that large
active land battle is materially slower than reconstructing its checkpoint.

**Pros:** Real match states exercise the production menu and engine instead of
toy mocks; one implementation keeps trace and fallback semantics consistent;
content-addressed prefixes make ignored source archives optional at runtime;
and outcome assertions admit alternate successful trajectories.

**Cons:** Version 1 still has only one development fixture per newly implemented
family, so it is an implementation baseline rather than the 20-task release set
required by the specification; replaying late-game states and especially a
large proactive land battle is CPU-intensive; the construction failure code is
classified while adapting a legacy trace that predates stable failure codes;
and thresholds are specific to these pinned trajectories and must be versioned
if recalibrated.

## 35. Renderer-compatible eval trials

**Decision:** Record each eval session as a native sparse OpenFront
`GameRecord`, from initial spawn through checkpoint preparation, the evaluated
decision, and the complete grading horizon. Keep intent-bearing turns and
periodic state hashes, embed the record in the eval report, and resolve eval
trial UUIDs as a fallback through the existing `/api/runs/:runId`, replay, and
artifact endpoints. Convert the eval trace into one production-shaped decision
record so the existing replay panel remains synchronized without a second
viewer implementation. Provide a no-model migration command for older reports;
it writes only after checkpoint and final-outcome verification.

**Pros:** A grader result can be inspected visually against the authoritative
engine trajectory; evals reuse the pinned renderer, playback controls, and trace
panel; sparse turns add little report size; old model calls do not need to be
repeated; and migration fails closed if replay determinism has drifted.

**Cons:** Replays begin at tick zero, so late-game fixtures take time to reach
the evaluated decision unless the viewer seeks forward; eval reports are larger;
the server scans eval reports by trial UUID on fallback requests; and a replay
visualizes the recorded trajectory but does not replace deterministic grading.

## Known benchmark limitations

- A fixed engine seed does not make a hosted model deterministic. Sampling, model weights, and provider routing can change generated decisions.
- The full-match score surface is outcome, placement, survival, ticks, usage,
  and trace—not yet a single leaderboard formula. The micro-eval has a separate
  capability score and must not be folded into the match result.
- The candidate generator is part of the environment. Improving it can improve every model and therefore requires a scenario version bump.
- One map, seed, spawn, model run, and opponent set cannot establish general strategy competence.
- Nation AI and the renderer are pinned implementation dependencies, not immutable external standards.
- Structured-menu and visual-controls results are separate divisions and must not be pooled into one model ranking.

For a real leaderboard, the next version should accept signed submitted action traces, replay every submission server-side against a content-addressed engine image, publish the scoring formula, add several hidden versioned seeds, and separate model/provider divisions.
