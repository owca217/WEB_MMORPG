import { CONTAINER_ITEM_CATEGORY, PERMANENT_BACKPACK_CAPACITY } from "@web-mmorpg/shared";

export interface ContainerCapacitySource {
  permanent_container: boolean;
  category_id: string;
  special_data: Record<string, unknown> | null;
  container_capacity: number | null;
  legacy_capacity?: number | string | null;
}

/** The published flat stat supports old backpack definitions without changing the catalog. */
export const LEGACY_CAPACITY_COLUMN = `(SELECT SUM(stat.value)::double precision
  FROM item_stat_modifiers stat WHERE stat.version_id=version.id
    AND stat.stat_code='EXTRA_SLOTS' AND stat.modifier_type='flat') AS legacy_capacity`;

export function resolveContainerCapacity(row: ContainerCapacitySource): number | undefined {
  if (row.permanent_container) return PERMANENT_BACKPACK_CAPACITY;
  if (row.category_id !== CONTAINER_ITEM_CATEGORY && row.category_id !== "backpack") return undefined;
  const capacity = row.special_data?.capacity ?? row.container_capacity ??
    (row.category_id === "backpack" && row.legacy_capacity != null ? Number(row.legacy_capacity) : undefined);
  return typeof capacity === "number" && Number.isSafeInteger(capacity) && capacity > 0 && capacity <= 10_000
    ? capacity : undefined;
}

export function isInventoryContainer(row: ContainerCapacitySource): boolean {
  return row.permanent_container || row.category_id === CONTAINER_ITEM_CATEGORY ||
    (row.category_id === "backpack" && resolveContainerCapacity(row) !== undefined);
}
