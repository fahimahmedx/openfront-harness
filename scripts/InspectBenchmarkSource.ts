import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

const source = process.argv[2];
if (!source)
  throw new Error(
    "Usage: tsx scripts/InspectBenchmarkSource.ts <artifact.json.gz>",
  );
const artifact = JSON.parse(
  (await promisify(gunzip)(await readFile(source))).toString("utf8"),
) as {
  decisions: Array<{
    index: number;
    tick: number;
    observation: Record<string, any>;
    candidates: Array<{ id: string; category: string }>;
    appliedActionIds: string[];
  }>;
};

for (const decision of artifact.decisions) {
  const observation = decision.observation;
  const opponents = (observation.opponents ?? []) as Array<Record<string, any>>;
  const attacks = decision.candidates.filter(
    (item) => item.category === "attack",
  );
  const boats = decision.candidates.filter((item) => item.category === "boat");
  const counters = decision.candidates.filter((item) =>
    item.id.startsWith("counter:"),
  );
  const retreats = decision.candidates.filter(
    (item) => item.category === "retreat",
  );
  const builds = decision.candidates.filter(
    (item) => item.category === "build",
  );
  const bordered = opponents.filter((item) => item.sharedBorder);
  const weak = opponents.filter(
    (item) =>
      typeof item.troopsRelativeToSelf === "number" &&
      item.troopsRelativeToSelf <= 0.4,
  );
  const row = {
    i: decision.index,
    tick: decision.tick,
    cap: observation.self?.troopCapacityPercent,
    tiles: observation.self?.tiles,
    spendable: observation.self?.spendableTroops,
    bordered: bordered.map(
      (item) => `${item.name}:${item.troopsRelativeToSelf}`,
    ),
    weak: weak.map((item) => `${item.name}:${item.troopsRelativeToSelf}`),
    incoming: observation.self?.incomingAttacks?.length ?? 0,
    outgoing: observation.self?.outgoingAttacks?.length ?? 0,
    expand: decision.candidates.filter((item) => item.category === "expand")
      .length,
    attacks: attacks.length,
    attackTargets: [...new Set(attacks.map((item) => item.id.split(":")[1]))],
    boats: boats.length,
    counters: counters.length,
    retreats: retreats.length,
    builds: builds.length,
    applied: decision.appliedActionIds,
  };
  process.stdout.write(`${JSON.stringify(row)}\n`);
}
