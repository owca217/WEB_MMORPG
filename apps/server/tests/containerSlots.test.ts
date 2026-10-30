import { randomUUID } from "node:crypto";
import type { ItemDefinition, ItemDraftInput } from "@web-mmorpg/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { InventoryService } from "../src/inventory/InventoryService";
import { ItemCatalogService } from "../src/items/ItemCatalogService";
import { ItemMetadataRepository } from "../src/items/ItemMetadataRepository";
import { seedItemMetadata } from "../src/items/seedItemMetadata";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const characterId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherCharacterId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const actor = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function asDraft(item: ItemDefinition, overrides: Partial<ItemDraftInput> = {}): ItemDraftInput {
  const { status: _status, activeVersionNo: _active, ...input } = item;
  return { ...input, ...overrides };
}

describeDatabase("persistent container slots", () => {
  const pool = createPool(databaseUrl);
  const inventory = new InventoryService(pool);
  const catalog = new ItemCatalogService(pool, new ItemMetadataRepository(pool));
  let backpack: string;

  beforeAll(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
    for (const [index, id] of [characterId, otherCharacterId].entries()) {
      const accountId = randomUUID();
      await pool.query(
        `INSERT INTO accounts (id, username, username_normalized, password_hash, recovery_code_hash)
         VALUES ($1, $2, $2, 'hash', 'recovery')`,
        [accountId, `slot-owner-${index}`]
      );
      await pool.query(
        `INSERT INTO characters (id, account_id, nickname, nickname_normalized)
         VALUES ($1, $2, $3, $3)`,
        [id, accountId, `SlotHero${index}`]
      );
    }
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE item_instances, items, admin_audit_log CASCADE");
    await seedItemMetadata(pool);
    backpack = (await inventory.getSnapshot(characterId)).items.find(item => item.permanentContainer)!.instanceId;
    const source = (await catalog.getItem("wolf-pelt")).item;
    const draft = asDraft(source, {
      itemId: "slot-container",
      name: "Pojemnik testowy",
      categoryId: "container",
      stackable: false,
      maxStack: 1,
      specialData: {}
    });
    delete draft.subcategoryId;
    await catalog.createDraft(draft, actor);
    await catalog.publish("slot-container", 1, actor);
  });

  afterAll(async () => pool.end());

  async function addContainers(quantity = 1, owner = characterId): Promise<string[]> {
    const snapshot = await inventory.addItems(owner, [{ itemId: "slot-container", quantity }]);
    return snapshot.items.filter((item) => item.itemId === "slot-container").map((item) => item.instanceId);
  }

  it("exposes the permanent backpack and three empty slots without hiding ordinary owned items", async () => {
    const snapshot = await inventory.addItems(characterId, [{ itemId: "wolf-pelt", quantity: 2 }]);
    expect(snapshot.containerSlots).toEqual([backpack, null, null, null]);
    expect(snapshot.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ instanceId: backpack, permanentContainer: true, containerCapacity: 16 }),
      expect.objectContaining({ itemId: "wolf-pelt", quantity: 2 })
    ]));
    expect(snapshot.items).toHaveLength(2);
  });

  it("persists assignments, replaces a slot, moves an instance, and clears it", async () => {
    const [first, second] = await addContainers(2);
    expect((await inventory.setContainerSlot(characterId, 1, first!)).containerSlots)
      .toEqual([backpack, first, null, null]);
    expect((await new InventoryService(pool).getSnapshot(characterId)).containerSlots)
      .toEqual([backpack, first, null, null]);
    expect((await inventory.setContainerSlot(characterId, 1, second!)).containerSlots)
      .toEqual([backpack, second, null, null]);
    expect((await inventory.setContainerSlot(characterId, 3, second!)).containerSlots)
      .toEqual([backpack, null, null, second]);
    const cleared = await inventory.setContainerSlot(characterId, 3, null);
    expect(cleared.containerSlots).toEqual([backpack, null, null, null]);
    expect(cleared.items).toHaveLength(3);
  });

  it("rejects foreign, non-container, nested, and missing instances before replacing an occupant", async () => {
    const [original, nested] = await addContainers(2);
    const [foreign] = await addContainers(1, otherCharacterId);
    const ordinary = await inventory.addItems(characterId, [{ itemId: "wolf-pelt", quantity: 1 }]);
    const pelt = ordinary.items.find((item) => item.itemId === "wolf-pelt")!;
    await pool.query("UPDATE item_instances SET container_instance_id = $2 WHERE id = $1", [nested, original]);
    expect((await inventory.getSnapshot(characterId)).items.find((item) => item.instanceId === nested))
      .toMatchObject({ containerInstanceId: original });
    await inventory.setContainerSlot(characterId, 1, original!);
    for (const [id, error] of [
      [foreign!, "CONTAINER_ITEM_NOT_OWNED"],
      [pelt.instanceId, "ITEM_NOT_CONTAINER"],
      [nested!, "CONTAINER_ITEM_STORED"],
      [randomUUID(), "CONTAINER_ITEM_NOT_OWNED"]
    ]) {
      await expect(inventory.setContainerSlot(characterId, 1, id!)).rejects.toThrow(error);
      expect((await inventory.getSnapshot(characterId)).containerSlots).toEqual([backpack, original, null, null]);
    }
  });

  it("validates slot numbers and instance IDs without losing the existing assignment", async () => {
    const [instance] = await addContainers();
    await inventory.setContainerSlot(characterId, 1, instance!);
    for (const slot of [-1, 4, 0.5, Number.NaN, "0", null]) {
      await expect(inventory.setContainerSlot(characterId, slot as number, instance!))
        .rejects.toThrow("INVALID_CONTAINER_SLOT");
    }
    for (const id of ["", "not-a-uuid", 7, undefined]) {
      await expect(inventory.setContainerSlot(characterId, 1, id as string))
        .rejects.toThrow("INVALID_CONTAINER_INSTANCE_ID");
    }
    expect((await inventory.getSnapshot(characterId)).containerSlots).toEqual([backpack, instance, null, null]);
  });

  it("serializes concurrent moves so one instance occupies exactly one slot", async () => {
    const [instance] = await addContainers();
    await Promise.all([
      inventory.setContainerSlot(characterId, 1, instance!),
      inventory.setContainerSlot(characterId, 2, instance!)
    ]);
    const slots = (await inventory.getSnapshot(characterId)).containerSlots!;
    expect(slots.filter((id) => id === instance)).toHaveLength(1);
    expect([slots[1], slots[2]]).toContain(instance);
    expect(slots[0]).toBe(backpack);
  });

  it("serializes competing replacements instead of failing either concurrent request", async () => {
    const [first, second] = await addContainers(2);
    await Promise.all([
      inventory.setContainerSlot(characterId, 1, first!),
      inventory.setContainerSlot(characterId, 1, second!)
    ]);
    const snapshot = await inventory.getSnapshot(characterId);
    expect([first, second]).toContain(snapshot.containerSlots![1]);
    expect(snapshot.containerSlots!.filter((id) => id !== null)).toHaveLength(2);
    expect(snapshot.containerSlots![0]).toBe(backpack);
    expect(snapshot.items).toHaveLength(3);
  });

  it("keeps a stack as one assigned instance when later rewards grow its quantity", async () => {
    const source = (await catalog.getItem("slot-container")).item;
    await catalog.updateDraft("slot-container", asDraft(source, { stackable: true, maxStack: 20 }), 1, actor);
    await catalog.publish("slot-container", 1, actor);
    const [instance] = await addContainers(3);
    await inventory.setContainerSlot(characterId, 2, instance!);
    const snapshot = await inventory.addItems(characterId, [{ itemId: "slot-container", quantity: 2 }]);
    expect(snapshot.containerSlots).toEqual([backpack, null, instance, null]);
    expect(snapshot.items).toEqual(expect.arrayContaining([expect.objectContaining({ instanceId: instance, quantity: 5 })]));
    expect(snapshot.items).toHaveLength(2);
  });

  it("revalidates the current published category without discarding the owned instance", async () => {
    const [instance] = await addContainers();
    await inventory.setContainerSlot(characterId, 1, instance!);
    const source = (await catalog.getItem("slot-container")).item;
    await catalog.updateDraft("slot-container", asDraft(source, { categoryId: "backpack" }), 1, actor);
    await catalog.publish("slot-container", 1, actor);
    const snapshot = await inventory.getSnapshot(characterId);
    expect(snapshot.containerSlots).toEqual([backpack, null, null, null]);
    expect(snapshot.items).toEqual(expect.arrayContaining([expect.objectContaining({ instanceId: instance, category: "backpack" })]));
    expect(snapshot.items).toHaveLength(2);
    await expect(inventory.setContainerSlot(characterId, 1, instance!)).rejects.toThrow("ITEM_NOT_CONTAINER");
  });

  it("preserves an archived owned container's assignment and allows moving it", async () => {
    const [instance] = await addContainers();
    await inventory.setContainerSlot(characterId, 1, instance!);
    await catalog.archive("slot-container", actor);
    const snapshot = await inventory.getSnapshot(characterId);
    expect(snapshot.containerSlots).toEqual([backpack, instance, null, null]);
    expect(snapshot.items).toEqual(expect.arrayContaining([expect.objectContaining({ instanceId: instance, category: "container" })]));
    expect(snapshot.items).toHaveLength(2);
    expect((await inventory.setContainerSlot(characterId, 2, instance!)).containerSlots)
      .toEqual([backpack, null, instance, null]);
  });

  it("never treats legacy player ownership as a persistent character slot", async () => {
    const [instance] = await addContainers();
    await inventory.setContainerSlot(characterId, 1, instance!);
    expect((await inventory.getLegacySessionSnapshot(characterId)).containerSlots).toEqual([null, null, null, null]);
    await expect(inventory.setContainerSlot(randomUUID(), 1, instance!)).rejects.toThrow("CHARACTER_NOT_FOUND");
  });

  it("enforces slot bounds, ownership, parent exclusion, and occupied-slot uniqueness in the database", async () => {
    const [first, second] = await addContainers(2);
    await inventory.setContainerSlot(characterId, 1, first!);
    await expect(pool.query("UPDATE item_instances SET container_slot = 1 WHERE id = $1", [second]))
      .rejects.toMatchObject({ code: "23505" });
    await expect(pool.query("UPDATE item_instances SET container_slot = 4 WHERE id = $1", [second]))
      .rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("UPDATE item_instances SET character_id = NULL WHERE id = $1", [first]))
      .rejects.toMatchObject({ code: "23514" });
    await expect(pool.query("UPDATE item_instances SET container_instance_id = $2 WHERE id = $1", [first, second]))
      .rejects.toMatchObject({ code: "23514" });
  });
});
