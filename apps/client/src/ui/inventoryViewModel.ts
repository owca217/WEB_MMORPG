import type { InventoryItem, InventorySnapshot } from "@web-mmorpg/shared";

export interface InventoryViewModel {
  generalItems: InventoryItem[];
  selectedBag: InventoryItem | null;
  bagContents: InventoryItem[];
  occupiedSlots: number;
  capacity: number;
  emptySlots: number;
  rowSizes: number[];
  columns: number;
  visibleRows: number;
  isScrollable: boolean;
  windowWidth: number;
}

const BAG_GRID_COLUMNS = 5;
const BAG_GRID_MAX_VISIBLE_ROWS = 5;
const BAG_SLOT_SIZE = 32;
const BAG_SLOT_GAP = 4;
const BAG_WINDOW_HORIZONTAL_CHROME = 80;
const BAG_WINDOW_MIN_WIDTH = 230;

function getBalancedRowSizes(capacity: number): number[] {
  if (capacity <= 0) return [];

  const rows = Math.ceil(capacity / BAG_GRID_COLUMNS);
  const slotsPerRow = Math.floor(capacity / rows);
  const extraSlots = capacity % rows;
  return Array.from(
    { length: rows },
    (_unused, index) => slotsPerRow + Number(index < extraSlots)
  );
}

function getBagWindowWidth(columns: number): number {
  const slotGridWidth = columns > 0
    ? columns * BAG_SLOT_SIZE + (columns - 1) * BAG_SLOT_GAP
    : 0;
  return Math.max(BAG_WINDOW_MIN_WIDTH, slotGridWidth + BAG_WINDOW_HORIZONTAL_CHROME);
}

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
  const rowSizes = getBalancedRowSizes(capacity);
  const columns = rowSizes[0] ?? 0;
  const visibleRows = Math.min(BAG_GRID_MAX_VISIBLE_ROWS, rowSizes.length);

  return {
    generalItems,
    selectedBag,
    bagContents,
    occupiedSlots,
    capacity,
    emptySlots: Math.max(0, capacity - occupiedSlots),
    rowSizes,
    columns,
    visibleRows,
    isScrollable: rowSizes.length > BAG_GRID_MAX_VISIBLE_ROWS,
    windowWidth: getBagWindowWidth(columns)
  };
}
