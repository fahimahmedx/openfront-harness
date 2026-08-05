import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import {
  type AssetManifest,
  rewriteAssetsForCdn,
} from "./OpenFrontIO/src/core/AssetUrls";
import {
  buildPublicAssetManifest,
  copyRootPublicFiles,
  createHashedPublicAssetFiles,
  writePublicAssetManifest,
} from "./OpenFrontIO/src/server/PublicAssetManifest";
import {
  adaptLeaderboardCurrentTroops,
  adaptReplaySeekInputHandler,
  adaptReplaySeekLocalServer,
  adaptVisualBaselineClientGameRunner,
  adaptVisualBaselineLocalServer,
} from "./src/OpenFrontAdapters";

const projectRoot = import.meta.dirname;
const openFrontRoot = path.join(projectRoot, "OpenFrontIO");
const resourcesDir = path.join(openFrontRoot, "resources");
const proprietaryDir = path.join(openFrontRoot, "proprietary");
const sourceDirs = [resourcesDir, proprietaryDir];
const outDir = path.join(projectRoot, "static");

function openFrontHarnessAdapter(): Plugin {
  return {
    name: "openfront-harness-source-adapters",
    enforce: "pre",
    transform(code, id) {
      const normalized = id.replaceAll("\\", "/").split("?")[0];
      if (normalized.endsWith("/OpenFrontIO/src/client/InputHandler.ts")) {
        return adaptReplaySeekInputHandler(code);
      }
      if (normalized.endsWith("/OpenFrontIO/src/client/LocalServer.ts")) {
        return adaptVisualBaselineLocalServer(adaptReplaySeekLocalServer(code));
      }
      if (normalized.endsWith("/OpenFrontIO/src/client/ClientGameRunner.ts")) {
        return adaptVisualBaselineClientGameRunner(code);
      }
      if (
        normalized.endsWith("/OpenFrontIO/src/client/hud/layers/Leaderboard.ts")
      ) {
        return adaptLeaderboardCurrentTroops(code);
      }
      return null;
    },
  };
}

function replayTickAdapter(): Plugin {
  return {
    name: "openfront-harness-replay-tick-adapter",
    transform(code, id) {
      const normalized = id.replaceAll("\\", "/").split("?")[0];
      if (!normalized.endsWith("/OpenFrontIO/src/client/ClientGameRunner.ts")) {
        return null;
      }
      const needle = "this.gameView.update(gu);";
      if (!code.includes(needle)) {
        throw new Error(
          "Pinned OpenFront ClientGameRunner no longer matches the replay adapter",
        );
      }
      return code.replace(
        needle,
        `${needle}\n      window.dispatchEvent(\n        new CustomEvent("harness-replay-tick", { detail: { tick: gu.tick } }),\n      );`,
      );
    },
  };
}

function replayTurnstileAdapter(): Plugin {
  return {
    name: "openfront-harness-replay-turnstile-adapter",
    transform(code, id) {
      const normalized = id.replaceAll("\\", "/").split("?")[0];
      if (!normalized.endsWith("/OpenFrontIO/src/client/Main.ts")) {
        return null;
      }
      const needle = "this.turnstileTokenPromise = getTurnstileToken();";
      if (!code.includes(needle)) {
        throw new Error(
          "Pinned OpenFront Main no longer matches the replay Turnstile adapter",
        );
      }
      // The harness only opens recorded single-player games, whose join path
      // already returns a null token. Avoid the upstream multiplayer client's
      // eager challenge prefetch on localhost and replay-only deployments.
      return code.replace(needle, "this.turnstileTokenPromise = null;");
    },
  };
}

function replayWorkerAssetAdapter(): Plugin {
  return {
    name: "openfront-harness-replay-worker-asset-adapter",
    transform(code, id) {
      const normalized = id.replaceAll("\\", "/");
      if (
        !normalized.endsWith("/OpenFrontIO/src/core/worker/WorkerClient.ts")
      ) {
        return null;
      }
      const needle = /cdnBase\s*:\s*getCdnBase\(\)(?!\s*\|\|)/;
      const replacement = "cdnBase: getCdnBase() || window.location.origin";
      if (
        /cdnBase\s*:\s*getCdnBase\(\)\s*\|\|\s*window\.location\.origin/.test(
          code,
        )
      ) {
        return null;
      }
      if (!needle.test(code)) {
        throw new Error(
          "Pinned OpenFront WorkerClient no longer matches the replay asset adapter",
        );
      }
      // An inline worker runs from a blob: URL, which cannot resolve root-
      // relative map URLs. Preserve a configured CDN and otherwise give the
      // worker the page origin so its manifest entries become absolute URLs.
      return code.replace(needle, replacement);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, "");
  const isProduction = mode === "production";
  const assetManifest: AssetManifest = isProduction
    ? buildPublicAssetManifest(sourceDirs)
    : {};
  let bundleFiles: string[] = [];

  const syncAssets: Plugin = {
    name: "sync-openfront-assets-to-harness",
    apply: "build",
    writeBundle(_options, bundle) {
      bundleFiles = Object.keys(bundle);
    },
    closeBundle() {
      copyRootPublicFiles(resourcesDir, outDir);
      createHashedPublicAssetFiles(sourceDirs, outDir, assetManifest);
      for (const fileName of bundleFiles) {
        if (fileName.startsWith("assets/")) {
          assetManifest[fileName] = `/${fileName}`;
        }
      }
      writePublicAssetManifest(outDir, assetManifest);
    },
  };

  return {
    root: projectRoot,
    base: "/",
    publicDir: false,
    resolve: {
      tsconfigPaths: true,
      alias: {
        resources: resourcesDir,
      },
    },
    plugins: [
      openFrontHarnessAdapter(),
      replayTickAdapter(),
      replayTurnstileAdapter(),
      replayWorkerAssetAdapter(),
      ...(isProduction
        ? [
            {
              name: "inject-cdn-base-template",
              apply: "build" as const,
              enforce: "post" as const,
              transformIndexHtml: rewriteAssetsForCdn,
            },
            syncAssets,
          ]
        : []),
      tailwindcss(),
    ],
    define: {
      __ASSET_MANIFEST__: JSON.stringify(assetManifest),
      "process.env.WEBSOCKET_URL": JSON.stringify(""),
      "process.env.GAME_ENV": JSON.stringify("prod"),
      "process.env.STRIPE_PUBLISHABLE_KEY": JSON.stringify(undefined),
      "process.env.API_DOMAIN": JSON.stringify(undefined),
    },
    build: {
      outDir,
      emptyOutDir: true,
      assetsDir: "assets",
      rollupOptions: {
        input: {
          dashboard: path.join(projectRoot, "harness.html"),
          replay: path.join(projectRoot, "replay.html"),
        },
        output: {
          manualChunks: (id) => {
            const vendorModules = ["pixi.js", "howler", "zod"];
            if (vendorModules.some((module) => id.includes(module))) {
              return "vendor";
            }
          },
        },
      },
    },
    server: {
      port: 9000,
      host: true,
    },
  };
});
