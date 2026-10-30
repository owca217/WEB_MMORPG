import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { BattleService } from "../src/battle/BattleService";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { InventoryService } from "../src/inventory/InventoryService";
import { seedItemMetadata } from "../src/items/seedItemMetadata";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("battle item persistence", () => {
  const pool = createPool(databaseUrl);
  const inventory = new InventoryService(pool);
  let characterId: string;

  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
    await seedItemMetadata(pool);
    const accountId = randomUUID();
    await pool.query(`INSERT INTO accounts (id,username,username_normalized,password_hash,recovery_code_hash)
      VALUES ($1,'ItemOwner','itemowner','hash','recovery')`, [accountId]);
    const character = await new CharacterLifecycleService(pool).createCharacter(accountId, { nickname: "ItemHero", appearance: {} });
    characterId = character.id;
  });
  afterAll(() => pool.end());

  const start = () => {
    const battles = new BattleService();
    battles.startBattle({ playerId: characterId, nickname: "Hero", level: 1, hp: 41, maxHp: 100,
      maxAp: 5, initiative: 10, severelyInjured: true, injuries: ["bleeding"] }, "wolves");
    return battles;
  };
  const give = async (quantity = 2) => {
    const snapshot = await inventory.addItems(characterId, [{ itemId: "field-bandage", quantity }]);
    return snapshot.items.find((item) => item.itemId === "field-bandage")!.instanceId;
  };

  it("exposes published effects and adds healing only to the untouched starter bandage", async () => {
    const id = await give();
    expect((await inventory.getSnapshot(characterId)).items.find((item) => item.instanceId === id))
      .toMatchObject({ consumableEffects: { healHp: 30 } });
    await pool.query("DELETE FROM item_stat_modifiers WHERE stat_code='HEAL_AMOUNT'");
    await seedItemMetadata(pool);
    expect((await inventory.getSnapshot(characterId)).items.find(item => item.instanceId === id)!.consumableEffects).toEqual({ healHp: 30 });
    await pool.query("UPDATE item_stat_modifiers SET value=54 WHERE stat_code='HEAL_AMOUNT'");
    await seedItemMetadata(pool);
    expect((await inventory.getSnapshot(characterId)).items.find(item => item.instanceId === id)!.consumableEffects).toEqual({ healHp: 54 });
  });

  it("consumes exactly one stored item and commits matching HP while preserving injuries", async () => {
    const id = await give();
    const bag = (await inventory.addItems(characterId, [{ itemId: "rag-bag", quantity: 1 }])).items.find((item) => item.itemId === "rag-bag")!;
    await inventory.moveItemToContainer(characterId, id, bag.instanceId);
    const battles = start();
    const applied = await battles.useConsumable(characterId, `hero:${characterId}`, (prepare) =>
      inventory.consumeBattleItem(characterId, id, prepare));
    expect(applied.inventory.items.find((item) => item.instanceId === id)).toMatchObject({ quantity: 1, containerInstanceId: bag.instanceId });
    expect(applied.snapshot.combatants.find((actor) => actor.ownerPlayerId === characterId)).toMatchObject({ hp: 71, ap: 3 });
    expect((await pool.query("SELECT hp,severely_injured,injuries FROM characters WHERE id=$1", [characterId])).rows[0])
      .toEqual({ hp: 71, severely_injured: true, injuries: ["bleeding"] });
  });

  it("removes the last quantity and refuses to use the same instance again", async () => {
    const id = await give(1);
    const battles = start();
    const use = () => battles.useConsumable(characterId, `hero:${characterId}`, (prepare) => inventory.consumeBattleItem(characterId, id, prepare));
    await use();
    const remaining = (await inventory.getSnapshot(characterId)).items;
    expect(remaining.find(item => item.instanceId === id)).toBeUndefined();
    expect(remaining.filter(item => !item.permanentContainer)).toEqual([]);
    expect(remaining.find(item => item.permanentContainer)).toMatchObject({ containerCapacity: 16 });
    await expect(use()).rejects.toThrow("INVENTORY_ITEM_NOT_OWNED");
    expect(battles.getSnapshot(characterId)!.combatants.find((actor) => actor.ownerPlayerId === characterId)).toMatchObject({ hp: 71, ap: 3 });
  });

  it("allows an owned archived consumable with an active published version", async () => {
    const id = await give();
    await pool.query("UPDATE items SET status='ARCHIVED' WHERE item_id='field-bandage'");
    expect((await inventory.getSnapshot(characterId)).items.find(item => item.instanceId === id)).toMatchObject({ instanceId: id, consumableEffects: { healHp: 30 } });
    const battles = start();
    const applied = await battles.useConsumable(characterId, `hero:${characterId}`, (prepare) => inventory.consumeBattleItem(characterId, id, prepare));
    expect(applied.inventory.items.find(item => item.instanceId === id)).toMatchObject({ instanceId: id, quantity: 1 });
    expect(applied.snapshot.combatants.find((actor) => actor.ownerPlayerId === characterId)).toMatchObject({ hp: 71, ap: 3 });
  });

  it("rejects foreign and nonconsumable instances without spending them", async () => {
    const id = await give();
    const material = (await inventory.addItems(characterId, [{ itemId: "wolf-pelt", quantity: 1 }])).items.find((item) => item.itemId === "wolf-pelt")!;
    const prepare = () => ({ hp: 71, severelyInjured: false, injuries: [] });
    await expect(inventory.consumeBattleItem(randomUUID(), id, prepare)).rejects.toThrow("CHARACTER_NOT_FOUND");
    await expect(inventory.consumeBattleItem(characterId, randomUUID(), prepare)).rejects.toThrow("INVENTORY_ITEM_NOT_OWNED");
    await expect(inventory.consumeBattleItem(characterId, material.instanceId, prepare)).rejects.toThrow("ITEM_NOT_CONSUMABLE");
    expect((await inventory.getSnapshot(characterId)).items.find((item) => item.instanceId === id)!.quantity).toBe(2);
  });

  it("rolls inventory and HP back when character persistence fails", async () => {
    const id = await give();
    const battles = start();
    await pool.query(`CREATE FUNCTION reject_item_hp() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'HP_SAVE_FAILED'; END; $$;
      CREATE TRIGGER reject_item_hp BEFORE UPDATE OF hp ON characters FOR EACH ROW EXECUTE FUNCTION reject_item_hp()`);
    await expect(battles.useConsumable(characterId, `hero:${characterId}`, (prepare) => inventory.consumeBattleItem(characterId, id, prepare)))
      .rejects.toThrow("HP_SAVE_FAILED");
    expect((await inventory.getSnapshot(characterId)).items.find(item => item.instanceId === id)!.quantity).toBe(2);
    expect(battles.getSnapshot(characterId)!.combatants.find((actor) => actor.ownerPlayerId === characterId)).toMatchObject({ hp: 41, ap: 5 });
  });
});
