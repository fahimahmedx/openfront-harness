# OpenFront LLM Harness — Design Decisions

Status: implemented for benchmark scenario `japan-v2`; the slot-based `agent-v4` output contract was added on 2026-07-26. Existing `japan-v1` and `agent-v1` through `agent-v3` artifacts remain replay-compatible.

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

**Decision:** Expose only Japan at Normal size under scenario ID `japan-v2`. The game preset and seed remain those of v1; v2 versions the action and observation contract.

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

## 8. Exactly two action slots

**Decision:** Require exactly two named action slots, `action1` and `action2`. Each slot has its own legal-ID enum and its own hold. Expansion, attack, and boat candidates may be selected in both slots because their troop amount is already bounded to one slot's half of the shared safe budget. Repeated build, upgrade, retreat, diplomacy, or hold actions are normalized deterministically to the appropriate slot hold. If two distinct structure builds target the same coordinate, the second is also normalized to its slot hold because the core can place only one structure there.

**Pros:** Every model gets the same action bandwidth; choosing the strongest safe troop action in both slots is valid rather than a model error; slot-specific enums prevent the wrong hold ID; repeated non-repeatable side effects cannot reach the core; the trace clearly distinguishes an intentional hold from missing output.

**Cons:** Some states need one or three useful actions; two same-target troop intents may be strategically redundant even though they are budget-safe; simultaneous intents can conflict; the artificial slot count is not a native UI constraint.

## 9. Server-generated legal action menu with shared troop reserves

**Decision:** Deterministically enumerate at most 64 legal candidates from current state, including expansion, attacks, boats, retreats, construction, upgrades, diplomacy, and holds. Troop actions split one safe surplus across both slots. The reserve floor is a percentage of current troop capacity: 15% during expansion, 35% during combat, and 15% during an emergency. Spendable troops are `max(0, current troops - reserve floor)` and each of the two slots receives at most half of that snapshot surplus. The menu offers 25%, 50%, 75%, and 100% variants of the per-slot budget rather than percentages of the whole garrison.

Incoming hostile troops take precedence and switch the policy to emergency mode. Neutral expansion and ordinary offense are suppressed; only attackers receive counterattack candidates. A counter is bounded by the safe per-slot budget, that attacker's incoming force, and half of all hostile incoming troops. Outside an emergency, ordinary attacks unlock only at 55% troop capacity, require the attacker to have more troops than the target, and omit commitments smaller than 20% of the defender's troops.

**Pros:** Prevents arbitrary commands and schema hallucinations; keeps prompts bounded; IDs are auditable and map directly to native intents; candidate ordering is reproducible; two individually legal choices cannot spend the same troops twice or drain the garrison.

**Cons:** The menu is an opinionated abstraction and deliberately withholds risky all-in or understrength attacks; legality can change between enumeration and core execution; maintaining coverage requires understanding new game mechanics.

## 10. Normalized observations, not hidden core objects

**Decision:** Send a compact JSON observation containing public self/opponent state, attacks, relations, units, time, map totals, and the last three decisions. Version 2 explicitly includes troop-capacity percentage, absolute troop growth per second, total incoming and outgoing troops, the active policy mode, reserve floor and percentage, spendable troops, per-action budget, and each opponent's troops relative to the LLM.

**Pros:** The model sees structured, stable data; prompts stay inspectable; engine implementation details and cyclic objects do not leak; artifacts can be analyzed without running the game.

**Cons:** Information omitted by normalization is unavailable to the policy; large-scale spatial geometry is summarized rather than rendered; changing observation fields changes the benchmark.

## 11. Public strategy note instead of chain of thought

**Decision:** Ask for a concise strategy string of at most 160 characters and action IDs. Do not request or store private reasoning.

**Pros:** Gives viewers an understandable annotation without relying on hidden reasoning; bounds output and artifact size; avoids presenting a strategy note as privileged internal cognition.

**Cons:** The note may be post-hoc or shallow; it cannot fully explain complex choices; it provides less debugging information than a long rationale.

## 12. Structured output plus local validation

**Decision:** Use OpenRouter JSON Schema output in strict mode. Build separate `action1` and `action2` enum properties from the current candidate menu, excluding the other slot's hold from each property. Parse independently with Zod and verify membership for each slot locally. Include `maxUses` in the candidate view so repeatable troop actions are explicit. This slot-based request contract is prompt version `agent-v4`; it replaces v3's array-level distinctness rule, which conflicted with the two-slot troop budget and could not be expressed with the pinned provider's strict-schema subset.

**Pros:** The provider prevents invented and wrong-slot IDs during generation; property names encode slot identity without unsupported JSON Schema keywords; local validation remains defense in depth; application types and API schema agree; failure behavior is measurable.

**Cons:** Strict structured output and dynamic enums narrow compatible endpoints; schema requests add tokens and provider coupling; repeatability remains a harness-owned semantic rule; local validation and retry logic remain necessary because the provider boundary is untrusted.

## 13. Default model and pinned provider route

**Decision:** Default to `openai/gpt-5.6-luna`, provider tag `openai`, disable provider fallback, require all requested parameters, and deny data-collecting routes. Both remain environment-configurable for private experiments.

**Pros:** Provider changes do not contaminate a run; supported-parameter enforcement fails loudly; recorded model/provider metadata is meaningful; the default is fast enough for interactive generation.

**Cons:** Availability is lower than multi-provider routing; a provider parameter change can stop all runs; model behavior may still change behind a stable slug; alternative model results are not leaderboard-comparable without a new benchmark division.

## 14. Separate game seed and model seed

**Decision:** Use game seed `JAPAN01A` and model seed `3209`, recording both.

**Pros:** Makes the two sources of stochasticity explicit; providers that honor seed can reduce response variance; artifacts are easier to reproduce.

**Cons:** Hosted-model seeds are best-effort rather than a cryptographic reproducibility guarantee; backend model revisions can change output; exact leaderboard reproducibility ultimately requires model snapshots or submitted action traces.

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

## 19. Placement from elimination order

**Decision:** Track the first tick at which each player becomes non-alive and calculate placement by counting players eliminated later, with the winner first.

**Pros:** Works even though OpenFront's `players()` method returns only living players; avoids ranking all eliminated zero-tile players incorrectly; produces a useful four-player metric.

**Cons:** Simultaneous elimination requires a tie convention; placement is harness-derived rather than a native OpenFront field.

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

**Decision:** Ship one gzipped `japan-v2` sample generated by the default live model. Provide a no-network verifier that replays its recorded actions and requires winner, terminal tick, and final hash to match. Continue accepting legacy `japan-v1`/`agent-v1` artifacts for replay. Keep the immutable bundled winning sample identified as `agent-v2`; new live runs use `agent-v4`, and replacing the sample requires a new real model run rather than rewriting its recorded decisions.

**Pros:** Recruiters can inspect the result without a key or waiting; deployment remains useful when generation is disabled; the verifier turns the sample into a reproducibility fixture.

**Cons:** The sample adds repository data and will age; one match is anecdotal; its model cost and latency reflect one provider run, not a performance guarantee.

## 24. Versioned, transparent artifacts

**Decision:** Store schema-versioned JSON containing full normalized observations, candidate menus, decisions, per-attempt validation diagnostics, metrics, outcome, and replay, compressed with gzip. Diagnostic entries contain stable codes and rejected action IDs but not raw model responses. Default missing diagnostic arrays to empty when parsing older artifacts.

**Pros:** Data is portable, auditable, and easy to analyze; replay and agent trace cannot become detached; failures can be classified without retaining unnecessary raw output; old artifacts remain viewable; gzip reduces the bundled sample substantially.

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

**Current acceptance evidence:** The live v2 sample (`fadf8cc4-40e0-4c81-91d3-6da5b507c636`) won in first place after 106 model decisions at tick 10,561. It used 180,599 prompt tokens and 20,095 completion tokens, cost $0.31777925, retried 15 decisions, and fell back to two holds eight times. An artifact audit found no decision where combined troop commitments exceeded `spendableTroops`, no ordinary land attack below the readiness/troop-advantage gates, and no counterattack total above the recorded incoming force. The no-network verifier reproduced winner, placement, terminal tick, and final hash `4090602815772241`; all 10 focused tests, TypeScript checking, and the production build passed. This validates the implemented boundary and this recorded trajectory, not general strategic competence from one run.

## 32. Preserve attribution and publish the harness

**Decision:** Keep OpenFront's visible copyright notices, upstream link, AGPL-3.0 source terms, and CC BY-SA asset notice in the dashboard and README, while publishing the external harness source and leaving the pinned game checkout unmodified.

**Pros:** Meets the project's licensing obligations; makes the portfolio provenance honest; encourages upstream reuse and scrutiny.

**Cons:** A deployed fork must keep corresponding source available; asset and source licenses need continued attention when deployment contents change.

## Known benchmark limitations

- A fixed engine seed does not make a hosted model perfectly deterministic. Provider seeds are best effort, and model weights/routing can change.
- The current score surface is outcome, placement, survival, ticks, usage, and trace—not yet a single leaderboard formula.
- The candidate generator is part of the environment. Improving it can improve every model and therefore requires a scenario version bump.
- One map, seed, spawn, model run, and opponent set cannot establish general strategy competence.
- Nation AI and the renderer are pinned implementation dependencies, not immutable external standards.

For a real leaderboard, the next version should accept signed submitted action traces, replay every submission server-side against a content-addressed engine image, publish the scoring formula, add several hidden versioned seeds, and separate model/provider divisions.
