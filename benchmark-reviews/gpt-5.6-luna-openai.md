# GPT-5.6 Luna on OpenAI — OpenFront Bench v0.1 review

## Run identity

- Requested model: `openai/gpt-5.6-luna`
- Resolved model: `openai/gpt-5.6-luna` in all 136 trials
- Requested and resolved provider: `OpenAI` in all 136 trials
- Agent configuration: `agent-v13`, reasoning effort `none`, one action per decision
- Run ID: `41cf072f-c069-4d7a-be63-3af8c3890c2a`
- Manifest SHA-256: `f5b931094973115a036ee8f7bea5c92d2012d62b7d77f99e97c4facd0ee66a60`
- Report: `data/benchmarks/gpt-5.6-luna-openai/report.json`
- Verification: `npm run benchmark:verify -- data/benchmarks/gpt-5.6-luna-openai` passed all 36 match and 100 capability trials.

## Headline results

| Metric | Result |
| --- | ---: |
| Match score | **69.83** (95% bootstrap CI 61.33–78.44) |
| Capability score | **39.00** (95% bootstrap CI 34.00–44.00) |
| Match win rate | **16.67%** (6/36) |
| Mean placement | **2.72** |
| Survival rate | **69.44%** |
| First-attempt validity | **99.26%** |
| Fallback rate | **0.00%** (0/136 trials) |
| Median / p95 request latency | **1.23 s / 3.38 s** |
| Prompt / completion tokens | **8,408,899 / 147,914** |
| Recorded inference cost | **$1.1059** |

The model's most consistent full-match results came on Four Islands and Great Lakes: it scored 80 in all three Match 06 trials and averaged 86.7 on Match 07. Match 01 was its best task at 88.9 with two wins. It struggled most on the larger hard lobbies, averaging 46.7 on Match 02 and 48.1 on Match 12.

## Match task results

| Task | Mean | Wins | Placements | Trial scores |
| --- | ---: | ---: | --- | --- |
| Match 01 | 88.9 | 2/3 | 1 · 2 · 1 | 100 · 66.7 · 100 |
| Match 02 | 46.7 | 0/3 | 3 · 4 · 4 | 60 · 40 · 40 |
| Match 03 | 60.0 | 0/3 | 2 · 5 · 2 | 80 · 20 · 80 |
| Match 04 | 61.1 | 0/3 | 3 · 3 · 4 | 66.7 · 66.7 · 50 |
| Match 05 | 66.7 | 0/3 | 2 · 2 · 2 | 66.7 · 66.7 · 66.7 |
| Match 06 | 80.0 | 0/3 | 2 · 2 · 2 | 80 · 80 · 80 |
| Match 07 | 86.7 | 1/3 | 2 · 1 · 2 | 80 · 100 · 80 |
| Match 08 | 66.7 | 0/3 | 4 · 3 · 2 | 50 · 66.7 · 83.3 |
| Match 09 | 80.0 | 1/3 | 1 · 2 · 3 | 100 · 80 · 60 |
| Match 10 | 72.2 | 1/3 | 5 · 2 · 1 | 33.3 · 83.3 · 100 |
| Match 11 | 81.0 | 1/3 | 4 · 1 · 2 | 57.1 · 100 · 85.7 |
| Match 12 | 48.1 | 0/3 | 7 · 5 · 5 | 33.3 · 55.6 · 55.6 |

All 36 matches ended after OpenFront declared a winner; none reached the 15-minute wall-clock ceiling. Variance remained material in several tasks. Match 10 ranged from fifth place to a win, and Match 03 ranged from second to fifth place despite identical frozen scenarios.

## Capability results

| Capability | Passed | Pass@1 | Mean component coverage |
| --- | ---: | ---: | ---: |
| Neutral expansion | 10/10 | 100% | 100.0% |
| Saturated-capacity expansion | 6/10 | 60% | 60.0% |
| Post-expansion recovery | 0/10 | 0% | 75.0% |
| Weaker-target selection | 9/10 | 90% | 90.0% |
| Frontier restraint | 0/10 | 0% | 75.0% |
| Incoming-attack response | 4/10 | 40% | 70.0% |
| Split-front defense | 10/10 | 100% | 100.0% |
| Losing-attack retreat | 0/10 | 0% | 50.0% |
| Naval-target recognition | 0/10 | 0% | 0.0% |
| Construction-failure recovery | 0/10 | 0% | 50.0% |

Neutral expansion and split-front defense were perfectly reliable, and weaker-target selection passed nine of ten trials. The overall capability score was pulled down by five complete family failures. Naval-target recognition was the sharpest gap because it achieved no component coverage at all; recovery after expansion or failed construction, frontier restraint, and retreat from losing attacks also never completed their full success criteria.

## Errors, failures, and concerns

- The verified run recorded one 30-second request timeout during a Match 06 trial. The next attempt succeeded, so the trial remained valid, did not invoke the harness `hold` fallback, and scored 80.
- The game engine repeatedly rejected Defense Post construction during construction-recovery scenarios. This was reproduced by the verifier and aligns with the model's 0/10 result rather than artifact corruption. The run also logged isolated nonfatal engine warnings for a missing outgoing attack, a failed warship spawn, and a bot emoji action.
- All 136 trial artifacts were valid and consistently resolved to OpenAI. No provider-routing fallback, HTTP rate limit, or invalid trial was recorded.
- The model had a much stronger match score than capability score. Full-match placement can reward broad survival and expansion while the focused fixtures expose absent tactical behaviors; the 30.83-point gap should not be read as contradictory evidence.
- Hosted sampling is not deterministic even with frozen game state and task order. Match 10's 33.3/83.3/100 spread and Match 03's 80/20/80 spread show that three trials leave considerable task-level uncertainty.
- `openai/gpt-5.6-luna` is an alias rather than a dated revision in the recorded metadata. Provider-side changes under the same alias may affect future reproducibility.

## Bottom line

GPT-5.6 Luna/OpenAI was fast, inexpensive, and operationally reliable in this run, but its tactical coverage was uneven. It expanded well, selected weaker targets, and handled split-front defense, yet it showed no successful naval recognition, retreat, restraint, or recovery behavior in the focused fixtures. Its full-match score remained respectable because it frequently survived near the front of the lobby, though it converted only 6 of 36 matches into wins.
