import { BASE_CHARACTER_SKINS, type CharacterSkinId } from "@web-mmorpg/shared";

export interface CharacterSkinAtlas {
  id: CharacterSkinId;
  url: string;
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  rowBounds: readonly { y: number; height: number }[];
}

const SKIN_ROW_BOUNDS: Record<CharacterSkinId, CharacterSkinAtlas["rowBounds"]> = {
  "male-traveler": [{ y: 37, height: 330 }, { y: 403, height: 338 }, { y: 785, height: 341 }, { y: 1162, height: 337 }],
  "male-scout": [{ y: 50, height: 331 }, { y: 407, height: 340 }, { y: 790, height: 341 }, { y: 1160, height: 335 }],
  "male-guard": [{ y: 34, height: 346 }, { y: 402, height: 358 }, { y: 783, height: 359 }, { y: 1158, height: 344 }],
  "female-traveler": [{ y: 47, height: 334 }, { y: 411, height: 331 }, { y: 781, height: 329 }, { y: 1137, height: 346 }],
  "female-scout": [{ y: 18, height: 364 }, { y: 391, height: 372 }, { y: 777, height: 369 }, { y: 1157, height: 349 }],
  "female-guard": [{ y: 49, height: 338 }, { y: 418, height: 339 }, { y: 782, height: 342 }, { y: 1149, height: 329 }]
};

export const CHARACTER_SKIN_ATLASES = Object.fromEntries(
  BASE_CHARACTER_SKINS.map(({ id }) => [id, {
    id,
    url: `${import.meta.env.BASE_URL}assets/characters/skins/${id}.png`,
    frameWidth: 256,
    frameHeight: 384,
    columns: 4,
    rows: 4,
    rowBounds: SKIN_ROW_BOUNDS[id]
  }])
) as Record<CharacterSkinId, CharacterSkinAtlas>;

export function getCharacterSkinTextureKey(skinId: CharacterSkinId): string {
  return `character-skin:${skinId}`;
}

export function getCharacterSkinFrame(skinId: CharacterSkinId, rowIndex: number, columnIndex = 0): {
  x: number; y: number; width: number; height: number; offsetY: number;
} {
  const atlas = CHARACTER_SKIN_ATLASES[skinId];
  const row = atlas.rowBounds[rowIndex];
  if (!row) throw new RangeError(`Invalid character skin row: ${rowIndex}`);
  return {
    x: columnIndex * atlas.frameWidth,
    y: row.y,
    width: atlas.frameWidth,
    height: row.height,
    offsetY: atlas.frameHeight - row.height - 8
  };
}
