import { EventBus } from "../../OpenFrontIO/src/core/EventBus";
import {
  GameSpeedDownIntentEvent,
  GameSpeedUpIntentEvent,
  ReplaySpeedChangeEvent,
} from "../../OpenFrontIO/src/client/InputHandler";
import { PauseGameIntentEvent } from "../../OpenFrontIO/src/client/Transport";
import { ReplayPanel } from "../../OpenFrontIO/src/client/hud/layers/ReplayPanel";
import {
  defaultReplaySpeedMultiplier,
  ReplaySpeedMultiplier,
} from "../../OpenFrontIO/src/client/utilities/ReplaySpeedMultiplier";
import {
  clampReplayTick,
  formatReplayTime,
  isReplayComplete,
  replayProgressPercent,
  replayRates,
} from "./ReplayPlaybackState";

class HarnessReplayPlayback extends HTMLElement {
  private totalTicks = 0;
  private currentTick = 0;
  private paused = false;
  private speed = defaultReplaySpeedMultiplier;
  private eventBus: EventBus | null = null;
  private paintFrame: number | null = null;
  private toggleButton: HTMLButtonElement;
  private status: HTMLElement;
  private time: HTMLOutputElement;
  private progress: HTMLElement;
  private progressFill: HTMLElement;
  private rateButtons: HTMLButtonElement[];

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
        display: block;
        width: 100%;
        color: var(--ink);
        font: 12px/1.35 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-synthesis: none;
      }

      * { box-sizing: border-box; }

      button { font: inherit; }

      button { -webkit-tap-highlight-color: transparent; }

      button:focus-visible {
        outline: 2px solid #7bbcff;
        outline-offset: 3px;
      }

      .transport {
        overflow: hidden;
        background: var(--paper);
      }

      .progress {
        position: relative;
        height: 4px;
        overflow: hidden;
        background: var(--line);
      }

      .progress-fill {
        width: 0;
        height: 100%;
        background: var(--signal);
        transition: width 80ms linear;
      }

      .controls {
        min-height: 54px;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 8px 10px;
      }

      .toggle {
        width: 36px;
        height: 36px;
        flex: none;
        display: grid;
        place-items: center;
        border: 1px solid rgba(30, 122, 90, .5);
        border-radius: 50%;
        background: rgba(30, 122, 90, .08);
        color: var(--signal);
        cursor: pointer;
      }

      .toggle:hover:not(:disabled) {
        border-color: var(--signal);
        background: rgba(30, 122, 90, .14);
      }

      .toggle svg {
        width: 15px;
        height: 15px;
        fill: currentColor;
      }

      .toggle:disabled,
      .rate:disabled {
        cursor: not-allowed;
        opacity: .42;
      }

      .readout {
        min-width: 116px;
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        gap: 2px;
      }

      .status {
        color: var(--signal);
        font: 800 8px/1.3 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        letter-spacing: .13em;
        text-transform: uppercase;
      }

      output {
        color: var(--muted);
        font: 700 10px/1.3 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        letter-spacing: .04em;
        white-space: nowrap;
      }

      .rates {
        display: grid;
        grid-template-columns: repeat(3, minmax(42px, 1fr));
        gap: 5px;
      }

      .rate {
        min-height: 30px;
        border: 1px solid var(--line);
        border-radius: 4px;
        background: transparent;
        color: var(--muted);
        padding: 4px 9px;
        cursor: pointer;
        font: 750 10px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      }

      .rate:hover:not(:disabled) {
        border-color: var(--line-strong);
        color: var(--ink);
      }

      .rate[aria-pressed="true"] {
        border-color: rgba(30, 122, 90, .7);
        background: rgba(30, 122, 90, .1);
        color: var(--signal);
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        clip-path: inset(50%);
      }

      @media (max-width: 480px) {
        .controls {
          min-height: 52px;
          gap: 7px;
          padding: 7px 8px;
        }

        .toggle {
          width: 34px;
          height: 34px;
        }

        .readout { min-width: 78px; }

        .status { font-size: 7px; }

        output {
          font-size: 8px;
          letter-spacing: 0;
        }

        .rates {
          flex: 1 1 auto;
          grid-template-columns: repeat(3, 1fr);
          gap: 3px;
        }

        .rate {
          min-width: 0;
          padding-inline: 3px;
          font-size: 9px;
        }
      }

      @media (prefers-reduced-motion: reduce) {
        .progress-fill { transition: none; }
      }
    </style>
    <section class="transport" aria-label="Match replay playback">
      <div
        class="progress"
        id="progress"
        role="progressbar"
        aria-label="Replay progress"
        aria-valuemin="0"
        aria-valuemax="${this.totalTicks}"
        aria-valuenow="0"
      >
        <div class="progress-fill"></div>
      </div>
      <div class="controls">
        <button class="toggle" type="button" disabled>
          <span class="sr-only">Pause replay</span>
        </button>
        <div class="readout">
          <span class="status" aria-live="polite">Loading replay</span>
          <output>00:00 / ${formatReplayTime(this.totalTicks)}</output>
        </div>
        <div class="rates" aria-label="Playback speed">
          ${replayRates
            .map(
              (rate) => `<button
                class="rate"
                type="button"
                data-speed="${rate.multiplier}"
                aria-label="${rate.id === "fastest" ? "Fast-forward at maximum speed" : `Play at ${rate.label} speed`}"
                aria-pressed="${rate.multiplier === this.speed}"
                disabled
              >${rate.label}</button>`,
            )
            .join("")}
        </div>
      </div>
    </section>`;

    this.toggleButton = root.querySelector(".toggle")!;
    this.status = root.querySelector(".status")!;
    this.time = root.querySelector("output")!;
    this.progress = root.querySelector(".progress")!;
    this.progressFill = root.querySelector(".progress-fill")!;
    this.rateButtons = Array.from(root.querySelectorAll(".rate"));

    root
      .querySelector(".transport")!
      .addEventListener("contextmenu", (event) => {
        event.preventDefault();
      });
    this.toggleButton.addEventListener("click", this.togglePlayback);
    this.rateButtons.forEach((button) => {
      button.addEventListener("click", this.changeSpeed);
    });
    window.addEventListener(
      "harness-replay-tick",
      this.onTick as EventListener,
    );
    this.schedulePaint();
  }

  disconnectedCallback() {
    window.removeEventListener(
      "harness-replay-tick",
      this.onTick as EventListener,
    );
    this.toggleButton?.removeEventListener("click", this.togglePlayback);
    this.rateButtons?.forEach((button) => {
      button.removeEventListener("click", this.changeSpeed);
    });
    if (this.paintFrame !== null) {
      cancelAnimationFrame(this.paintFrame);
      this.paintFrame = null;
    }
    this.disconnectEventBus();
  }

  setTotalTicks(totalTicks: number) {
    this.totalTicks = Math.max(0, Math.floor(totalTicks));
  }

  private connectEventBus() {
    if (this.eventBus) return;
    const replayPanel = document.querySelector(
      "replay-panel",
    ) as ReplayPanel | null;
    if (!replayPanel?.eventBus) return;

    this.eventBus = replayPanel.eventBus;
    this.eventBus.on(ReplaySpeedChangeEvent, this.onSpeedChanged);
    this.eventBus.on(PauseGameIntentEvent, this.onPauseChanged);
    this.eventBus.on(GameSpeedUpIntentEvent, this.onSpeedUp);
    this.eventBus.on(GameSpeedDownIntentEvent, this.onSpeedDown);
  }

  private disconnectEventBus() {
    if (!this.eventBus) return;
    this.eventBus.off(ReplaySpeedChangeEvent, this.onSpeedChanged);
    this.eventBus.off(PauseGameIntentEvent, this.onPauseChanged);
    this.eventBus.off(GameSpeedUpIntentEvent, this.onSpeedUp);
    this.eventBus.off(GameSpeedDownIntentEvent, this.onSpeedDown);
    this.eventBus = null;
  }

  private onTick = (event: CustomEvent<{ tick: number }>) => {
    this.connectEventBus();
    this.currentTick = clampReplayTick(event.detail.tick, this.totalTicks);
    this.schedulePaint();
  };

  private onSpeedChanged = (event: ReplaySpeedChangeEvent) => {
    this.speed = event.replaySpeedMultiplier;
    this.schedulePaint();
  };

  private onPauseChanged = (event: PauseGameIntentEvent) => {
    this.paused = event.paused;
    this.schedulePaint();
  };

  private onSpeedUp = () => {
    const current = replayRates.findIndex(
      (rate) => rate.multiplier === this.speed,
    );
    this.setSpeed(replayRates[Math.min(current + 1, replayRates.length - 1)]);
  };

  private onSpeedDown = () => {
    const current = replayRates.findIndex(
      (rate) => rate.multiplier === this.speed,
    );
    this.setSpeed(replayRates[Math.max(current - 1, 0)]);
  };

  private togglePlayback = () => {
    if (!this.eventBus || isReplayComplete(this.currentTick, this.totalTicks)) {
      return;
    }
    this.eventBus.emit(new PauseGameIntentEvent(!this.paused));
  };

  private changeSpeed = (event: Event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const multiplier = Number(button.dataset.speed) as ReplaySpeedMultiplier;
    const rate = replayRates.find((entry) => entry.multiplier === multiplier);
    this.setSpeed(rate);
  };

  private setSpeed(rate: (typeof replayRates)[number] | undefined) {
    if (
      !rate ||
      !this.eventBus ||
      isReplayComplete(this.currentTick, this.totalTicks)
    ) {
      return;
    }
    this.eventBus.emit(new ReplaySpeedChangeEvent(rate.multiplier));
  }

  private schedulePaint() {
    if (this.paintFrame !== null) return;
    this.paintFrame = requestAnimationFrame(() => {
      this.paintFrame = null;
      this.paint();
    });
  }

  private paint() {
    if (!this.toggleButton) return;
    const complete = isReplayComplete(this.currentTick, this.totalTicks);
    const ready = this.eventBus !== null;
    const disabled = !ready || complete;
    const progress = replayProgressPercent(this.currentTick, this.totalTicks);
    const state = complete
      ? "Replay complete"
      : !ready
        ? "Loading replay"
        : this.paused
          ? "Replay paused"
          : this.speed === ReplaySpeedMultiplier.fastest
            ? "Fast-forwarding"
            : "Playing replay";

    this.status.textContent = state;
    this.time.textContent = `${formatReplayTime(this.currentTick)} / ${formatReplayTime(this.totalTicks)}`;
    this.progress.setAttribute("aria-valuemax", String(this.totalTicks));
    this.progress.setAttribute("aria-valuenow", String(this.currentTick));
    this.progress.setAttribute(
      "aria-valuetext",
      `${formatReplayTime(this.currentTick)} of ${formatReplayTime(this.totalTicks)}`,
    );
    this.progressFill.style.width = `${progress}%`;

    this.toggleButton.disabled = disabled;
    this.toggleButton.setAttribute(
      "aria-label",
      complete
        ? "Replay complete"
        : this.paused
          ? "Resume replay"
          : "Pause replay",
    );
    this.toggleButton.innerHTML = this.paused
      ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg><span class="sr-only">Resume replay</span>`
      : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg><span class="sr-only">${complete ? "Replay complete" : "Pause replay"}</span>`;

    this.rateButtons.forEach((button) => {
      button.disabled = disabled;
      button.setAttribute(
        "aria-pressed",
        String(Number(button.dataset.speed) === this.speed),
      );
    });
  }
}

if (!customElements.get("harness-replay-playback")) {
  customElements.define("harness-replay-playback", HarnessReplayPlayback);
}

export function installHarnessReplayControls(
  totalTicks: number,
  container: HTMLElement = document.body,
) {
  if (document.querySelector("harness-replay-playback")) return;
  const controls = document.createElement(
    "harness-replay-playback",
  ) as HarnessReplayPlayback;
  controls.setTotalTicks(totalTicks);
  controls.slot = "playback";
  container.append(controls);
}
