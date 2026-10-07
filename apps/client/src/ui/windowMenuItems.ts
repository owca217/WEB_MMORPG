export const WORLD_WINDOW_MENU_ITEMS = [
  { key: "inventory", label: "Ekwipunek" },
  { key: "character", label: "Postać" },
  { key: "statistics", label: "Statystyki" },
  { key: "professions", label: "Profesje" },
  { key: "party", label: "Drużyna" },
  { key: "logout", label: "Wyloguj" }
] as const;

export type WorldWindowMenuKey = (typeof WORLD_WINDOW_MENU_ITEMS)[number]["key"];

export function worldWindowMenuItem(key: WorldWindowMenuKey) {
  const item = WORLD_WINDOW_MENU_ITEMS.find((candidate) => candidate.key === key);
  if (!item) throw new Error(`Unknown world menu item: ${key}`);
  return item;
}
