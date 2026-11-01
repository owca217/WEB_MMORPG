import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { InventoryService } from "../src/inventory/InventoryService";
import { WeaponInjuryUpgradeService } from "../src/inventory/WeaponInjuryUpgradeService";
import { EquipmentService } from "../src/equipment/EquipmentService";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { MerchantService } from "../src/merchant/MerchantService";
import { TradeService } from "../src/social/TradeService";

const url = process.env.DATABASE_URL;
const target = url ? new URL(url) : null;
const local = target && ["localhost", "127.0.0.1"].includes(target.hostname) && target.pathname === "/web_mmorpg_test";
const describeDb = local ? describe : describe.skip;

describeDb("durable weapon injury upgrades", () => {
  const pool = createPool(url ?? "postgresql://unused/unused");
  const inventory = new InventoryService(pool);
  const service = new WeaponInjuryUpgradeService(pool, inventory);
  let alice: string, bob: string;
  async function character(name: string) {
    const id = randomUUID(), account = randomUUID();
    await pool.query("INSERT INTO accounts(id,username,username_normalized,password_hash,recovery_code_hash) VALUES($1,$2,$2,'hash','hash')", [account, name]);
    await pool.query("INSERT INTO characters(id,account_id,nickname,nickname_normalized) VALUES($1,$2,$3,$3)", [id, account, name]);
    return id;
  }
  async function grant(itemId: string, owner = alice, quantity = 1) {
    return (await inventory.addItems(owner, [{ itemId, quantity }])).items.find(item => item.itemId === itemId)!;
  }
  async function fixture() {
    const weapon = await grant("training-sword"), stone = await grant("injury-stone", alice, 3);
    await pool.query("UPDATE item_instances SET quality='EXCELLENT' WHERE id=$1", [weapon.instanceId]);
    return { requestId: randomUUID(), weaponInstanceId: weapon.instanceId, stoneInstanceId: stone.instanceId };
  }
  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool); await seedItemMetadata(pool);
    alice = await character("InjuryAlice"); bob = await character("InjuryBob");
  });
  afterAll(async () => pool.end());

  it("sells the stone for 50 gold and atomically persists an equipped weapon's roll", async () => {
    const merchant = new MerchantService(pool);
    expect((await merchant.getShop(alice)).offers.find(item => item.itemId === "injury-stone")).toMatchObject({ unitPrice: 50, categoryId: "upgrade-item" });
    const purchase = await merchant.purchase(alice, { npcId: "merchant-miro", itemId: "injury-stone", quantity: 1, requestId: randomUUID() });
    expect(purchase.shop.gold).toBe(50);
    const weapon = await grant("training-sword");
    await pool.query("UPDATE item_instances SET quality='PERFECT' WHERE id=$1", [weapon.instanceId]);
    await new EquipmentService(pool, inventory).setSlot(alice, { slot: "mainHand", itemInstanceId: weapon.instanceId });
    const request = { requestId: randomUUID(), weaponInstanceId: weapon.instanceId, stoneInstanceId: purchase.inventory.items.find(item => item.itemId === "injury-stone")!.instanceId };
    const result = await service.apply(alice, request);
    expect(result.inventory.items.some(item => item.instanceId === request.stoneInstanceId)).toBe(false);
    expect(result.inventory.items.find(item => item.instanceId === weapon.instanceId)).toMatchObject({ equippedSlot: "mainHand", injuryUpgrade: result.upgrade });
    expect((await new InventoryService(pool).getSnapshot(alice)).items.find(item => item.instanceId === weapon.instanceId)?.injuryUpgrade).toEqual(result.upgrade);
    expect((await pool.query("SELECT upgrade FROM weapon_injury_upgrade_receipts WHERE request_id=$1", [request.requestId])).rows[0].upgrade).toEqual(result.upgrade);
  });

  it("replays concurrent requests once, binds receipt inputs and allows a later replacement roll", async () => {
    const request = await fixture();
    const results = await Promise.all([service.apply(alice, request), service.apply(alice, request)]);
    expect(results[0].upgrade).toEqual(results[1].upgrade);
    expect(results[1].inventory.items.find(item => item.instanceId === request.stoneInstanceId)?.quantity).toBe(2);
    await expect(service.apply(alice, { ...request, stoneInstanceId: randomUUID() })).rejects.toThrow("WEAPON_INJURY_REQUEST_CONFLICT");
    await expect(service.apply(bob, request)).rejects.toThrow("WEAPON_INJURY_REQUEST_CONFLICT");
    const next = await service.apply(alice, { ...request, requestId: randomUUID() });
    expect(next.inventory.items.find(item => item.instanceId === request.stoneInstanceId)?.quantity).toBe(1);
    expect((await service.apply(alice, request)).upgrade).toEqual(results[0].upgrade);
    expect((await pool.query("SELECT COUNT(*)::int AS count FROM weapon_injury_upgrade_receipts")).rows[0].count).toBe(2);
  });

  it("uses instance quality and rejects foreign items, wrong material, malformed IDs and broken weapons without consumption", async () => {
    const request = await fixture();
    await pool.query("UPDATE item_instances SET quality='GOOD' WHERE id=$1", [request.weaponInstanceId]);
    await pool.query("UPDATE item_versions SET quality='MASTERWORK' WHERE item_id IN(SELECT item_id FROM item_instances WHERE id=$1)", [request.weaponInstanceId]);
    await expect(service.apply(alice, request)).rejects.toThrow("WEAPON_INJURY_INELIGIBLE");
    await pool.query("UPDATE item_instances SET quality='EXCELLENT',durability=0,max_durability=10 WHERE id=$1", [request.weaponInstanceId]);
    await expect(service.apply(alice, request)).rejects.toThrow("WEAPON_INJURY_INELIGIBLE");
    await pool.query("UPDATE item_instances SET durability=10 WHERE id=$1", [request.weaponInstanceId]);
    const bandage = await grant("field-bandage"), foreign = await grant("injury-stone", bob), armor = await grant("cloth-helmet");
    await expect(service.apply(alice, { ...request, stoneInstanceId: bandage.instanceId })).rejects.toThrow("WEAPON_INJURY_INVALID_STONE");
    await expect(service.apply(alice, { ...request, stoneInstanceId: foreign.instanceId })).rejects.toThrow("INVENTORY_ITEM_NOT_OWNED");
    await expect(service.apply(bob, request)).rejects.toThrow("INVENTORY_ITEM_NOT_OWNED");
    await expect(service.apply(alice, { ...request, weaponInstanceId: armor.instanceId })).rejects.toThrow("WEAPON_INJURY_INELIGIBLE");
    await expect(service.apply(alice, { ...request, requestId: "bad" })).rejects.toThrow("WEAPON_INJURY_INVALID_REQUEST");
    expect((await inventory.getSnapshot(alice)).items.find(item => item.instanceId === request.stoneInstanceId)?.quantity).toBe(3);
    expect((await pool.query("SELECT 1 FROM weapon_injury_upgrade_receipts")).rowCount).toBe(0);
  });

  it("rolls back the roll, consumption and receipt when current session/live state validation fails", async () => {
    const request = await fixture();
    const assertCurrent = vi.fn(() => { throw new Error("SESSION_REPLACED"); });
    await expect(service.apply(alice, request, assertCurrent)).rejects.toThrow("SESSION_REPLACED");
    expect(assertCurrent).toHaveBeenCalled();
    const items = (await inventory.getSnapshot(alice)).items;
    expect(items.find(item => item.instanceId === request.stoneInstanceId)?.quantity).toBe(3);
    expect(items.find(item => item.instanceId === request.weaponInstanceId)?.injuryUpgrade).toBeUndefined();
    expect((await pool.query("SELECT 1 FROM weapon_injury_upgrade_receipts")).rowCount).toBe(0);
  });

  it("preserves custom instance rolls during trade copies and excludes them from pristine stack merges", async () => {
    const bandage = await grant("field-bandage", alice, 3);
    const upgrade = { kind: "bleeding", chancePercent: 7, duration: 3 };
    // Historical/imported stacks can carry custom instance fields even when new upgrades only accept weapons.
    await pool.query("UPDATE item_instances SET injury_upgrade=$2::jsonb WHERE id=$1", [bandage.instanceId, JSON.stringify(upgrade)]);
    await inventory.addItems(alice, [{ itemId: "field-bandage", quantity: 1 }]);
    await new MerchantService(pool).purchase(alice, { npcId: "merchant-miro", itemId: "field-bandage", quantity: 1, requestId: randomUUID() });
    expect((await inventory.getSnapshot(alice)).items.find(item => item.instanceId === bandage.instanceId)?.quantity).toBe(3);
    const trade = new TradeService(pool, id => ({ id, nickname: id, level: 1, online: true, inBattle: false }), () => ({ locationId: "forest-settlement-01", x: 450, y: 420 }));
    const invite = await trade.request(alice, bob); await trade.respond(bob, invite.id, true);
    await trade.setOffer(alice, invite.id, trade.getSnapshot(alice)!.revision, [{ instanceId: bandage.instanceId, quantity: 1 }]);
    const current = trade.getSnapshot(alice)!;
    await trade.confirm(alice, invite.id, current.revision); await trade.confirm(bob, invite.id, current.revision);
    expect((await inventory.getSnapshot(bob)).items.find(item => item.itemId === "field-bandage")?.injuryUpgrade).toEqual(upgrade);
  });
});
