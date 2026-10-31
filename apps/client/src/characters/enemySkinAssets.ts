import type { EnemyId } from "@web-mmorpg/shared";
import type Phaser from "phaser";

export interface EnemySkinAsset {
  id: EnemyId;
  url: string;
  frame: { x: number; y: number; width: number; height: number };
  shape: "quadruped" | "humanoid";
}

// Phaser crops source padding without changing the original transparent artwork.
const ENEMY_SKIN_FRAMES: Record<EnemyId, EnemySkinAsset["frame"]> = {
  "feral-rat": { x: 114, y: 295, width: 1037, height: 700 },
  "forest-wolf": { x: 41, y: 181, width: 1166, height: 894 },
  "wild-boar": { x: 57, y: 102, width: 1145, height: 1041 },
  "forest-bandit": { x: 284, y: 73, width: 716, height: 1123 },
  "outlaw-guard": { x: 158, y: 68, width: 974, height: 1106 }
};

export const ENEMY_SKIN_ASSETS: readonly EnemySkinAsset[] = Object.entries(ENEMY_SKIN_FRAMES)
  .map(([id, frame]) => ({
    id: id as EnemyId,
    frame,
    shape: id === "forest-bandit" || id === "outlaw-guard" ? "humanoid" : "quadruped",
    url: `${import.meta.env.BASE_URL}assets/characters/enemies/${id}.png`
  }));

export function getEnemySkinAsset(enemyId: string): EnemySkinAsset | undefined {
  return ENEMY_SKIN_ASSETS.find((asset) => asset.id === enemyId);
}

export function getEnemySkinTextureKey(enemyId: string): string {
  return `enemy-skin:${enemyId}`;
}

export function getEnemySkinDisplaySize(asset: EnemySkinAsset, maxWidth: number, maxHeight: number): { width: number; height: number } {
  const scale = Math.min(maxWidth / asset.frame.width, maxHeight / asset.frame.height);
  return { width: asset.frame.width * scale, height: asset.frame.height * scale };
}

export function preloadEnemySkins(scene: Phaser.Scene): number {
  let queued = 0;
  for (const asset of ENEMY_SKIN_ASSETS) {
    const key = getEnemySkinTextureKey(asset.id);
    if (scene.textures.exists(key)) continue;
    scene.load.image(key, asset.url);
    queued += 1;
  }
  return queued;
}

export function registerEnemySkinFrames(scene: Phaser.Scene): void {
  for (const asset of ENEMY_SKIN_ASSETS) {
    const key = getEnemySkinTextureKey(asset.id);
    if (!scene.textures.exists(key)) continue;
    const texture = scene.textures.get(key);
    if (texture.has("idle")) continue;
    const { x, y, width, height } = asset.frame;
    texture.add("idle", 0, x, y, width, height);
  }
}
