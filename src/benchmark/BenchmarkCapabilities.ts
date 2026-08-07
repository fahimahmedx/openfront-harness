import { benchmarkTask, BenchmarkMatchTask } from "./BenchmarkConfig";

export const BENCHMARK_CAPABILITY_FAMILIES = [
  "neutral-expansion",
  "saturated-capacity-expansion",
  "post-expansion-recovery",
  "weaker-target-selection",
  "frontier-restraint",
  "incoming-attack-response",
  "split-front-prioritization",
  "losing-attack-retreat",
  "naval-target-recognition",
  "construction-failure-recovery",
] as const;

export type BenchmarkCapabilityFamily =
  (typeof BENCHMARK_CAPABILITY_FAMILIES)[number];

type CapabilityDefinition = {
  family: BenchmarkCapabilityFamily;
  fixtureId: `cap-${string}-scored-${string}-001`;
  sourceTaskId: BenchmarkMatchTask["id"];
  horizonTicks: 100 | 200 | 300;
  graderVersion: "capability-grader-v2";
};

export const BENCHMARK_CAPABILITY_TASKS: readonly CapabilityDefinition[] = [
  {
    family: "neutral-expansion",
    fixtureId: "cap-neutral-expansion-scored-great-lakes-001",
    sourceTaskId: "match-08",
    horizonTicks: 100,
    graderVersion: "capability-grader-v2",
  },
  {
    family: "saturated-capacity-expansion",
    fixtureId: "cap-saturated-capacity-expansion-scored-world-001",
    sourceTaskId: "match-11",
    horizonTicks: 100,
    graderVersion: "capability-grader-v2",
  },
  {
    family: "post-expansion-recovery",
    fixtureId: "cap-post-expansion-recovery-scored-europe-classic-001",
    sourceTaskId: "match-04",
    horizonTicks: 100,
    graderVersion: "capability-grader-v2",
  },
  {
    family: "weaker-target-selection",
    fixtureId: "cap-weaker-target-selection-scored-europe-classic-001",
    sourceTaskId: "match-03",
    horizonTicks: 200,
    graderVersion: "capability-grader-v2",
  },
  {
    family: "frontier-restraint",
    fixtureId: "cap-frontier-restraint-scored-strait-of-gibraltar-001",
    sourceTaskId: "match-10",
    horizonTicks: 200,
    graderVersion: "capability-grader-v2",
  },
  {
    family: "incoming-attack-response",
    fixtureId: "cap-incoming-attack-response-scored-great-lakes-001",
    sourceTaskId: "match-07",
    horizonTicks: 200,
    graderVersion: "capability-grader-v2",
  },
  {
    family: "split-front-prioritization",
    fixtureId: "cap-split-front-prioritization-scored-europe-classic-001",
    sourceTaskId: "match-03",
    horizonTicks: 200,
    graderVersion: "capability-grader-v2",
  },
  {
    family: "losing-attack-retreat",
    fixtureId: "cap-losing-attack-retreat-scored-world-001",
    sourceTaskId: "match-12",
    horizonTicks: 100,
    graderVersion: "capability-grader-v2",
  },
  {
    family: "naval-target-recognition",
    fixtureId: "cap-naval-target-recognition-scored-strait-of-gibraltar-001",
    sourceTaskId: "match-09",
    horizonTicks: 300,
    graderVersion: "capability-grader-v2",
  },
  {
    family: "construction-failure-recovery",
    fixtureId: "cap-construction-failure-recovery-scored-europe-classic-001",
    sourceTaskId: "match-03",
    horizonTicks: 200,
    graderVersion: "capability-grader-v2",
  },
] as const;

export function capabilitySource(
  task: CapabilityDefinition,
): BenchmarkMatchTask {
  return benchmarkTask(task.sourceTaskId);
}

export function benchmarkCapability(fixtureId: string): CapabilityDefinition {
  const task = BENCHMARK_CAPABILITY_TASKS.find(
    (candidate) => candidate.fixtureId === fixtureId,
  );
  if (!task)
    throw new Error(`Unknown benchmark capability fixture: ${fixtureId}`);
  return task;
}
