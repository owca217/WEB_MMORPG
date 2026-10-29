import Phaser from "phaser";

export type TerrainTextureId = "meadow-grass" | "worn-earth" | "forest-floor";
export type VegetationTextureId = "oak" | "pine" | "shrubs" | "ground-plants";
export type EnvironmentTextureId = TerrainTextureId | VegetationTextureId;
export const TERRAIN_TEXTURES: readonly TerrainTextureId[] = ["meadow-grass", "worn-earth", "forest-floor"];
export const VEGETATION_FRAMES: Readonly<Record<VegetationTextureId, { x: number; y: number; width: number; height: number }>> = {
  oak: { x: 28, y: 59, width: 1204, height: 1151 },
  pine: { x: 344, y: 23, width: 572, height: 1209 },
  shrubs: { x: 106, y: 347, width: 1051, height: 645 },
  "ground-plants": { x: 319, y: 408, width: 625, height: 464 }
};
export function getEnvironmentTextureKey(id: EnvironmentTextureId): string { return `environment:${id}`; }
export function preloadEnvironmentAssets(scene: Phaser.Scene): number {
  let queued = 0;
  for (const id of [...TERRAIN_TEXTURES, ...Object.keys(VEGETATION_FRAMES) as VegetationTextureId[]]) {
    const key = getEnvironmentTextureKey(id);
    if (scene.textures.exists(key)) continue;
    const directory = TERRAIN_TEXTURES.includes(id as TerrainTextureId) ? "terrain" : "vegetation";
    scene.load.image(key, `${import.meta.env.BASE_URL}assets/environment/${directory}/${id}.png`);
    queued += 1;
  }
  return queued;
}
export function registerEnvironmentFrames(scene: Phaser.Scene): void {
  for (const id of [...TERRAIN_TEXTURES, ...Object.keys(VEGETATION_FRAMES) as VegetationTextureId[]]) {
    const key = getEnvironmentTextureKey(id);
    if (!scene.textures.exists(key)) continue;
    const texture = scene.textures.get(key);
    texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
    if (!(id in VEGETATION_FRAMES) || texture.has("plant")) continue;
    const frame = VEGETATION_FRAMES[id as VegetationTextureId];
    texture.add("plant", 0, frame.x, frame.y, frame.width, frame.height);
  }
}
