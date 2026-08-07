# Public benchmark release data

This directory contains the canonical `openfront-bench-v0.1` release manifest,
the ten scored multi-map capability acceptance reports, and versioned JSON
Schemas for benchmark artifacts. The existing Japan fixtures remain development
aids and are never included in a public score.

This v0.1 release is the current single-action contract: `agent-v13`,
`single-action-v1`, and `actionsPerDecision: 1`. Earlier two-action v0.1
manifests and artifacts are intentionally incompatible and are not accepted as
benchmark input.

Release checks:

```bash
npm run benchmark:validate-tasks
npm run benchmark:acceptance
npm run benchmark:smoke
```

Maintainer freeze workflow:

1. Run the release checks and commit all executable benchmark, dependency,
   schema, test, and documentation changes.
2. Run `npm run benchmark:freeze`. The command performs five independent
   checkpoint rebuilds and reference rollouts plus two distinct controls for
   every capability fixture, then writes the acceptance reports and manifest.
3. Confirm `harnessCommit` is the executable-code commit from step 1, rerun the
   release checks, and commit only the regenerated release artifacts.

The artifact-only commit in step 3 is necessarily one commit after
`harnessCommit`: a Git commit cannot contain its own hash. `harnessSourceHash`
is the authoritative exact-runtime check and the release validator additionally
requires `harnessCommit` to be an ancestor of the checkout.

Public run and verification workflow:

```bash
npm run benchmark:run -- --profile official
npm run benchmark:run -- --profile official --resume data/benchmarks/<run-id>
npm run benchmark:verify -- data/benchmarks/<run-id>
```

The acceptance gate performs five clean checkpoint rebuilds and five reference
rollouts per capability fixture, requires two distinct failing controls, and
hashes each evidence report into the release manifest.

The runner uses a fresh child process for every trial, records its
seeded randomized schedule before execution, writes an inspectable partial
report after every attempt, retries infrastructure-invalid trials, and does not
retry provider or model failures. If the manifest is absent or fails schema or
hash validation, `benchmark:run` fails closed rather than emitting a benchmark
result.

`harnessCommit` identifies the latest executable-code commit at freeze time;
`harnessSourceHash` covers the exact benchmark runtime files. This permits a
later manifest-only release commit without weakening runtime drift detection.
