import {
  BAG_DEFINITIONS,
  type ItemCategory
} from "./inventory";

export interface AdminItemDefinition {
  itemId: string;
  name: string;
  category: ItemCategory;
  description: string;
  containerCapacity?: number;
}

export type AdminItemCatalog = {
  items: readonly AdminItemDefinition[];
};

export const ITEM_DEFINITIONS = [
  {
    itemId: "simple-bag",
    name: BAG_DEFINITIONS["simple-bag"].name,
    category: "bag",
    description: BAG_DEFINITIONS["simple-bag"].description,
    containerCapacity: BAG_DEFINITIONS["simple-bag"].capacity
  },
  {
    itemId: "traditional-backpack",
    name: BAG_DEFINITIONS["traditional-backpack"].name,
    category: "bag",
    description: BAG_DEFINITIONS["traditional-backpack"].description,
    containerCapacity: BAG_DEFINITIONS["traditional-backpack"].capacity
  },
  {
    itemId: "travel-backpack",
    name: BAG_DEFINITIONS["travel-backpack"].name,
    category: "bag",
    description: BAG_DEFINITIONS["travel-backpack"].description,
    containerCapacity: BAG_DEFINITIONS["travel-backpack"].capacity
  },
  {
    itemId: "expedition-backpack",
    name: BAG_DEFINITIONS["expedition-backpack"].name,
    category: "bag",
    description: BAG_DEFINITIONS["expedition-backpack"].description,
    containerCapacity: BAG_DEFINITIONS["expedition-backpack"].capacity
  },
  {
    itemId: "wolf-pelt",
    name: "Wolf Pelt",
    category: "material",
    description: "A rough pelt taken from a forest wolf."
  },
  {
    itemId: "field-bandage",
    name: "Field Bandage",
    category: "medical",
    description: "A simple bandage for field treatment."
  }
] as const satisfies readonly AdminItemDefinition[];

export function adminItemDefinition(itemId: string): AdminItemDefinition | null {
  return ITEM_DEFINITIONS.find((item) => item.itemId === itemId) ?? null;
}
