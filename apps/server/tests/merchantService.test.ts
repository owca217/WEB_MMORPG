import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { MerchantService } from "../src/merchant/MerchantService";

const databaseUrl = process.env.DATABASE_URL;
const testDatabase = databaseUrl && new URL(databaseUrl).pathname === "/web_mmorpg_test";
const describeDatabase = testDatabase ? describe : describe.skip;

describeDatabase("persistent merchant purchases and rewards", () => {
  const pool = createPool(databaseUrl ?? "postgresql://unused/unused");
  let service: MerchantService;
  let alice: string;
  let bob: string;
  const purchase = (itemId = "field-bandage", quantity = 1, requestId = randomUUID()) =>
    ({ npcId: "merchant-miro", itemId, quantity, requestId });
  async function character(name: string): Promise<string> {
    const id = randomUUID(), account = randomUUID();
    await pool.query(`INSERT INTO accounts(id,username,username_normalized,password_hash,recovery_code_hash)
      VALUES($1,$2,$2,'hash','hash')`, [account, name]);
    await pool.query(`INSERT INTO characters(id,account_id,nickname,nickname_normalized)
      VALUES($1,$2,$3,$3)`, [id, account, name]);
    return id;
  }
  async function quantity(id: string, itemId: string): Promise<number> {
    return Number((await pool.query(`SELECT COALESCE(SUM(instance.quantity),0) AS quantity
      FROM item_instances instance JOIN items item ON item.id=instance.item_id
      WHERE instance.character_id=$1 AND item.item_id=$2`, [id, itemId])).rows[0].quantity);
  }
  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
    await seedItemMetadata(pool);
    service = new MerchantService(pool);
    alice = await character("Alice");
    bob = await character("Bob");
  });
  afterAll(async () => { await pool.end(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it("creates the starter allowance once and publishes functional current offers", async () => {
    const shop = await service.getShop(alice);
    expect(shop).toMatchObject({ npcId: "merchant-miro", npcName: "Miro", gold: 100 });
    expect(shop.offers).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: "field-bandage", unitPrice: 5, healHp: 30, maxQuantity: 20 }),
      expect.objectContaining({ itemId: "rag-bag", unitPrice: 30, capacity: 8, maxQuantity: 1 }),
      expect.objectContaining({ itemId: "minor-healing-potion", unitPrice: 10, healHp: 50 }),
      expect.objectContaining({ itemId: "invigorating-tonic", unitPrice: 12, restoreAp: 3 })
    ]));
    await service.purchase(alice, purchase());
    expect(await new MerchantService(pool).getGold(alice)).toBe(95);
    expect(await service.getGold(bob)).toBe(100);
    expect((await pool.query("SELECT * FROM character_wallets WHERE character_id=$1", [alice])).rowCount).toBe(1);
  });

  it("deducts and grants atomically with request replay bound to owner and payload", async () => {
    const request = purchase("minor-healing-potion", 3);
    const first = await service.purchase(alice, request);
    expect(first.shop.gold).toBe(70);
    expect(first.inventory.items.find(item => item.itemId === request.itemId)).toMatchObject({ quantity: 3, consumableEffects: { healHp: 50 } });
    expect((await service.purchase(alice, request)).shop.gold).toBe(70);
    expect(await quantity(alice, request.itemId)).toBe(3);
    await expect(service.purchase(alice, { ...request, quantity: 2 })).rejects.toThrow("MERCHANT_REQUEST_CONFLICT");
    await expect(service.purchase(bob, request)).rejects.toThrow("MERCHANT_REQUEST_CONFLICT");
    expect(await quantity(bob, request.itemId)).toBe(0);
  });

  it("serializes concurrent purchases so insufficient gold cannot be overspent", async () => {
    const outcomes = await Promise.allSettled(Array.from({ length: 4 }, () => service.purchase(alice, purchase("rag-bag"))));
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(3);
    expect(outcomes.filter(result => result.status === "rejected")).toHaveLength(1);
    expect(await service.getGold(alice)).toBe(10);
    expect(await quantity(alice, "rag-bag")).toBe(3);
    expect((await pool.query("SELECT * FROM merchant_purchase_receipts WHERE character_id=$1", [alice])).rowCount).toBe(3);
  });

  it("marks failed post-commit reads as uncertain and safely replays the original request", async () => {
    const request = purchase("rag-bag");
    vi.spyOn(service, "getShop").mockRejectedValueOnce(new Error("READ_FAILED_AFTER_COMMIT"));
    await expect(service.purchase(alice, request)).rejects.toThrow("MERCHANT_REQUEST_UNCERTAIN");
    expect(await service.getGold(alice)).toBe(70);
    expect(await quantity(alice, "rag-bag")).toBe(1);
    const replayed = await service.purchase(alice, request);
    expect(replayed.shop.gold).toBe(70);
    expect(replayed.inventory.items.filter(item => item.itemId === "rag-bag")).toHaveLength(1);
    expect((await pool.query("SELECT * FROM merchant_purchase_receipts WHERE request_id=$1", [request.requestId])).rowCount).toBe(1);
  });

  it("merges only pristine top-level stacks and respects the published stack limit", async () => {
    await service.purchase(alice, purchase("field-bandage", 18));
    await service.rewardVictory(alice, randomUUID(), 100);
    const initial = (await service.purchase(alice, purchase("field-bandage", 4))).inventory;
    expect(initial.items.filter(item => item.itemId === "field-bandage").map(item => item.quantity).sort((a,b) => a-b)).toEqual([2, 20]);
    const stored = initial.items.find(item => item.quantity === 2)!;
    await pool.query("UPDATE item_instances SET container_instance_id=$2 WHERE id=$1", [stored.instanceId, randomUUID()]);
    await service.purchase(alice, purchase("field-bandage", 1));
    expect((await pool.query("SELECT quantity FROM item_instances WHERE id=$1", [stored.instanceId])).rows[0].quantity).toBe(2);
    expect(await quantity(alice, "field-bandage")).toBe(23);
  });

  it("rolls back deductions and grants if lifecycle validation fails before COMMIT", async () => {
    const request = purchase("rag-bag");
    await expect(service.purchase(alice, request, () => { throw new Error("SESSION_REPLACED"); })).rejects.toThrow("SESSION_REPLACED");
    expect(await service.getGold(alice)).toBe(100);
    expect(await quantity(alice, "rag-bag")).toBe(0);
    expect((await pool.query("SELECT * FROM merchant_purchase_receipts")).rowCount).toBe(0);
    expect((await service.purchase(alice, request)).shop.gold).toBe(70);
  });

  it("revalidates publication and current valid metadata instead of trusting earlier shop data", async () => {
    await service.getShop(alice);
    await pool.query("UPDATE items SET status='ARCHIVED' WHERE item_id='field-bandage'");
    expect((await service.getShop(alice)).offers.some(item => item.itemId === "field-bandage")).toBe(false);
    await expect(service.purchase(alice, purchase())).rejects.toThrow("MERCHANT_ITEM_UNAVAILABLE");
    await pool.query(`UPDATE item_versions SET category_id='material',subcategory_id=NULL
      WHERE item_id=(SELECT id FROM items WHERE item_id='minor-healing-potion')`);
    await expect(service.purchase(alice, purchase("minor-healing-potion"))).rejects.toThrow("MERCHANT_ITEM_UNAVAILABLE");
    expect(await service.getGold(alice)).toBe(100);
  });

  it("honors unique and pickup-bound published items", async () => {
    await pool.query(`UPDATE item_versions SET unique_item=TRUE,soulbound='ON_PICKUP'
      WHERE item_id=(SELECT id FROM items WHERE item_id='minor-healing-potion')`);
    const result = await service.purchase(alice, purchase("minor-healing-potion"));
    expect(result.inventory.items.find(item => item.itemId === "minor-healing-potion")?.boundToPlayerId).toBe(alice);
    await expect(service.purchase(alice, purchase("minor-healing-potion"))).rejects.toThrow("MERCHANT_UNIQUE_ITEM_EXISTS");
    expect(await service.getGold(alice)).toBe(90);
  });

  it("grants each victory once across reconnect and concurrent retries", async () => {
    const battle = randomUUID();
    await Promise.all([service.rewardVictory(alice, battle), service.rewardVictory(alice, battle)]);
    expect(await new MerchantService(pool).getGold(alice)).toBe(115);
    await service.rewardVictory(alice, randomUUID());
    expect(await service.getGold(alice)).toBe(130);
    await expect(service.rewardVictory(alice, battle, 16)).rejects.toThrow("MERCHANT_REWARD_CONFLICT");
    expect((await pool.query("SELECT * FROM character_gold_rewards WHERE character_id=$1", [alice])).rowCount).toBe(2);
  });

  it("rejects malformed orders, unsupported stock and unsafe reward amounts", async () => {
    for (const request of [purchase("wolf-pelt"), purchase("rag-bag", 2), purchase("field-bandage", 0), purchase("field-bandage", 1.5), purchase("field-bandage", 21), { ...purchase(), npcId: "healer-ada" }, { ...purchase(), requestId: "invalid" }]) {
      await expect(service.purchase(alice, request)).rejects.toThrow();
    }
    for (const amount of [-1, 1.5, 10001, Number.NaN]) await expect(service.rewardVictory(alice, randomUUID(), amount)).rejects.toThrow("MERCHANT_INVALID_REWARD");
    expect(await service.getGold(alice)).toBe(100);
    expect((await pool.query("SELECT * FROM merchant_purchase_receipts")).rowCount).toBe(0);
  });

  it("rejects inactive or missing characters without creating wallets", async () => {
    await pool.query("UPDATE characters SET deletion_effective_at=NOW() WHERE id=$1", [alice]);
    await expect(service.getGold(alice)).rejects.toThrow("CHARACTER_NOT_FOUND");
    await expect(service.purchase(alice, purchase())).rejects.toThrow("CHARACTER_NOT_FOUND");
    await expect(service.getGold(randomUUID())).rejects.toThrow("CHARACTER_NOT_FOUND");
    expect((await pool.query("SELECT * FROM character_wallets")).rowCount).toBe(0);
  });
});
