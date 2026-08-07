# Record LLM Provider Timings

  ## Summary

  Switch OpenRouter completions to streaming so the harness can measure client-observed TTFT and generation duration for every attempt. Record timings per
  attempt, retain total decision latency, and represent provider queue time as null because OpenRouter does not expose it directly. OpenRouter supports both
  streaming structured output (https://openrouter.ai/docs/guides/features/structured-outputs) and usage data in the final stream chunk.

  ## Implementation Changes

  - Send stream: true and stream_options: { include_usage: true }; parse SSE with eventsource-parser, ignoring keepalive comments and assembling partial
    structured JSON.

  - Measure each attempt with a monotonic clock:
      - totalMs: request start through terminal event or failure.
      - timeToFirstTokenMs: request start through the first non-empty content/reasoning delta.
      - generationMs: first token through successful terminal completion; null for incomplete streams or responses without tokens.
      - queueMs: always null until OpenRouter exposes a genuine upstream queue metric.
      - generationId: capture the response header or stream ID for correlation.

  - Add attemptTimings to AgentResult and each decision artifact:

    {
      attempt: 1 | 2;
      totalMs: number;
      timeToFirstTokenMs: number | null;
      generationMs: number | null;
      queueMs: number | null;
      generationId: string | null;
    }[]

  - Preserve timings from timed-out, pre-stream-error, and mid-stream-error attempts. Keep latencyMs unchanged as total decision latency across all attempts and
    local validation.

  - Keep schema version 1 and default missing attemptTimings to [], preserving existing runs and the bundled sample.
  - Expand the replay trace with Total latency, TTFT, Generation, and Queue. Show the successful attempt—or final attempt after complete failure—in the summary,
    and include every attempt’s timing in retry diagnostics. Render unavailable values as —, not zero.


  ## Test Plan

  - Verify split SSE frames, multiline events, keepalive comments, partial JSON, terminal usage, refusal, and mid-stream error handling.
  - Use a controlled clock to assert exact TTFT, generation, attempt-total, and overall decision latency calculations.
  - Verify retries retain two ordered timing records and timeouts retain totalMs while unavailable phases remain null.
  - Verify legacy artifacts parse with an empty timing array and continue rendering normally.
  - Test timing formatting and replay presentation for milliseconds, seconds, null queue values, successful retries, and complete failures.
  - Run the full unit suite, type-check, production build, and bundled-sample verification.

  ## Assumptions

  - Measurements represent harness-observed provider behavior, not provider-internal timestamps.
  - Queue duration is intentionally unknown rather than estimated.
  - No paid live benchmark run is part of validation; the next authorized run will populate the new fields.