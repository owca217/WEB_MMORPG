export const GENERAL_INVENTORY_TITLE = "Ekwipunek";

export function inventoryPanelTitle(bagName: string | null): string {
  return bagName?.trim() || GENERAL_INVENTORY_TITLE;
}

export function fitInventoryTitleFontSize(
  measuredTextWidth: number,
  availableTextWidth: number,
  baseFontSize: number
): number {
  if (
    !Number.isFinite(measuredTextWidth)
    || !Number.isFinite(availableTextWidth)
    || !Number.isFinite(baseFontSize)
    || measuredTextWidth <= 0
    || availableTextWidth <= 0
    || baseFontSize <= 0
    || measuredTextWidth <= availableTextWidth
  ) {
    return baseFontSize;
  }

  const fitted = baseFontSize * availableTextWidth / measuredTextWidth * 0.96;
  return Math.max(8, Math.floor(fitted * 10) / 10);
}
