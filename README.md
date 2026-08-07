# OpenFront Harness

A deterministic, inspectable harness in which one LLM plays a fixed OpenFront match on Japan against three built-in medium-difficulty nations. Every run produces a complete OpenFront replay plus a decision-by-decision trace of observations, legal actions, selected intents, latency, tokens, cost, hashes, and outcome.

The harness is a separate project. `OpenFrontIO/` stays at the pristine `v0.32.9` tag and is treated as a read-only source dependency; the harness imports its core and builds its renderer without patching tracked game files.

This is a portfolio project and a first step toward a reproducible strategy-agent benchmark. The scenario is deliberately immutable: changing it creates a new benchmark version.

## What you can inspect

- A real OpenFront v0.32.9 simulation, not a simplified game clone
- One LLM spawned in Kanto against Hokkaido, Shikoku, and Kansai
- A bounded menu of currently legal core intents every 100 ticks
- Exactly one legal action per model decision, including an explicit hold
- Structured model output validated against both JSON Schema and the legal menu
- Full intent-based replay in OpenFront's existing renderer
- A synchronized trace showing the public strategy note, actions, state, total latency, per-attempt TTFT, generation time, TPOT, tokens, provider, and cost
- Gzipped, versioned run artifacts suitable for later benchmark ingestion
- A bundled real-model sample that works without an API key

The exact scenario is documented in [design-decision.md](design-decision.md), and the project retrospective is in [writeup.md](writeup.md).

## Quick start

Requirements: Node.js 24 and npm.

```bash
git clone --recurse-submodules https://github.com/fahimahmedx/openfront-harness.git
cd openfront-harness
npm run inst
cp example.env .env
# Add OPENROUTER_API_KEY to .env
npm run build
RATE_LIMIT_SALT=local-development npm start
```

For an existing clone, fetch the pinned OpenFront source with
`git submodule update --init --recursive` before installing dependencies.

Open `http://localhost:3000`. The server reads the workspace-level `.env`; no environment file is added to the OpenFront checkout.

## Commands

```bash
npm test               # focused unit and artifact tests
npm run eval:neutral   # run 10 live neutral-expansion eval trials
npm run eval:micro     # run the ten-family live micro-eval suite
npm run eval:fixtures  # regenerate tracked replay prefixes from source runs
npm run eval:add-replays -- path/to/report.json # add replays to current eval reports
npm run verify:sample  # verify the bundled replay directly, without model calls
npm run build          # type-check and production Vite build
npm run sample         # spend live API credits to create a new sample
npm run refresh:sample # intentionally disabled for the immutable legacy sample
npm run baseline:run:controls # run the screenshot baseline with the public manual
npm run baseline:run:naive    # run the screenshot baseline without game instructions
```

`npm run sample` uses the same hard $1 run cap as the public app. `verify:sample`
validates and loads the stored OpenFront replay directly. The bundled sample is
a legacy two-action artifact and is never fed through the current resolver.

The raw-UI comparison protocols and run instructions are documented in
[baseline.md](baseline.md). They keep deterministic setup and scoring outside
the model boundary while limiting the model itself to stock-renderer screenshots
and primitive controls. `npm run baseline:run` remains an alias for the original
`visual-controls-v1` condition.

The `openfront-micro-v2` suite covers neutral and saturated expansion,
post-expansion recovery, target selection, restraint, incoming defense,
split-front prioritization, retreat, naval reachability, and construction recovery. Each task
rebuilds a pinned checkpoint, verifies state/observation/menu/tile hashes, sends
the production-shaped single-action decision, and grades authoritative engine state
after its fixed horizon. Tracked replay prefixes retain their source artifact
path and SHA-256; the original ignored run archives are not needed to execute
the suite.

Live reports are written atomically under `data/evals/`. Run one family with
`npm run eval:micro -- --family incoming-attack-response`, select several with a
comma-separated value, change the per-family development count with
`--trials 20`, or choose a report destination with `--output path/to/report.json`.
Live evals require `OPENROUTER_API_KEY` and spend API credits. The default model
is `openai/gpt-5.6-luna`; `OPENROUTER_MODEL` overrides it.

Every new eval trial embeds a sparse renderer-compatible OpenFront replay. With
the server running, open `/replay/<trial-runId>` to watch the complete setup and
grading horizon with the eval decision synchronized in the trace panel. Trial
UUIDs are the `trials[].runId` values in the JSON report. Reports created before
replay capture was added can be upgraded deterministically with
`npm run eval:add-replays -- path/to/report.json`; this makes no model request
and refuses to write if the reconstructed checkpoint or final outcome differs.

## Fixed benchmark preset

| Setting            | Value                                                      |
| ------------------ | ---------------------------------------------------------- |
| Scenario           | `japan-v6`                                                 |
| Map                | Japan, Normal                                              |
| Mode               | Free For All, Singleplayer                                 |
| Players            | 1 LLM + 3 Nation players                                   |
| Difficulty         | Medium                                                     |
| Game seed / ID     | `JAPAN01A`                                                 |
| LLM spawn          | Kanto, tile `(1613, 1133)`                                 |
| Nations            | Hokkaido, Shikoku, Kansai                                  |
| Decision interval  | 100 ticks / 10 simulated seconds                           |
| Actions / decision | Exactly 1                                                  |
| Decision ceiling   | 120 while the LLM is alive                                 |
| Match ceiling      | 20 simulated minutes                                       |
| OpenFront          | v0.32.9, commit `dcc18d5231af6253b0e991bf04a4c764982fe262` |

The model is never given permission to invent a command. The server enumerates
a deterministic set of legal action IDs from current state and requires exactly
one ID. The selected ID resolves to one ordinary OpenFront intent; `hold` is the
explicit no-op. Invalid output is retried once and then converted to one hold.
Five consecutive complete decision failures abort a run.

Troop-spending actions may use the full safe surplus above the reserve floor.
Neutral expansion preserves 15% of troop capacity, ordinary combat preserves
35% and unlocks at 55% capacity, and attacks against stronger defenders are
withheld. During an invasion, unrelated troop spending is suppressed and a
counterattack is capped by the selected attacker's incoming force while
preserving a 15% emergency reserve.

## Artifact shape

New `.json.gz` artifacts use schema version 3 and `agent-v13`. Schema-version-1
and schema-version-2 artifacts are accepted only by the read-only replay and
download paths. Each current artifact contains:

- scenario, source commit, model, provider, prompt version, and reasoning configuration;
- start/end timestamps and exact token/cost usage;
- winner, placement, terminal tick, simulated time, and final hash;
- every normalized observation and legal candidate menu;
- selected and applied action IDs, post-execution lifecycle results, fallback state, and request metrics;
- an OpenFront `GameRecord` containing the initial configuration and sparse turns.

Run files are written atomically. A small pending JSON checkpoint is updated after each decision so interrupted work is visible rather than silently disappearing.

## HTTP surface

| Route                        | Purpose                                          |
| ---------------------------- | ------------------------------------------------ |
| `GET /api/health`            | Railway health check and generation availability |
| `GET /api/scenario`          | Immutable preset, public quota, active run       |
| `GET /api/runs`              | Replay summaries, including the bundled sample   |
| `GET /api/baseline/runs`     | Stock-UI visual baseline summaries               |
| `POST /api/runs`             | Launch one bounded match                         |
| `GET /api/runs/:id`          | Progress or completed decision trace             |
| `GET /api/runs/:id/replay`   | OpenFront replay record                          |
| `GET /api/runs/:id/artifact` | Download the complete JSON artifact              |
| `GET /replay/:id`            | Replay UI with synchronized trace panel          |

## Railway deployment

The included `railway.toml` selects the multi-stage Dockerfile and `/api/health`. Configure:

- `OPENROUTER_API_KEY` — required for fresh public runs;
- `RATE_LIMIT_SALT` — required in production; use a long random value;
- `PUBLIC_BASE_URL` — the deployed HTTPS origin;
- `SOURCE_URL` — the public repository for this modified AGPL deployment;
- optionally `OPENROUTER_MODEL`, `OPENROUTER_PROVIDER`, and `CDN_BASE`.

Attach a Railway Volume at `/data`. The image sets `RUN_DATA_DIR=/data`; without a volume, generated artifacts and quota state disappear on redeploy. The bundled sample remains available because it is part of the image.

Public generation is intentionally conservative: one active run globally, one launch per hashed IP per UTC day, five launches per UTC day, a ten-minute wall-clock limit, and a $1 model-cost ceiling. Only an HMAC of the IP is persisted.

## Repository layout

```text
src/                          scenario, runner, agent, storage, API
src/client/                   dashboard, replay bootstrap, trace panel
tests/                        focused deterministic tests
data/                         local run artifacts grouped by run folder
resources/harness/            bundled real-model replay artifacts
OpenFrontIO/                   untouched v0.32.9 source dependency
vite.config.ts                external build and in-memory replay adapter
design-decision.md            decisions with pros and cons
writeup.md                    publishable project retrospective
```

## Upstream and license

This project consumes an unmodified checkout of [OpenFrontIO/OpenFrontIO](https://github.com/openfrontio/OpenFrontIO) at tag `v0.32.9`. OpenFront is an online real-time strategy game focused on territorial control and alliance building and is itself a fork/rewrite of WarFront.io.

OpenFront source code is licensed under the **GNU Affero General Public License v3.0**, and this harness is distributed under compatible AGPL terms. Assets retain their applicable **CC BY-SA 4.0** terms. Network deployments must offer corresponding source and preserve the visible notices. See [LICENSE](OpenFrontIO/LICENSE), [LICENSE-ASSETS](OpenFrontIO/LICENSE-ASSETS), and [LICENSING.md](OpenFrontIO/LICENSING.md).

© OpenFront and Contributors
