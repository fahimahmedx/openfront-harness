export type Interval95 = { lower: number; upper: number };

export function matchPoints(fieldSize: number, rank: number): number {
  if (!Number.isInteger(fieldSize) || fieldSize < 2) {
    throw new Error("fieldSize must be an integer of at least two");
  }
  if (!Number.isInteger(rank) || rank < 1 || rank > fieldSize) {
    throw new Error(`rank must be between 1 and ${fieldSize}`);
  }
  return (100 * (fieldSize - rank)) / (fieldSize - 1);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error("Cannot calculate an empty mean");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function percentile(
  values: readonly number[],
  probability: number,
): number {
  if (values.length === 0) throw new Error("Cannot sample an empty set");
  if (probability < 0 || probability > 1) {
    throw new Error("probability must be between zero and one");
  }
  const sorted = [...values].sort((a, b) => a - b);
  const position = probability * (sorted.length - 1);
  const lower = Math.floor(position);
  const fraction = position - lower;
  return (
    sorted[lower] +
    (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) * fraction
  );
}

export function wilson95(successes: number, trials: number): Interval95 {
  if (
    !Number.isInteger(successes) ||
    !Number.isInteger(trials) ||
    successes < 0 ||
    successes > trials ||
    trials < 1
  ) {
    throw new Error(
      "Wilson interval requires 0 <= successes <= trials and trials >= 1",
    );
  }
  const z = 1.959963984540054;
  const rate = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = rate + (z * z) / (2 * trials);
  const margin =
    z *
    Math.sqrt((rate * (1 - rate)) / trials + (z * z) / (4 * trials * trials));
  return {
    lower: Math.max(0, (center - margin) / denominator),
    upper: Math.min(1, (center + margin) / denominator),
  };
}

/** Stable, cross-platform PRNG used for schedules and published bootstraps. */
export function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index++) {
    state ^= seed.charCodeAt(index);
    state = Math.imul(state, 16777619);
  }
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

export function deterministicShuffle<T>(
  values: readonly T[],
  seed: string,
): T[] {
  const copy = [...values];
  const random = seededRandom(seed);
  for (let index = copy.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

export type BootstrapTask = {
  taskId: string;
  stratum: string;
  values: readonly number[];
};

/** Resamples trials within tasks, then tasks within their declared strata. */
export function stratifiedBootstrap95(
  tasks: readonly BootstrapTask[],
  seed: string,
  replicates = 10_000,
): Interval95 {
  if (!Number.isInteger(replicates) || replicates < 1) {
    throw new Error("replicates must be a positive integer");
  }
  if (tasks.length === 0 || tasks.some((task) => task.values.length === 0)) {
    throw new Error("Every bootstrap task must contain at least one value");
  }
  const strata = new Map<string, BootstrapTask[]>();
  for (const task of tasks) {
    const group = strata.get(task.stratum) ?? [];
    group.push(task);
    strata.set(task.stratum, group);
  }
  const random = seededRandom(seed);
  const samples: number[] = [];
  for (let iteration = 0; iteration < replicates; iteration++) {
    const taskMeans: number[] = [];
    for (const group of strata.values()) {
      for (let draw = 0; draw < group.length; draw++) {
        const task = group[Math.floor(random() * group.length)];
        const trialDraws = Array.from(
          { length: task.values.length },
          () => task.values[Math.floor(random() * task.values.length)],
        );
        taskMeans.push(mean(trialDraws));
      }
    }
    samples.push(mean(taskMeans));
  }
  return {
    lower: percentile(samples, 0.025),
    upper: percentile(samples, 0.975),
  };
}

export function percentileBootstrap95(
  values: readonly number[],
  seed: string,
  replicates = 10_000,
): Interval95 {
  return stratifiedBootstrap95(
    [{ taskId: "task", stratum: "task", values }],
    seed,
    replicates,
  );
}
