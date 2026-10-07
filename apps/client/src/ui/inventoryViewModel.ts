import type { InventoryItem, InventorySnapshot } from "@web-mmorpg/shared";

export interface InventoryViewModel {
  generalItems: InventoryItem[];
  selectedBag: InventoryItem | null;
  bagContents: InventoryItem[];
  occupiedSlots: number;
  capacity: number;
  emptySlots: number;
  visibleRows: number;
  isScrollable: boolean;
}

const BAG_GRID_COLUMNS = 5;
const BAG_GRID_MAX_VISIBLE_ROWS = 5;

export function getInventoryView(
  snapshot: InventorySnapshot,
  selectedContainerId: string | null
): InventoryViewModel {
  const selectedBag = selectedContainerId
    ? snapshot.items.find((item) =>
        item.instanceId === selectedContainerId && item.category === "bag"
      ) ?? null
    : null;
  const bagContents = selectedBag
    ? snapshot.items.filter((item) =>
        item.containerInstanceId === selectedBag.instanceId && item.category !== "bag"
      )
    : [];
  const generalItems = snapshot.items.filter((item) =>
    item.containerInstanceId == null || item.category === "bag"
  );
  const rawCapacity = selectedBag?.containerCapacity ?? 0;
  const capacity = Number.isInteger(rawCapacity) && rawCapacity > 0
    ? rawCapacity
    : 0;
  const occupiedSlots = bagContents.length;
  const visibleRows = capacity > 0
    ? Math.min(BAG_GRID_MAX_VISIBLE_ROWS, Math.ceil(capacity / BAG_GRID_COLUMNS))
    : 0;

  return {
    generalItems,
    selectedBag,
    bagContents,
    occupiedSlots,
    capacity,
    emptySlots: Math.max(0, capacity - occupiedSlots),
    visibleRows,
    isScrollable: capacity > BAG_GRID_COLUMNS * BAG_GRID_MAX_VISIBLE_ROWS
  };
}
