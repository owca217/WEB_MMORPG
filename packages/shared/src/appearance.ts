export const APPEARANCE_CATALOG = {
  bodyType: ["body-01", "body-02"],
  skinTone: ["skin-01", "skin-02", "skin-03", "skin-04"],
  face: ["face-01", "face-02", "face-03", "face-04"],
  eyes: ["eyes-01", "eyes-02", "eyes-03", "eyes-sad", "eyes-angry", "eyes-closed"],
  hair: ["hair-01", "hair-02", "hair-03", "hair-04", "hair-05"],
  hairColor: ["hair-color-01", "hair-color-02", "hair-color-03", "hair-color-04", "hair-color-05", "hair-color-06"],
  facialHair: ["facial-hair-none", "facial-hair-01", "facial-hair-02"],
  marking: ["marking-none", "scar-01", "scar-02", "tattoo-01"],
  startingOutfit: ["outfit-01", "outfit-02", "outfit-03", "outfit-base"]
} as const;

export interface AppearanceSelection {
  bodyType: string;
  skinTone: string;
  face: string;
  eyes: string;
  hair: string;
  hairColor: string;
  facialHair: string;
  marking: string;
  startingOutfit: string;
}

export const DEFAULT_APPEARANCE: AppearanceSelection = {
  bodyType: "body-01",
  skinTone: "skin-01",
  face: "face-01",
  eyes: "eyes-01",
  hair: "hair-01",
  hairColor: "hair-color-01",
  facialHair: "facial-hair-none",
  marking: "marking-none",
  startingOutfit: "outfit-01"
};

export function isAppearanceSelection(value: unknown): value is AppearanceSelection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;

  return (Object.keys(APPEARANCE_CATALOG) as Array<keyof typeof APPEARANCE_CATALOG>)
    .every((key) => {
      const selected = candidate[key];
      return typeof selected === "string"
        && (APPEARANCE_CATALOG[key] as readonly string[]).includes(selected);
    });
}
