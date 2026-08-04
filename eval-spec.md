# OpenFront Agent Micro-Eval Specification

Status: proposed capability suite, version `openfront-micro-v1`.

This specification follows the evaluation practices described in Anthropic's
[Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):
grade outcomes rather than prescribed trajectories, prove tasks with reference
solutions, isolate trials, combine deterministic grading with trace review, and
report repeated-trial reliability instead of a single score.

## 1. Purpose and scope

This suite measures whether an agent makes sound local decisions while playing
OpenFront through the production harness. It complements the full `japan-v5`
match:

- the full match measures whether a policy can win one long episode; and
- the micro-eval identifies which game-playing capabilities succeed or fail.

`openfront-micro-v1` is a **capability eval**. Its tasks should contain useful
headroom and may initially have low pass rates. It is not a regression gate.
Stable, saturated fixtures may later be copied into a separately versioned
regression suite whose expected pass rate is near 100%.

The suite evaluates the model and agent harness together. The agent receives the
production game prompt, normalized observation, and legal action menu; it does
not receive the task name, fixture metadata, grader, reference policy, or
expected outcome. Its response goes through the production provider request,
schema validation, retry, resolver, troop policy, and OpenFront engine.

This suite does not replace unit tests for schemas, validators, action conflicts,
or replay determinism. Those test whether the harness is implemented correctly;
the micro-eval tests the policy expressed through that harness.

## 2. Evaluation vocabulary

| Term              | Meaning in this suite                                                                                                                           |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability family | One of the ten behaviors in section 8.                                                                                                          |
| Fixture           | One deterministic checkpoint and its hidden grader metadata.                                                                                    |
| Task              | Running one fixture with one model/configuration.                                                                                               |
| Trial             | One independent attempt at a task.                                                                                                              |
| Trace             | The observation, legal menu, accepted decision, attempt diagnostics, applied intents, lifecycle events, state hashes, and metrics from a trial. |
| Outcome           | The authoritative OpenFront state at the end of the evaluation horizon or earlier terminal state.                                               |
| Assertion         | One deterministic check against the outcome.                                                                                                    |
| Reference policy  | A known legal decision that passes every required assertion.                                                                                    |
| Control policy    | A legal, plausible decision used to demonstrate that the grader rejects a meaningful failure.                                                   |

A provider retry is part of one trial; it is not another trial. Replaying a
recorded decision is a determinism check; it is not an independent model trial.

## 3. Dataset design

Version 1 contains ten capability families and **at least two fixtures per
family**, for a minimum of 20 tasks. One checkpoint per family is not sufficient
for release because it makes task-specific overfitting too easy and yields a
fragile aggregate.

Fixtures are divided before model or prompt tuning:

- **development fixtures** may be inspected while building the harness; and
- **test fixtures** are not used to change the evaluated prompt, action policy,
  or model configuration before a published comparison.

Because this is an open repository, “test” means procedurally held out, not
secret forever. A used test set may be published for reproducibility, but new
comparisons that were tuned against it must use a newly versioned test set.
Published headline scores use the test split only. Development results may be
shown for diagnosis but must be labeled and must never be pooled with test
results.

New fixtures should come from real evidence in this order:

1. failures found in full-match traces;
2. behaviors manually checked before a release;
3. bug reports or user-observed failures; and
4. intentionally constructed boundary cases for an existing capability.

The suite must contain contrasting cases so that optimization is not one-sided.
In particular, it tests expansion and recovery, offense and restraint, one-front
and two-front defense, and land and naval reachability. Within a family,
fixtures must vary at least one strategically relevant factor such as opponent,
troop ratio, geography, preparation trajectory, or threshold.

## 4. Common fixture contract

Every fixture must:

- use the pinned OpenFront version and map assets;
- record the source seed, ordered preparation intents, checkpoint tick, engine
  RNG state if not derivable, and pre-decision state hash;
- recreate the same normalized observation and legal candidate menu, verified
  by hashes of their canonical serialized forms;
- start the LLM player alive with exactly two action slots;
- expose enough information in the normal observation and menu for a capable
  agent to decide correctly, without relying on hidden engine state;
- make every grader-checked requirement either clear from the prompt or a
  natural consequence of the stated game rules;
- record its evaluation horizon and all thresholds, regions, entity roles, and
  checkpoint-relative ownership sets used by the grader;
- identify entities by fixture roles in metadata, resolving generated IDs only
  when the checkpoint is built;
- include one reference policy that passes and at least two control policies
  that fail for the intended reason; and
- be solvable without exploiting grader access, leaked metadata, stale files,
  another trial's state, or exact generated IDs.

Unless a family says otherwise, the player is not within one decision interval
of timer victory or elimination and has no hostile incoming attack.

Each trial starts in a fresh process or equivalently reset engine instance. It
must not share files, caches, mutable game objects, rate-limit state, or model
conversation history with another trial. Fixture execution order should be
randomized, and configurations in a comparison should be interleaved to reduce
time-of-day and provider-drift bias.

After the decision is applied, the engine advances for the fixture's fixed
horizon using the ordinary built-in nation policies. If the game ends first,
the terminal state is the outcome. Otherwise, the state at the exact final tick
is the outcome. The grader compares checkpoint metadata with this authoritative
state, not with the agent's strategy note or a claimed result.

## 5. Grading

### 5.1 Primary outcome grade

Every task has one or more required deterministic assertions. A trial passes
only when **all** required assertions pass:

```text
task_pass = AND(required assertions)
task_score = 100 if task_pass else 0
```

The grader may inspect core state, ownership, units, attacks, resources, and
terminal outcome. It must not award or remove gameplay credit based on action
IDs, slot order, action count, troop fraction, strategy wording, retries, or a
preferred trajectory. Any legal decision that reaches the required outcome
passes.

If a task has multiple assertions, also report `component_coverage`, the
fraction that passed. This is diagnostic partial credit, not the headline score;
it distinguishes a near miss from a total failure without weakening the task's
success contract.

### 5.2 Other graders and metrics

Code-based transcript checks report interface reliability separately:

- first-attempt valid response rate;
- retry rate by stable failure code;
- fallback-to-holds rate;
- applied-action lifecycle outcomes;
- total decision latency and per-attempt TTFT/generation metrics; and
- prompt tokens, completion tokens, and model cost.

These checks do not alter the outcome grade. A retry or fallback can still cause
the gameplay outcome to fail, which is the appropriate consequence when the
production harness behaves that way.

No LLM judge is required for version 1. The outcomes are machine-verifiable, and
the public strategy note is not reliable evidence of the policy's reasoning. If
a future task needs a model grader, it must have a single-dimension rubric, an
`unknown` option, examples at each score boundary, and measured agreement with
expert human labels before release.

### 5.3 Invalid trials

A trial is invalid and rerun only when the eval infrastructure cannot present or
grade the task—for example, checkpoint hash mismatch, engine crash, missing
fixture metadata, or grader exception. Report invalid-trial counts and reasons.

Provider errors, malformed model responses, corrective retries, and production
fallbacks are agent-harness behavior. They remain valid trials and count toward
the result.

## 6. Repeated trials and statistics

Model generation is unseeded, so a single attempt is anecdotal. Predeclare the
number of trials before starting:

- development runs: at least 10 trials per fixture; and
- published model/configuration comparisons: at least 20 trials per fixture.

Larger samples are required when the intended decision depends on a small score
difference. Do not stop early because a result looks favorable, discard legal
failures, or select the best sample.

For every fixture, report:

- successes and total valid trials;
- empirical `pass@1` (successes divided by trials);
- a 95% Wilson confidence interval for `pass@1`;
- mean component coverage; and
- estimated `pass^3 = pass@1³`, labeled as an estimate of three-run
  consistency rather than an observed result.

For each capability family and the suite aggregate, report the macro-average of
its fixture rates with a stratified bootstrap confidence interval that resamples
trials within fixtures and fixtures within families. Do not treat heterogeneous
fixtures as one identically distributed binomial sample.

`pass@k` for `k > 1` is not a headline metric because the deployed harness gets
one gameplay decision, not multiple solutions from which an oracle selects the
best. If a future product actually permits multiple attempts and defines a
selection rule, that system may report observed `pass@k` separately.

For comparisons, use the same eval version and trial count, interleave runs, and
report the pass-rate difference with a confidence interval. Claims of
improvement must not be based only on overlapping point estimates or on the
aggregate hiding a regressed family.

## 7. Required trace and run metadata

Every trial record must contain enough evidence to reproduce the engine outcome
and audit the grade:

- eval version, suite split, family ID, fixture ID, and grader version;
- OpenFront commit, scenario ID, prompt version, harness commit, model, provider,
  reasoning configuration, request parameters, and run timestamp;
- checkpoint state, observation, and candidate-menu hashes;
- exact normalized observation and legal candidate menu shown to the model;
- accepted strategy note and selected action IDs;
- failed-attempt codes, retries, fallback state, and usage/latency metrics;
- resolved intents and post-execution lifecycle events;
- checkpoint, periodic, and final state hashes; and
- each assertion's observed value, threshold, pass/fail result, and overall
  task grade.
- a renderer-compatible OpenFront game record containing the preparation,
  evaluated decision, rollout horizon, intent-bearing turns, and periodic
  hashes.

The trace need not persist private chain-of-thought or raw rejected model text.
Existing privacy and artifact-retention rules continue to apply.

## 8. Capability families

The requirements below define a family. Each released fixture supplies concrete
checkpoint-relative IDs, ownership sets, and calibrated thresholds.

### 1. Neutral expansion

**Capability:** Converts a safe early troop surplus into neutral territory
instead of waiting unnecessarily.

**Checkpoint requirements:**

- No shared border with an opponent and no incoming attack.
- Unclaimed land borders the player's territory.
- Troop capacity is between 70% and 90%.
- No outgoing neutral expansion is still consuming troops.
- All four neutral-expansion fractions are available in both slots.

**Horizon:** 100 ticks.

**Required assertion:** The player owns at least one tile that was neutral at
the checkpoint.

**Diagnostics:** Neutral tiles gained, troop capacity, and action lifecycle
outcomes.

### 2. Saturated-capacity expansion

**Capability:** Understands that holding at maximum troop capacity does not
rebuild the army further.

**Checkpoint requirements:**

- Troop capacity is at least 98% and troop growth is near zero.
- Unclaimed bordered land and neutral-expansion actions are available.
- There is no incoming attack or hostile shared border.
- The observation reports positive `spendableTroops`.

**Horizon:** 100 ticks.

**Required assertion:** The player owns at least one tile that was neutral at
the checkpoint.

**Diagnostics:** Neutral tiles gained, troop capacity, troop growth, and action
lifecycle outcomes. Strategy wording may be inspected during trace review but
is not a metric.

### 3. Post-expansion recovery

**Capability:** Rebuilds troop capacity without surrendering territory after an
expansion has depleted the army.

**Checkpoint requirements:**

- Troop capacity is at most 20%.
- At least one outgoing neutral expansion is active.
- There is no hostile incoming attack.
- At least one small troop-spending action remains legal, so the menu does not
  force inaction.
- A no-new-commitment reference policy survives more reliably than the largest
  offered new troop commitment.

**Horizon:** 100 ticks.

**Required assertions:**

- The player is alive.
- Troop capacity is greater than at the checkpoint.
- The player owns at least as many land tiles as at the checkpoint.

**Diagnostics:** Capacity change, minimum capacity, territory change, new troops
committed, and survival.

### 4. Weaker-target selection

**Capability:** Makes progress against a vulnerable opponent when a more
dangerous alternative is also available.

**Checkpoint requirements:**

- The player shares borders with exactly two attackable opponents.
- Both opponents have proactive land-attack candidates.
- The designated weak opponent has at most 40% of the player's troops.
- The other opponent has between 80% and 99% of the player's troops.
- Neither opponent has an active incoming attack against the player.
- The weak opponent owns enough adjacent territory for measurable progress.
- The player is allied with neither opponent.

**Horizon:** 200 ticks.

**Required assertion:** The player owns at least one tile that the designated
weak opponent owned at the checkpoint.

**Diagnostics:** Checkpoint-owned tiles captured from each opponent, territory
change, active attacks, troop capacity, and action lifecycle outcomes.

### 5. Frontier restraint

**Capability:** Avoids a low-value offensive commitment when the only available
opponent is nearly as strong and rebuilding is safer.

**Checkpoint requirements:**

- The player shares a border with exactly one attackable opponent.
- The opponent has between 75% and 95% of the player's troops.
- Troop capacity is between 55% and 70%, so proactive attack candidates exist
  but the player is not saturated.
- There is no incoming hostile attack or active outgoing attack.
- The fixture records frontier `protectedTiles` and
  `maximumAllowedTileLoss`.
- A conservative reference policy increases capacity and protects the frontier;
  selecting the largest offered attack in both slots fails at least one required
  assertion.

**Horizon:** 200 ticks.

**Required assertions:**

- The player is alive.
- Troop capacity is greater than at the checkpoint.
- No more than `maximumAllowedTileLoss` protected tiles are owned by another
  player.

**Diagnostics:** Troop commitment, minimum and final capacity, protected tiles
lost, and territory change. Holding is not required if another legal strategy
produces the same outcome.

### 6. Incoming-attack response

**Capability:** Preserves threatened territory during one active incoming
attack.

**Checkpoint requirements:**

- Exactly one opponent has a hostile incoming land attack.
- The force threatens meaningful territory but is small enough that counter
  candidates exist.
- Counter variants at 25%, 50%, 75%, and 100% of the capped per-slot emergency
  budget are available.
- The fixture records frontier `protectedTiles` and
  `maximumAllowedTileLoss`, calibrated so a reference defense passes and double
  hold fails.

**Horizon:** 200 ticks.

**Required assertions:**

- The player is alive.
- No more than `maximumAllowedTileLoss` protected tiles are owned by another
  player.

**Diagnostics:** Protected tiles lost, attacker ownership gains, incoming force
remaining, minimum troop capacity, and action lifecycle outcomes.

### 7. Split-front defense

**Capability:** Preserves both threatened frontiers during simultaneous incoming
attacks.

**Checkpoint requirements:**

- Exactly two opponents have hostile incoming attacks.
- Their incoming troop counts differ by no more than 10%.
- Both attackers have counterattack candidates in both slots.
- Neither attack is already certain to fail without a response.
- The fixture records disjoint `protectedTiles` and a separate
  `maximumAllowedTileLoss` for each frontier.

**Horizon:** 200 ticks.

**Required assertions:**

- The player is alive.
- Frontier A loses no more than its `maximumAllowedTileLoss`.
- Frontier B loses no more than its `maximumAllowedTileLoss`.

**Diagnostics:** Protected tiles lost on each frontier, ownership gains by each
attacker, incoming forces remaining, minimum troop capacity, and whether a legal
two-attacker response was rejected.

### 8. Losing-attack retreat

**Capability:** Ends a deteriorated offensive commitment and recovers forces
without losing territory.

**Checkpoint requirements:**

- The player has exactly one outgoing attack.
- Its force is at most 25% of the defender's current troops.
- It made negligible progress during the preceding decision interval.
- A retreat action for it is legal.
- The player has no hostile incoming attack.
- The fixture records `minimumRecoveredTroops`, calibrated so a timely reference
  retreat reaches it and allowing the attack to continue does not.

**Horizon:** 100 ticks.

**Required assertions:**

- The player is alive.
- The original losing attack is no longer active.
- Available troops are at least `minimumRecoveredTroops`.
- The player owns at least as many land tiles as at the checkpoint.

**Diagnostics:** Original attack status, troops recovered, territory change,
outgoing attack count, and action lifecycle outcomes. A retreat action itself is
not required if another legal method reaches the outcome.

### 9. Naval target recognition

**Capability:** Establishes a foothold against a vulnerable opponent that cannot
be reached by land.

**Checkpoint requirements:**

- The player does not share a border with the designated target.
- A transport-ship attack against the target is legal.
- The target has at most 40% of the player's troops.
- No land attack against any opponent is available.
- There is no hostile incoming attack.

**Horizon:** 300 ticks.

**Required assertion:** The player owns at least one tile that the designated
target owned at the checkpoint.

**Diagnostics:** Target tiles captured, transports started or failed, landing
events, transport troops remaining, and territory change.

### 10. Construction-failure recovery

**Capability:** Recovers from a stale construction failure and establishes a
needed defensive structure.

**Checkpoint requirements:**

- The most recent decision records a failed Defense Post construction with
  `failureCode: "anchor_lost"` or `"placement_blocked"`.
- The failed structure does not exist.
- The player has enough gold and a new legal Defense Post candidate at a
  different anchor.
- The player has a hostile shared border but no active incoming attack.
- The selected replacement completes under the deterministic rollout.
- The fixture records `defenseZoneTiles`, the acceptable protected area for the
  replacement.

**Horizon:** 200 ticks.

**Required assertions:**

- The player is alive.
- The player owns a completed, active Defense Post within `defenseZoneTiles`.

**Diagnostics:** Defense Post location and status, distance from the hostile
frontier, construction lifecycle outcomes, and any second failure code.

## 9. Fixture acceptance gate

Before a fixture enters either split, its owner must provide an acceptance
report showing that:

1. The checkpoint reproduces the same state, observation, and menu hashes in
   five clean local rebuilds.
2. Every checkpoint requirement is asserted from the normalized observation,
   legal candidates, or authoritative core state.
3. The reference policy passes every grader in five clean replays.
4. At least two meaningfully different legal decisions that reach the required
   outcome also pass, when the family admits alternatives.
5. At least two control policies miss the intended outcome and score zero; one
   should be a plausible distractor, not merely malformed output.
6. Boundary-value tests exercise every threshold just below, at, and just above
   the pass boundary where the engine permits construction of those states.
7. The grader cannot be satisfied by changing fixture metadata, matching a
   generated action ID, claiming success in text, or exploiting state left by a
   previous trial.
8. A human reviewer, without hidden grader metadata, can independently identify
   the intended strategic tradeoff from the same observation and menu.
9. The reviewer reads the reference and control traces and confirms that each
   failure is fair, attributable, and not caused by ambiguous instructions or a
   harness constraint.

A 0% success rate across many trials triggers a fixture audit before it is
interpreted as a model limitation. An impossible reference policy, an ambiguous
task, or a valid creative solution rejected by the grader is an eval bug.

## 10. Aggregate reporting

Aggregate one named split at a time and by capability family so families with
extra fixtures do not receive more weight:

```text
family_pass@1 = mean(fixture pass@1 within the family)
micro_eval_score = 100 * mean(family_pass@1 across the 10 families)
```

The headline report must show:

| Metric                   | Meaning                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| Micro-eval score         | Macro-average `pass@1`, scaled to 0–100, with a bootstrap 95% confidence interval over fixtures. |
| Per-family `pass@1`      | Macro-average fixture success rate with a stratified bootstrap interval.                         |
| Reliability              | Per-family and macro-average estimated `pass^3`.                                                 |
| Component coverage       | Mean fraction of required outcome assertions satisfied.                                          |
| First-attempt validity   | Responses accepted without a corrective retry.                                                   |
| Retry and fallback rates | Rates with counts and stable failure codes.                                                      |
| Latency                  | Median and p95 total decision latency; per-attempt timing remains available.                     |
| Cost                     | Mean cost per task and estimated cost per 100 decisions.                                         |
| Invalid trials           | Count and reason, excluded from the denominator.                                                 |

Always show all ten family results beside the aggregate. Full-match win rate,
placement, territory, victory type, decision count, cost, and latency remain a
separate report and are never folded into the micro-eval score.

## 11. Trace review, maintenance, and versioning

Automated scores are not accepted at face value. For each candidate release:

- review every unexpected reference/control result;
- review every apparent grader disagreement or novel solution;
- review all failures for a new fixture during acceptance; and
- sample at least 10% of passing and 20% of failing model trials, with a minimum
  of five from each class when available.

Record review findings as task ambiguity, grader bug, harness/environment bug,
genuine policy failure, or valid novel solution. Do not manually flip a frozen
trial's score. Fix the fixture or grader, increment the eval version, and rerun
the comparison.

The suite has a named maintainer. Product and domain contributors may add tasks,
but the maintainer owns fixture isolation, grader tests, release reports, and
versioning. New real-world failures should be converted into development tasks
before prompt changes are made.

A capability fixture is considered saturated when it no longer distinguishes
current configurations. Graduation to the regression suite is explicit, not
automatic: it requires at least 95% observed `pass@1` over 50 or more trials in
two evaluation releases, no unresolved grader disputes, and a frozen grader.
Regression fixtures should run continuously and target near-100% pass rates;
the capability suite should receive harder replacements as it saturates.

Any change to checkpoint construction, horizon, grader logic, threshold,
fixture membership, split assignment, or aggregation creates a new eval version.
Prompt, model, provider, reasoning, or agent-harness changes define a new
evaluated configuration and must be recorded, but do not by themselves change
the eval version. Comparisons across eval versions must be labeled non-equivalent.
