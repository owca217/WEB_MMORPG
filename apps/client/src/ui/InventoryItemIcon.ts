import { PERMANENT_BACKPACK_ICON_PATH, type InventoryItem } from "@web-mmorpg/shared";

// Used when a catalog item has no illustration yet, or its image cannot load.
const GLYPHS: Record<string, string> = {
  sword: '<path d="m10 24 14-14 3-5-5 3L8 22m-2-2 6 6m-7 1 3-3"/>',
  dagger: '<path d="m12 21 9-13 4-3-2 5-9 13m-5-4 8 6m-9 3 4-6"/>',
  axe: '<path d="m9 28 10-22m-4 4c5 2 7 4 10 8l3-8-7-6-4 6"/>',
  hammer: '<path d="m10 28 9-17m-6-6 11 5-3 7-11-5z"/>',
  spear: '<path d="m7 29 14-22m-3 1 7-5-1 9z"/>',
  bow: '<path d="M10 4c17 8 17 16 0 24l7-12zM6 16h22m-4-3 4 3-4 3"/>',
  crossbow: '<path d="m11 27 10-22M7 11c9-5 15-2 18 7L7 11zm1 10 10 5m1-19 5-3"/>',
  staff: '<path d="m11 29 6-19m-3-5 5-3 5 5-3 6-5-1-3-4zM18 5v5m-2-3h5"/>',
  shield: '<path d="m16 3 11 4-2 13-9 9-9-9L5 7zM16 7v17M9 11h14"/>',
  helmet: '<path d="M6 22V14a10 10 0 0 1 20 0v8l-7 5v-9h-6v9zM16 4v10M7 14h18"/>',
  chest: '<path d="m11 4 5 4 5-4 7 6-4 7-3-2v14H11V15l-3 2-4-7zM11 12h10M16 9v19"/>',
  gloves: '<path d="M9 28 5 18V9a2 2 0 0 1 4 0v7-10a2 2 0 0 1 4 0v10-12a2 2 0 0 1 4 0v12-9a2 2 0 0 1 4 0v12l3-4 3 2-5 11z"/>',
  pants: '<path d="M8 4h16l2 24h-8l-2-13-2 13H6zM8 9h16M16 4v7"/>',
  boots: '<path d="M8 4h13l-2 15 8 4v5H6v-8zM8 10h12M7 25h19"/>',
  cloak: '<path d="M11 7a5 5 0 0 1 10 0l7 21H4zM11 7l5 6 5-6M16 13v14"/>',
  container: '<path d="M11 8V6a5 5 0 0 1 10 0v2M7 15H4v10h3m18-10h3v10h-3"/><rect x="7" y="8" width="18" height="22" rx="5"/><path d="M8 14h16M13 14v4m6-4v4"/><rect x="11" y="21" width="10" height="6" rx="2"/>',
  bandage: '<path d="m6 15 9-9a4 4 0 0 1 6 0l5 5a4 4 0 0 1 0 6l-9 9a4 4 0 0 1-6 0l-5-5a4 4 0 0 1 0-6zM11 11l10 10M8 17l7 7m2-16 7 7"/><path d="M14 16h4m-2-2v4"/>',
  consumable: '<path d="M12 3h8v5l5 8a9 9 0 0 1-2 12H9a9 9 0 0 1-2-12l5-8zM11 9h10M8 19h16M14 23h4m-2-2v4"/>',
  material: '<path d="m11 4 5 3 5-3 2 6 6 2-4 6 2 7-7-1-4 5-4-5-7 1 2-7-4-6 6-2zM12 10l4 3 4-3m-8 10 4 2 4-2"/>',
  other: '<path d="m16 4 12 7v14l-12 5L4 25V11zM4 11l12 6 12-6M16 17v13M10 7l12 7"/>'
};

function fallbackKind(item: InventoryItem): string {
  if (item.equipment) return item.equipment.weaponFamily ?? item.equipment.slot;
  if (item.containerCapacity !== undefined || item.category === "container" || item.category === "backpack") return "container";
  if (item.itemId.includes("bandage")) return "bandage";
  if (item.consumableEffects || item.category === "medical" || item.category === "consumable") return "consumable";
  return item.category === "material" ? "material" : "other";
}

/** An illustration only; the containing slot or details view supplies its label and quality frame. */
export function inventoryItemIcon(item: InventoryItem): HTMLSpanElement {
  const root = document.createElement("span");
  root.className = "inventory-item-icon";
  root.setAttribute("aria-hidden", "true");
  const showFallback = (): void => {
    const glyph = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    glyph.setAttribute("viewBox", "0 0 32 32");
    glyph.setAttribute("fill", "#b5a27a22");
    glyph.setAttribute("stroke", "currentColor");
    glyph.setAttribute("stroke-width", "1.6");
    glyph.setAttribute("stroke-linecap", "round");
    glyph.setAttribute("stroke-linejoin", "round");
    glyph.setAttribute("focusable", "false");
    glyph.innerHTML = GLYPHS[fallbackKind(item)] ?? GLYPHS.other!;
    root.replaceChildren(glyph);
  };
  showFallback();
  const url = item.permanentContainer ? `${import.meta.env.BASE_URL}${PERMANENT_BACKPACK_ICON_PATH}` : item.iconUrl;
  if (url) {
    const image = document.createElement("img");
    image.alt = "";
    image.src = url;
    image.addEventListener("error", showFallback, { once: true });
    root.replaceChildren(image);
  }
  return root;
}
