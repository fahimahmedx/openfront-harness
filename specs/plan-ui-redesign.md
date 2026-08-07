# Redesign the Front Page Around an Auditable Agent

  ## Summary

  Reframe the homepage for hiring teams around one clear claim: “An AI strategy agent you can audit.”

  Use the bundled winning run as immediate proof, then explain the engineering through an editorial case-study structure. Keep live generation available as a
  secondary lab feature. The landing page will use a light editorial palette; dark, data-dense styling remains reserved for the replay and trace interface.

  ## Key Changes

  - Replace the current hero with:
      - Eyebrow: “OPENFRONT AGENT HARNESS”
      - Headline: “An AI strategy agent you can audit.”
      - Supporting copy: “One model played a fixed match on Japan—and won. Replay all 106 decisions: what it saw, what it chose, what the game executed, and what
        inference cost.”

      - Primary CTA: “Watch the verified run”
      - Secondary CTA: “Read the engineering story”

  - Add a real, optimized WebP poster captured from a representative mid-match point in the bundled japan-v2 replay. Show the Japan map and trace panel in a
    successful, non-fallback decision; do not autoplay or embed WebGL on the homepage.

  - Populate a proof strip from the sample run summary: placement, decisions, simulated time, inference cost, and deterministic verification status.
  - Structure the page as:
      1. Hero and verified sample
      2. “Why this is auditable” — real game, bounded legal actions, native deterministic replay
      3. Compact observe → constrain → decide → execute → replay flow
      4. Fixed protocol summary, including the current scenario ID dynamically instead of the incorrect hard-coded “Japan v1”
      5. Recorded-run archive
      6. “Run another trial” lab section with quota, availability, progress, and cost/time expectations
      7. Engineering-note links, source attribution, upstream attribution, and licensing

  - Use project-first language throughout, with one short first-person pull quote adapted from the write-up: the hard part was building a trustworthy boundary
    between a probabilistic model and a deterministic game.

  - Replace the dark-green dashboard treatment with:
      - Paper #F3F1EA, ink #101614, muted text #5F6863
      - Rules #D2D6CE, signal green #1E7A5A
      - Dark replay/data surface #0B1713, warning #B7602A
      - System sans-serif body/headings and monospace labels/data
      - Editorial spacing, thin rules, restrained radii, no glow-heavy gradients or gaming-style ornament

  - Use a two-column hero on desktop and a single-column composition on mobile. Preserve visible focus states, semantic headings, descriptive poster alt text,
    sufficient contrast, and reduced-motion behavior.

  ## Data and Interaction Behavior

  - Keep all server routes and artifact schemas unchanged.
  - Load /api/scenario, /api/runs, and /api/health independently so one failed request does not blank the entire page.
  - Select the newest bundled sample matching the current scenario for the hero CTA and proof metrics.
  - Preserve existing launch, quota, refresh, polling, replay, and artifact-download behavior after moving those controls.
  - Handle running, completed, failed, interrupted, unavailable-generation, exhausted-quota, and network-error states explicitly. Failed runs must not be
    presented as completed results.

  - Keep the sample-first experience usable without an API key; disable live generation with a clear explanation when health data reports it unavailable.

  - Run npm test, npm run build, and npm run verify:sample.
  - Smoke-test the production server with the bundled sample and confirm all hero, replay, artifact, documentation, and source links resolve correctly.
  - Verify desktop and mobile layouts at approximately 1440 px, 768 px, 390 px, and the 320 px minimum.
  - Exercise sample-present, no-runs, API-error, generation-unavailable, quota-exhausted, active-run, completed-run, and failed-run UI states without making paid
    model calls.

  - Check keyboard navigation, focus visibility, image alternatives, heading order, color contrast, and layout stability while API data loads.

  ## Assumptions

  - Scope is the front page and its client-side states; the replay console and documentation-page styling remain unchanged.
  - The visual uses a captured frame from the real bundled replay, not AI-generated artwork or an external stock image.
  - “Watch the verified run” remains the primary action; live generation moves below the explanatory content.
  - Existing OpenFront attribution, source visibility rules, AGPL notice, and asset licensing remain visible.