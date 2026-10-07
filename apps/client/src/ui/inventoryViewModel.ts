import type { InventoryItem, InventorySnapshot } from "@web-mmorpg/shared";

export interface InventoryViewModel {
  generalItems: InventoryItem[];
  selectedBag: InventoryItem | null;
  bagContents: InventoryItem[];
  occupiedSlots: number;
  capacity: number;
  emptySlots: number;
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

  return {
    generalItems,
    selectedBag,
    bagContents,
    occupiedSlots,
    capacity,
    emptySlots: Math.max(0, capacity - occupiedSlots)
  };
}
