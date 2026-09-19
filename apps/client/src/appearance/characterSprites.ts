import { DEFAULT_APPEARANCE, type AppearanceSelection } from "@web-mmorpg/shared";

export const CHARACTER_ATLAS_URL = `${import.meta.env.BASE_URL}assets/characters/base-front.png`;
export const SPRITE_WIDTH = 64;
export const SPRITE_HEIGHT = 108;
export const EYE_LABELS: Record<string, string> = {
  "eyes-01": "Zwykłe", "eyes-02": "Szeroko rozstawione", "eyes-03": "Duże",
  "eyes-sad": "Smutne", "eyes-angry": "Zdenerwowane", "eyes-closed": "Zamknięte"
};
export const CHARACTER_PRESETS = [
  { name: "Kasztanowe włosy", appearance: { ...DEFAULT_APPEARANCE, hair: "hair-01", hairColor: "hair-color-02", startingOutfit: "outfit-base" } },
  { name: "Czarne włosy", appearance: { ...DEFAULT_APPEARANCE, skinTone: "skin-02", hair: "hair-02", startingOutfit: "outfit-base" } },
  { name: "Rudy kucyk", appearance: { ...DEFAULT_APPEARANCE, bodyType: "body-02", hair: "hair-03", hairColor: "hair-color-05", startingOutfit: "outfit-base" } },
  { name: "Srebrne włosy", appearance: { ...DEFAULT_APPEARANCE, bodyType: "body-02", skinTone: "skin-04", hair: "hair-04", hairColor: "hair-color-06", startingOutfit: "outfit-base" } }
] satisfies Array<{ name: string; appearance: AppearanceSelection }>;

let atlasPromise: Promise<HTMLImageElement> | undefined;
export function loadCharacterAtlas(): Promise<HTMLImageElement> {
  return atlasPromise ??= new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => { atlasPromise = undefined; reject(new Error("Nie udało się wczytać grafiki postaci.")); };
    image.src = CHARACTER_ATLAS_URL;
  });
}

export function spriteHeadIndex(hair: string): number {
  return ({ "hair-01": 0, "hair-02": 1, "hair-03": 2, "hair-04": 3, "hair-05": 0 } as Record<string, number>)[hair] ?? 0;
}
