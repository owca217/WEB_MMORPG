/** Cosmetic qualities are independent of rarity and never modify item statistics. */
export const ITEM_QUALITIES = ["BASIC", "NORMAL", "GOOD", "EXCELLENT", "PERFECT", "MASTERWORK"] as const;
export type ItemQuality = (typeof ITEM_QUALITIES)[number];
export const DEFAULT_ITEM_QUALITY: ItemQuality = "NORMAL";

export const ITEM_QUALITY_DEFINITIONS = [
  { id: "BASIC", label: "Zwykła", color: "#8b8b8b" },
  { id: "NORMAL", label: "Normalna", color: "#ffffff" },
  { id: "GOOD", label: "Dobra", color: "#2ecc71" },
  { id: "EXCELLENT", label: "Znakomita", color: "#3498db" },
  { id: "PERFECT", label: "Doskonała", color: "#ffd700" },
  { id: "MASTERWORK", label: "Arcydzieło", color: "#e74c3c" }
] as const;

export function isItemQuality(value: unknown): value is ItemQuality {
  return ITEM_QUALITIES.some(quality => quality === value);
}

export function normalizeItemQuality(value: unknown): ItemQuality {
  return isItemQuality(value) ? value : DEFAULT_ITEM_QUALITY;
}

export function getItemQualityDefinition(value: unknown) {
  const quality = normalizeItemQuality(value);
  return ITEM_QUALITY_DEFINITIONS.find(definition => definition.id === quality)!;
}
