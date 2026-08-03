import * as dotenv from "dotenv";
import path from "path";
import { HarnessRunner } from "./src/HarnessRunner";
import { OpenRouterAgent } from "./src/OpenRouterAgent";
import { RunStore } from "./src/RunStore";

dotenv.config({ path: path.resolve(".env") });

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error("OPENROUTER_API_KEY is required");

const [model, provider] = process.argv.slice(2);
if (!model || !provider) {
  throw new Error("Usage: .tmp-run-evaluation.ts <model> <provider>");
}

const slug = model.split("/").at(-1)!;
const store = new RunStore(path.resolve("data", slug));
await store.init();
const existing = await store.listArtifacts();
const ordinal = existing.length + 1;
console.log(JSON.stringify({ event: "run_started", model, provider, ordinal }));
const artifact = await new HarnessRunner(
  store,
  new OpenRouterAgent(apiKey, { model, provider }),
).run();
console.log(
  JSON.stringify({
    event: "run_finished",
    model,
    provider,
    ordinal,
    runId: artifact.runId,
    status: artifact.status,
    winner: artifact.outcome.winner,
    placement: artifact.outcome.finalPlacement,
    decisions: artifact.decisions.length,
    terminationReason: artifact.outcome.terminationReason,
    costUsd: artifact.usage.costUsd,
  }),
);
