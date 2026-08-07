# DeepSeek V4 Flash 0731 on Cloudflare — OpenFront Bench v0.1 review

## Run identity

- Requested model: `deepseek/deepseek-v4-flash-0731`
- Resolved model: `deepseek/deepseek-v4-flash-0731` in all 136 trials
- Requested and resolved provider: `Cloudflare` in all 136 trials
- Agent configuration: `agent-v13`, reasoning effort `none`, one action per decision
- Run ID: `75d8ce77-ea60-4565-b24a-4383325d5ae8`
- Manifest SHA-256: `f5b931094973115a036ee8f7bea5c92d2012d62b7d77f99e97c4facd0ee66a60`
- Report: `data/benchmarks/deepseek-v4-flash-cloudflare/report.json`
- Verification: `npm run benchmark:verify -- data/benchmarks/deepseek-v4-flash-cloudflare` passed all 36 match and 100 capability trials.

## Headline results

| Metric | Result |
| --- | ---: |
| Match score | **65.04** (95% bootstrap CI 58.12–71.79) |
| Capability score | **24.00** (95% bootstrap CI 17.00–31.00) |
| Match win rate | **5.56%** (2/36) |
| Mean placement | **2.94** |
| Survival rate | **69.44%** |
| First-attempt validity | **97.06%** |
| Fallback rate | **1.47%** (2/136 trials) |
| Median / p95 request latency | **1.25 s / 1.85 s** |
| Prompt / completion tokens | **8,323,010 / 125,074** |
| Recorded inference cost | **$1.0963** |

The model's best full-match results were on Strait of Gibraltar. It averaged 80.0 on Match 09 and 88.9 on Match 10, earning one of its two wins there. It often settled into a stable non-winning placement: every Match 04 trial scored 66.7, every Match 05 trial scored 66.7, and every Match 09 trial scored 80. Its weakest mean scores were 46.7 on both Match 02 and Match 03.

## Match task results

| Task | Mean | Wins | Placements | Trial scores |
| --- | ---: | ---: | --- | --- |
| Match 01 | 77.8 | 1/3 | 2 · 2 · 1 | 66.7 · 66.7 · 100 |
| Match 02 | 46.7 | 0/3 | 3 · 4 · 4 | 60 · 40 · 40 |
| Match 03 | 46.7 | 0/3 | 5 · 2 · 4 | 20 · 80 · 40 |
| Match 04 | 66.7 | 0/3 | 3 · 3 · 3 | 66.7 · 66.7 · 66.7 |
| Match 05 | 66.7 | 0/3 | 2 · 2 · 2 | 66.7 · 66.7 · 66.7 |
| Match 06 | 66.7 | 0/3 | 4 · 2 · 2 | 40 · 80 · 80 |
| Match 07 | 73.3 | 0/3 | 2 · 2 · 3 | 80 · 80 · 60 |
| Match 08 | 55.6 | 0/3 | 4 · 3 · 4 | 50 · 66.7 · 50 |
| Match 09 | 80.0 | 0/3 | 2 · 2 · 2 | 80 · 80 · 80 |
| Match 10 | 88.9 | 1/3 | 2 · 2 · 1 | 83.3 · 83.3 · 100 |
| Match 11 | 52.4 | 0/3 | 2 · 7 · 4 | 85.7 · 14.3 · 57.1 |
| Match 12 | 59.3 | 0/3 | 5 · 4 · 5 | 55.6 · 66.7 · 55.6 |

All 36 matches ended after OpenFront declared a winner; none reached the 15-minute wall-clock ceiling. Match 11 was the largest source of within-task variance, ranging from second to seventh place. Most other tasks were comparatively stable, but stability often meant consistent second- or third-place finishes rather than wins.

## Capability results

| Capability | Passed | Pass@1 | Mean component coverage |
| --- | ---: | ---: | ---: |
| Neutral expansion | 7/10 | 70% | 70.0% |
| Saturated-capacity expansion | 3/10 | 30% | 30.0% |
| Post-expansion recovery | 3/10 | 30% | 82.5% |
| Weaker-target selection | 1/10 | 10% | 10.0% |
| Frontier restraint | 4/10 | 40% | 85.0% |
| Incoming-attack response | 2/10 | 20% | 60.0% |
| Split-front defense | 4/10 | 40% | 60.0% |
| Losing-attack retreat | 0/10 | 0% | 50.0% |
| Naval-target recognition | 0/10 | 0% | 0.0% |
| Construction-failure recovery | 0/10 | 0% | 50.0% |

Neutral expansion was the only capability to pass a majority of trials. Frontier restraint and post-expansion recovery had high component coverage without reliably completing their success criteria. Losing-attack retreat, naval-target recognition, and construction-failure recovery failed all ten trials; weaker-target selection passed only once.

## Errors, failures, and concerns

- The verified run recorded six failed response attempts across four trials. Two were Cloudflare shared-pool HTTP 429s that succeeded on retry. Four were responses truncated at the token limit: two attempts in one Match 05 decision and two attempts in one Match 04 decision. Both affected decisions used the harness `hold` fallback, but their trials remained valid and each scored 66.7.
- The provider was pinned with `allow_fallbacks: false`, and every artifact resolved to `Cloudflare`. The 1.47% benchmark fallback rate refers to the harness substituting `hold` after both attempts failed, not to OpenRouter routing the request to a different provider.
- The game engine repeatedly rejected Defense Post builds, and it rejected two Nuke builds. A missing outgoing-attack warning also appeared once. All reproduced during verification, so they are deterministic gameplay/action outcomes rather than corrupted artifacts.
- All 136 artifacts were valid and all 36 matches reached a declared winner. There were no invalid trials or 15-minute wall-clock terminations.
- The model's match score exceeds its capability score by 41.04 points. Frequent near-front placements can produce a respectable full-match score even when focused tactical behaviors are absent; only two of 36 matches became wins.
- Match 11's 85.7/14.3/57.1 spread and Match 03's 20/80/40 spread show meaningful hosted-sampling variance despite frozen scenarios and task order.

## Bottom line

DeepSeek V4 Flash 0731/Cloudflare was fast and inexpensive, and it often survived into a respectable placement, especially on Gibraltar. Its focused tactical performance was poor, however: only neutral expansion passed reliably, three families never passed, and target selection succeeded once. Two token-limit fallbacks and two shared-pool 429s were operational blemishes, though every trial remained valid and the complete run verified successfully.
