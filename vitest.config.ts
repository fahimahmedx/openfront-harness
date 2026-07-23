import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      resources: path.resolve(import.meta.dirname, "OpenFrontIO/resources"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["OpenFrontIO/**"],
  },
});
