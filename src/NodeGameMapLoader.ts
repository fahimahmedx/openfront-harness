import fs from "fs";
import path from "path";
import { GameMapType } from "../OpenFrontIO/src/core/game/Game";
import {
  GameMapLoader,
  MapData,
} from "../OpenFrontIO/src/core/game/GameMapLoader";
import { MapManifest } from "../OpenFrontIO/src/core/game/TerrainMapLoader";

export class NodeGameMapLoader implements GameMapLoader {
  private readonly allowedMaps: ReadonlySet<GameMapType>;

  constructor(
    private readonly mapsDir: string,
    allowedMaps: readonly GameMapType[] = [GameMapType.Japan],
  ) {
    this.allowedMaps = new Set(allowedMaps);
  }

  getMapData(map: GameMapType): MapData {
    if (!this.allowedMaps.has(map)) {
      throw new Error(`Map ${map} is not in this loader's allowlist`);
    }
    // Generated map enum names differ from their labels only by spaces and
    // punctuation. Map asset directories use the same normalized spelling.
    const slug = map.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const dir = path.resolve(this.mapsDir, slug);
    const root = path.resolve(this.mapsDir);
    if (path.dirname(dir) !== root) {
      throw new Error(`Invalid map asset path for ${map}`);
    }
    const readBin = (name: string) => async () =>
      new Uint8Array(fs.readFileSync(path.join(dir, name)));
    return {
      mapBin: readBin("map.bin"),
      map4xBin: readBin("map4x.bin"),
      map16xBin: readBin("map16x.bin"),
      manifest: async () =>
        JSON.parse(
          fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
        ) as MapManifest,
      webpPath: path.join(dir, "thumbnail.webp"),
    };
  }
}
