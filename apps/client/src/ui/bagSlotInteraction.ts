export type BagSlotClickAction =
  | { type: "open-bag"; containerInstanceId: string }
  | { type: "empty"; message: string };

export const EMPTY_BAG_SLOT_MESSAGE = "ten slot jest pusty.";

interface StoredInventoryItem {
  containerInstanceId?: string | null;
  quantity?: number;
}

export function bagSlotClickAction(
  itemInstanceId: string | null,
  itemCategory: string | null
): BagSlotClickAction {
  return itemInstanceId && itemCategory === "bag"
    ? { type: "open-bag", containerInstanceId: itemInstanceId }
    : { type: "empty", message: EMPTY_BAG_SLOT_MESSAGE };
}

export function bagSlotOccupancyText(
  containerInstanceId: string | null,
  capacity: number | null | undefined,
  items: readonly StoredInventoryItem[]
): string {
  if (!containerInstanceId) return "";
  const occupiedSlots = items.filter(
    (item) => item.containerInstanceId === containerInstanceId
  ).length;
  return `${occupiedSlots}/${capacity ?? "?"}`;
}

export function containerSlotIcon(itemCategory: string | null): string {
  if (itemCategory === "bag") return "🎒";
  return '<svg viewBox="0 0 24 24" fill="none" stroke="#a0a0a0" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 8V6.5a4 4 0 0 1 8 0V8"/><rect x="4" y="8" width="16" height="13" rx="2"/><path d="M8 12h8M12 12v4"/></svg>';
}
