import type { EquipmentSnapshot, InventoryItem, InventorySnapshot } from "@web-mmorpg/shared";

export const EQUIPMENT_SLOTS = [
  { id: "head", label: "Głowa", group: "armor", description: "Hełmy, czapki, maski i opaski." },
  { id: "shoulders", label: "Ramiona", group: "armor", description: "Naramienniki." },
  { id: "chest", label: "Klatka piersiowa", group: "armor", description: "Zbroje, tuniki, szaty i napierśniki." },
  { id: "hands", label: "Dłonie", group: "armor", description: "Rękawice i rękawice bojowe." },
  { id: "legs", label: "Nogi", group: "armor", description: "Spodnie, nogawice i spódnice magów." },
  { id: "feet", label: "Stopy", group: "armor", description: "Buty i kozaki." },
  { id: "neck", label: "Szyja", group: "accessories", description: "Naszyjniki, amulety i talizmany." },
  { id: "ring1", label: "Pierścień I", group: "accessories", description: "Pierwsze miejsce na pierścień lub sygnet." },
  { id: "ring2", label: "Pierścień II", group: "accessories", description: "Drugie miejsce na pierścień lub sygnet." },
  { id: "back", label: "Plecy", group: "accessories", description: "Peleryny, płaszcze i plecaki." },
  { id: "wrists", label: "Nadgarstki", group: "accessories", description: "Karwasze i bransolety." },
  { id: "waist", label: "Talia", group: "accessories", description: "Pasy i paski." },
  { id: "ears", label: "Uszy", group: "accessories", description: "Kolczyki." },
  { id: "mainHand", label: "Główna ręka", group: "weapons", description: "Broń jednoręczna lub dwuręczna: miecz, sztylet, różdżka i inne." },
  { id: "offHand", label: "Druga ręka", group: "weapons", description: "Tarcza, druga broń lub przedmiot magiczny, np. księga albo totem." }
] as const;

export type EquipmentSlotId = typeof EQUIPMENT_SLOTS[number]["id"];
export type EquipmentSlotView = typeof EQUIPMENT_SLOTS[number] & {
  itemInstanceId: string | null;
  item: InventoryItem | null;
};

// Persisted slot names are strings. Accept common spellings without rewriting saved equipment.
const ALIASES: Record<string, EquipmentSlotId> = {
  helmet: "head", torso: "chest", body: "chest", gloves: "hands", pants: "legs", boots: "feet",
  necklace: "neck", amulet: "neck", leftring: "ring1", rightring: "ring2", cloak: "back", cape: "back",
  bracers: "wrists", belt: "waist", earrings: "ears", weapon: "mainHand", shield: "offHand"
};
const normalize = (value: string) => value.toLowerCase().replace(/[\s_-]/g, "");

export function equipmentSlotsFor(equipment: EquipmentSnapshot, inventory: InventorySnapshot): EquipmentSlotView[] {
  const items = new Map(inventory.items.map(item => [item.instanceId, item]));
  const entries = new Map(equipment.items.map(entry => {
    const name = normalize(entry.slot);
    return [normalize(ALIASES[name] ?? name), entry.itemInstanceId];
  }));
  return EQUIPMENT_SLOTS.map(slot => {
    const itemInstanceId = entries.get(normalize(slot.id)) ?? null;
    return { ...slot, itemInstanceId, item: itemInstanceId ? items.get(itemInstanceId) ?? null : null };
  });
}
