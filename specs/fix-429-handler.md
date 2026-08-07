# Add 429-Aware OpenRouter Retries

  ## Summary

  The two August 5 DeepSeek/StreamLake runs recorded 23 upstream shared-pool 429s across 12 decisions. Immediate retries recovered once; 11 decisions exhausted
  both attempts and fell back to holds. OpenRouter documents that direct fetch clients should honor Retry-After, which the harness currently ignores. OpenRouter
  error handling (https://openrouter.ai/docs/api/reference/errors-and-debugging)

  ## Implementation Changes

  - Preserve strict JSON Schema, the pinned provider, disabled provider fallback, reasoning configuration, and the existing two-attempt budget.
  - Replace string-only HTTP errors with an internal typed error carrying the HTTP status, request timing, and parsed Retry-After.
  - For the first attempt’s HTTP 429:
      - Accept delta-seconds and HTTP-date header formats.
      - Wait for the requested duration, capped at 60 seconds.
      - Use a deterministic 5-second fallback when the header is missing or invalid.
      - Then issue the existing second attempt; a second 429 still produces one safe hold and counts toward the five-failure cutoff.

  - Keep per-attempt network timing unchanged; total decision latency includes the backoff.
  - Extend attempt-failure artifacts with a rate_limited code plus optional httpStatus and retryDelayMs. Render the delay in replay diagnostics.
  - Update the retry design record and DeepSeek learnings with the two affected run IDs, 23 errors, one recovered retry, and 11 fallbacks. Historical artifacts
    remain immutable.

  ## Interfaces and Compatibility

  - AgentAttemptFailure gains optional httpStatus and retryDelayMs; rate_limited is added to its failure-code enum.
  - These fields flow through run, benchmark, and eval artifacts without a schema-version bump because they are additive and optional.
  - No new environment variables, provider routing changes, or constructor options.

  ## Test Plan

  - Verify two 429s make exactly two requests and retain safe-hold behavior.
  - Verify ordinary network, validation, strict-schema, usage, and timing behavior remains unchanged.
  - Run all 90 repository tests and the TypeScript/Vite production build; both pass before the change and must remain green afterward.

  ## Assumptions

  - Provider comparability is more important than routing around StreamLake with another provider.
  - No paid live run is required for acceptance because upstream throttling is nondeterministic; mocked wire-level tests are authoritative.