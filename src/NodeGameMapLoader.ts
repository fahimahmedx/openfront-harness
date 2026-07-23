import fs from "fs";
import path from "path";
import { GameMapType } from "../OpenFrontIO/src/core/game/Game";
import {
  GameMapLoader,
  MapData,
} from "../OpenFrontIO/src/core/game/GameMapLoader";
import { MapManifest } from "../OpenFrontIO/src/core/game/TerrainMapLoader";

export class NodeGameMapLoader implements GameMapLoader {
  constructor(private readonly mapsDir: string) {}

  getMapData(map: GameMapType): MapData {
    if (map !== GameMapType.Japan) {
      throw new Error(`Harness only supports the Japan map, received ${map}`);
    }
    const dir = path.join(this.mapsDir, "japan");
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
