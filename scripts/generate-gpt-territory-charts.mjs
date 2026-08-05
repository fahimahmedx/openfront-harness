import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(root, "charts");

const runFiles = [
  "8463f549-e335-4114-b39f-a6c87755bd9f.json.gz",
  "5c3016b7-10bf-4583-af24-b27b8de4e378.json.gz",
  "cdf646fa-5edb-4cee-94a1-2ed7e8fc88af.json.gz",
  "3aac9fc1-d8cd-41d1-987d-0d4cce4f804f.json.gz",
  "b0462398-8031-4e4a-ba91-81e340d11c06.json.gz",
];

const colors = {
  gpt: "#5B5BD6",
  Hokkaido: "#E76F51",
  Kansai: "#169C8C",
  Shikoku: "#D99114",
  ink: "#172033",
  muted: "#64748B",
  grid: "#DDE3EC",
  panel: "#F8FAFC",
};

function loadRun(filename) {
  const path = join(root, "data", "gpt-5.6-luna", filename);
  return JSON.parse(gunzipSync(readFileSync(path), "utf8"));
}

function loadArtifact(relativePath) {
  return JSON.parse(gunzipSync(readFileSync(join(root, relativePath)), "utf8"));
}

function finalTerritoryPercent(run) {
  const finalTiles = Number(run.replay.info.players[0].stats.finalTiles);
  const landTiles = run.decisions[0].observation.landTiles;
  return (finalTiles / landTiles) * 100;
}

function gptPoints(run) {
  const points = run.decisions.map((decision) => ({
    x: decision.observation.elapsedSeconds / 60,
    y: decision.observation.self.territoryPercent,
  }));
  points.push({
    x: run.outcome.simulatedSeconds / 60,
    y: finalTerritoryPercent(run),
  });
  return points;
}

function opponentPoints(run, name) {
  return run.decisions.map((decision) => {
    const opponent = decision.observation.opponents.find(
      (candidate) => candidate.name === name,
    );
    return {
      x: decision.observation.elapsedSeconds / 60,
      y: opponent?.territoryPercent ?? 0,
    };
  });
}

function linePath(points, xScale, yScale) {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${xScale(point.x).toFixed(1)},${yScale(point.y).toFixed(1)}`,
    )
    .join(" ");
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatClock(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function svgShell({ width, height, title, description, body }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(title)}</title>
  <desc id="description">${escapeXml(description)}</desc>
  <rect width="${width}" height="${height}" fill="#FFFFFF"/>
  <style>
    text { font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: ${colors.ink}; }
    .title { font-size: 34px; font-weight: 750; letter-spacing: -0.7px; }
    .subtitle { font-size: 17px; fill: ${colors.muted}; }
    .axis { font-size: 14px; fill: ${colors.muted}; }
    .axis-label { font-size: 15px; font-weight: 600; fill: #475569; }
    .panel-title { font-size: 18px; font-weight: 700; }
    .panel-result { font-size: 14px; fill: ${colors.muted}; }
    .legend { font-size: 14px; fill: #475569; }
    .threshold-label { fill: #9A3412; }
  </style>
  ${body}
</svg>
`;
}

function territoryOverTime(run) {
  const width = 1200;
  const height = 720;
  const plot = { left: 112, top: 145, right: 54, bottom: 102 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = height - plot.top - plot.bottom;
  const xMax = 14;
  const yMax = 85;
  const xScale = (value) => plot.left + (value / xMax) * plotWidth;
  const yScale = (value) => plot.top + plotHeight - (value / yMax) * plotHeight;
  const points = gptPoints(run);
  const line = linePath(points, xScale, yScale);
  const area = `${line} L${xScale(points.at(-1).x).toFixed(1)},${yScale(0).toFixed(1)} L${xScale(points[0].x).toFixed(1)},${yScale(0).toFixed(1)} Z`;
  const finalPoint = points.at(-1);
  const yTicks = [0, 20, 40, 60, 80];
  const xTicks = [0, 2, 4, 6, 8, 10, 12, 14];

  const horizontalGrid = yTicks
    .map(
      (tick) => `
        <line x1="${plot.left}" y1="${yScale(tick)}" x2="${width - plot.right}" y2="${yScale(tick)}" stroke="${colors.grid}" stroke-width="1"/>
        <text class="axis" x="${plot.left - 18}" y="${yScale(tick)}" text-anchor="end" dominant-baseline="middle">${tick}%</text>`,
    )
    .join("");
  const verticalGrid = xTicks
    .map(
      (tick) => `
        <line x1="${xScale(tick)}" y1="${plot.top}" x2="${xScale(tick)}" y2="${plot.top + plotHeight}" stroke="${colors.grid}" stroke-width="1"/>
        <text class="axis" x="${xScale(tick)}" y="${plot.top + plotHeight + 30}" text-anchor="middle">${tick}</text>`,
    )
    .join("");

  return svgShell({
    width,
    height,
    title: "GPT-5.6 Luna territory over time",
    description:
      "Territory controlled by GPT-5.6 Luna during run 5c3016b7, ending in victory after crossing 80 percent.",
    body: `
      <defs>
        <linearGradient id="territory-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${colors.gpt}" stop-opacity="0.24"/>
          <stop offset="100%" stop-color="${colors.gpt}" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <text class="title" x="${plot.left}" y="58">GPT-5.6 Luna’s path to victory</text>
      <text class="subtitle" x="${plot.left}" y="91">Territory controlled over simulated time · Run ${run.runId.slice(0, 8)}</text>
      ${horizontalGrid}
      ${verticalGrid}
      <line x1="${plot.left}" y1="${yScale(80)}" x2="${width - plot.right}" y2="${yScale(80)}" stroke="#B45309" stroke-width="2" stroke-dasharray="8 7"/>
      <rect x="${width - 316}" y="${yScale(80) - 31}" width="246" height="25" rx="12.5" fill="#FFF7ED"/>
      <text class="threshold-label" x="${width - 193}" y="${yScale(80) - 14}" text-anchor="middle" font-size="13" font-weight="650">80% instant-victory threshold</text>
      <path d="${area}" fill="url(#territory-fill)"/>
      <path d="${line}" fill="none" stroke="${colors.gpt}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${xScale(finalPoint.x)}" cy="${yScale(finalPoint.y)}" r="9" fill="#FFFFFF" stroke="${colors.gpt}" stroke-width="5"/>
      <text class="axis-label" x="${plot.left + plotWidth / 2}" y="${height - 34}" text-anchor="middle">Simulated time (minutes)</text>
      <text class="axis-label" x="30" y="${plot.top + plotHeight / 2}" text-anchor="middle" transform="rotate(-90 30 ${plot.top + plotHeight / 2})">Territory controlled</text>
      <text class="axis" x="${width - plot.right}" y="${height - 34}" text-anchor="end">Japan · JAPAN01A · Kanto spawn</text>`,
  });
}

function territoryRaceSmallMultiples(runs) {
  const width = 1200;
  const height = 190 + runs.length * 316;
  const plotLeft = 112;
  const plotRight = 54;
  const plotWidth = width - plotLeft - plotRight;
  const panelTop = 190;
  const panelHeight = 238;
  const panelGap = 78;
  const xMax = 20.5;
  const yMax = 85;
  const xScale = (value) => plotLeft + (value / xMax) * plotWidth;
  const yTicks = [0, 20, 40, 60, 80];
  const xTicks = [0, 5, 10, 15, 20];

  const legendEntries = [
    ["GPT-5.6 Luna", colors.gpt],
    ["Hokkaido", colors.Hokkaido],
    ["Kansai", colors.Kansai],
    ["Shikoku", colors.Shikoku],
  ];
  const legend = legendEntries
    .map(([label, color], index) => {
      const x = plotLeft + index * 205;
      return `<line x1="${x}" y1="139" x2="${x + 28}" y2="139" stroke="${color}" stroke-width="4" stroke-linecap="round"/><text class="legend" x="${x + 39}" y="144">${label}</text>`;
    })
    .join("");

  const panels = runs
    .map((run, panelIndex) => {
      const top = panelTop + panelIndex * (panelHeight + panelGap);
      const yScale = (value) =>
        top + panelHeight - (value / yMax) * panelHeight;
      const shortId = run.runId.slice(0, 8);
      const finalPercent = finalTerritoryPercent(run);
      const finalPoint = gptPoints(run).at(-1);
      const horizontalGrid = yTicks
        .map(
          (tick) =>
            `<line x1="${plotLeft}" y1="${yScale(tick)}" x2="${width - plotRight}" y2="${yScale(tick)}" stroke="${colors.grid}"/><text class="axis" x="${plotLeft - 17}" y="${yScale(tick)}" text-anchor="end" dominant-baseline="middle">${tick}%</text>`,
        )
        .join("");
      const verticalGrid = xTicks
        .map(
          (tick) =>
            `<line x1="${xScale(tick)}" y1="${top}" x2="${xScale(tick)}" y2="${top + panelHeight}" stroke="${colors.grid}"/><text class="axis" x="${xScale(tick)}" y="${top + panelHeight + 27}" text-anchor="middle">${tick}</text>`,
        )
        .join("");
      const opponents = run.scenario.expectedNations
        .map((name) => {
          const path = linePath(opponentPoints(run, name), xScale, yScale);
          return `<path d="${path}" fill="none" stroke="${colors[name]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.92"/>`;
        })
        .join("");
      const gptPath = linePath(gptPoints(run), xScale, yScale);

      return `
        <rect x="${plotLeft - 14}" y="${top - 44}" width="${plotWidth + 28}" height="${panelHeight + 80}" rx="18" fill="${colors.panel}"/>
        <text class="panel-title" x="${plotLeft}" y="${top - 16}">Run ${shortId}</text>
        <text class="panel-result" x="${width - plotRight}" y="${top - 16}" text-anchor="end">Victory at ${formatClock(run.outcome.simulatedSeconds)} · ${finalPercent.toFixed(1)}% territory</text>
        ${horizontalGrid}
        ${verticalGrid}
        <line x1="${plotLeft}" y1="${yScale(80)}" x2="${width - plotRight}" y2="${yScale(80)}" stroke="#B45309" stroke-width="1.5" stroke-dasharray="7 6" opacity="0.75"/>
        ${opponents}
        <path d="${gptPath}" fill="none" stroke="${colors.gpt}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="${xScale(finalPoint.x)}" cy="${yScale(finalPoint.y)}" r="7" fill="#FFFFFF" stroke="${colors.gpt}" stroke-width="4"/>
        <text class="axis-label" x="${plotLeft + plotWidth / 2}" y="${top + panelHeight + 53}" text-anchor="middle">Simulated time (minutes)</text>`;
    })
    .join("");

  return svgShell({
    width,
    height,
    title: "GPT-5.6 Luna territory races",
    description:
      "Five separate panels chart GPT-5.6 Luna and the built-in nations' territory shares during each evaluated match.",
    body: `
      <text class="title" x="${plotLeft}" y="55">Five paths through the Japan eval</text>
      <text class="subtitle" x="${plotLeft}" y="87">Each panel shows one GPT-5.6 Luna match against the built-in nations</text>
      ${legend}
      ${panels}
      <text class="axis-label" x="30" y="${height / 2}" text-anchor="middle" transform="rotate(-90 30 ${height / 2})">Territory controlled</text>
      <text class="axis" x="${width - plotRight}" y="${height - 18}" text-anchor="end">Opponent lines fall to zero after elimination · Japan · JAPAN01A</text>`,
  });
}

function modelActionMix() {
  const width = 1200;
  const height = 610;
  const barLeft = 300;
  const barRight = 70;
  const barWidth = width - barLeft - barRight;
  const barHeight = 70;
  const rowY = [205, 335, 465];
  const categories = [
    { key: "combat", label: "Combat", color: colors.gpt, dark: true },
    { key: "hold", label: "Hold", color: "#CBD5E1", dark: false },
    { key: "expand", label: "Expand", color: colors.Kansai, dark: true },
    { key: "other", label: "Other", color: "#F2C46D", dark: false },
  ];
  const models = [
    {
      label: "GPT-5.6 Luna",
      files: runFiles.map((file) => join("data", "gpt-5.6-luna", file)),
    },
    {
      label: "GLM-5.2",
      files: [
        "data/glm-5.2/4f42ae97-f1d9-4b43-ae38-01314ef3fb74.json.gz",
        "data/glm-5.2/4f6cf74d-68b3-4ea7-bd32-619636f116be.json.gz",
        "data/glm-5.2/817d7009-8ce5-4f4d-bf34-a336fa86695c.json.gz",
        "data/glm-5.2/90c57d50-3ee6-4a5d-984e-b5c279d5a9e6.json.gz",
        "data/glm-5.2/f7e8e361-047d-43ab-a53c-1055af01117c.json.gz",
      ],
    },
    {
      label: "DeepSeek V4 Flash",
      files: [
        "data/deepseek-v4-flash/1bc4116a-e7ca-4765-9697-46e3ee5967e9.json.gz",
        "data/deepseek-v4-flash/22c50f53-2626-4c51-b8c6-ec8180226886.json.gz",
        "data/deepseek-v4-flash/29c19e21-9bce-49c0-9196-c6be662d376e.json.gz",
        "data/deepseek-v4-flash/8d43865f-2dd0-4cd8-9576-64e6ecd48a2c.json.gz",
        "data/deepseek-v4-flash/bdb2c0c4-2d54-4216-9555-f0238a85e5cc.json.gz",
      ],
    },
  ];

  function categoryFor(actionId) {
    if (
      actionId.startsWith("attack:") ||
      actionId.startsWith("boat:") ||
      actionId.startsWith("counter:")
    ) {
      return "combat";
    }
    if (actionId.startsWith("hold:")) return "hold";
    if (actionId.startsWith("expand:")) return "expand";
    return "other";
  }

  const summaries = models.map((model) => {
    const actionIds = model.files.flatMap((file) =>
      loadArtifact(file).decisions.flatMap(
        (decision) => decision.selectedActionIds,
      ),
    );
    const counts = Object.fromEntries(categories.map(({ key }) => [key, 0]));
    for (const actionId of actionIds) counts[categoryFor(actionId)] += 1;
    return { ...model, counts, total: actionIds.length };
  });

  const legend = categories
    .map(({ label, color }, index) => {
      const x = barLeft + index * 180;
      return `<rect x="${x}" y="126" width="18" height="18" rx="5" fill="${color}"/><text class="legend" x="${x + 29}" y="140">${label}</text>`;
    })
    .join("");

  const rows = summaries
    .map((model, index) => {
      const y = rowY[index];
      const combatPercent = (model.counts.combat / model.total) * 100;
      let x = barLeft;
      const segments = categories
        .map(({ key, label, color, dark }) => {
          const count = model.counts[key];
          const percent = (count / model.total) * 100;
          const segmentWidth = (count / model.total) * barWidth;
          const segmentX = x;
          x += segmentWidth;
          const labelMarkup =
            segmentWidth >= 105
              ? `<text x="${segmentX + segmentWidth / 2}" y="${y + barHeight / 2 + 5}" text-anchor="middle" font-size="14" font-weight="700" style="fill:${dark ? "#FFFFFF" : colors.ink}">${label} ${percent.toFixed(1)}%</text>`
              : "";
          return `<rect x="${segmentX}" y="${y}" width="${segmentWidth}" height="${barHeight}" fill="${color}"/>${labelMarkup}`;
        })
        .join("");
      return `
        <defs><clipPath id="action-bar-${index}"><rect x="${barLeft}" y="${y}" width="${barWidth}" height="${barHeight}" rx="15"/></clipPath></defs>
        <text x="${barLeft - 24}" y="${y + 25}" text-anchor="end" font-size="19" font-weight="750">${model.label}</text>
        <text x="${barLeft - 24}" y="${y + 51}" text-anchor="end" font-size="14" style="fill:${colors.muted}">${combatPercent.toFixed(1)}% combat · ${model.total} slots</text>
        <g clip-path="url(#action-bar-${index})">${segments}</g>`;
    })
    .join("");

  return svgShell({
    width,
    height,
    title: "How the evaluated models used their action slots",
    description:
      "One hundred percent stacked bars compare combat, hold, expansion, and other actions selected by GPT-5.6 Luna, GLM-5.2, and DeepSeek V4 Flash.",
    body: `
      <text class="title" x="${barLeft}" y="58">Three models, three different play styles</text>
      <text class="subtitle" x="${barLeft}" y="91">Share of accepted action slots across five runs per model</text>
      ${legend}
      ${rows}
      <text class="axis" x="${width - barRight}" y="570" text-anchor="end">Combat includes attack, boat, and counter actions</text>`,
  });
}

const runs = runFiles.map(loadRun);
const representativeRun = runs.find((run) => run.runId.startsWith("5c3016b7"));

mkdirSync(outputDir, { recursive: true });
writeFileSync(
  join(outputDir, "gpt-5.6-territory-over-time.svg"),
  territoryOverTime(representativeRun),
);
writeFileSync(
  join(outputDir, "gpt-5.6-territory-races.svg"),
  territoryRaceSmallMultiples(runs),
);
writeFileSync(join(outputDir, "model-action-mix.svg"), modelActionMix());
