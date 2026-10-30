import { randomUUID } from "node:crypto";
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

describeDatabase("container item storage", () => {
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
         VALUES ($1, $2, $2, 'hash', 'recovery')`, [accountId, `storage-owner-${index}`]
      );
      await pool.query(
        `INSERT INTO characters (id, account_id, nickname, nickname_normalized)
         VALUES ($1, $2, $3, $3)`, [id, accountId, `StorageHero${index}`]
      );
    }
  });

  beforeEach(async () => {
    await pool.query("TRUNCATE item_instances, items, admin_audit_log CASCADE");
    await seedItemMetadata(pool);
    backpack = (await inventory.getSnapshot(characterId)).items.find(item => item.permanentContainer)!.instanceId;
    const source = (await catalog.getItem("wolf-pelt")).item;
    await catalog.createDraft({
      ...source, itemId: "storage-token", name: "Znacznik", stackable: false, maxStack: 1
    }, actor);
    await catalog.publish("storage-token", 1, actor);
  });

  afterAll(async () => pool.end());

  async function add(itemId: string, quantity = 1, owner = characterId): Promise<string[]> {
    const snapshot = await inventory.addItems(owner, [{ itemId, quantity }]);
    return snapshot.items.filter((item) => item.itemId === itemId).map((item) => item.instanceId);
  }

  it("stores eight whole instances in the rag bag and rejects a ninth without losing its original parent", async () => {
    const [bag, otherBag] = await add("rag-bag", 2);
    const tokens = await add("storage-token", 9);
    for (const token of tokens.slice(0, 8)) {
      await inventory.moveItemToContainer(characterId, token!, bag!);
    }
    await inventory.moveItemToContainer(characterId, tokens[8]!, otherBag!);
    await expect(inventory.moveItemToContainer(characterId, tokens[8]!, bag!)).rejects.toThrow("CONTAINER_FULL");
    const snapshot = await inventory.getSnapshot(characterId);
    expect(snapshot.items.filter((item) => item.containerInstanceId === bag)).toHaveLength(8);
    expect(snapshot.items.find((item) => item.instanceId === tokens[8])?.containerInstanceId).toBe(otherBag);
    expect((await inventory.moveItemToContainer(characterId, tokens[0]!, bag!.toUpperCase())).items
      .filter((item) => item.containerInstanceId === bag)).toHaveLength(8);
  });

  it("moves whole stacks between bags and removes them to the top level", async () => {
    const [first, second] = await add("rag-bag", 2);
    const [stack] = await add("wolf-pelt", 99);
    await inventory.moveItemToContainer(characterId, stack!, first!);
    const moved = await inventory.moveItemToContainer(characterId, stack!, second!);
    expect(moved.items.find((item) => item.instanceId === stack))
      .toMatchObject({ quantity: 99, containerInstanceId: second });
    expect(moved.items.filter((item) => item.containerInstanceId === first)).toHaveLength(0);
    const removed = await inventory.moveItemToContainer(characterId, stack!, null);
    expect(removed.items.find((item) => item.instanceId === stack)).not.toHaveProperty("containerInstanceId");
    expect((await new InventoryService(pool).getSnapshot(characterId)).items
      .find((item) => item.instanceId === stack)).toMatchObject({ quantity: 99 });
  });

  it("rejects foreign items, foreign targets, invalid UUIDs, and non-container targets while preserving storage", async () => {
    const [bag] = await add("rag-bag");
    const [token] = await add("storage-token");
    const [foreignBag] = await add("rag-bag", 1, otherCharacterId);
    const [foreignToken] = await add("storage-token", 1, otherCharacterId);
    await inventory.moveItemToContainer(characterId, token!, bag!);
    for (const [source, target, code] of [
      [foreignToken!, bag!, "INVENTORY_ITEM_NOT_OWNED"],
      [token!, foreignBag!, "CONTAINER_ITEM_NOT_OWNED"],
      [token!, token!, "CONTAINER_CANNOT_STORE_SELF"],
      [bag!.toUpperCase(), bag!, "CONTAINER_CANNOT_STORE_SELF"],
      [bag!, token!, "ITEM_NOT_CONTAINER"],
      ["bad", bag!, "INVALID_ITEM_INSTANCE_ID"],
      [token!, "bad", "INVALID_CONTAINER_INSTANCE_ID"]
    ]) {
      await expect(inventory.moveItemToContainer(characterId, source!, target!)).rejects.toThrow(code);
    }
    expect((await inventory.getSnapshot(characterId)).items.find((item) => item.instanceId === token))
      .toMatchObject({ containerInstanceId: bag });
    const source = (await catalog.getItem("rag-bag")).item;
    await catalog.updateDraft("rag-bag", { ...source, specialData: {} }, 1, actor);
    await catalog.publish("rag-bag", 1, actor);
    await expect(inventory.moveItemToContainer(characterId, token!, bag!)).rejects.toThrow("CONTAINER_CAPACITY_INVALID");
  });

  it("allows empty unassigned containers but rejects equipped sources, nested targets, and nonempty sources", async () => {
    const [first, second, third] = await add("rag-bag", 3);
    const [token] = await add("storage-token");
    await inventory.setContainerSlot(characterId, 1, first!);
    await expect(inventory.moveItemToContainer(characterId, first!, second!)).rejects.toThrow("CONTAINER_ITEM_EQUIPPED");
    await inventory.moveItemToContainer(characterId, second!, first!);
    await expect(inventory.moveItemToContainer(characterId, token!, second!)).rejects.toThrow("CONTAINER_ITEM_STORED");
    await inventory.moveItemToContainer(characterId, second!, null);
    await inventory.moveItemToContainer(characterId, token!, second!);
    await expect(inventory.moveItemToContainer(characterId, second!, third!)).rejects.toThrow("CONTAINER_NOT_EMPTY");
    const snapshot = await inventory.getSnapshot(characterId);
    expect(snapshot.containerSlots).toEqual([backpack, first, null, null]);
    expect(snapshot.items.find((item) => item.instanceId === second)).not.toHaveProperty("containerInstanceId");
    expect(snapshot.items.find((item) => item.instanceId === token)).toMatchObject({ containerInstanceId: second });
  });

  it("counts a stack as one place and serializes competing moves into the last free place", async () => {
    const [bag] = await add("rag-bag");
    const [stack] = await add("wolf-pelt", 99);
    const tokens = await add("storage-token", 8);
    await inventory.moveItemToContainer(characterId, stack!, bag!);
    for (const token of tokens.slice(0, 6)) await inventory.moveItemToContainer(characterId, token!, bag!);
    const outcomes = await Promise.allSettled(tokens.slice(6).map((token) =>
      inventory.moveItemToContainer(characterId, token!, bag!)));
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ message: "CONTAINER_FULL" }) })
    ]);
    const children = (await inventory.getSnapshot(characterId)).items.filter((item) => item.containerInstanceId === bag);
    expect(children).toHaveLength(8);
    expect(children.find((item) => item.instanceId === stack)?.quantity).toBe(99);
  });
});
