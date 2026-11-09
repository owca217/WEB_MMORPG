import type { InventoryItem } from "@web-mmorpg/shared";

const BUNDLED_ITEM_ICON_PATHS: ReadonlyMap<string, string> = new Map([
  ["field-bandage", "assets/items/field-bandage.png"],
  ["minor-healing-potion", "assets/items/minor-healing-potion.png"],
  ["invigorating-tonic", "assets/items/invigorating-tonic.png"]
]);

/** Published illustrations take precedence over bundled art for these starter consumables. */
export function resolveItemIconUrl(item: Pick<InventoryItem, "itemId" | "iconUrl">): string | undefined {
  if (item.iconUrl) return item.iconUrl;
  const path = BUNDLED_ITEM_ICON_PATHS.get(item.itemId);
  return path ? `${import.meta.env.BASE_URL}${path}` : undefined;
}
