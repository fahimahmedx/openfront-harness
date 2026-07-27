# Latency benchmarks

All latency values are client-observed and measured per model decision. TTFT starts
immediately before the OpenRouter request and ends at the first non-empty streamed
content, reasoning, or refusal delta. Generation time runs from that first delta
through stream completion. Queue time is unavailable because OpenRouter does not
expose upstream provider queue duration.

## GPT-5.6 Luna / reasoning-low / 2026-07-26

- Replay ID: `35fd5d95-ae47-4384-9ab2-9337b9557ace`
- Replay: http://localhost:3000/replay/35fd5d95-ae47-4384-9ab2-9337b9557ace
- Artifact: `.data/runs/35fd5d95-ae47-4384-9ab2-9337b9557ace.json.gz`
- Model: `openai/gpt-5.6-luna`
- Provider: OpenAI through OpenRouter
- Reasoning effort: `low`
- Started: `2026-07-27T02:10:35.602Z`
- Completed: `2026-07-27T02:16:12.133Z`
- Result: LLM agent won, placement 1
- Decisions: 120
- Retries / failed attempts: 0 / 0
- Run wall time: 336.531 s
- Usage: 226,725 prompt tokens; 18,958 completion tokens; $0.397064

| Per-decision metric    |       Result |
| ---------------------- | -----------: |
| Total latency, minimum |   958.422 ms |
| Total latency, median  | 2,570.681 ms |
| Total latency, mean    | 2,691.432 ms |
| Total latency, p90     | 3,890.597 ms |
| Total latency, p95     | 4,474.675 ms |
| Total latency, p99     | 4,775.457 ms |
| Total latency, maximum | 5,466.020 ms |
| TTFT, median           | 2,394.348 ms |
| TTFT, mean             | 2,509.563 ms |
| Generation, median     |    86.308 ms |
| Generation, mean       |   181.425 ms |
| TPOT proxy, median     |     0.600 ms |
| TPOT proxy, mean       |     1.266 ms |

Across all decisions, TTFT accounted for 93.26% of completed attempt time and
visible generation accounted for 6.74%. TPOT is an approximation based on
provider-reported completion tokens; it can include hidden reasoning tokens and
is not a distribution of individual token arrival intervals.

## GPT-5.6 Luna / reasoning-none / 2026-07-26

- Replay ID: `1ebe925e-8108-412d-8b2d-8d882822a253`
- Replay: http://localhost:3000/replay/1ebe925e-8108-412d-8b2d-8d882822a253
- Artifact: `.data/runs/1ebe925e-8108-412d-8b2d-8d882822a253.json.gz`
- Model: `openai/gpt-5.6-luna`
- Provider: OpenAI through OpenRouter
- Reasoning effort: **`none`**
- Artifact metadata: `model.reasoningEffort = "none"`
- Started: `2026-07-27T03:46:46.391Z`
- Completed: `2026-07-27T03:47:51.210Z`
- Result: LLM agent won, placement 1
- Decisions: 54
- Retries / failed attempts: 0 / 0
- Run wall time: 64.819 s
- Usage: 101,169 prompt tokens; 3,204 completion tokens; $0.145645

| Per-decision metric    |       Result |
| ---------------------- | -----------: |
| Total latency, minimum |   619.982 ms |
| Total latency, median  |   949.491 ms |
| Total latency, mean    | 1,084.520 ms |
| Total latency, p90     | 1,458.832 ms |
| Total latency, p95     | 1,663.199 ms |
| Total latency, p99     | 2,525.512 ms |
| Total latency, maximum | 2,551.451 ms |
| TTFT, median           |   607.660 ms |
| TTFT, mean             |   705.577 ms |
| Generation, median     |   345.962 ms |
| Generation, mean       |   378.559 ms |
| TPOT proxy, median     |     5.986 ms |
| TPOT proxy, mean       |     6.484 ms |

Across all decisions, TTFT accounted for 65.08% of completed attempt time and
visible generation accounted for 34.92%.

## Comparison

Both replays used the fixed Japan scenario, `agent-v4` prompt, model, OpenAI
provider, model seed 3209, streaming structured output, and request settings
other than reasoning effort. Negative changes are improvements.

| Per-decision metric       | Reasoning `low` | Reasoning `none` |      Change |
| ------------------------- | --------------: | ---------------: | ----------: |
| Total latency, median     |    2,570.681 ms |       949.491 ms | **-63.06%** |
| Total latency, mean       |    2,691.432 ms |     1,084.520 ms | **-59.70%** |
| Total latency, p90        |    3,890.597 ms |     1,458.832 ms | **-62.50%** |
| Total latency, p95        |    4,474.675 ms |     1,663.199 ms | **-62.83%** |
| Total latency, p99        |    4,775.457 ms |     2,525.512 ms | **-47.11%** |
| Total latency, maximum    |    5,466.020 ms |     2,551.451 ms | **-53.32%** |
| TTFT, median              |    2,394.348 ms |       607.660 ms | **-74.62%** |
| TTFT, mean                |    2,509.563 ms |       705.577 ms | **-71.88%** |
| Generation, median        |       86.308 ms |       345.962 ms |    +300.85% |
| Generation, mean          |      181.425 ms |       378.559 ms |    +108.66% |
| Prompt tokens, median     |           1,878 |            1,814 |      -3.41% |
| Completion tokens, median |             147 |             59.5 |     -59.52% |
| Cost per decision         |       $0.003309 |        $0.002697 |     -18.49% |

Disabling reasoning reduced median per-decision latency by 1,621.190 ms. The
improvement came from a 1,786.688 ms reduction in median TTFT, which more than
offset the 259.654 ms increase in measured generation time.

The `none` replay also finished with 54 decisions instead of 120, so its 80.74%
lower whole-run wall time is not a pure latency comparison. Hosted model
sampling is best-effort even with the same seed, and the two trajectories
produced slightly different prompt distributions. The per-decision results are
strong evidence that `none` is faster for this setup, but multiple paired runs
would be required for confidence intervals.

TPOT should not be directly compared between these reasoning settings. With
reasoning enabled, provider-reported completion tokens may contain hidden
reasoning that occurred before the first streamed delta; with reasoning
disabled, those tokens are much closer to the visible JSON output.
