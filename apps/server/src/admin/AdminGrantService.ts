import { randomUUID } from "node:crypto";
import type {
  EquipmentSnapshot,
  InventoryItem,
  InventorySnapshot
} from "@web-mmorpg/shared";
import { adminItemDefinition } from "@web-mmorpg/shared";

export interface AdminGrantPersistenceInput {
  operationId: string;
  accountId: string;
  characterId: string;
  itemId: string;
  quantity: number;
  inventory: InventorySnapshot;
  equipment: EquipmentSnapshot;
}

export interface AdminGrantPersistenceResult {
  status: "applied" | "alreadyApplied";
  inventory: InventorySnapshot;
  equipment: EquipmentSnapshot;
}

export interface AdminGrantPersistence {
  applyAdminGrant(
    input: AdminGrantPersistenceInput
  ): Promise<AdminGrantPersistenceResult>;
}

export class AdminGrantError extends Error {
  constructor(
    public readonly code:
      | "ADMIN_INVALID_ITEM"
      | "ADMIN_INVALID_QUANTITY"
      | "ADMIN_INVALID_OPERATION",
    message: string
  ) {
    super(message);
  }
}

function cloneEquipment(equipment: EquipmentSnapshot): EquipmentSnapshot {
  return { items: equipment.items.map((entry) => ({ ...entry })) };
}

function cloneInventory(inventory: InventorySnapshot): InventorySnapshot {
  return { items: inventory.items.map((item) => ({ ...item })) };
}

function addCatalogItem(
  inventory: InventorySnapshot,
  itemId: string,
  quantity: number
): InventorySnapshot {
  const definition = adminItemDefinition(itemId);
  if (!definition) {
    throw new AdminGrantError(
      "ADMIN_INVALID_ITEM",
      "The selected item is not available in the admin catalog."
    );
  }

  const items = inventory.items.map((item) => ({ ...item }));
  if (definition.category === "bag") {
    for (let index = 0; index < quantity; index += 1) {
      const bag: InventoryItem = {
        instanceId: randomUUID(),
        itemId: definition.itemId,
        name: definition.name,
        quantity: 1,
        category: definition.category,
        description: definition.description,
        ...(definition.containerCapacity === undefined
          ? {}
          : { containerCapacity: definition.containerCapacity })
      };
      items.push(bag);
    }
    return { items };
  }

  const existingIndex = items.findIndex(
    (item) =>
      item.itemId === definition.itemId &&
      item.category === definition.category &&
      item.containerInstanceId === undefined
  );
  if (existingIndex >= 0) {
    const existing = items[existingIndex]!;
    items[existingIndex] = { ...existing, quantity: existing.quantity + quantity };
  } else {
    items.push({
      instanceId: randomUUID(),
      itemId: definition.itemId,
      name: definition.name,
      quantity,
      category: definition.category,
      description: definition.description
    });
  }

  return { items };
}

export class AdminGrantService {
  constructor(private readonly persistence: AdminGrantPersistence) {}

  async grant(input: AdminGrantPersistenceInput): Promise<AdminGrantPersistenceResult> {
    if (
      typeof input.operationId !== "string" ||
      input.operationId.trim().length === 0 ||
      input.operationId.length > 128
    ) {
      throw new AdminGrantError(
        "ADMIN_INVALID_OPERATION",
        "The operation identifier is invalid."
      );
    }
    if (
      typeof input.quantity !== "number" ||
      !Number.isInteger(input.quantity) ||
      input.quantity < 1 ||
      input.quantity > 1000
    ) {
      throw new AdminGrantError(
        "ADMIN_INVALID_QUANTITY",
        "Quantity must be an integer between 1 and 1000."
      );
    }
    if (!adminItemDefinition(input.itemId)) {
      throw new AdminGrantError(
        "ADMIN_INVALID_ITEM",
        "The selected item is not available in the admin catalog."
      );
    }

    return this.persistence.applyAdminGrant({
      ...input,
      inventory: addCatalogItem(input.inventory, input.itemId, input.quantity),
      equipment: cloneEquipment(input.equipment)
    });
  }
}

export { addCatalogItem, cloneEquipment, cloneInventory };
