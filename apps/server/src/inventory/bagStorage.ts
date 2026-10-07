import type { InventoryItem, InventorySnapshot } from "@web-mmorpg/shared";

export function moveItemToContainer(
  snapshot: InventorySnapshot,
  itemInstanceId: string,
  containerInstanceId: string | null
): InventorySnapshot {
  const item = snapshot.items.find((candidate) =>
    candidate.instanceId === itemInstanceId
  );
  if (!item) throw new Error("SOURCE_ITEM_NOT_FOUND");

  if ((item.containerInstanceId ?? null) === containerInstanceId) return snapshot;

  if (containerInstanceId === null) {
    return {
      items: snapshot.items.map((candidate) => {
        if (candidate.instanceId !== itemInstanceId) return candidate;
        const { containerInstanceId: _previousContainer, ...generalItem } = candidate;
        return generalItem as InventoryItem;
      })
    };
  }

  const destination = snapshot.items.find((candidate) =>
    candidate.instanceId === containerInstanceId
  );
  if (!destination) throw new Error("DESTINATION_BAG_NOT_FOUND");
  if (destination.category !== "bag") throw new Error("DESTINATION_IS_NOT_BAG");
  if (item.category === "bag") throw new Error("BAGS_CANNOT_BE_NESTED");

  const capacity = destination.containerCapacity;
  if (!Number.isInteger(capacity) || capacity === undefined || capacity <= 0) {
    throw new Error("DESTINATION_BAG_INVALID");
  }

  const occupiedSlots = snapshot.items.filter((candidate) =>
    candidate.containerInstanceId === containerInstanceId
  ).length;
  if (occupiedSlots >= capacity) throw new Error("BAG_IS_FULL");

  return {
    items: snapshot.items.map((candidate) =>
      candidate.instanceId === itemInstanceId
        ? { ...candidate, containerInstanceId }
        : candidate
    )
  };
}
