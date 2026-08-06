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
