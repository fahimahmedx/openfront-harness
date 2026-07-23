# Troop-Economy and Attack-Discipline Fix

  ## Summary

  This is a harness issue. Each action currently calculates its troops from the same pre-decision balance, allowing combinations such as 75% + 25% or 75% + 50% to
  commit essentially everything. The observation exposes raw troop values but does not explain capacity, growth, or relative combat strength.

  Introduce japan-v2 and agent-v2; preserve replay compatibility with existing v1 artifacts.

  ## Implementation Changes

  - Add deterministic troop-policy constants based on OpenFront’s native nation-AI ranges:
      - Neutral-expansion reserve: 15% of maximum troops.
      - Combat reserve: 35%.
      - Offensive combat trigger: 55%.
      - Minimum useful attack commitment: 20% of the defender’s current troops.
      - Emergency reserve: 15%.

  - Replace “percentage of current troops” actions with a shared safe budget:
      - Compute spendable = currentTroops - reserveFloor.
      - Divide spendable troops across the two action slots.
      - Offer 25%, 50%, 75%, and 100% of each slot’s allocation.
      - Ensure any two offered troop actions can execute together without crossing the active reserve floor.
      - Labels must show the exact troop commitment and reserve policy, not imply that each percentage independently references the full balance.

  - Select the reserve mode before generating candidates:
      - Expansion mode when no immediate player conflict exists.
      - Combat mode when there is a hostile shared border or an eligible naval target.
      - Emergency mode when hostile incoming attacks exist.

  - Gate ordinary land and naval attacks:
      - Require at least 55% troop capacity.
      - Require the agent’s current troops to exceed the target’s current troops.
      - Omit commitments smaller than 20% of the target’s troops.

  - During an incoming attack:
      - Suppress unrelated troop-spending actions.
      - Offer counterattacks only against active attackers.
      - Cap each response by both the shared emergency budget and that attacker’s incoming force.
      - Retain at least the 15% emergency reserve.

  - Expand observations with explicit, model-readable metrics:
      - Troops as a percentage of capacity.
      - Current troop growth per simulated second.
      - Total incoming and outgoing troops.
      - Active reserve mode, reserve floor, spendable troops, and per-action cap.
      - Each opponent’s capacity percentage and troop ratio relative to the agent.

  - Update the prompt to explain that low troop counts reduce absolute growth, expose the territory to stronger opponents, and make weak attacks ineffective.
    Explicitly recommend holding while below the combat trigger.

  - Add scenarioId to run summaries and display it on run cards so local v1 and v2 artifacts remain distinguishable.
  - Accept both agent-v1 and agent-v2 in artifact parsing, while emitting only v2 for new runs. Keep artifact schema version 1 because the wire structure remains
    backward-compatible.

  - Replace the bundled sample with a live v2 run and update the README, design decision log, and write-up with the reserve-budget behavior.

  - Unit-test reserve mode selection, threshold boundaries, per-slot allocations, rounding, and zero-spendable states.
  - Prove for every generated pair of troop actions that combined commitments cannot cross the applicable reserve floor.
  - Verify ordinary attacks are absent below 55% capacity, against stronger targets, and when the largest safe commitment is below 20% of target troops.
  - Verify incoming attacks produce bounded counters while suppressing unrelated expansion and offense.
  - Run a scripted repeated-max-expansion probe and confirm voluntary commitments never drain below the snapshot reserve.
  - Confirm old v1 artifacts still parse and replay.
  - Generate and validate the v2 sample, then run npm test, npm run build, and npm run verify:sample.

  ## Acceptance Criteria

  - No decision can voluntarily commit 100% or more of the same troop balance.
  - Repeated expansion naturally alternates with recovery instead of holding the agent around 1–2% capacity.
  - Clearly futile attacks are absent from the legal menu.
  - Incoming invasions still permit a bounded defensive response.
  - Existing v1 replay files remain viewable, while all new artifacts identify japan-v2 and agent-v2.