import type { CharacterSkinId } from "@web-mmorpg/shared";
import type Phaser from "phaser";
import {
  getCharacterAnimationFrames,
  type CharacterDirection
} from "./characterSkinAnimation";
import { CHARACTER_SKIN_ATLASES, getCharacterSkinFrame, getCharacterSkinTextureKey } from "./characterSkinAssets";

const DIRECTIONS: CharacterDirection[] = ["south", "west", "east", "north"];

export function getCharacterWalkAnimationKey(skinId: CharacterSkinId, direction: CharacterDirection): string {
  return `${getCharacterSkinTextureKey(skinId)}:walk:${direction}`;
}

export function preloadCharacterSkins(scene: Phaser.Scene): number {
  let queued = 0;
  for (const atlas of Object.values(CHARACTER_SKIN_ATLASES)) {
    const textureKey = getCharacterSkinTextureKey(atlas.id);
    if (scene.textures.exists(textureKey)) continue;
    scene.load.image(textureKey, atlas.url);
    queued += 1;
  }
  return queued;
}

export function registerCharacterSkinAnimations(scene: Phaser.Scene): void {
  for (const atlas of Object.values(CHARACTER_SKIN_ATLASES)) {
    const textureKey = getCharacterSkinTextureKey(atlas.id);
    if (!scene.textures.exists(textureKey)) continue;
    const texture = scene.textures.get(textureKey);
    for (let rowIndex = 0; rowIndex < atlas.rows; rowIndex += 1) {
      for (let columnIndex = 0; columnIndex < atlas.columns; columnIndex += 1) {
        const index = rowIndex * atlas.columns + columnIndex;
        if (texture.has(String(index))) continue;
        const rect = getCharacterSkinFrame(atlas.id, rowIndex, columnIndex);
        const frame = texture.add(index, 0, rect.x, rect.y, rect.width, rect.height);
        frame?.setTrim(atlas.frameWidth, atlas.frameHeight, 0, rect.offsetY, rect.width, rect.height);
      }
    }
    for (const direction of DIRECTIONS) {
      const key = getCharacterWalkAnimationKey(atlas.id, direction);
      if (scene.anims.exists(key)) continue;
      scene.anims.create({
        key,
        frames: scene.anims.generateFrameNumbers(textureKey, {
          frames: getCharacterAnimationFrames(direction)
        }),
        frameRate: 8,
        repeat: -1
      });
    }
  }
}
