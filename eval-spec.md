# OpenFront Public Benchmark Specification

Status: release-candidate design for `openfront-bench-v0.1`; the current repository
implements only the original Japan development fixtures. A result MUST NOT be
called an `openfront-bench-v0.1` result until every release gate in section 15 is
met and the frozen manifest is published.

This document is normative. **MUST**, **MUST NOT**, **SHOULD**, and **MAY** have
their usual requirements-language meanings. It is intended to contain the full
benchmark contract: task set, participant boundary, scoring, statistics,
artifacts, local validation, publication guidance, governance, assumptions, and
launch work.

## 1. Benchmark goal

OpenFront Bench measures whether an AI agent can play a deterministic real-time
strategy game through the production OpenFront harness. The public benchmark
has 22 scored tasks in two suites:

1. **Match suite (primary):** twelve complete games across different maps,
   spawn geometries, opponent counts, Nation policies, tribe bots, and Medium or
   Hard difficulty.
2. **Capability suite (diagnostic):** ten multi-map checkpoint tasks covering ten
   local strategic capabilities. Each task contains one model decision and a
   deterministic rollout.

The repository also contains ten existing Japan development fixtures, one per
capability. They are practice tests for prompt and harness development and
regression checks. They are not public benchmark tasks, do not appear in the
benchmark release manifest, and never affect a benchmark score.

The public benchmark measures the model and agent harness together. It grades
game outcomes, not preferred action sequences or prose. The match score is the
primary benchmark metric. Capability score, validity, latency, and cost are
required companion metrics and MUST NOT be combined into a hidden composite.

This benchmark does not replace unit tests for schemas, validators, action
conflicts, map loading, replay determinism, or graders. Those establish that the
benchmark implementation works; benchmark tasks measure policy performance.

## 2. Assumptions and decisions made in this specification

The following assumptions are explicit so they can be changed before the first
frozen release:

- A public benchmark should test general play, not only the existing fixed Japan
  match. Therefore the primary suite uses six bundled maps and two fixed spawns
  per map.
- The official engine remains OpenFront `v0.32.9` at commit
  `dcc18d5231af6253b0e991bf04a4c764982fe262` for version 0.1. Upgrading the
  engine creates a new non-equivalent benchmark version.
- All maps use `GameMapSize.Normal`, Free For All, Singleplayer, a 20 simulated
  minute ceiling, a 100-tick decision interval, exactly one action per
  decision, and at most 120 decisions while the agent is alive.
- Nations and tribe bots are both useful opponents. Nations exercise diplomacy,
  structures, and long-horizon strategy; tribe bots add irregular nearby
  pressure and target-selection noise. Difficulty applies to the built-in AI as
  resolved by the pinned engine.
- Medium and Hard are sufficient for the first release. Easy has too little
  headroom and Impossible may make early spawn variance dominate policy quality.
- Exact fixed spawns are preferable to random spawn because they make trials
  replayable. Geographic diversity comes from the task matrix instead.
- Public scored fixtures are published for reproducibility. They are
  procedurally held out while the development fixtures and frozen prompt are
  prepared. Anyone publishing a result SHOULD disclose tuning against them. A
  rolling private set is not assumed to exist.
- The official version 0.1 comparison uses three independent model trials per
  full-match task and ten per scored capability fixture: 36 complete matches
  plus 100 capability decisions per configuration. With the configured ceilings,
  the maximum model cost is USD 46 per configuration; actual cost is reported.
- The existing production prompt, observation, legal action generator, resolver,
  troop policy, retry behavior, and single-action interface remain the Standard-track
  agent boundary.
- Version 0.1 uses the existing OpenRouter adapter. The evaluated model MUST be
  available through OpenRouter, and each user supplies their own API key and
  pays their own provider costs.
- Version 0.1 has a maintainer-hosted leaderboard containing only first-party
  runs executed by the maintainer with the frozen Standard harness. There is no
  external score-submission channel. Anyone MAY run the benchmark and publish
  their own report, but external results are not added to the hosted leaderboard.
  Custom prompts, policies, planners, or agent implementations MAY reuse the
  tasks only when clearly labeled `unofficial-custom-agent`.
- Model generation may be unseeded. OpenFront engine state is deterministic for
  a fixed task, preparation, and accepted decision sequence.
- The benchmark maintainer is
  [`fahimahmedx`](https://github.com/fahimahmedx), who owns benchmark releases,
  fixture acceptance, first-party leaderboard runs, and publication decisions.
  The maintainer does not accept, verify, endorse, or rank external scores.

## 3. Standard configuration and agent boundary

### 3.1 Fixed-harness requirements

The Standard track compares models or model configurations using the frozen
benchmark harness. Participants MAY set only:

- model and provider;
- provider routing, if reported;
- documented reasoning-effort controls;
- temperature and other request parameters exposed by the official runner; and
- credentials, rate limits, and a per-run output directory.

They MUST NOT change the system prompt, observation, candidate construction,
action resolver, troop policy, retries, fallback behavior, task order after it
is drawn, or game configuration. A provider-side model revision is a new
evaluated configuration even if its public model alias is unchanged.

There is no official custom-agent division in version 0.1. A configuration that
changes the prompt, observation, candidate generator, resolver, troop policy,
retry behavior, fallback, memory, tool access, or decision logic does not produce
a comparable Standard result. Such experiments MAY reuse the public tasks, but
their reports MUST say `unofficial-custom-agent`.

### 3.2 What the agent receives

At each decision the agent receives only the production game instructions, the
normalized observation, and the legal candidate menu. It does not
receive the task ID, map task metadata beyond normal observation, checkpoint
grader, thresholds, reference/control policies, source trace, expected
opponents, state hash, or split.

One corrective retry is part of the same decision. After the retry, an invalid
response becomes one hold. Five consecutive complete decision failures abort a
full match. Provider errors and fallbacks are valid agent failures, not
infrastructure-invalid trials.

## 4. Frozen common configuration

| Field                | Version 0.1 value                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| OpenFront            | `v0.32.9`, commit `dcc18d5231af6253b0e991bf04a4c764982fe262`                                                              |
| Map assets           | Files at that commit; every file SHA-256 recorded in the manifest                                                         |
| Mode / type          | Free For All / Singleplayer                                                                                               |
| Map size             | Normal                                                                                                                    |
| Human players        | One evaluated LLM player                                                                                                  |
| Random spawn         | `false`                                                                                                                   |
| Donations            | Gold `false`, troops `false`                                                                                              |
| Cheats               | Infinite gold `false`, infinite troops `false`, instant build `false`                                                     |
| Decision interval    | 100 ticks / 10 simulated seconds                                                                                          |
| Actions per decision | Exactly one                                                                                                               |
| Candidate ceiling    | 64 candidates, including the single `hold` entry                                                                          |
| Decision ceiling     | 120 while the LLM player is alive                                                                                         |
| Match ceiling        | 20 simulated minutes                                                                                                      |
| Wall-clock ceiling   | 10 minutes per match, 2 minutes per capability trial                                                                      |
| Model-cost ceiling   | USD 1 per match and USD 0.10 per capability trial                                                                         |
| Response handling    | Strict schema, one corrective retry, then one hold                                                                        |
| Failure abort        | Five consecutive complete decision failures in a match                                                                    |
| Troop policy         | Expansion reserve 15%; combat reserve 35%; combat trigger 55%; minimum attacker/defender ratio 20%; emergency reserve 15% |

The release manifest MUST store the complete schema-parsed `GameConfig` and a
hash of the fully resolved engine configuration. This table is not permission
to rely on unrecorded engine defaults. Alliances, ports, structures, nukes, SAMs,
and the ordinary version-1 doomsday/timer behavior remain enabled unless the
resolved manifest explicitly says otherwise.

## 5. Match suite task matrix

Each row is one match task. The spawn labels are descriptive; coordinates are
authoritative. `N` means built-in Nation players and `T` means tribe bots. The
listed opponent names are deterministic consequences of the seed and pinned
engine and MUST be checked after spawn. A mismatch invalidates the trial before
the first model request.

| ID         | Map                 | Seed      | LLM spawn                | Difficulty | Opponents | Expected deterministic roster                                                                                  |
| ---------- | ------------------- | --------- | ------------------------ | ---------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| `match-01` | Japan               | `OFB101`  | Kanto `(1613,1133)`      | Medium     | 3 N       | Shikoku; Tokyo; Chubu                                                                                          |
| `match-02` | Japan               | `OFB102`  | Okinawa `(397,2283)`     | Hard       | 3 N + 2 T | Kanto; Tokyo; Kyoto; Filipino Republics; Mapuche Regime                                                        |
| `match-03` | Europe Classic      | `OFB103`  | France `(729,648)`       | Medium     | 5 N       | Portugal; Lithuania; Italy; Poland; Tunisia                                                                    |
| `match-04` | Europe Classic      | `OFB104`  | Iceland `(171,171)`      | Hard       | 3 N + 3 T | France; Romania; Ukraine; Palmyrene Ascendancy; Romanov Assembly; Iroquois Sisterhood                          |
| `match-05` | Four Islands        | `OFB105A` | Korinthal `(403,1296)`   | Medium     | 3 N       | Myrkwind; Lunareth; Sylvoria                                                                                   |
| `match-06` | Four Islands        | `OFB106`  | Sylvoria `(1328,322)`    | Hard       | 1 N + 4 T | Myrkwind; Danish Alliance; Zuni Hierarchy; York Kingdom; Hopi Army                                             |
| `match-07` | Great Lakes         | `OFB107A` | Detroit `(1120,1098)`    | Medium     | 5 N       | Toronto; Goderich; Parry Sound; Rouyn-Noranda; Green Bay                                                       |
| `match-08` | Great Lakes         | `OFB108`  | Duluth `(38,326)`        | Hard       | 3 N + 3 T | Marquette; Marathon; Wausau; Tuareg Supremacy; Ptolemaic District; Almohad Protectorate                        |
| `match-09` | Strait of Gibraltar | `OFB109`  | Andalusia `(1555,258)`   | Medium     | 3 N + 2 T | Spain; Portugal; Rif; Stuart Duchy; Mongolian Monkdom                                                          |
| `match-10` | Strait of Gibraltar | `OFB110`  | Morocco `(1287,1175)`    | Hard       | 1 N + 5 T | Shilha; Rashidun Territory; Latin Colony; Norwegian Matriarchy; Wolof Free State; Kazakh Queendom              |
| `match-11` | World               | `OFB111`  | Germany `(990,195)`      | Medium     | 7 N       | Cuba; South Africa; Japan; Peru; Chad; Oman; Antarctica                                                        |
| `match-12` | World               | `OFB112`  | New Zealand `(1890,775)` | Hard       | 5 N + 4 T | India; Poland; Romania; Antarctica; Iran; Hittite Republic; British Monkdom; Mapuche Federation; Filipino Army |

This matrix deliberately crosses continental, island, strait, inland-water, and
global geography; central and edge spawns; three to nine opponents; pure Nation
and mixed Nation/tribe rosters; and Medium and Hard AI. The launch acceptance
run MUST verify that every named spawn is land and that no selected Nation uses
the evaluated player's named anchor.

### 5.1 Match termination and authoritative placement

A match ends at the first of engine victory, evaluated-player elimination, 120
decisions while alive, 20 simulated minutes, the cost ceiling, the wall-clock
ceiling, or five consecutive decision failures. Cost and wall-clock termination
are valid outcomes and place the player using the last authoritative state.

At termination, surviving players rank by land tiles, descending. Eliminated
players rank after survivors, later elimination first; equal elimination ticks
break by land tiles immediately before elimination, then stable engine player
order. An engine-declared winner is rank 1. The initial field size is the LLM
plus all configured opponents.

For trial `i` with initial field size `P_i` and one-indexed rank `r_i`:

```text
match_points_i = 100 * (P_i - r_i) / (P_i - 1)
```

The match-suite headline is the unweighted macro-average of the twelve task
means, so larger lobbies and repeated trials do not receive more weight:

```text
match_score = mean_task(mean_trial(match_points))
```

Required diagnostics are win rate, mean placement, survival rate, final land
share, final troop share, victory/termination reason, decisions, validity,
latency, tokens, and cost. Match points reward relative game outcome without
creating map-specific territory thresholds; win rate remains visible and MUST
never be omitted from a leaderboard report.

## 6. Capability suite and development tools

Version 0.1 has exactly ten scored capability tasks, one per family. These are
new multi-map fixtures and all ten contribute to the capability score. The ten
existing Japan fixtures remain separate development tools: they can be inspected
and used freely while improving the prompt, observation, actions, or graders.
This separation reduces the risk of designing the harness around the exact
scored situations.

The scored fixtures below are required work, not fabricated finished fixtures.
They become benchmark tasks only after hashes, graders, references, controls,
and acceptance reports are frozen.

| Family                        | Development aid (not scored) | Public scored source             |
| ----------------------------- | ---------------------------- | -------------------------------- |
| Neutral expansion             | existing Japan/Kanto         | `match-08` Great Lakes/Duluth    |
| Saturated-capacity expansion  | existing Japan/Kanto         | `match-11` World/Germany         |
| Post-expansion recovery       | existing Japan/Kanto         | `match-04` Europe/Iceland        |
| Weaker-target selection       | existing Japan/Kanto         | `match-03` Europe/France         |
| Frontier restraint            | existing Japan/Kanto         | `match-10` Gibraltar/Morocco     |
| Incoming-attack response      | existing Japan/Kanto         | `match-07` Great Lakes/Detroit   |
| Split-front defense           | existing Japan/Kanto         | `match-06` Four Islands/Sylvoria |
| Losing-attack retreat         | existing Japan/Kanto         | `match-12` World/New Zealand     |
| Naval target recognition      | existing Japan/Kanto         | `match-09` Gibraltar/Andalusia   |
| Construction-failure recovery | existing Japan/Kanto         | `match-03` Europe/France         |

Canonical fixture IDs use
`cap-<family-slug>-<split>-<map-slug>-<three-digit-ordinal>`, for example
`cap-naval-target-recognition-scored-gibraltar-001`. A fixture source identifies
the base map, seed, spawn, difficulty, and opponent policy; ordered preparation
intents create the exact checkpoint.

The Japan development fixtures MAY be inspected while building the harness.
Scored fixtures MUST be generated and accepted after the evaluated prompt and
action policy are frozen. If scored results influence either, the next claim
MUST use a newly versioned scored fixture set.

## 7. Common capability fixture contract

Every scored capability fixture MUST:

- use a match task's pinned map, seed, spawn, difficulty, opponent counts, and
  assets;
- record ordered preparation intents, checkpoint tick, engine RNG state if not
  derivable, pre-decision state hash, and all periodic hashes;
- recreate identical normalized observation, legal menu, and tile-state hashes;
- start the evaluated player alive with at least one legal action (`hold`);
- expose enough information through the ordinary observation and menu for a
  capable agent to decide without hidden state;
- record its fixed horizon, grader version, thresholds, regions, entity roles,
  and checkpoint-relative ownership sets;
- resolve generated player, attack, unit, and action IDs to semantic fixture
  roles only when the checkpoint is built;
- contain one reference policy that passes five clean replays and at least two
  legal control policies that fail for the intended reason;
- admit any legal trajectory that reaches the graded outcome, regardless of
  action ID, troop fraction, or strategy wording; and
- be solvable without grader access, leaked metadata, stale files, cross-trial
  state, exact generated IDs, or provider-specific behavior.

Unless a family says otherwise, the player is not one decision interval from
timer victory or elimination and has no hostile incoming attack. After the
decision, the ordinary built-in policies advance the engine to the exact fixed
horizon or earlier terminal state.

Each trial uses a fresh process or proven-equivalent reset. It MUST NOT share
mutable maps, game objects, files, caches, rate-limit state, or conversation
history with another trial. Fixture order is randomized from a recorded runner
seed. Configurations in a comparison are interleaved.

## 8. Capability families and graders

Every required assertion is evaluated against authoritative engine state. The
concrete thresholds and role-owned tile sets live in the frozen fixture
manifest, not in agent-visible input.

### 8.1 Neutral expansion

**Capability:** Spend a safe early troop surplus on neutral territory.

**Checkpoint:** No opponent border or incoming attack; bordered unclaimed land;
70–90% troop capacity; no active neutral expansion; all four expansion fractions
available.

**Horizon:** 100 ticks.

**Pass:** Own at least one tile that was neutral at checkpoint.

### 8.2 Saturated-capacity expansion

**Capability:** Recognize that waiting at maximum capacity does not rebuild the
army.

**Checkpoint:** At least 98% capacity with near-zero growth; bordered unclaimed
land; no hostile border or incoming attack; positive `spendableTroops`.

**Horizon:** 100 ticks.

**Pass:** Own at least one tile that was neutral at checkpoint.

### 8.3 Post-expansion recovery

**Capability:** Rebuild after expansion without surrendering territory.

**Checkpoint:** At most 20% capacity; one active neutral expansion; no incoming
attack; at least one small troop-spending distractor remains legal.

**Horizon:** 100 ticks.

**Pass:** Alive; capacity increased; land-tile count is not below checkpoint.

### 8.4 Weaker-target selection

**Capability:** Progress against a vulnerable opponent when a dangerous
alternative is also available.

**Checkpoint:** Exactly two attackable bordered opponents with land-attack
candidates; weak target has at most 40% of player troops; other has 80–99%; no
incoming attacks or alliances; weak target has capturable adjacent territory.

**Horizon:** 200 ticks.

**Pass:** Own at least one checkpoint tile of the designated weak target.

### 8.5 Frontier restraint

**Capability:** Avoid a low-value attack while rebuilding against a nearly equal
opponent.

**Checkpoint:** Exactly one attackable bordered opponent at 75–95% of player
troops; player at 55–70% capacity; attack candidates exist; no incoming or
outgoing attack; calibrated protected frontier tiles.

**Horizon:** 200 ticks.

**Pass:** Alive; capacity increased; losses in `protectedTiles` do not exceed
`maximumAllowedTileLoss`.

### 8.6 Incoming-attack response

**Capability:** Preserve threatened territory during one active incoming land
attack.

**Checkpoint:** Exactly one hostile incoming attack; counter candidates at 25%,
50%, 75%, and 100% of the capped emergency budget; calibrated such that a
reference defense passes and hold fails.

**Horizon:** 200 ticks.

**Pass:** Alive; losses in `protectedTiles` do not exceed the fixture maximum.

### 8.7 Split-front prioritization

**Capability:** Prioritize the more dangerous of two simultaneous attacks.

**Checkpoint:** Exactly two opponents attack with materially unequal incoming
forces; both have legal counters; the dangerous and lesser frontier tile sets
are disjoint.

**Horizon:** 200 ticks.

**Pass:** Alive; dangerous-front loss and combined protected-territory loss stay
within their frozen maxima. Hold and countering only the lesser threat fail
calibration.

### 8.8 Losing-attack retreat

**Capability:** End a deteriorated offensive commitment and recover forces.

**Checkpoint:** Exactly one outgoing attack with force at most 25% of defender
troops; negligible prior-interval progress; retreat is legal; no incoming
attack; calibrated `minimumRecoveredTroops`.

**Horizon:** 100 ticks.

**Pass:** Alive; original attack inactive; available troops meet the fixture
minimum; land-tile count is not below checkpoint.

### 8.9 Naval target recognition

**Capability:** Establish a foothold against a vulnerable target unreachable by
land.

**Checkpoint:** No land border with target; legal transport attack; target has at
most 40% of player troops; no land attack against an opponent; no incoming
attack.

**Horizon:** 300 ticks.

**Pass:** Own at least one checkpoint tile of the designated target.

### 8.10 Construction-failure recovery

**Capability:** Recover from stale construction failure and establish a needed
defensive structure.

**Checkpoint:** Most recent decision has failed Defense Post construction with
`anchor_lost` or `placement_blocked`; failed structure absent; sufficient gold;
new candidate at a different anchor; hostile border but no incoming attack;
replacement deterministically completes in a calibrated defense zone.

**Horizon:** 200 ticks.

**Pass:** Alive; own a completed active Defense Post in `defenseZoneTiles`.

For all families, required diagnostics include each assertion's observed value,
threshold, outcome, action lifecycle, troop/capacity minimum and final values,
territory change, relevant attacks or units, and terminal state.

## 9. Capability grading and aggregate

A capability trial is binary:

```text
task_pass = AND(required assertions)
task_score = 100 if task_pass else 0
component_coverage = passed assertions / required assertions
```

Component coverage is diagnostic partial credit only. Retries, wording, action
IDs, slot order, or a preferred reference path MUST NOT add or remove gameplay
credit.

For fixture `f`, `pass@1_f` is successes divided by valid trials. In version 0.1
there is one scored fixture per family, so each scored family rate equals that
fixture's rate.

```text
capability_score = 100 * mean(pass@1 of the ten scored fixtures)
```

All ten family rates MUST accompany the aggregate. Results from the Japan
development tools MUST NOT be included. The capability score is never averaged
with match score.

## 10. Repetitions and statistics

Predeclare trial counts before execution:

- smoke/development: one match trial per task and at least ten capability trials
  per fixture;
- complete version 0.1 result: three match trials per task and ten
  capability trials per scored fixture, for 36 matches and 100 capability
  decisions in total; and
- paired comparison: identical task membership and valid-trial target for every
  configuration.

Do not stop early, drop legal failures, or select the best trial. Infrastructure-
invalid trials are rerun until the declared valid count is reached or the run is
reported incomplete.

For each capability fixture report successes, valid trials, empirical `pass@1`,
95% Wilson interval, mean component coverage, and estimated
`pass^3 = pass@1^3`. Label `pass^3` as an estimate, not an observed result.

For each match task report mean match points with a percentile-bootstrap 95%
interval, wins, placement distribution, and survival. For each suite aggregate,
use a stratified bootstrap that resamples trials within tasks and tasks within
map or capability strata. Publish the bootstrap seed and at least 10,000
replicates. Heterogeneous tasks MUST NOT be treated as one binomial sample.

Comparisons report paired task-level differences with bootstrap intervals.
Claims of improvement MUST show both aggregate suites and all per-map/per-family
results; an aggregate gain does not erase a material regression.

## 11. Interface reliability, latency, and cost

The following are mandatory separate metrics and never change gameplay grades:

- first-attempt valid response rate;
- corrective retry rate by stable failure code;
- fallback-to-holds and five-failure abort rates;
- resolved/applied/rejected action lifecycle outcomes;
- total decision latency and per-attempt TTFT, generation time, and TPOT;
- prompt and completion tokens;
- model cost per decision, task, and complete suite; and
- peak runner memory and wall-clock time for reproducibility diagnostics.

Report median and p95 latency, mean cost, total cost, and raw counts. Cached
tokens and provider discounts MUST be identified. Unknown cost is reported as
unknown, never zero.

## 12. Invalid trials

A trial is invalid only when infrastructure cannot present or grade the frozen
task: map/checkpoint/hash mismatch, wrong roster, engine or runner crash not
caused by agent output, missing metadata, corrupted artifact, or grader
exception. Record the reason and rerun.

Provider errors, timeouts, malformed output, retries, production fallback,
agent-triggered cost ceiling, and legal but harmful actions are valid outcomes.
If attribution is unclear, preserve the artifact, mark it `needs-review`, and do
not silently exclude it. The benchmark maintainer makes a documented ruling
before publication.

## 13. Manifest, trace, and artifact contract

### 13.1 Release manifest

The signed canonical JSON manifest covers only the 22 public benchmark tasks and
MUST contain:

- benchmark semantic version, release date, license, and maintainer;
- OpenFront version/commit and SHA-256 for every map asset;
- harness commit, prompt version/hash, schema versions, resolver version, troop
  policy, grader package hash, and complete resolved configuration;
- every task ID, suite, split, map enum/path, seed, fixed spawn, difficulty,
  Nation/tribe counts, ordered expected roster, and all ceilings;
- capability preparation turns, checkpoint tick and hashes, horizon, semantic
  roles, thresholds, ownership sets, and grader version;
- reference/control policy hashes and acceptance-report paths; and
- the canonical task-order randomization algorithm, runner seed format, and
  bootstrap implementation/version.

The release archive MUST include JSON Schema files for the manifest, trial, and
run report. Canonical JSON uses UTF-8, sorted object keys, no insignificant
whitespace, decimal integers, and SHA-256 lowercase hex.

### 13.2 Trial trace

Every trial MUST record:

- benchmark version, task/fixture/family/split, grader version, and run UUID;
- model, immutable model revision when available, provider, routing, reasoning,
  request parameters, prompt hash, timestamps, and runner host metadata;
- checkpoint, observation, menu, tile-state, periodic, and final hashes;
- exact normalized observations and legal menus shown to the model;
- accepted public strategy note and selected action IDs;
- failed-attempt codes, retries, fallback state, usage, cost, and latency;
- resolved intents and post-execution lifecycle events;
- each assertion's observed value, operator, threshold, pass/fail, component
  coverage, and task grade; and
- a renderer-compatible sparse OpenFront game record containing spawn,
  preparation, agent decisions, rollout, intent-bearing turns, and periodic
  hashes.

Raw rejected output and private chain-of-thought are not required and SHOULD NOT
be retained. Public strategy notes are untrusted text and MUST be escaped when
rendered.

### 13.3 Run report

The report stores manifest hash, declared and completed trial counts, task order,
all trial references, invalid counts/reasons, per-task summaries, suite
aggregates, confidence intervals, reliability, interface metrics, cost/latency,
and the exact CLI invocation with secrets removed. Writes are atomic and partial
runs remain inspectable.

## 14. Public running and maintainer-hosted leaderboard

### 14.1 Running the public benchmark

Anyone MAY clone the tagged release, supply their own OpenRouter credentials,
and run the same frozen Standard configuration. Version 0.1 MUST provide this
workflow:

```bash
git clone --recurse-submodules https://github.com/fahimahmedx/openfront-harness.git
cd openfront-harness
npm run inst
cp example.env .env
# Set OPENROUTER_API_KEY, OPENROUTER_MODEL, and optionally OPENROUTER_PROVIDER.
npm run benchmark:smoke
npm run benchmark:run -- --profile official
npm run benchmark:verify -- data/benchmarks/<run-id>
```

`benchmark:smoke` checks credentials, model availability, structured output,
one map/checkpoint path, replay generation, and cost estimation without producing
a complete score. `benchmark:run` executes the recorded randomized schedule,
writes atomically, and supports safe resume without permitting trial selection.
`benchmark:verify` makes no model calls and checks schemas, manifest and harness
hashes, task/trial counts, configuration consistency, rosters, spawns,
checkpoints, replayed decisions, final hashes, graders, aggregates, artifact
uniqueness, and duplicate traces.

A locally verified report MAY be published by its owner. It SHOULD include all
artifacts needed for reproduction and disclose whether public test tasks
influenced model or request-parameter selection. External reports MUST identify
themselves as `external-self-run` and MUST NOT imply inclusion in, verification
by, or endorsement from the hosted OpenFront leaderboard.

The project provides no score-upload endpoint, score-submission form, pull-
request process, or email review path. The maintainer does not ingest external
reports or artifacts into the hosted leaderboard.

### 14.2 Hosted leaderboard

The hosted leaderboard contains only first-party Standard runs executed by
`fahimahmedx` using the frozen release and maintainer-controlled runner. The
maintainer selects model/provider configurations, supplies credentials, runs
the complete schedule, validates and replays every artifact, reviews all wins,
invalid trials, and unusual terminations, and then publishes the result.

The leaderboard shows, at minimum: rank, match score with interval, win rate,
capability score with interval, all map and capability subscores, first-attempt
validity, p50/p95 latency, total/mean cost, model revision, provider, benchmark
version, run date, test-informed status, and links to downloadable reports and
replays. Test-informed first-party configurations remain ranked with a prominent
label and optional filter. Incomplete runs MAY be displayed as `preview` but do
not receive a rank. Results from different benchmark versions are never placed
in one ranking.

## 15. Fixture acceptance and release gates

Before a scored capability fixture enters the benchmark, its acceptance report
MUST show:

1. identical state, observation, menu, and tile hashes in five clean rebuilds;
2. machine checks for every checkpoint requirement;
3. reference policy passes all assertions in five clean replays;
4. at least two different legal successful decisions when alternatives exist;
5. at least two meaningful legal controls score zero, including one plausible
   distractor;
6. boundary tests just below, at, and just above every threshold where possible;
7. no success through metadata edits, generated-ID matching, text claims, stale
   state, or cross-trial leakage;
8. a blinded human can identify the strategic tradeoff from ordinary input;
9. reference/control trace review finds the outcome fair and attributable; and
10. no map, spawn, opponent, prompt, or horizon gives away the family label.

Before `openfront-bench-v0.1` release, the maintainer MUST also complete:

- generic Node map loading with an allowlist and asset-hash verification;
- scenario objects for all twelve match rows and tests for land spawns, rosters,
  field sizes, difficulty, config hashes, and deterministic clean starts;
- multi-map observation, action, pathfinding, checkpoint, replay, and renderer
  tests;
- the ten scored capability fixtures and their ten acceptance reports;
- passing deterministic tests for the ten existing Japan development fixtures;
- isolated-process execution and recorded randomized/interleaved ordering;
- match scoring, tie-breaking, stratified bootstrap, report schema, and artifact
  validator tests with golden examples;
- a reference agent smoke run over every match and capability task;
- replay verification of every reference/control trace and one complete
  first-party run through leaderboard publication;
- benchmark and artifact licenses, security/privacy review, contribution guide,
  public-running guide, leaderboard publication policy, and a documented
  maintainer/contact; and
- a release candidate with no unresolved impossible, ambiguous, leaking, or
  nondeterministic task.

A 0% model pass rate triggers an audit before being called model failure. An
impossible reference, valid creative solution rejected by the grader, ambiguous
input, or harness-induced failure is an evaluation bug.

## 16. Review, contamination, maintenance, and versioning

For each release, review every unexpected reference/control result, every grader
dispute, every invalid trial, all failures from a new fixture, at least 10% of
passing model trials, and at least 20% of failing trials (minimum five from each
available class). Classify findings as ambiguity, grader bug,
harness/environment bug, genuine policy failure, or valid novel solution.

Do not manually flip a frozen score. Fix the implementation, issue a new patch
version if task semantics do not change or a new minor/major version if they do,
and rerun affected comparisons.

Anyone publishing an external result SHOULD disclose whether public tasks,
artifacts, or replays were used for training, fine-tuning, prompt development,
policy rules, request-parameter selection, or model selection. This disclosure
is self-reported and is not verified by the benchmark maintainer. First-party
leaderboard runs record the same disclosure and prominently label a
configuration `test-informed` when applicable. A custom policy or
fixture-specific lookup is not comparable to the frozen Standard configuration.

A capability fixture is saturated after at least 95% observed `pass@1` over 50
trials in two releases with no grader dispute. It MAY graduate to a separately
versioned regression suite and be replaced by a harder fixture.

Semantic versioning rules are:

- **patch:** artifact/schema clarification or bug fix that provably leaves every
  accepted action sequence and grade unchanged;
- **minor:** task, threshold, grader, prompt, harness policy, map asset, or split
  change that invalidates score equivalence; and
- **major:** engine upgrade, agent interface change, suite/scoring definition
  change, or material benchmark-purpose change.

Prompt, model, provider, reasoning, or request changes identify a new evaluated
configuration. Except for the frozen Standard prompt itself, they do not change
the benchmark version. Comparisons across non-equivalent versions are labeled
historical; the hosted leaderboard does not rank different versions together.

## 17. Resolved launch decisions

Version 0.1 launches with these owner-approved decisions:

1. The benchmark is public and anyone may run the frozen Standard configuration
   with their own OpenRouter credentials and publish an `external-self-run`
   report.
2. The hosted leaderboard contains only first-party runs executed and published
   by `fahimahmedx`. External scores are not accepted, verified, or ranked, and
   there is no submission workflow.
3. A complete configuration runs three trials for each of twelve full-match
   tasks and ten trials for each of ten scored capability fixtures: 36 matches
   and 100 capability decisions, with a configured maximum model cost of USD 46.
4. Test-informed first-party Standard entries remain ranked with a prominent
   disclosure label and an optional leaderboard filter.
5. The named benchmark maintainer is
   [`fahimahmedx`](https://github.com/fahimahmedx).
