# GLM-5.2 on Baidu — OpenFront Bench v0.1 review

## Run identity

- Requested model: `z-ai/glm-5.2`
- Resolved model: `z-ai/glm-5.2` in all 136 trials
- Requested and resolved provider: `Baidu` in all 136 trials
- Agent configuration: `agent-v13`, reasoning effort `none`, one action per decision
- Run ID: `dbdeb06c-7f67-4387-b755-77e9a11e5ae0`
- Manifest SHA-256: `f5b931094973115a036ee8f7bea5c92d2012d62b7d77f99e97c4facd0ee66a60`
- Report: `data/benchmarks/glm-5.2-baidu/report.json`
- Verification: `npm run benchmark:verify -- data/benchmarks/glm-5.2-baidu` passed all 36 match and 100 capability trials.

## Headline results

| Metric | Result |
| --- | ---: |
| Match score | **73.60** (95% bootstrap CI 65.17–82.30) |
| Capability score | **56.00** (95% bootstrap CI 49.00–63.00) |
| Match win rate | **36.11%** (13/36) |
| Mean placement | **2.53** |
| Survival rate | **77.78%** |
| First-attempt validity | **97.79%** |
| Fallback rate | **0.74%** (1/136 trials) |
| Median / p95 request latency | **2.69 s / 3.50 s** |
| Prompt / completion tokens | **8,012,294 / 172,967** |
| Recorded inference cost | **$3.3494** |

The model was strongest in the Great Lakes and Strait of Gibraltar match tasks. It swept Match 07 and Match 10, and it placed first in 13 of the 36 matches overall. Its weakest match task was Match 11 on World/Medium: the three scores were 100, 14.3, and 28.6, producing a 47.6 mean and unusually large run-to-run spread.

## Match task results

| Task | Mean | Wins | Placements | Trial scores |
| --- | ---: | ---: | --- | --- |
| Match 01 | 77.8 | 2/3 | 1 · 3 · 1 | 100 · 33.3 · 100 |
| Match 02 | 53.3 | 0/3 | 3 · 3 · 4 | 60 · 60 · 40 |
| Match 03 | 86.7 | 1/3 | 2 · 2 · 1 | 80 · 80 · 100 |
| Match 04 | 61.1 | 0/3 | 3 · 4 · 3 | 66.7 · 50 · 66.7 |
| Match 05 | 77.8 | 2/3 | 3 · 1 · 1 | 33.3 · 100 · 100 |
| Match 06 | 73.3 | 0/3 | 3 · 2 · 2 | 60 · 80 · 80 |
| Match 07 | 100.0 | 3/3 | 1 · 1 · 1 | 100 · 100 · 100 |
| Match 08 | 83.3 | 1/3 | 1 · 3 · 2 | 100 · 66.7 · 83.3 |
| Match 09 | 66.7 | 0/3 | 3 · 3 · 2 | 60 · 60 · 80 |
| Match 10 | 100.0 | 3/3 | 1 · 1 · 1 | 100 · 100 · 100 |
| Match 11 | 47.6 | 1/3 | 1 · 7 · 6 | 100 · 14.3 · 28.6 |
| Match 12 | 55.6 | 0/3 | 7 · 3 · 5 | 33.3 · 77.8 · 55.6 |

Match 08 trial two reached the 15-minute wall-clock safety limit at decision 100 and was scored from its final authoritative state. The other 35 matches ended after OpenFront declared a winner.

## Capability results

| Capability | Passed | Pass@1 | Mean component coverage |
| --- | ---: | ---: | ---: |
| Neutral expansion | 8/10 | 80% | 80.0% |
| Saturated-capacity expansion | 10/10 | 100% | 100.0% |
| Post-expansion recovery | 1/10 | 10% | 77.5% |
| Weaker-target selection | 7/10 | 70% | 70.0% |
| Frontier restraint | 3/10 | 30% | 82.5% |
| Incoming-attack response | 9/10 | 90% | 95.0% |
| Split-front defense | 9/10 | 90% | 93.3% |
| Losing-attack retreat | 4/10 | 40% | 70.0% |
| Naval-target recognition | 5/10 | 50% | 50.0% |
| Construction-failure recovery | 0/10 | 0% | 50.0% |

The clearest capability strengths were saturated-capacity expansion, incoming-attack response, and split-front defense. Construction-failure recovery was the clearest failure: all ten trials failed, despite 50% mean component coverage. Post-expansion recovery also failed in nine of ten trials. Frontier restraint and losing-attack retreat were unreliable.

## Errors, failures, and concerns

- The verified run recorded three HTTP 429 attempt failures from Baidu's shared upstream token-per-minute pool and one request timeout. One Match 01 trial exhausted both attempts after two 429s, fell back to hold for that decision, and ultimately scored 33.3. The other failures recovered on retry.
- One of 36 matches reached the 15-minute wall-clock ceiling. This is a valid scored termination, but its 66.7 points represent position at cutoff rather than a completed game outcome.
- The benchmark fixes the game state and task schedule, but hosted model sampling is not deterministic. Match 11's 100/14.3/28.6 spread, Match 05's 33.3/100/100 spread, and Match 01's 100/33.3/100 spread show that three match trials leave wide uncertainty for individual tasks.
- `z-ai/glm-5.2` is an alias rather than a dated model revision in the recorded metadata. A future provider-side revision under the same alias may not reproduce this policy exactly.
- The provider was pinned with `allow_fallbacks: false`; the report consistently resolved to `Baidu`. The benchmark's term “fallback” means the harness substituted `hold` after both response attempts failed, not that OpenRouter routed to another provider.
- A first discarded attempt used requested provider string `baidu` while successful responses reported `Baidu`. Three rate-limited/fallback trials retained the lowercase requested string, causing the verifier's mixed-provider gate to reject the otherwise complete run. That unverified attempt is preserved at `data/benchmarks/glm-5.2-baidu-unverified-provider-casing/` and is not used for any score. It contained 45 HTTP 429 attempt failures across three fallback trials. The verified rerun used the canonical provider name `Baidu` from the outset; no benchmark artifacts were rewritten after generation.

## Bottom line

GLM-5.2/Baidu was a capable full-match agent in this harness, especially on Great Lakes and Gibraltar, but its 56-point capability score exposes important tactical gaps. It expands and responds to pressure well, yet it is poor at recovering from failed construction or recent expansion and is inconsistent about restraint and retreat. The substantial within-task variance and the provider's shared-pool rate limits are material concerns for reproducibility.
