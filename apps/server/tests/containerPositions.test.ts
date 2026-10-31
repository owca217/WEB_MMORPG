import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { EquipmentService } from "../src/equipment/EquipmentService";
import { InventoryService } from "../src/inventory/InventoryService";
import { seedItemMetadata } from "../src/items/seedItemMetadata";

const url = process.env.DATABASE_URL;
const target = url ? new URL(url) : undefined;
const isolated = target && ["localhost", "127.0.0.1"].includes(target.hostname) && ["/web_mmorpg_test", "/web_mmorpg_slot_order_tests"].includes(target.pathname);
const describeDb = isolated ? describe : describe.skip;
describeDb("persistent container positions", () => {
  const pool = createPool(url ?? "postgresql://unused/unused"), inventory = new InventoryService(pool);
  let owner: string, other: string, backpack: string;
  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool); await seedItemMetadata(pool);
    const characters: string[] = [];
    for (const name of ["CellOwner", "CellOther"]) {
      const account = randomUUID(), id = randomUUID();
      await pool.query("INSERT INTO accounts(id,username,username_normalized,password_hash,recovery_code_hash) VALUES($1,$2,$2,'hash','hash')", [account, name]);
      await pool.query("INSERT INTO characters(id,account_id,nickname,nickname_normalized) VALUES($1,$2,$3,$3)", [id, account, name]);
      characters.push(id);
    }
    [owner, other] = [characters[0]!, characters[1]!];
    await inventory.ensurePermanentBackpack(owner);
    backpack = (await inventory.getSnapshot(owner)).containerSlots![0]!;
  });
  afterAll(() => pool.end());
  const give = async (id = "training-dagger", quantity = 1, character = owner) => (await inventory.addItems(character, [{ itemId: id, quantity }])).items.filter(item => item.itemId === id);
  const positions = async () => (await inventory.getSnapshot(owner)).items.filter(item => item.containerInstanceId === backpack);

  it("moves to a hole, swaps occupied cells and makes repeated requests idempotent across reloads", async () => {
    const initial = await give("training-dagger", 3), [a, b, c] = initial;
    expect(initial.map(item => item.containerPosition).sort()).toEqual([0, 1, 2]);
    const oldB = b!.containerPosition!;
    await inventory.moveItemToContainer(owner, a!.instanceId, backpack, 10);
    expect((await positions()).find(item => item.instanceId === c!.instanceId)?.containerPosition).toBe(c!.containerPosition);
    await inventory.moveItemToContainer(owner, b!.instanceId, backpack, 10);
    await inventory.moveItemToContainer(owner, b!.instanceId, backpack, 10);
    const persisted = (await new InventoryService(pool).getSnapshot(owner)).items;
    expect(persisted.find(item => item.instanceId === b!.instanceId)?.containerPosition).toBe(10);
    expect(persisted.find(item => item.instanceId === a!.instanceId)?.containerPosition).toBe(oldB);
    expect(persisted.filter(item => item.itemId === "training-dagger").map(item => item.instanceId)).toEqual(initial.map(item => item.instanceId));
  });
  it("keeps old-client same-bag moves unchanged and allocates the first free cross-bag cell", async () => {
    const bag = (await give("rag-bag"))[0]!; await inventory.setContainerSlot(owner, 1, bag.instanceId);
    const [a, b] = await give("training-dagger", 2);
    await inventory.moveItemToContainer(owner, a!.instanceId, bag.instanceId, 5);
    await inventory.moveItemToContainer(owner, a!.instanceId, bag.instanceId);
    const moved = await inventory.moveItemToContainer(owner, b!.instanceId, bag.instanceId);
    expect(moved.items.find(item => item.instanceId === a!.instanceId)?.containerPosition).toBe(5);
    expect(moved.items.find(item => item.instanceId === b!.instanceId)?.containerPosition).toBe(0);
    await expect(inventory.moveItemToContainer(owner, a!.instanceId, backpack, -1)).rejects.toThrow("INVALID_CONTAINER_POSITION");
    for (const invalid of [1.5, NaN, Infinity, 16]) await expect(inventory.moveItemToContainer(owner, b!.instanceId, backpack, invalid)).rejects.toThrow("INVALID_CONTAINER_POSITION");
    await expect(inventory.moveItemToContainer(owner, b!.instanceId, null, 0)).rejects.toThrow("INVALID_CONTAINER_POSITION");
  });
  it("rejects occupied cross-bag cells, unassigned bags and foreign or inaccessible sources", async () => {
    const bag = (await give("rag-bag"))[0]!; await inventory.setContainerSlot(owner, 1, bag.instanceId);
    const [a, b] = await give("training-dagger", 2); await inventory.moveItemToContainer(owner, a!.instanceId, bag.instanceId, 0);
    await expect(inventory.moveItemToContainer(owner, b!.instanceId, bag.instanceId, 0)).rejects.toThrow("CONTAINER_POSITION_OCCUPIED");
    const foreign = (await give("training-dagger", 1, other))[0]!;
    await expect(inventory.moveItemToContainer(owner, foreign.instanceId, backpack, 3)).rejects.toThrow("INVENTORY_ITEM_NOT_OWNED");
    await inventory.setContainerSlot(owner, 1, null);
    await expect(inventory.moveItemToContainer(owner, a!.instanceId, backpack, 3)).rejects.toThrow("CONTAINER_ITEM_STORED");
    await expect(inventory.moveItemToContainer(owner, b!.instanceId, bag.instanceId, 3)).rejects.toThrow("CONTAINER_NOT_ASSIGNED");
  });
  it("serializes competing same-bag swaps without losing or duplicating positions", async () => {
    const [a, b] = await give("training-dagger", 2);
    await Promise.all([inventory.moveItemToContainer(owner, a!.instanceId, backpack, 9), inventory.moveItemToContainer(owner, b!.instanceId, backpack, 9)]);
    const rows = await positions(); expect(rows).toHaveLength(2); expect(new Set(rows.map(item => item.containerPosition)).size).toBe(2);
    expect(rows.some(item => item.containerPosition === 9)).toBe(true);
  });
  it("fills holes after rewards and unequip, clears equipped positions and leaves other cells untouched", async () => {
    const [a, b] = await give("training-dagger", 2); await inventory.moveItemToContainer(owner, a!.instanceId, backpack, 9);
    const next = (await give("training-sword"))[0]!; expect(next.containerPosition).toBe(0);
    const equipment = new EquipmentService(pool, inventory); const equipped = await equipment.setSlot(owner, { slot: "mainHand", itemInstanceId: next.instanceId });
    expect(equipped.items.find(item => item.instanceId === next.instanceId)).not.toHaveProperty("containerPosition");
    await equipment.setSlot(owner, { slot: "mainHand", itemInstanceId: null });
    const final = await positions(); expect(final.find(item => item.instanceId === next.instanceId)?.containerPosition).toBe(0);
    expect(final.find(item => item.instanceId === a!.instanceId)?.containerPosition).toBe(9);
    expect(final.find(item => item.instanceId === b!.instanceId)?.containerPosition).toBe(b!.containerPosition);
  });
  it("rolls back a stale-session move before commit", async () => {
    const [item] = await give();
    await expect(inventory.moveItemToContainer(owner, item!.instanceId, backpack, 9, () => { throw new Error("SESSION_REPLACED"); })).rejects.toThrow("SESSION_REPLACED");
    expect((await positions())[0]?.containerPosition).toBe(item!.containerPosition);
  });
  it("backfills existing contained rows stably and reruns without changing positions or item data", async () => {
    await give("training-dagger", 3);
    const original = (await pool.query("SELECT id,quality,quantity FROM item_instances WHERE container_instance_id=$1 ORDER BY created_at,id", [backpack])).rows;
    await pool.query("ALTER TABLE item_instances DROP COLUMN container_position CASCADE");
    await pool.query("DELETE FROM schema_migrations WHERE migration_name='014_container_positions'");
    await runMigrations(pool); await runMigrations(pool);
    expect((await pool.query("SELECT id,quality,quantity,container_position FROM item_instances WHERE container_instance_id=$1 ORDER BY created_at,id", [backpack])).rows).toEqual(original.map((row, index) => ({ ...row, container_position: index })));
    const [row] = await positions();
    await expect(pool.query("UPDATE item_instances SET container_position=-1 WHERE id=$1", [row!.instanceId])).rejects.toThrow();
    await expect(pool.query("UPDATE item_instances SET container_instance_id=NULL WHERE id=$1", [row!.instanceId])).rejects.toThrow();
    await expect(pool.query("UPDATE item_instances SET container_position=0 WHERE id<>$1 AND container_instance_id=$2", [row!.instanceId, backpack])).rejects.toThrow();
  });
});
