import { getCharacterSkin, resolveCharacterSkin, type CharacterSkinId, type CombatantSnapshot } from "@web-mmorpg/shared";
import type Phaser from "phaser";
import { CHARACTER_SKIN_ATLASES, getCharacterSkinFrame } from "../characters/characterSkinAssets";
import { getCharacterSkinTextureKey } from "../characters/characterSkinAssets";

/** Old running battles may predate the server's explicit enemy and appearance fields. */
export function battleEnemyId(combatant: CombatantSnapshot): string | undefined {
  return combatant.enemyId ?? (/^wolf(?::|$)/.test(combatant.id) ? "forest-wolf" : undefined);
}

export function battleCharacterSkin(
  combatant: CombatantSnapshot,
  ownPlayerId: string,
  ownAppearance?: Record<string, unknown>
): CharacterSkinId | undefined {
  if (battleEnemyId(combatant) || combatant.side === "enemy" || !combatant.ownerPlayerId) return undefined;
  return getCharacterSkin(combatant.skinId)?.id
    ?? resolveCharacterSkin(combatant.ownerPlayerId === ownPlayerId ? ownAppearance : undefined).id;
}

/** Reuse the world's directional artwork, cropped to its actual visible height. */
export function registerBattleCharacterFrames(scene: Phaser.Scene): void {
  for (const atlas of Object.values(CHARACTER_SKIN_ATLASES)) {
    const key = getCharacterSkinTextureKey(atlas.id);
    if (!scene.textures.exists(key)) continue;
    const texture = scene.textures.get(key);
    for (const [direction, row] of [["west", 1], ["east", 2]] as const) {
      const name = `battle:${direction}`;
      if (texture.has(name)) continue;
      const frame = getCharacterSkinFrame(atlas.id, row, 0);
      texture.add(name, 0, frame.x, frame.y, frame.width, frame.height);
    }
  }
}

export function battleCharacterSize(skinId: CharacterSkinId, facing: "east" | "west", hexSize: number): { width: number; height: number } {
  const frame = getCharacterSkinFrame(skinId, facing === "east" ? 2 : 1, 0);
  const height = hexSize * 1.8;
  return { width: height * frame.width / frame.height, height };
}

/** Sprites and terrain obstacles share one ground plane, regardless of creation order. */
export function battleObjectDepth(groundY: number): number { return 1000 + groundY; }
