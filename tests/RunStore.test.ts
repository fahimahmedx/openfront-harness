import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { RunStore } from "../src/RunStore";

const projectRoot = path.resolve(import.meta.dirname, "..");
const bundledRuns = [
  path.join(projectRoot, "resources/harness/sample-run.json.gz"),
  path.join(
    projectRoot,
    "resources/harness/9f73a404-ae98-430f-be5b-ea22fb1755a6.json.gz",
  ),
];

describe("RunStore bundled artifacts", () => {
  it("resolves every bundled replay without a local run database", async () => {
    const dataDir = await fs.mkdtemp(
      path.join(os.tmpdir(), "openfront-run-store-"),
    );

    try {
      const store = new RunStore(dataDir, bundledRuns);
      await store.init();

      const featured = await store.getArtifact(
        "9f73a404-ae98-430f-be5b-ea22fb1755a6",
      );
      expect(featured?.outcome.winner).toBe("LLM Agent");

      const listedIds = (await store.listArtifacts()).map(
        (artifact) => artifact.runId,
      );
      expect(listedIds).toContain("9f73a404-ae98-430f-be5b-ea22fb1755a6");
      expect(listedIds).toContain("fadf8cc4-40e0-4c81-91d3-6da5b507c636");
    } finally {
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  });

  it("discovers replay artifacts recursively under a shared data root", async () => {
    const artifactRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "openfront-artifact-root-"),
    );
    const dataDir = path.join(artifactRoot, "runs");
    const nestedDir = path.join(artifactRoot, "models", "featured");

    try {
      await fs.mkdir(nestedDir, { recursive: true });
      await fs.copyFile(
        bundledRuns[1],
        path.join(nestedDir, "9f73a404-ae98-430f-be5b-ea22fb1755a6.json.gz"),
      );
      await fs.mkdir(dataDir, { recursive: true });
      await fs.copyFile(
        bundledRuns[1],
        path.join(dataDir, "9f73a404-ae98-430f-be5b-ea22fb1755a6.json.gz"),
      );
      const store = new RunStore(dataDir, [], artifactRoot);
      await store.init();

      const featured = await store.getArtifact(
        "9f73a404-ae98-430f-be5b-ea22fb1755a6",
      );
      expect(featured?.outcome.winner).toBe("LLM Agent");
      expect(
        (await store.listArtifacts()).map((artifact) => artifact.runId),
      ).toEqual(["9f73a404-ae98-430f-be5b-ea22fb1755a6"]);
    } finally {
      await fs.rm(artifactRoot, { recursive: true, force: true });
    }
  });
});
