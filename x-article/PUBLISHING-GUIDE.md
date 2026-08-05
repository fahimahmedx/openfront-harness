# X Article publishing guide

The copy-ready article is in `README.md`. For the easiest paste:

1. Open `ARTICLE-PREVIEW.html` in a browser.
2. Select the rendered article and copy it.
3. Paste it into the X Article editor.
4. Delete each gray `INSERT IMAGE` or `UPLOAD VIDEO` marker after adding the named asset.
5. Use the first heading as the X Article title rather than leaving it duplicated in the body.
6. Preview on both desktop and mobile before publishing.

## Media used by the article

Insert these files in numerical order as their markers appear:

- `videos/attack-2-clipped.mp4` — opening/hero gameplay clip
- `visuals/01-interface-win-rate.png` — headline 0/10, 0/10, 10/10 result
- `videos/attack-1-clipped.mp4` — OpenFront gameplay example
- `visuals/02-harness-architecture.png` — bounded decision loop
- `visuals/03-replay-at-5m50.png` — replay and decision trace
- `visuals/04-observation-json.png` — model observation
- `visuals/05-legal-actions-json.png` — legal action menu
- `visuals/06-model-decision-json.png` — selected action IDs
- `visuals/07-action-reliability.png` — validation boundary
- `visuals/08-provider-output-variance.png` — unpinned provider behavior
- `visuals/09-operational-metrics.png` — final provider metrics
- `visuals/10-provider-schema-compliance.png` — schema conformance
- `visuals/11-audit-trace-before-after.png` — audit case studies
- `visuals/12-evaluation-conditions.png` — interface definitions
- `visuals/13-interface-results-table.png` — win-rate confidence intervals
- `visuals/14-model-performance-table.png` — model performance summary
- `visuals/15-territory-over-time.png` — representative winning run
- `visuals/16-territory-races.png` — three paths to victory
- `visuals/17-model-action-mix.png` — model play-style comparison

Every visual is a PNG, so it can be opened and copied directly or uploaded from the file picker. `video-posters/` contains a JPEG frame from every exported clip if X asks for a thumbnail.

## Optional video exports

The article directly uses the two clipped attack videos. The other normalized MP4 files are included for launch posts, replies, or later edits:

- `videos/attack-1.mp4`
- `videos/attack-1-zoomed.mp4`
- `videos/attack-2.mp4`
- `videos/building.mp4`
- `videos/building-defence.mp4`
- `videos/sending-ship.mp4`
- `videos/replay-demo.mp4`

The exports use H.264 MP4, 30 fps, `yuv420p`, fast-start metadata, a maximum 1920×1200 frame, and an 8 Mbps rate ceiling. These settings fit X's current web-upload limits.

## Regenerating the package

With the local write-up server running at `http://127.0.0.1:3000`:

```sh
npm run export:x-article
```

Set `WRITEUP_URL` if the write-up is available at another origin. Regeneration overwrites the generated `README.md`, preview, visuals, videos, and poster frames.
