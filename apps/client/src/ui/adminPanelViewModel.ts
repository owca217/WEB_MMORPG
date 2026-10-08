import type {
  AdminItemCatalog,
  AdminItemDefinition,
  ItemCategory
} from "@web-mmorpg/shared";

export type AdminItemCategoryFilter = "all" | ItemCategory;

export type GrantQuantityResult =
  | { ok: true; value: number }
  | { ok: false; code: "ADMIN_INVALID_QUANTITY"; message: string };

const INVALID_QUANTITY: GrantQuantityResult = {
  ok: false,
  code: "ADMIN_INVALID_QUANTITY",
  message: "Ilość musi być liczbą całkowitą od 1 do 1000."
};

export function filterAdminItems(
  catalog: AdminItemCatalog,
  query: string,
  category: AdminItemCategoryFilter
): AdminItemDefinition[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("pl-PL");
  return catalog.items.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (!normalizedQuery) return true;
    return [item.name, item.itemId, item.description]
      .some((value) => value.toLocaleLowerCase("pl-PL").includes(normalizedQuery));
  });
}

export function normalizeGrantQuantity(value: string | number | null | undefined): GrantQuantityResult {
  if (value === null || value === undefined || value === "") return INVALID_QUANTITY;
  const parsed = typeof value === "number" ? value : Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) return INVALID_QUANTITY;
  return { ok: true, value: parsed };
}

export function adminItemCapacityLabel(item: AdminItemDefinition): string {
  return typeof item.containerCapacity === "number"
    ? `Pojemność: ${item.containerCapacity} miejsc`
    : "";
}

export function createAdminOperationId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  return `admin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
