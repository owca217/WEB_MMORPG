import type Phaser from "phaser";

export interface NpcSkinAsset {
  id: string;
  url: string;
  frame: { x: number; y: number; width: number; height: number };
}

// Crop complete silhouettes from the original transparent generated PNGs.
// The source files stay intact; only Phaser's texture frame removes padding.
const NPC_SKIN_FRAMES = {
  "guide-boran": { x: 239, y: 294, width: 549, height: 1027 },
  "healer-ada": { x: 271, y: 206, width: 466, height: 1138 },
  "merchant-miro": { x: 200, y: 213, width: 623, height: 1095 }
};

export const NPC_SKIN_ASSETS: readonly NpcSkinAsset[] = Object.entries(NPC_SKIN_FRAMES)
  .map(([id, frame]) => ({ id, frame, url: `${import.meta.env.BASE_URL}assets/characters/npcs/${id}.png` }));

export function getNpcSkinAsset(npcId: string): NpcSkinAsset | undefined {
  return NPC_SKIN_ASSETS.find((asset) => asset.id === npcId);
}

export function getNpcSkinTextureKey(npcId: string): string {
  return `npc-skin:${npcId}`;
}

export function preloadNpcSkins(scene: Phaser.Scene): number {
  let queued = 0;
  for (const asset of NPC_SKIN_ASSETS) {
    const key = getNpcSkinTextureKey(asset.id);
    if (scene.textures.exists(key)) continue;
    scene.load.image(key, asset.url);
    queued += 1;
  }
  return queued;
}

export function registerNpcSkinFrames(scene: Phaser.Scene): void {
  for (const asset of NPC_SKIN_ASSETS) {
    const key = getNpcSkinTextureKey(asset.id);
    if (!scene.textures.exists(key)) continue;
    const texture = scene.textures.get(key);
    if (texture.has("idle")) continue;
    const { x, y, width, height } = asset.frame;
    texture.add("idle", 0, x, y, width, height);
  }
}
