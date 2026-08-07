  # Single-Action Harness

  ## Summary

  - Require exactly one action per model decision, including an explicit hold.
  - Introduce agent-v13, scenario japan-v6, and run artifact schema 3.
  - Preserve old two-action artifacts only through a read-only replay path with full discovery, playback, and two-row decision traces.
  - Replace benchmark v0.1 in place with a strictly one-action contract; old benchmark artifacts will be rejected.

  ## Harness Changes

  - Change the model response to { strategy, action } and the internal decision type to a singular action.
  - Replace hold:1/hold:2 with hold; simplify resolution to one selected action or one hold fallback.
  - Record selectedActionIds, appliedActionIds, outcomes, and actionOutcomes as length-one arrays.
  - Remove slot configuration, repeatability rules, gold-slot restrictions, pair conflicts, duplicate/conflict failures, and simultaneous-slot prompt language.
  - Give troop actions the full safe surplus above the existing reserve floor. Rename slot-oriented budget fields/labels and cap counters by the selected
    attacker’s incoming force.

  - Execute at most one core intent per decision while retaining the existing cadence, retry policy, failure cutoff, and cost/time limits.
  - Decouple visual-browser baselines from harness slots; their existing two-command UI behavior and artifact compatibility remain unchanged.

  ## Replay Compatibility

  - Keep the current run, eval, sample-generation, and benchmark schemas strict to one action.
  - Add separate replay-only schemas for legacy schema-v1/v2 artifacts and old eval trials with two actions, legacy observations, lifecycle defaults, prompt
    versions, and failure codes.

  - Use those schemas only for run discovery, summaries, artifact download, replay payloads, and trace rendering. Never feed legacy decisions into the current
    runner, resolver, verifier, eval grader, or benchmark.

  - Update sample verification to replay the stored OpenFront turns directly rather than executing legacy decisions through the new harness.

  ## Benchmark and Evals

  - Keep the public identifier openfront-bench-v0.1, but require a one-action contract fingerprint, actionsPerDecision: 1, the new prompt hash, and a single-
    action-v1 resolver. Tighten frozen recent-decision schemas to length-one traces.

  - Regenerate one-action source runs, checkpoint/menu hashes, reference/control policies, acceptance reports, JSON Schemas, and the release manifest. Do not
    restore or adapt deleted two-action benchmark sources/results.

  - Replace split-front-defense with split-front-prioritization: present two unequal incoming threats, require countering the dangerous front, and grade survival,
    dangerous-front loss, and combined protected-territory loss. Hold and countering the lesser threat must fail calibration.

  - Keep 12 match tasks, 10 capability tasks, and existing non-action benchmark limits.
  - Move development micro-evals to a new one-action version and retain old reports only as replay data.
  - Update active README, benchmark/eval specifications, site copy, diagrams, and scripts. Preserve historical two-action analyses and charts with explicit
    historical labeling.

  ## Test Plan

  - Verify the JSON Schema accepts only { strategy, action }, retries malformed/unknown actions, and falls back to one hold.
  - Test the singular resolver, full troop budget, per-attacker counter caps, one-intent execution, length-one lifecycle records, and runner failure handling.
  - Confirm bundled two-action runs remain listed, playable, downloadable, and render both action rows, while strict current schemas reject them.
  - Confirm old benchmark manifests, resumes, fixtures, and match artifacts fail validation.
    key is available.

  ## Assumptions

  - Exactly one action is mandatory; hold represents intentional inaction.
  - Trace fields remain arrays for lifecycle/replay consistency, but current arrays must contain exactly one item.
  - Historical artifacts are not migrated or rewritten.
  - Benchmark v0.1 is intentionally replaced in place rather than versioned as v0.2.