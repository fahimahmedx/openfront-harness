# Public benchmark release data

This directory contains the canonical `openfront-bench-v0.1` release manifest,
the ten scored multi-map capability acceptance reports, and versioned JSON
Schemas for benchmark artifacts. The existing Japan fixtures remain development
aids and are never included in a public score.

Release checks:

```bash
npm run benchmark:validate-tasks
npm run benchmark:smoke
```

The frozen workflow is:

```bash
npm run benchmark:run -- --profile official
npm run benchmark:run -- --profile official --resume data/benchmarks/<run-id>
npm run benchmark:verify -- data/benchmarks/<run-id>
```

The runner uses a fresh child process for every trial, records its
seeded randomized schedule before execution, writes an inspectable partial
report after every attempt, retries infrastructure-invalid trials, and does not
retry provider or model failures. If the manifest is absent or fails schema or
hash validation, `benchmark:run` fails closed rather than emitting a benchmark
result.
