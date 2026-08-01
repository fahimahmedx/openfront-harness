# OpenFront LLM Harness

## Summary

Build the portfolio project outside the existing OpenFrontIO repository. Treat the clean v0.32.9 checkout as a
read-only source dependency while reusing its deterministic core and browser renderer.

A visitor can launch a tightly rate-limited match, watch generation progress, and then replay the complete game
with synchronized LLM decisions. A verified sample replay is always available.

Fixed scenario japan-v1:

- OpenFront tag/commit: v0.32.9 / dcc18d5231af6253b0e991bf04a4c764982fe262
- Map: Japan, normal size, free-for-all
- Game seed: JAPAN01A
- LLM: one human player, fixed Kanto spawn (1613, 1133)
- Opponents: exactly three Nation players—Hokkaido, Shikoku, and Kansai—at Medium difficulty; zero Tribe bots
- Decision cadence: every 100 ticks / 10 simulated seconds
- Action slots: exactly two per decision, with explicit hold actions filling unused or invalid slots
- Time limit: 20 simulated minutes, producing at most 120 LLM decisions
- Default model: openai/gpt-5.6-luna, overridable by OPENROUTER_MODEL

## Implementation Changes

### Headless deterministic runner

- Add a harness service that loads only the production Japan map and drives GameRunner directly under Node—no
  browser automation.

- Keep the fixed gameplay seed separate from each unique run ID so every match uses identical core randomness
  while artifacts remain individually addressable.

- Spawn the LLM with a fixed intent, advance initialization until all four players have spawned, then anchor
  decision zero and run exactly 100 core ticks between decisions.

- Stop on an OpenFront winner, the 20-minute timer, five consecutive failed LLM decisions, the $1 model budget,
  or a 10-minute wall-clock safety limit.

- Record sparse OpenFront turns, hashes every 100 turns, final statistics, winner, ticks, and final state hash.
  Empty turns are reconstructed by OpenFront’s existing replay code.

### LLM policy adapter

- Produce a deterministic, globally sorted observation containing time remaining, win threshold, player
  resources/territory/units, attacks, relations, nearby opponents, and recent action outcomes. BigInts become
  decimal strings and no browser receives the API key.

- Generate up to 64 deterministic legal candidates using core legality checks. Cover expansion, land and boat
  attacks, retreat, structures, upgrades, warships, nukes, alliances, alliance breaks, and embargoes.

- Resolve spatial actions through fixed anchors such as spawn, territory center, hostile front, owned shoreline,
  and nearest opposing shoreline. Revalidate selections immediately before translation into OpenFront intents.

- Request strict JSON with a short strategy note and exactly two candidate IDs. Use dedicated hold:1 and hold:2
  IDs when the model wants fewer actions.

- Call OpenRouter Chat Completions statelessly with prompt version agent-v1, structured output, unseeded sampling, low
  reasoning effort, and a 256-token completion cap. Require parameter support and pin the configured provider for
  benchmark consistency. OpenRouter documents both strict structured outputs
  (https://openrouter.ai/docs/guides/features/structured-outputs) and usage/cost accounting
  (https://openrouter.ai/docs/cookbook/administration/usage-accounting).

- Retry a failed request or invalid response once. After the retry, retain valid slots and replace invalid,
  duplicate, or unknown slots with holds. Abort only after five consecutive decisions requiring complete
  fallback.

- Store a bounded “strategy note,” not hidden chain-of-thought. Record observation, candidate menu, selected
  actions, validation/outcome, latency, resolved model/provider, token usage, and cost.

### Storage, API, and public safeguards

- Store gzip-compressed, schema-versioned run artifacts as atomic JSON files on a Railway Volume at /data; use a
  local ignored directory during development.

- Persist only HMAC-hashed IP identifiers using required RATE_LIMIT_SALT. Never persist raw IP addresses.
- Enforce one active match globally, one match per IP per UTC day, five matches globally per UTC day, and no
  waiting queue. Return the active run for concurrency conflicts.

- Enforce the $1/run budget with a conservative preflight estimate using current model pricing and serialized
  request size, then reconcile against OpenRouter’s returned usage cost after every response. Fail closed if
  pricing cannot be established.

- Keep active progress in a lightweight pending record. Mark unfinished records interrupted after restart rather
  than attempting an unsafe resume.

- Include a verified default-model sample artifact in the repository so outages, exhausted quotas, or missing
  Railway storage never leave the portfolio empty.

### Dashboard, replay, and deployment

- Add a dedicated responsive dashboard showing the immutable scenario, architecture summary, quota state, sample/
  latest runs, outcome, model, tokens, cost, and a “Run benchmark” action.

- Poll run status once per second while generating; show tick, decision count, latest strategy note, elapsed wall
  time, and spend.

- Add a harness replay route that fetches the stored GameRecord, bypasses OpenFront authentication/lobby
  networking, and starts its existing local replay server and renderer.

- Reuse OpenFront’s pause and 0.5×/1×/2×/MAX controls. Add back/restart controls and a toggleable decision drawer
  synchronized through a replay-tick event.

- Display the current decision’s observation summary, strategy note, selected actions, validation results,
  latency, tokens, and cost. Escape all model text.

- Use a single Railway Node service and a simplified multi-stage Docker image. Serve the dashboard, replay shell,
  API, required static assets, and only resources/maps/japan; do not run the upstream multiplayer cluster/nginx
  stack.

- Add Railway health checks and graceful shutdown. Document a 2 GB memory recommendation because the full Japan
  simulation is large.

- Preserve OpenFront copyright notices, AGPL attribution, asset attribution, and a visible link to the complete
  external harness source while leaving the pinned OpenFront checkout unchanged.

## Public Interfaces

- GET /api/health — process, storage, and generation availability.
- GET /api/scenario — immutable japan-v1 configuration and versions.
- GET /api/runs — sample and completed run summaries.
- POST /api/runs — bodyless fixed-scenario launch; returns 202 with run/status/replay URLs, 409 when busy, or 429
  when limited.

- GET /api/runs/:runId — public progress/result and decision timeline without secrets or limiter metadata.
- GET /api/runs/:runId/replay — validated OpenFront GameRecord.
- GET /api/runs/:runId/artifact — portable benchmark artifact containing scenario, model metadata, trace, score/
  outcome, and replay.

- GET /replay/:runId — full graphical replay.

Core harness types will include ScenarioDefinition, Observation, LegalAction, AgentDecision, DecisionRecord,
RunProgress, RunArtifactV1, and RunPublicView, all runtime-validated.

## Test Plan

- Assert the fixed scenario loads the real Japan map, the Kanto coordinate is valid land, and seed JAPAN01A
  creates one human plus exactly Hokkaido, Shikoku, and Kansai at Medium difficulty.

- Unit-test stable observation ordering, candidate IDs, legal-action filtering, deterministic placement, exact
  two-slot enforcement, duplicate rejection, holds, and secret redaction.

- Mock OpenRouter to test strict-schema success, timeout, retry, partial invalidity, five-failure abort, usage
  aggregation, provider/model capture, and budget refusal.

- Test atomic gzip storage, corrupt artifact handling, restart interruption, raw-IP non-persistence, UTC limits,
  global concurrency, and all API status codes.

- Run a network-free integration match with a scripted policy through the real Japan core; validate maximum
  decision count, timer winner, GameRecordSchema, sparse-turn expansion, final hash, and deterministic replay
  hash verification.

- Test dashboard empty/sample/running/completed/failed/quota states and replay decision synchronization.
- Run typecheck, lint, unit/integration tests, production build, Docker health smoke, and a replay smoke test.
- Keep live OpenRouter tests opt-in. Generate one real verified sample after the harness passes deterministic
  tests, then populate writeup.md with measured—not estimated—runtime, token, cost, outcome, and replay results.

## Documentation and Assumptions

- design-decision.md will be a comprehensive decision register. Every material product, architecture, simulation,
  prompt, action-space, replay, storage, privacy, rate-limit, cost, UI, deployment, licensing, and testing choice
  must include context, alternatives, pros, cons, consequences, and future benchmark impact. Completion includes
  auditing all introduced behavior against this register.

- writeup.md will be a publish-ready first-person technical case study for engineering readers and hiring

- Add a portfolio-quality README with architecture, local commands, environment variables, artifact format, API
  examples, Railway volume setup, source/licensing obligations, and links to both documents.

- Required deployment variables: OPENROUTER_API_KEY and RATE_LIMIT_SALT. Defaults: OPENROUTER_MODEL=openai/gpt-
  5.6-luna, OPENROUTER_PROVIDER=openai, RUN_DATA_DIR=/data.

- Model sampling can never be guaranteed reproducible solely from the game seed. Every artifact therefore records
  model, provider, parameters, prompt/action encoder versions, usage, and emitted turns; replay determinism is
  guaranteed from the recorded turns, while policy reproducibility is reported honestly as a limitation.
