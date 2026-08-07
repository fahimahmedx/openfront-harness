import { BENCHMARK_CAPABILITY_TASKS } from "./BenchmarkCapabilities";
import { BENCHMARK_MATCH_TASKS } from "./BenchmarkConfig";
import { BenchmarkTrial } from "./BenchmarkSchemas";
import {
  mean,
  percentile,
  percentileBootstrap95,
  stratifiedBootstrap95,
  wilson95,
} from "./BenchmarkStatistics";

export function summarizeBenchmarkTrials(
  trials: readonly BenchmarkTrial[],
  seed: string,
) {
  const valid = trials.filter((trial) => trial.status === "valid");
  const match = valid.filter((trial) => trial.suite === "match");
  const capability = valid.filter((trial) => trial.suite === "capability");
  const matchTasks = BENCHMARK_MATCH_TASKS.map((task) => {
    const values = match
      .filter((trial) => trial.taskId === task.id)
      .map((trial) => trial.taskScore);
    return values.length === 0
      ? null
      : {
          taskId: task.id,
          mean: mean(values),
          interval95: percentileBootstrap95(values, `${seed}:${task.id}`),
          values,
          stratum: task.mapStratum,
        };
  }).filter((value): value is NonNullable<typeof value> => value !== null);
  const capabilities = Object.fromEntries(
    BENCHMARK_CAPABILITY_TASKS.flatMap((task) => {
      const values = capability.filter(
        (trial) => trial.taskId === task.fixtureId,
      );
      if (values.length === 0) return [];
      const successes = values.filter(
        (trial) => trial.taskScore === 100,
      ).length;
      const rate = successes / values.length;
      return [
        [
          task.family,
          {
            successes,
            validTrials: values.length,
            passAt1: rate,
            wilson95: wilson95(successes, values.length),
            estimatedPassPower3: rate ** 3,
            meanComponentCoverage: mean(
              values.map((trial) => trial.componentCoverage ?? 0),
            ),
          },
        ],
      ];
    }),
  );
  const latencies = valid.flatMap((trial) =>
    trial.attempts.timings.map((timing) => timing.totalMs),
  );
  const costs = valid
    .map((trial) => trial.usage.costUsd)
    .filter((cost): cost is number => cost !== null);
  const capabilityRates = Object.values(capabilities).map(
    (value) => (value as { passAt1: number }).passAt1,
  );
  return {
    matchScore:
      matchTasks.length === 0
        ? null
        : mean(matchTasks.map((task) => task.mean)),
    matchBootstrap95:
      matchTasks.length === 0
        ? null
        : stratifiedBootstrap95(
            matchTasks.map((task) => ({
              taskId: task.taskId,
              stratum: task.stratum,
              values: task.values,
            })),
            `${seed}:match`,
          ),
    capabilityScore:
      capabilityRates.length === 0 ? null : 100 * mean(capabilityRates),
    capabilityBootstrap95:
      capabilityRates.length === 0
        ? null
        : stratifiedBootstrap95(
            BENCHMARK_CAPABILITY_TASKS.flatMap((task) => {
              const values = capability
                .filter((trial) => trial.taskId === task.fixtureId)
                .map((trial) => trial.taskScore);
              return values.length === 0
                ? []
                : [{ taskId: task.fixtureId, stratum: task.family, values }];
            }),
            `${seed}:capability`,
          ),
    winRate:
      match.length === 0
        ? null
        : match.filter((trial) => trial.diagnostics.won === true).length /
          match.length,
    meanPlacement:
      match.length === 0
        ? null
        : mean(
            match.map((trial) => {
              const placement = trial.diagnostics.placement;
              if (typeof placement !== "number")
                throw new Error("Missing placement diagnostic");
              return placement;
            }),
          ),
    survivalRate:
      match.length === 0
        ? null
        : match.filter((trial) => trial.diagnostics.survived === true).length /
          match.length,
    matchTasks,
    capabilities,
    firstAttemptValidityRate:
      valid.length === 0
        ? 0
        : valid.filter(
            (trial) =>
              !trial.attempts.failures.some((failure) => failure.attempt === 1),
          ).length / valid.length,
    fallbackRate:
      valid.length === 0
        ? 0
        : valid.filter((trial) => trial.attempts.fallback).length /
          valid.length,
    medianLatencyMs: latencies.length === 0 ? 0 : percentile(latencies, 0.5),
    p95LatencyMs: latencies.length === 0 ? 0 : percentile(latencies, 0.95),
    totalCostUsd: costs.reduce((sum, cost) => sum + cost, 0),
    meanCostUsd: costs.length === 0 ? null : mean(costs),
  };
}
