# Replay Analysis Log

## DeepSeek agent-v7 — `9f848b8e-ba19-4abf-af4b-6af105e05ff3`

### Result

- Model: `deepseek/deepseek-v4-flash`
- Provider: CoreWeave
- Prompt contract: `agent-v7`
- Winner: Kansai
- DeepSeek placement: third
- Decisions: 81
- DeepSeek eliminated: tick 8,029
- Match ended: tick 9,581
- Inference cost: $0.0258
- Replay: `/replay/9f848b8e-ba19-4abf-af4b-6af105e05ff3`

### What worked

- The saturation loop was eliminated. DeepSeek's maximum troop capacity was
  94.59%, where it selected two attacks instead of holding.
- It recorded no double-holds at or above 95% capacity and only two intentional
  double-hold decisions in the entire match.
- DeepSeek repeatedly recognized when it had a territory deficit and selected
  actions intended to close it.
- It no longer interpreted a numeric `territoryDeficitPercent` as “Leading by
  X%.” The new agent-v7 standings fields were internally consistent throughout
  the artifact.

### What failed

- DeepSeek prioritized the wrong opponent. While Kansai was leading and legal
  attacks against Kansai were available at decisions 41, 44, 49, and 55,
  DeepSeek repeatedly attacked Hokkaido instead. Kansai's lead grew from 4.57
  to 8.29 percentage points and eventually became overwhelming.
- Once Kansai and Hokkaido continuously attacked DeepSeek, emergency mode
  restricted the troop menu to counterattacks. DeepSeek frequently chose
  minimum-strength counters and held the second slot while its territory
  collapsed from roughly 33% to 1.55%.
- At decision 68, DeepSeek contradicted the correct structured observation. It
  was ranked second with a 26.577-point deficit but referred to itself as the
  “territory leader.” This was a model hallucination rather than an observation
  calculation error.
- Three CoreWeave 429 fallbacks aggravated the collapse. The final fallback
  occurred with 891,587 incoming troops, and DeepSeek was eliminated 26 ticks
  later. The run was already losing badly, so the provider failure was not the
  root cause.

Agent v7 therefore fixed the saturation-holding and unsigned-gap failures, but
the replay exposed separate weaknesses in target prioritization and emergency
defense.
