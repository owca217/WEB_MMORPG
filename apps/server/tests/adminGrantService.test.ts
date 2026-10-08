import { randomUUID } from "node:crypto";
import type {
  EquipmentSnapshot,
  InventorySnapshot
} from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import {
  AdminGrantError,
  AdminGrantService,
  type AdminGrantPersistence,
  type AdminGrantPersistenceInput
} from "../src/admin/AdminGrantService";

function makePersistence(
  result: "applied" | "alreadyApplied" = "applied"
): { persistence: AdminGrantPersistence; calls: AdminGrantPersistenceInput[] } {
  const calls: AdminGrantPersistenceInput[] = [];
  return {
    calls,
    persistence: {
      async applyAdminGrant(input) {
        calls.push(input);
        return {
          status: result,
          inventory: input.inventory,
          equipment: input.equipment
        };
      }
    }
  };
}

function startingState(): {
  inventory: InventorySnapshot;
  equipment: EquipmentSnapshot;
} {
  return {
    inventory: {
      items: [
        {
          instanceId: "bag-equipped",
          itemId: "simple-bag",
          name: "Zwykły worek",
          quantity: 1,
          category: "bag",
          description: "Prosty worek.",
          containerCapacity: 8
        },
        {
          instanceId: "nested-bandage",
          itemId: "field-bandage",
          name: "Field Bandage",
          quantity: 2,
          category: "medical",
          description: "A simple bandage for field treatment.",
          containerInstanceId: "bag-equipped"
        },
        {
          instanceId: "general-bandage",
          itemId: "field-bandage",
          name: "Field Bandage",
          quantity: 4,
          category: "medical",
          description: "A simple bandage for field treatment."
        }
      ]
    },
    equipment: {
      items: [{ slot: "bag-1", itemInstanceId: "bag-equipped" }]
    }
  };
}

describe("AdminGrantService", () => {
  it("merges stackable items into general inventory without touching bag contents", async () => {
    const { persistence, calls } = makePersistence();
    const service = new AdminGrantService(persistence);
    const state = startingState();

    const result = await service.grant({
      operationId: "grant-merge",
      accountId: "account-1",
      characterId: "character-1",
      itemId: "field-bandage",
      quantity: 3,
      inventory: state.inventory,
      equipment: state.equipment
    });

    expect(result.status).toBe("applied");
    expect(result.inventory.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          instanceId: "general-bandage",
          itemId: "field-bandage",
          quantity: 7
        }),
        expect.objectContaining({
          instanceId: "nested-bandage",
          containerInstanceId: "bag-equipped",
          quantity: 2
        })
      ])
    );
    expect(result.equipment).toEqual(state.equipment);
    expect(state.inventory.items.find((item) => item.instanceId === "general-bandage")?.quantity)
      .toBe(4);
    expect(calls[0]?.inventory).not.toBe(state.inventory);
  });

  it("creates separate one-item bag instances and preserves equipped bags", async () => {
    const { persistence } = makePersistence();
    const service = new AdminGrantService(persistence);
    const state = startingState();

    const result = await service.grant({
      operationId: randomUUID(),
      accountId: "account-1",
      characterId: "character-1",
      itemId: "travel-backpack",
      quantity: 2,
      inventory: state.inventory,
      equipment: state.equipment
    });

    const bags = result.inventory.items.filter(
      (item) => item.itemId === "travel-backpack"
    );
    expect(bags).toHaveLength(2);
    expect(new Set(bags.map((item) => item.instanceId)).size).toBe(2);
    expect(bags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "bag",
          quantity: 1,
          containerCapacity: 40
        }),
        expect.objectContaining({
          category: "bag",
          quantity: 1,
          containerCapacity: 40
        })
      ])
    );
    expect(result.equipment).toEqual(state.equipment);
  });

  it.each([
    ["unknown-item", 1],
    ["field-bandage", 0],
    ["field-bandage", -1],
    ["field-bandage", 1.5],
    ["field-bandage", 1001],
    ["field-bandage", Number.NaN]
  ])("rejects invalid grant %s x %s", async (itemId, quantity) => {
    const { persistence, calls } = makePersistence();
    const service = new AdminGrantService(persistence);

    await expect(
      service.grant({
        operationId: "invalid-grant",
        accountId: "account-1",
        characterId: "character-1",
        itemId,
        quantity,
        inventory: { items: [] },
        equipment: { items: [] }
      })
    ).rejects.toBeInstanceOf(AdminGrantError);
    expect(calls).toHaveLength(0);
  });

  it("returns the durable result supplied by persistence for a replay", async () => {
    const { persistence } = makePersistence("alreadyApplied");
    const service = new AdminGrantService(persistence);

    await expect(
      service.grant({
        operationId: "replayed-grant",
        accountId: "account-1",
        characterId: "character-1",
        itemId: "wolf-pelt",
        quantity: 1,
        inventory: { items: [] },
        equipment: { items: [] }
      })
    ).resolves.toMatchObject({ status: "alreadyApplied" });
  });
});
