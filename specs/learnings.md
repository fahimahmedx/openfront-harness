# Learnings: Baidu vs Streamlake Provider for DeepSeek

## Structured-output support is provider-route specific

The model name alone does not define structured-output behavior. A provider can advertise strict structured outputs, accept a JSON Schema request, and still return content that violates that schema. Provider routing must therefore be pinned and recorded, and every response must still be validated locally.

### DeepSeek V4 Flash comparison

Three `deepseek/deepseek-v4-flash` runs through Baidu used prompt `agent-v12`, reasoning effort `none`, strict JSON Schema, required parameters, and disabled provider fallback. Across 327 decisions, the route produced 45 schema-conformance failures:

- 43 `strategy` strings exceeded the schema's 160-character maximum.
- 2 selected action IDs were outside the slot-specific schema enums.
- 41 decisions required a retry, and 4 decisions exhausted both attempts and safely fell back to holds.
- There were no 429s or transport-level provider failures.

The Baidu replays and artifacts are:

- [Replay `a769bdaf-9cef-43a4-8187-25e8d182760d`](/replay/a769bdaf-9cef-43a4-8187-25e8d182760d) — `data/deepseek-v4-flash/a769bdaf-9cef-43a4-8187-25e8d182760d.json.gz`
- [Replay `10bba638-474c-42e8-8fd1-5bdad2226f80`](/replay/10bba638-474c-42e8-8fd1-5bdad2226f80) — `data/deepseek-v4-flash/10bba638-474c-42e8-8fd1-5bdad2226f80.json.gz`
- [Replay `52f7ee50-b39b-4565-b1c9-3daac38dbbce`](/replay/52f7ee50-b39b-4565-b1c9-3daac38dbbce) — `data/deepseek-v4-flash/52f7ee50-b39b-4565-b1c9-3daac38dbbce.json.gz`

Three comparison runs changed only the pinned provider to StreamLake. They completed 343 decisions with reasoning effort `none`, and every recorded decision confirms that StreamLake served it. None produced a JSON-schema violation, fallback, 429, transport failure, or failed selected-action lifecycle. One decision selected proactive attacks against two opponents, a gameplay invariant that the JSON Schema cannot express; the local validator rejected it and the retry succeeded. The runs finished second, first, and first:

- [Replay `1bc4116a-e7ca-4765-9697-46e3ee5967e9`](/replay/1bc4116a-e7ca-4765-9697-46e3ee5967e9) — second, 103 decisions, no retries; artifact at `data/deepseek-v4-flash/1bc4116a-e7ca-4765-9697-46e3ee5967e9.json.gz`.
- [Replay `29c19e21-9bce-49c0-9196-c6be662d376e`](/replay/29c19e21-9bce-49c0-9196-c6be662d376e) — first, 120 decisions, no retries; artifact at `data/deepseek-v4-flash/29c19e21-9bce-49c0-9196-c6be662d376e.json.gz`.
- [Replay `8d43865f-2dd0-4cd8-9576-64e6ecd48a2c`](/replay/8d43865f-2dd0-4cd8-9576-64e6ecd48a2c) — first, 120 decisions, one recovered cross-slot conflict; artifact at `data/deepseek-v4-flash/8d43865f-2dd0-4cd8-9576-64e6ecd48a2c.json.gz`.

Three clean StreamLake runs do not prove the route can never violate the schema, but the controlled comparison shows that the repeated Baidu behavior is not inherent to the DeepSeek model or the harness request alone. The evidence points to provider-route schema enforcement or provider-specific serving behavior.

### Harness implication

Local validation remains the authority boundary for action IDs. Unknown actions must continue to be rejected rather than guessed or coerced. The public `strategy` note is non-authoritative, however, so an oversized strategy should be truncated deterministically to 160 characters and recorded as a nonfatal provider-conformance diagnostic instead of causing a paid retry or safe-hold fallback.
