import type { InventoryItem } from "@web-mmorpg/shared";

/** Reserve authoritative cells first; old packets fill the remaining cells in their existing order. */
export function inventoryPositions(items: readonly InventoryItem[], capacity: number): Map<number, InventoryItem> {
  const positions = new Map<number, InventoryItem>();
  const unpositioned: InventoryItem[] = [];
  for (const item of items) {
    const position = item.containerPosition;
    if (position !== undefined && Number.isSafeInteger(position) && position >= 0 && position < capacity && !positions.has(position)) positions.set(position, item);
    else unpositioned.push(item);
  }
  let next = 0;
  for (const item of unpositioned) {
    while (positions.has(next)) next++;
    if (next >= capacity) break;
    positions.set(next++, item);
  }
  return positions;
}
