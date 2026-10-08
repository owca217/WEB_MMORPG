export const WORLD_WINDOW_MENU_ITEMS = [
  { key: "inventory", label: "Ekwipunek" },
  { key: "character", label: "Postać" },
  { key: "statistics", label: "Statystyki" },
  { key: "professions", label: "Profesje" },
  { key: "party", label: "Drużyna" },
  { key: "logout", label: "Wyloguj" }
] as const;

export const ADMIN_WORLD_WINDOW_MENU_ITEM = {
  key: "admin",
  label: "Panel admin"
} as const;

export type WorldWindowMenuKey =
  | (typeof WORLD_WINDOW_MENU_ITEMS)[number]["key"]
  | typeof ADMIN_WORLD_WINDOW_MENU_ITEM.key;

export function worldWindowMenuItems(isAdmin: boolean): readonly {
  key: WorldWindowMenuKey;
  label: string;
}[] {
  return isAdmin
    ? [...WORLD_WINDOW_MENU_ITEMS, ADMIN_WORLD_WINDOW_MENU_ITEM]
    : WORLD_WINDOW_MENU_ITEMS;
}

export function worldWindowMenuItem(key: WorldWindowMenuKey) {
  const item = [...WORLD_WINDOW_MENU_ITEMS, ADMIN_WORLD_WINDOW_MENU_ITEM]
    .find((candidate) => candidate.key === key);
  if (!item) throw new Error(`Unknown world menu item: ${key}`);
  return item;
}
