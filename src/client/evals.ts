const modelSelectors = Array.from(
  document.querySelectorAll<HTMLSelectElement>("[data-model-selector]"),
);
const modelResultGroups = Array.from(
  document.querySelectorAll<HTMLElement>("[data-model-results]"),
);

function showModelResults(modelId: string): void {
  for (const selector of modelSelectors) {
    selector.value = modelId;
  }

  for (const resultGroup of modelResultGroups) {
    resultGroup.hidden = resultGroup.dataset.modelResults !== modelId;
  }
}

for (const selector of modelSelectors) {
  selector.addEventListener("change", () => showModelResults(selector.value));
}

type ReplayTrial = {
  trialId: string;
  taskId: string;
  suite: "match" | "capability";
  trialNumber: number;
};

type ReplayModel = {
  id: string;
  label: string;
  trials: ReplayTrial[];
};

type ReplayIndex = { models: ReplayModel[] };

const replayTaskLabels: Record<string, string> = {
  "match-01": "Match 01 · Japan · Medium",
  "match-02": "Match 02 · Japan · Hard",
  "match-03": "Match 03 · Europe Classic · Medium",
  "match-04": "Match 04 · Europe Classic · Hard",
  "match-05": "Match 05 · Four Islands · Medium",
  "match-06": "Match 06 · Four Islands · Hard",
  "match-07": "Match 07 · Great Lakes · Medium",
  "match-08": "Match 08 · Great Lakes · Hard",
  "match-09": "Match 09 · Strait of Gibraltar · Medium",
  "match-10": "Match 10 · Strait of Gibraltar · Hard",
  "match-11": "Match 11 · World · Medium",
  "match-12": "Match 12 · World · Hard",
};

const capabilityLabels: Array<[string, string]> = [
  ["neutral-expansion", "Neutral expansion"],
  ["saturated-capacity-expansion", "Saturated capacity expansion"],
  ["post-expansion-recovery", "Post-expansion recovery"],
  ["weaker-target-selection", "Weaker target selection"],
  ["frontier-restraint", "Frontier restraint"],
  ["incoming-attack-response", "Incoming attack response"],
  ["split-front-prioritization", "Split-front defense"],
  ["losing-attack-retreat", "Losing-attack retreat"],
  ["naval-target-recognition", "Naval target recognition"],
  ["construction-failure-recovery", "Construction recovery"],
];

function replayTaskLabel(taskId: string): string {
  if (replayTaskLabels[taskId]) return replayTaskLabels[taskId];
  const capability = capabilityLabels.find(([family]) =>
    taskId.startsWith(`cap-${family}-`),
  );
  return capability?.[1] ?? taskId;
}

function replaceOptions(
  select: HTMLSelectElement,
  options: Array<{ value: string; label: string }>,
): void {
  select.replaceChildren(
    ...options.map(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      return option;
    }),
  );
}

async function installReplayBrowser(): Promise<void> {
  const picker = document.querySelector<HTMLFormElement>(
    "[data-replay-picker]",
  );
  if (!picker) return;

  const modelSelect = picker.querySelector<HTMLSelectElement>(
    "[data-replay-model]",
  )!;
  const suiteSelect = picker.querySelector<HTMLSelectElement>(
    "[data-replay-suite]",
  )!;
  const taskSelect =
    picker.querySelector<HTMLSelectElement>("[data-replay-task]")!;
  const trialSelect = picker.querySelector<HTMLSelectElement>(
    "[data-replay-trial]",
  )!;
  const openLink =
    picker.querySelector<HTMLAnchorElement>("[data-replay-open]")!;
  const status = picker.querySelector<HTMLElement>("[data-replay-status]")!;

  const setUnavailable = (message: string) => {
    status.textContent = message;
    openLink.href = "#";
    openLink.setAttribute("aria-disabled", "true");
  };

  try {
    const response = await fetch("/api/evals/replays");
    if (!response.ok)
      throw new Error(`Replay index request failed: ${response.status}`);
    const index = (await response.json()) as ReplayIndex;
    if (!index.models.length) throw new Error("No benchmark replays found");

    replaceOptions(
      modelSelect,
      index.models.map((model) => ({ value: model.id, label: model.label })),
    );

    const selectedModel = () =>
      index.models.find((model) => model.id === modelSelect.value) ??
      index.models[0];
    const suiteTrials = () =>
      selectedModel().trials.filter(
        (trial) => trial.suite === suiteSelect.value,
      );

    const updateOpenLink = () => {
      const replayId = trialSelect.value;
      openLink.href = replayId ? `/replay/${replayId}` : "#";
      openLink.toggleAttribute("aria-disabled", !replayId);
    };

    const updateTrial = () => {
      const trials = suiteTrials().filter(
        (trial) => trial.taskId === taskSelect.value,
      );
      replaceOptions(
        trialSelect,
        trials.map((trial) => ({
          value: trial.trialId,
          label: `Trial ${trial.trialNumber} of ${trials.length}`,
        })),
      );
      updateOpenLink();
    };

    const updateTask = () => {
      const tasks = [
        ...new Set(suiteTrials().map((trial) => trial.taskId)),
      ].sort();
      replaceOptions(
        taskSelect,
        tasks.map((taskId) => ({
          value: taskId,
          label: replayTaskLabel(taskId),
        })),
      );
      updateTrial();
      status.textContent = `${selectedModel().trials.length} verified replays available for ${selectedModel().label}.`;
    };

    modelSelect.addEventListener("change", updateTask);
    suiteSelect.addEventListener("change", updateTask);
    taskSelect.addEventListener("change", updateTrial);
    trialSelect.addEventListener("change", updateOpenLink);
    openLink.addEventListener("click", (event) => {
      if (openLink.getAttribute("aria-disabled") === "true")
        event.preventDefault();
    });
    updateTask();
  } catch (error) {
    console.error("Could not load benchmark replays", error);
    setUnavailable("Replay browser unavailable.");
  }
}

void installReplayBrowser();
