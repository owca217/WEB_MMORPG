export type CharacterGender = "male" | "female";

export type CharacterSkinId =
  | "male-traveler"
  | "male-scout"
  | "male-guard"
  | "female-traveler"
  | "female-scout"
  | "female-guard";

export interface BaseCharacterSkin {
  id: CharacterSkinId;
  gender: CharacterGender;
  name: string;
  description: string;
}

export const BASE_CHARACTER_SKINS: readonly BaseCharacterSkin[] = [
  { id: "male-traveler", gender: "male", name: "Podróżnik", description: "Lekki strój podróżny ze skórzanym pasem i butami." },
  { id: "male-scout", gender: "male", name: "Zwiadowca", description: "Zielona tunika i skórzany kaftan zwiadowcy." },
  { id: "male-guard", gender: "male", name: "Strażnik", description: "Lekka zbroja ze stalowymi naramiennikami." },
  { id: "female-traveler", gender: "female", name: "Podróżniczka", description: "Lekki strój podróżny ze skórzanym pasem i butami." },
  { id: "female-scout", gender: "female", name: "Zwiadowczyni", description: "Zielona tunika i skórzany kaftan zwiadowczyni." },
  { id: "female-guard", gender: "female", name: "Strażniczka", description: "Lekka zbroja ze stalowymi naramiennikami." }
];

export function getCharacterSkin(skinId: unknown): BaseCharacterSkin | undefined {
  return BASE_CHARACTER_SKINS.find((skin) => skin.id === skinId);
}

export function resolveCharacterSkin(appearance?: Record<string, unknown>): BaseCharacterSkin {
  const selected = getCharacterSkin(appearance?.skinId);
  if (selected) return selected;
  return BASE_CHARACTER_SKINS[appearance?.gender === "female" ? 3 : 0]!;
}
