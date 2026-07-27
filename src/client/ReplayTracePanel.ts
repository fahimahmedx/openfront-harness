import { renderTroops } from "../../OpenFrontIO/src/client/Utils";
import {
  formatLatency,
  presentReplayAction,
  ReplayActionCandidate,
  statDelta,
} from "./ReplayTraceState";

type PublicDecision = {
  index: number;
  tick: number;
  strategy: string;
  appliedActionIds: string[];
  outcomes: string[];
  candidates: ReplayActionCandidate[];
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  model: string;
  provider: string | null;
  fallback: boolean;
  attemptFailures?: Array<{
    attempt: number;
    code: string;
    message: string;
    rejectedActionIds: string[];
  }>;
  observation: {
    elapsedSeconds: number;
    timeRemainingSeconds: number;
    self: Record<string, any>;
    opponents: Array<Record<string, any>>;
  };
};

class HarnessReplayPanel extends HTMLElement {
  private decisions: PublicDecision[] = [];
  private current = -1;
  private runId = "";
  private body: HTMLElement;

  connectedCallback() {
    const root = this.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      :host {
        --paper: #f3f1ea;
        --raised: #faf9f4;
        --ink: #101614;
        --muted: #5f6863;
        --faint: #858d88;
        --line: #d2d6ce;
        --line-strong: #aeb5ad;
        --signal: #1e7a5a;
        --warning: #b7602a;
        position: fixed;
        z-index: 100000;
        top: 14px;
        right: 14px;
        width: min(430px, calc(100vw - 28px));
        color: var(--ink);
        font: 13px/1.45 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-synthesis: none;
      }

      * { box-sizing: border-box; }

      a { color: inherit; text-decoration: none; }

      button { font: inherit; }

      a, button { -webkit-tap-highlight-color: transparent; }

      :focus-visible {
        outline: 2px solid #7bbcff;
        outline-offset: 3px;
      }

      .panel {
        max-height: calc(100vh - 28px);
        display: flex;
        overflow: hidden;
        flex-direction: column;
        border: 1px solid var(--line-strong);
        border-radius: 5px;
        background: rgba(243, 241, 234, .98);
        box-shadow: 0 24px 70px rgba(0, 0, 0, .28);
        scrollbar-color: var(--line-strong) var(--paper);
        backdrop-filter: blur(12px);
      }

      .panel-header {
        position: relative;
        flex: none;
        z-index: 2;
        top: 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        min-height: 58px;
        border-bottom: 1px solid var(--line);
        background: rgba(243, 241, 234, .98);
        padding: 12px 15px;
      }

      .brand {
        min-width: 0;
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .brand-mark {
        flex: none;
        color: var(--ink);
        font-size: 12px;
        font-weight: 900;
        letter-spacing: -.04em;
      }

      .brand-mark i {
        color: var(--signal);
        font-style: normal;
        letter-spacing: 0;
        padding-inline: 2px;
      }

      .brand-label {
        overflow: hidden;
        border-left: 1px solid var(--line-strong);
        padding-left: 10px;
        color: var(--muted);
        font: 700 8px/1.2 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        letter-spacing: .13em;
        text-overflow: ellipsis;
        text-transform: uppercase;
        white-space: nowrap;
      }

      nav {
        flex: none;
        display: flex;
        align-items: center;
        gap: 12px;
      }

      nav a,
      nav button {
        border: 0;
        border-bottom: 1px solid transparent;
        background: none;
        color: var(--muted);
        padding: 3px 0;
        cursor: pointer;
        font-size: 10px;
        font-weight: 700;
      }

      nav a:hover,
      nav button:hover {
        border-color: var(--signal);
        color: var(--ink);
      }

      .recording-bar {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 20px;
        border-bottom: 1px solid var(--line);
        padding: 9px 15px;
        color: var(--faint);
        font: 750 8px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        letter-spacing: .12em;
        text-transform: uppercase;
      }

      .recording {
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--signal);
      }

      .recording i {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--signal);
        box-shadow: 0 0 0 4px rgba(30, 122, 90, .12);
      }

      main {
        min-height: 0;
        overflow: auto;
        padding: 18px 15px 16px;
        scrollbar-color: var(--line-strong) var(--paper);
      }

      .empty-state {
        min-height: 170px;
        display: flex;
        flex-direction: column;
        justify-content: center;
        border-block: 1px solid var(--line);
        padding-block: 24px;
      }

      .empty-state span,
      .section-label {
        color: var(--signal);
        font: 800 8px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        letter-spacing: .13em;
        text-transform: uppercase;
      }

      .empty-state strong {
        margin-top: 13px;
        font-size: 21px;
        letter-spacing: -.035em;
      }

      .empty-state p {
        max-width: 320px;
        margin: 9px 0 0;
        color: var(--muted);
        line-height: 1.55;
      }

      .meta {
        display: flex;
        justify-content: space-between;
        gap: 18px;
        margin-bottom: 20px;
        color: var(--faint);
        font: 700 9px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        letter-spacing: .07em;
        text-transform: uppercase;
      }

      .strategy-block {
        border-bottom: 1px solid var(--line);
        padding-bottom: 19px;
      }

      h2 {
        margin: 10px 0 0;
        color: var(--ink);
        font-size: 20px;
        font-weight: 720;
        letter-spacing: -.035em;
        line-height: 1.16;
      }

      .provider {
        margin: 12px 0 0;
        color: var(--muted);
        font: 600 10px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        overflow-wrap: anywhere;
      }

      .warning {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-top: 14px;
        border: 1px solid rgba(183, 96, 42, .42);
        background: rgba(183, 96, 42, .08);
        padding: 8px 10px;
        color: var(--warning);
        font: 800 8px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        letter-spacing: .1em;
        overflow-wrap: anywhere;
        text-transform: uppercase;
      }

      .warning i {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
      }

      .actions {
        padding-block: 18px 10px;
      }

      .action {
        display: grid;
        grid-template-columns: 30px minmax(0, 1fr);
        gap: 10px;
        margin-top: 8px;
        border: 1px solid var(--line);
        background: var(--raised);
      }

      .action-index {
        display: grid;
        place-items: center;
        border-right: 1px solid var(--line);
        color: var(--signal);
        font: 800 9px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }

      .action-copy {
        min-width: 0;
        padding: 10px 10px 9px 0;
      }

      .action-title {
        display: block;
        color: var(--ink);
        font-size: 11px;
        font-weight: 700;
        line-height: 1.45;
        overflow-wrap: anywhere;
      }

      .action-detail {
        display: block;
        margin-top: 4px;
        color: var(--muted);
        font: 600 8px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        letter-spacing: .02em;
      }

      .action-outcome {
        display: block;
        margin-top: 3px;
        color: var(--muted);
        font-size: 9px;
        line-height: 1.4;
      }

      .stats {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        border-block: 1px solid var(--line-strong);
        margin-top: 8px;
        background: var(--raised);
      }

      .stats div {
        min-width: 0;
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 6px;
        border-right: 1px solid var(--line-strong);
        padding: 7px 8px;
      }

      .stats div:last-child {
        border-right: 0;
      }

      .stats span {
        color: var(--faint);
        font: 750 7px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        letter-spacing: .08em;
        text-transform: uppercase;
      }

      .stats b {
        color: var(--ink);
        font-size: 10px;
        white-space: nowrap;
      }

      .observation {
        margin-top: 20px;
        border-top: 1px solid var(--line);
        padding-top: 16px;
      }

      .agent-summary {
        margin-top: 10px;
      }

      .self-stats {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        border-block: 1px solid var(--line);
      }

      .self-stat {
        min-width: 0;
        padding: 9px 10px 9px 0;
      }

      .self-stat + .self-stat {
        border-left: 1px solid var(--line);
        padding-inline: 10px 0;
      }

      .self-stat-label {
        display: block;
        color: var(--faint);
        font: 750 7px/1.4 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        letter-spacing: .1em;
        text-transform: uppercase;
      }

      .self-stat-value {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
        margin-top: 4px;
      }

      .self-stat-value strong {
        min-width: 0;
        overflow: hidden;
        color: var(--ink);
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .delta {
        flex: none;
        font: 750 8px/1.3 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }

      .delta.up { color: var(--signal); }
      .delta.down { color: var(--warning); }
      .delta.flat { color: var(--muted); }
      .delta.unavailable { color: var(--faint); }

      .playback-footer {
        flex: none;
        border-top: 1px solid var(--line-strong);
        background: var(--paper);
      }

      ::slotted(harness-replay-playback) {
        display: block;
        width: 100%;
      }

      .collapsed .recording-bar,
      .collapsed main,
      .collapsed .playback-footer {
        display: none;
      }

      .collapsed .panel-header {
        border-bottom: 0;
      }

      @media (max-width: 680px) {
        :host {
          top: auto;
          right: 8px;
          bottom: max(8px, env(safe-area-inset-bottom));
          left: 8px;
          width: auto;
        }

        .panel {
          max-height: min(72vh, calc(100vh - 16px));
        }

        .panel-header {
          min-height: 52px;
          padding: 10px 12px;
        }

        .brand-label { display: none; }

        .recording-bar { padding-inline: 12px; }

        main { padding: 15px 12px 13px; }
      }

      @media (max-width: 390px) {
        nav { gap: 9px; }
        nav a, nav button { font-size: 9px; }
        .run-id { display: none; }
        h2 { font-size: 18px; }
        .stats div { padding-inline: 6px; }
      }

      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { transition-duration: .01ms !important; }
      }
    </style>
    <section class="panel">
      <header class="panel-header">
        <a class="brand" href="/" aria-label="Return to OpenFront Harness">
          <span class="brand-mark">OpenFront <i>Harness</i></span>
          <span class="brand-label">Decision trace</span>
        </a>
        <nav aria-label="Replay trace controls">
          <a href="/">Exit</a>
          <a href="/replay/${this.runId}">Restart</a>
          <button id="toggle" type="button" aria-expanded="true">Hide</button>
        </nav>
      </header>
      <div class="recording-bar">
        <span class="recording"><i aria-hidden="true"></i>Recorded simulation</span>
        <span class="run-id">Run ${this.runId.slice(0, 8)}</span>
      </div>
      <main aria-live="polite" aria-busy="true">
        <div class="empty-state">
          <span>Loading trace</span>
          <strong>Reading the decision artifact…</strong>
        </div>
      </main>
      <footer class="playback-footer">
        <slot name="playback"></slot>
      </footer>
    </section>`;
    this.body = root.querySelector("main")!;
    const panel = root.querySelector<HTMLElement>(".panel")!;
    const toggle = root.querySelector<HTMLButtonElement>("#toggle")!;
    toggle.addEventListener("click", () => {
      panel.classList.toggle("collapsed");
      const expanded = !panel.classList.contains("collapsed");
      toggle.textContent = expanded ? "Hide" : "Show";
      toggle.setAttribute("aria-expanded", String(expanded));
    });
    window.addEventListener(
      "harness-replay-tick",
      this.onTick as EventListener,
    );
    void this.load();
  }

  disconnectedCallback() {
    window.removeEventListener(
      "harness-replay-tick",
      this.onTick as EventListener,
    );
  }

  setRunId(runId: string) {
    this.runId = runId;
  }

  private onTick = (event: CustomEvent<{ tick: number }>) => {
    let next = -1;
    for (let i = 0; i < this.decisions.length; i++) {
      if (this.decisions[i].tick <= event.detail.tick) next = i;
      else break;
    }
    if (next !== this.current) {
      this.current = next;
      this.renderDecision();
    }
  };

  private async load() {
    try {
      const response = await fetch(`/api/runs/${this.runId}`);
      if (!response.ok)
        throw new Error(`Trace request failed: ${response.status}`);
      const data = await response.json();
      this.decisions = data.run.decisions ?? [];
      this.body.setAttribute("aria-busy", "false");
      this.renderDecision();
    } catch (error) {
      console.error("Could not load decision trace", error);
      this.body.setAttribute("aria-busy", "false");
      this.renderState(
        "Trace unavailable",
        "The replay can continue, but its decision artifact could not be loaded.",
      );
    }
  }

  private renderState(title: string, message: string) {
    this.body.replaceChildren();
    const state = document.createElement("div");
    state.className = "empty-state";
    const label = document.createElement("span");
    label.textContent = "Decision trace";
    const heading = document.createElement("strong");
    heading.textContent = title;
    const copy = document.createElement("p");
    copy.textContent = message;
    state.append(label, heading, copy);
    this.body.append(state);
  }

  private formatElapsed(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.floor(seconds % 60);
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  private renderDecision() {
    this.body.replaceChildren();
    const decision =
      this.current >= 0 ? this.decisions[this.current] : undefined;
    if (!decision) {
      this.renderState(
        this.decisions.length
          ? "Waiting for decision 01"
          : "No decisions recorded",
        this.decisions.length
          ? "The agent's first decision appears after all four players spawn."
          : "This replay does not contain a model decision trace.",
      );
      return;
    }

    const meta = document.createElement("div");
    meta.className = "meta";
    const decisionNumber = document.createElement("span");
    decisionNumber.textContent = `Decision ${decision.index + 1} / ${this.decisions.length}`;
    const simulationTime = document.createElement("span");
    simulationTime.textContent = `Tick ${decision.tick} · ${this.formatElapsed(decision.observation.elapsedSeconds)}`;
    meta.append(decisionNumber, simulationTime);

    const strategyBlock = document.createElement("section");
    strategyBlock.className = "strategy-block";
    const strategyLabel = document.createElement("span");
    strategyLabel.className = "section-label";
    strategyLabel.textContent = "Agent Decision";
    const title = document.createElement("h2");
    title.textContent = decision.strategy;
    const provider = document.createElement("p");
    provider.className = "provider";
    provider.textContent = `${decision.model}${decision.provider ? ` via ${decision.provider}` : ""}`;
    strategyBlock.append(strategyLabel, title, provider);

    if (decision.fallback || decision.attemptFailures?.length) {
      const warning = document.createElement("div");
      warning.className = "warning";
      const dot = document.createElement("i");
      dot.setAttribute("aria-hidden", "true");
      const failures =
        decision.attemptFailures
          ?.map((failure) => {
            const ids = failure.rejectedActionIds.length
              ? ` (${failure.rejectedActionIds.join(", ")})`
              : "";
            return `Attempt ${failure.attempt}: ${failure.code}${ids}`;
          })
          .join(" · ") ?? "";
      const status = decision.fallback
        ? "Validation fallback used"
        : "Recovered after retry";
      warning.title =
        decision.attemptFailures
          ?.map((failure) => failure.message)
          .join("\n") ?? "";
      warning.append(dot, failures ? `${status} · ${failures}` : status);
      strategyBlock.append(warning);
    }

    const actions = document.createElement("section");
    actions.className = "actions";
    const actionsLabel = document.createElement("span");
    actionsLabel.className = "section-label";
    actionsLabel.textContent = "Executed actions";
    actions.append(actionsLabel);
    decision.appliedActionIds.forEach((id, index) => {
      const presentation = presentReplayAction(
        id,
        decision.candidates ?? [],
        decision.outcomes[index],
      );
      const row = document.createElement("div");
      row.className = "action";
      row.title = `Action ID: ${id}`;
      const actionIndex = document.createElement("span");
      actionIndex.className = "action-index";
      actionIndex.textContent = String(index + 1).padStart(2, "0");
      const actionCopy = document.createElement("div");
      actionCopy.className = "action-copy";
      const actionTitle = document.createElement("span");
      actionTitle.className = "action-title";
      actionTitle.textContent = presentation.label;
      actionCopy.append(actionTitle);
      if (presentation.detail) {
        const detail = document.createElement("span");
        detail.className = "action-detail";
        detail.textContent = presentation.detail;
        actionCopy.append(detail);
      }
      const outcome = document.createElement("small");
      outcome.className = "action-outcome";
      outcome.textContent = presentation.outcome;
      actionCopy.append(outcome);
      row.append(actionIndex, actionCopy);
      actions.append(row);
    });

    const stats = document.createElement("div");
    stats.className = "stats";
    const statValues = [
      ["Latency", formatLatency(decision.latencyMs)],
      [
        "Tokens",
        (decision.promptTokens + decision.completionTokens).toLocaleString(),
      ],
      ["Cost", `$${decision.costUsd.toFixed(4)}`],
    ];
    statValues.forEach(([label, value]) => {
      const cell = document.createElement("div");
      const name = document.createElement("span");
      name.textContent = label;
      const amount = document.createElement("b");
      amount.textContent = value;
      cell.append(name, amount);
      stats.append(cell);
    });

    const observation = document.createElement("section");
    observation.className = "observation";
    const observationLabel = document.createElement("span");
    observationLabel.className = "section-label";
    observationLabel.textContent = "Agent State";
    const summary = document.createElement("div");
    summary.className = "agent-summary";

    const previousSelf =
      this.current > 0
        ? this.decisions[this.current - 1]?.observation.self
        : undefined;
    const selfStats = document.createElement("div");
    selfStats.className = "self-stats";
    const ownStats = [
      {
        label: "Tiles",
        value: Number(decision.observation.self.tiles).toLocaleString(),
        exactValue: `${Number(decision.observation.self.tiles).toLocaleString()} tiles`,
        delta: statDelta(
          Number(decision.observation.self.tiles),
          previousSelf ? Number(previousSelf.tiles) : undefined,
        ),
      },
      {
        label: "Troops",
        value: renderTroops(Number(decision.observation.self.troops)),
        exactValue: `${Number(decision.observation.self.troops).toLocaleString()} available garrison troops`,
        delta: statDelta(
          Number(decision.observation.self.troops),
          previousSelf ? Number(previousSelf.troops) : undefined,
        ),
      },
    ];
    ownStats.forEach((entry) => {
      const stat = document.createElement("div");
      stat.className = "self-stat";
      const label = document.createElement("span");
      label.className = "self-stat-label";
      label.textContent = entry.label;
      const valueRow = document.createElement("div");
      valueRow.className = "self-stat-value";
      const value = document.createElement("strong");
      value.textContent = entry.value;
      value.title = entry.exactValue;
      const delta = document.createElement("span");
      delta.className = `delta ${entry.delta.direction}`;
      delta.textContent = entry.delta.label;
      delta.title = entry.delta.description;
      delta.setAttribute("aria-label", entry.delta.description);
      valueRow.append(value, delta);
      stat.append(label, valueRow);
      selfStats.append(stat);
    });
    summary.append(selfStats);
    observation.append(observationLabel, summary);

    this.body.append(meta, strategyBlock, actions, stats, observation);
  }
}

if (!customElements.get("harness-replay-panel")) {
  customElements.define("harness-replay-panel", HarnessReplayPanel);
}

export function installHarnessReplayPanel(runId: string): HTMLElement {
  const existing = document.querySelector<HTMLElement>("harness-replay-panel");
  if (existing) return existing;
  const panel = document.createElement(
    "harness-replay-panel",
  ) as HarnessReplayPanel;
  panel.setRunId(runId);
  document.body.append(panel);
  return panel;
}
