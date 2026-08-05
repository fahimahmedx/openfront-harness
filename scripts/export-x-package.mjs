import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { chromium } from "playwright";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputRoot = path.join(projectRoot, "x-article");
const visualsDir = path.join(outputRoot, "visuals");
const videosDir = path.join(outputRoot, "videos");
const postersDir = path.join(outputRoot, "video-posters");
const writeupUrl =
  process.env.WRITEUP_URL ?? "http://127.0.0.1:3000/docs/writeup";

const videos = [
  ["attack-1", "videos/attack-1.mov"],
  ["attack-1-clipped", "videos/attack-1-clipped.mp4"],
  ["attack-1-zoomed", "videos/attack-1-zoomed.mov"],
  ["attack-2", "videos/attack-2.mov"],
  ["attack-2-clipped", "videos/attack-2-clipped.mov"],
  ["building", "videos/building.mov"],
  ["building-defence", "videos/building-defence.mov"],
  ["sending-ship", "videos/sending-ship.mov"],
  ["replay-demo", "src/client/replay-demo.mp4"],
];

const copiedPngs = [
  ["03-replay-at-5m50.png", "charts/replay-9f73a404-5m50.png"],
  [
    "08-provider-output-variance.png",
    "charts/unpinned-provider-output-variance.png",
  ],
  [
    "10-provider-schema-compliance.png",
    "charts/provider-schema-compliance.png",
  ],
  ["11-audit-trace-before-after.png", "charts/audit-trace-before-after.png"],
];

const svgVisuals = [
  ["01-interface-win-rate.png", "charts/gpt-5.6-harness-win-rate.svg"],
  ["15-territory-over-time.png", "charts/gpt-5.6-territory-over-time.svg"],
  ["16-territory-races.png", "charts/gpt-5.6-territory-races.svg"],
  ["17-model-action-mix.png", "charts/model-action-mix.svg"],
];

const pageVisuals = [
  ["02-harness-architecture.png", ".system-map", 0],
  ["04-observation-json.png", "pre", 0],
  ["05-legal-actions-json.png", "pre", 1],
  ["06-model-decision-json.png", "pre", 2],
  ["07-action-reliability.png", ".reliability-map", 0],
  ["09-operational-metrics.png", ".table-scroll", 0],
  ["12-evaluation-conditions.png", ".eval-conditions", 0],
  ["13-interface-results-table.png", ".table-scroll", 1],
  ["14-model-performance-table.png", ".table-scroll", 2],
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} failed:\n${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    );
  }
}

async function exportVideos() {
  const scale =
    "scale=w=min(1920\\,iw):h=min(1200\\,ih):force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30,format=yuv420p";

  for (const [name, relativeSource] of videos) {
    const source = path.join(projectRoot, relativeSource);
    const output = path.join(videosDir, `${name}.mp4`);
    run("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      source,
      "-map",
      "0:v:0",
      "-vf",
      scale,
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "19",
      "-profile:v",
      "high",
      "-level:v",
      "4.1",
      "-maxrate",
      "8M",
      "-bufsize",
      "16M",
      "-movflags",
      "+faststart",
      "-an",
      output,
    ]);

    run("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      "1",
      "-i",
      output,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      path.join(postersDir, `${name}.jpg`),
    ]);
  }
}

async function exportVisuals() {
  for (const [outputName, sourceName] of copiedPngs) {
    await copyFile(
      path.join(projectRoot, sourceName),
      path.join(visualsDir, outputName),
    );
  }

  const browser = await chromium.launch({ headless: true });
  try {
    for (const [outputName, sourceName] of svgVisuals) {
      const page = await browser.newPage({
        viewport: { width: 1800, height: 1400 },
        deviceScaleFactor: 2,
      });
      await page.goto(pathToFileURL(path.join(projectRoot, sourceName)).href);
      await page.locator("svg").screenshot({
        path: path.join(visualsDir, outputName),
        animations: "disabled",
      });
      await page.close();
    }

    const page = await browser.newPage({
      viewport: { width: 1600, height: 1200 },
      deviceScaleFactor: 2,
    });
    await page.goto(writeupUrl, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
      document.querySelectorAll("video").forEach((video) => video.pause());
    });

    for (const [outputName, selector, index] of pageVisuals) {
      const visual = page.locator(selector).nth(index);
      await visual.scrollIntoViewIfNeeded();
      await visual.screenshot({
        path: path.join(visualsDir, outputName),
        animations: "disabled",
      });
    }
    await page.close();
  } finally {
    await browser.close();
  }
}

async function exportCopyReadyReadme() {
  let markdown = await readFile(path.join(projectRoot, "writeup.md"), "utf8");
  const codeImages = [
    "04-observation-json.png",
    "05-legal-actions-json.png",
    "06-model-decision-json.png",
  ];
  const tableImages = [
    "09-operational-metrics.png",
    "13-interface-results-table.png",
    "14-model-performance-table.png",
  ];
  let codeIndex = 0;
  let tableIndex = 0;

  markdown = markdown
    .replace(/\nWritten by Fahim Ahmed\n\nAugust 5, 2026\n/, "\n")
    .replace(
      "<CLIP OF ATTACK-2-CLIPPED.mov HERE>",
      "[UPLOAD VIDEO: videos/attack-2-clipped.mp4]",
    )
    .replace(
      "<BENCHMARK CHART HERE>",
      "[INSERT IMAGE: visuals/01-interface-win-rate.png]",
    )
    .replace(
      "<OPENFRONT GAMEPLAY CLIP HERE>",
      "[UPLOAD VIDEO: videos/attack-1-clipped.mp4]",
    )
    .replace(
      /```mermaid[\s\S]*?```/,
      "[INSERT IMAGE: visuals/02-harness-architecture.png]",
    )
    .replace(
      /<figure class="data-figure">[\s\S]*?<\/figure>/,
      "[INSERT IMAGE: visuals/03-replay-at-5m50.png]",
    )
    .replace(/```json[\s\S]*?```/g, () => {
      const image = codeImages[codeIndex++];
      return `[INSERT IMAGE: visuals/${image}]`;
    })
    .replace(
      "<ACTION RELIABILITY DIAGRAM HERE>",
      "[INSERT IMAGE: visuals/07-action-reliability.png]",
    )
    .replace(
      /!\[[^\]]*\]\(charts\/unpinned-provider-output-variance\.png\)/,
      "[INSERT IMAGE: visuals/08-provider-output-variance.png]",
    )
    .replace(
      /!\[[^\]]*\]\(charts\/provider-schema-compliance\.png\)/,
      "[INSERT IMAGE: visuals/10-provider-schema-compliance.png]",
    )
    .replace(
      /!\[[^\]]*\]\(charts\/audit-trace-before-after\.png\?v=2\)/,
      "[INSERT IMAGE: visuals/11-audit-trace-before-after.png]",
    )
    .replace(
      /<div class="eval-conditions">[\s\S]*?<\/div>\n<\/div>/,
      "[INSERT IMAGE: visuals/12-evaluation-conditions.png]",
    )
    .replace(
      /!\[[^\]]*\]\(charts\/gpt-5\.6-territory-over-time\.svg\)/,
      "[INSERT IMAGE: visuals/15-territory-over-time.png]",
    )
    .replace(
      /!\[[^\]]*\]\(charts\/gpt-5\.6-territory-races\.svg\)/,
      "[INSERT IMAGE: visuals/16-territory-races.png]",
    )
    .replace(
      /!\[[^\]]*\]\(charts\/model-action-mix\.svg\)/,
      "[INSERT IMAGE: visuals/17-model-action-mix.png]",
    )
    .replace(/(?:^\|.*\|\n)+/gm, (table) => {
      if (
        !/^\|\s*(?:Model and pinned provider|Interface|Model and provider)/m.test(
          table,
        )
      ) {
        return table;
      }
      const image = tableImages[tableIndex++];
      return `[INSERT IMAGE: visuals/${image}]\n`;
    })
    .replace(
      "Furthermore, is the agent playing the game in a way that makes sense wins?",
      "Beyond the final score, did the agent's play make sense?",
    )
    .replace(
      "Before explaining how the harness enforced these properties, the next section will first walks through how the harness works.",
      "Before explaining how the harness enforced these properties, I'll first walk through how it works.",
    )
    .replace(
      "To prevent hallicunation from the model",
      "To prevent hallucinated actions",
    )
    .replace("At the next desicion point", "At the next decision point")
    .replace(
      "This is to be able to audit the harness and the model's performance.",
      "This makes both the harness and the model's performance auditable.",
    )
    .replace(
      "## How I made the harness reliable.",
      "## How I made the harness reliable",
    )
    .replace(
      "Each of the three dimensions mentioned from earlier",
      "Each of the three dimensions described above",
    )
    .replace(
      "one model (ex. DeepSeek V4 Flash) between two different provider are not actually the same model",
      "the same model (for example, DeepSeek V4 Flash) served by two different providers is not operationally the same model",
    )
    .replace(
      "As a result, the next DeepSeek run, the agent expanded aggressively and reached first place!",
      "In the next DeepSeek run, the agent expanded aggressively and reached first place.",
    )
    .replace(
      "From this, I learned the importance of not having biases in a prompt, and the importance of exposing more relevant information to the model for it to use when making a decision.",
      "This showed me the importance of avoiding prompt bias and exposing the information a model actually needs to make a decision.",
    )
    .replace(
      "From having to manually judge multiple runs, I learned that while the harness should prevent invalid actions, but it should not encode an entire winning strategy.",
      "Manually judging multiple runs taught me that the harness should prevent invalid actions without encoding an entire winning strategy.",
    )
    .replace(
      "Both of these gave me a baseline against which to compare my harness against.",
      "Together, these provided a baseline against which to compare the harness.",
    )
    .replace(
      "## What I learned from building a harness and evaluating it.",
      "## What I learned",
    )
    .replace(
      /---\n\n\*\*Note that doesn't belong to the reliability framework above:\*\* ([\s\S]*?)\n\n## Evaluating the models/,
      "> **A note on the interface:** $1\n\n## Evaluating the models",
    );

  await writeFile(path.join(outputRoot, "README.md"), markdown.trim() + "\n");
  return markdown;
}

async function exportArticlePreview(markdown) {
  const { marked } = await import("marked");
  const body = marked.parse(markdown);
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>OpenFront X Article — copy preview</title>
  <style>
    :root { color-scheme: light; font-family: Georgia, "Times New Roman", serif; color: #0f172a; background: #f1f5f9; }
    body { margin: 0; }
    article { width: min(760px, calc(100% - 40px)); margin: 40px auto; padding: 56px 64px; background: white; box-shadow: 0 12px 40px #0f172a18; }
    h1, h2, h3 { font-family: Inter, ui-sans-serif, system-ui, sans-serif; letter-spacing: -.025em; }
    h1 { font-size: 42px; line-height: 1.08; }
    h2 { margin-top: 48px; font-size: 29px; }
    h3 { margin-top: 36px; font-size: 22px; }
    p, li { font-size: 19px; line-height: 1.65; }
    a { color: #4338ca; }
    blockquote { margin: 28px 0; padding: 1px 24px; border-left: 4px solid #6366f1; background: #eef2ff; }
    .asset { margin: 30px 0; padding: 16px 18px; border: 2px dashed #94a3b8; border-radius: 12px; color: #475569; background: #f8fafc; font-family: Inter, ui-sans-serif, system-ui, sans-serif; font-size: 14px; }
    @media (max-width: 700px) { article { width: auto; margin: 0; padding: 28px 20px; box-shadow: none; } h1 { font-size: 34px; } }
  </style>
</head>
<body><article>${body.replaceAll("<p>[UPLOAD ", '<p class="asset">UPLOAD ').replaceAll("<p>[INSERT ", '<p class="asset">INSERT ').replaceAll("]</p>", "</p>")}</article></body>
</html>`;
  await writeFile(path.join(outputRoot, "ARTICLE-PREVIEW.html"), html);
}

await mkdir(visualsDir, { recursive: true });
await mkdir(videosDir, { recursive: true });
await mkdir(postersDir, { recursive: true });
await Promise.all([exportVideos(), exportVisuals()]);
const markdown = await exportCopyReadyReadme();
await exportArticlePreview(markdown);

console.log(`Exported the X publishing package to ${outputRoot}`);
