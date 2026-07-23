type PublicDecision = {
  index: number;
  tick: number;
  strategy: string;
  appliedActionIds: string[];
  outcomes: string[];
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  model: string;
  provider: string | null;
  fallback: boolean;
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
      :host { position: fixed; z-index: 100000; top: 14px; right: 14px; width: min(390px, calc(100vw - 28px)); color: #edf5f0; font: 13px/1.45 Inter, system-ui, sans-serif; }
      .panel { max-height: calc(100vh - 28px); overflow: auto; border: 1px solid #365047; border-radius: 12px; background: rgba(5, 17, 13, .94); box-shadow: 0 20px 70px rgba(0,0,0,.55); backdrop-filter: blur(16px); }
      header { position: sticky; top: 0; background: #091712; border-bottom: 1px solid #294137; padding: 14px 16px; display: flex; align-items: center; justify-content: space-between; }
      .brand { color: #6ce4a5; letter-spacing: .12em; font-size: 10px; font-weight: 900; }
      nav { display: flex; gap: 12px; } a, button { color: #b9cbc3; background: none; border: 0; padding: 0; cursor: pointer; text-decoration: none; font: inherit; }
      main { padding: 18px; } .empty { color: #8fa39a; }
      .meta { display: flex; justify-content: space-between; color: #758b81; font-size: 11px; margin-bottom: 12px; }
      h2 { font-size: 20px; line-height: 1.2; margin: 0 0 10px; } .strategy { color: #b9cbc3; margin: 0 0 18px; }
      .action { border-left: 2px solid #62d79c; background: #10241c; padding: 10px 12px; margin: 8px 0; border-radius: 0 6px 6px 0; overflow-wrap: anywhere; }
      .action span { color: #7f978d; display: block; margin-top: 4px; font-size: 11px; }
      .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: #294137; margin-top: 18px; }
      .stats div { background: #0c1d17; padding: 10px; } .stats span { color: #789086; display: block; font-size: 9px; text-transform: uppercase; letter-spacing: .08em; } .stats b { font-size: 12px; }
      .players { margin-top: 16px; border-top: 1px solid #294137; padding-top: 14px; } .player { display: flex; justify-content: space-between; padding: 5px 0; color: #8fa49a; } .player.self { color: #6ce4a5; }
      .fallback { color: #ffb36b; font-size: 10px; font-weight: bold; text-transform: uppercase; }
      .collapsed main { display: none; }
    </style><section class="panel"><header><span class="brand">OF × LLM TRACE</span><nav><a href="/">Exit</a><a href="/replay/${this.runId}">Restart</a><button id="toggle">Hide</button></nav></header><main><p class="empty">Loading decision trace…</p></main></section>`;
    this.body = root.querySelector("main")!;
    root.querySelector("#toggle")!.addEventListener("click", () => {
      const panel = root.querySelector(".panel")!;
      panel.classList.toggle("collapsed");
      root.querySelector("#toggle")!.textContent = panel.classList.contains(
        "collapsed",
      )
        ? "Show"
        : "Hide";
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
    const response = await fetch(`/api/runs/${this.runId}`);
    if (!response.ok) {
      this.body.textContent = "Decision trace unavailable.";
      return;
    }
    const data = await response.json();
    this.decisions = data.run.decisions ?? [];
    this.renderDecision();
  }

  private renderDecision() {
    this.body.replaceChildren();
    const decision =
      this.current >= 0 ? this.decisions[this.current] : undefined;
    if (!decision) {
      const message = document.createElement("p");
      message.className = "empty";
      message.textContent = this.decisions.length
        ? "The agent's first decision appears after all four players spawn."
        : "No model decisions were recorded.";
      this.body.append(message);
      return;
    }
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `<span>Decision ${decision.index + 1}/${this.decisions.length}</span><span>Tick ${decision.tick} · ${decision.observation.elapsedSeconds.toFixed(1)}s</span>`;
    const title = document.createElement("h2");
    title.textContent = decision.strategy;
    const strategy = document.createElement("p");
    strategy.className = "strategy";
    strategy.textContent = `${decision.model}${decision.provider ? ` via ${decision.provider}` : ""}`;
    this.body.append(meta, title, strategy);
    if (decision.fallback) {
      const fallback = document.createElement("p");
      fallback.className = "fallback";
      fallback.textContent = "Validation fallback used";
      this.body.append(fallback);
    }
    decision.appliedActionIds.forEach((id, index) => {
      const row = document.createElement("div");
      row.className = "action";
      row.textContent = id;
      const outcome = document.createElement("span");
      outcome.textContent = decision.outcomes[index];
      row.append(outcome);
      this.body.append(row);
    });
    const stats = document.createElement("div");
    stats.className = "stats";
    stats.innerHTML = `<div><span>Latency</span><b>${Math.round(decision.latencyMs)}ms</b></div><div><span>Tokens</span><b>${decision.promptTokens + decision.completionTokens}</b></div><div><span>Cost</span><b>$${decision.costUsd.toFixed(4)}</b></div>`;
    const players = document.createElement("div");
    players.className = "players";
    const entries = [
      decision.observation.self,
      ...decision.observation.opponents,
    ];
    entries.forEach((player, index) => {
      const row = document.createElement("div");
      row.className = `player${index === 0 ? " self" : ""}`;
      const name = document.createElement("span");
      name.textContent = `${index === 0 ? "● " : ""}${player.name}`;
      const state = document.createElement("span");
      state.textContent = `${player.tiles} tiles · ${Math.floor(player.troops).toLocaleString()} troops`;
      row.append(name, state);
      players.append(row);
    });
    this.body.append(stats, players);
  }
}

if (!customElements.get("harness-replay-panel")) {
  customElements.define("harness-replay-panel", HarnessReplayPanel);
}

export function installHarnessReplayPanel(runId: string) {
  const existing = document.querySelector("harness-replay-panel");
  if (existing) return;
  const panel = document.createElement(
    "harness-replay-panel",
  ) as HarnessReplayPanel;
  panel.setRunId(runId);
  document.body.append(panel);
}
