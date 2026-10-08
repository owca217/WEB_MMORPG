import { randomUUID } from "node:crypto";
import type { CharacterSnapshot, InventorySnapshot } from "@web-mmorpg/shared";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate";
import { AccountRepository } from "../../src/persistence/AccountRepository";
import { CharacterRepository } from "../../src/persistence/CharacterRepository";
import { PlayerPersistenceService } from "../../src/persistence/PlayerPersistenceService";
import { defaultAppearance } from "../helpers/testApp";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required.");

const pool = new Pool({ connectionString: databaseUrl });

beforeAll(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
});

async function createPersistentCharacter(): Promise<string> {
  const accountId = randomUUID();
  const characterId = randomUUID();
  const uniqueSuffix = characterId.slice(0, 8);

  await new AccountRepository(pool).create({
    id: accountId,
    username: `Persistence-${uniqueSuffix}`,
    usernameNormalized: `persistence-${uniqueSuffix.toLowerCase()}`,
    passwordHash: "hash",
    recoveryCodeHash: "recovery"
  });

  await new CharacterRepository(pool).create({
    id: characterId,
    accountId,
    nickname: `Hero-${uniqueSuffix}`,
    nicknameNormalized: `hero-${uniqueSuffix.toLowerCase()}`,
    appearance: defaultAppearance,
    locationId: "forest-settlement-01",
    x: 360,
    y: 470
  });

  return characterId;
}

async function accountIdForCharacter(characterId: string): Promise<string> {
  const result = await pool.query<{ account_id: string }>(
    "SELECT account_id FROM characters WHERE id = $1",
    [characterId]
  );
  if (!result.rows[0]) throw new Error("character account was not found");
  return result.rows[0].account_id;
}

describe("PlayerPersistenceService", () => {
  it("persists and reloads vitals, injuries, inventory and equipment", async () => {
    const characterId = await createPersistentCharacter();
    const persistence = new PlayerPersistenceService(pool);

    const loaded = await persistence.loadPlayer(characterId);
    expect(loaded.character.hp).toBe(100);
    expect(loaded.character.experience).toBe(0);
    expect(loaded.inventory.items).toEqual([]);
    expect(loaded.equipment).toEqual({ items: [] });

    const character: CharacterSnapshot = {
      ...loaded.character,
      hp: 37,
      experience: 275,
      severelyInjured: true,
      injuries: ["legTrauma"]
    };
    const inventory: InventorySnapshot = {
      items: [
        {
          instanceId: randomUUID(),
          itemId: "wolf-pelt",
          name: "Wolf Pelt",
          quantity: 2,
          category: "material",
          description: "A rough wolf pelt."
        },
        {
          instanceId: randomUUID(),
          itemId: "simple-bag",
          name: "Zwykły worek",
          quantity: 1,
          category: "bag",
          description: "Prosty worek.",
          containerCapacity: 8
        }
      ]
    };

    const wolfPeltId = inventory.items[0]!.instanceId;

    await persistence.saveBattleOutcome(character, inventory);
    await persistence.saveEquipment(characterId, {
      items: [
        {
          slot: "mainHand",
          itemInstanceId: wolfPeltId
        }
      ]
    });

    const restored = await persistence.loadPlayer(characterId);
    expect(restored.character).toMatchObject({
      hp: 37,
      experience: 275,
      severelyInjured: true,
      injuries: ["legTrauma"]
    });
    expect(restored.inventory.items.find((item) => item.itemId === "wolf-pelt")).toMatchObject({
      itemId: "wolf-pelt",
      quantity: 2
    });
    expect(restored.inventory.items.find((item) => item.itemId === "simple-bag")).toMatchObject({
      itemId: "simple-bag",
      quantity: 1,
      containerCapacity: 8
    });
    expect(restored.equipment).toEqual({
      items: [
        {
          slot: "mainHand",
          itemInstanceId: wolfPeltId
        }
      ]
    });

    await persistence.saveBattleOutcome(restored.character, restored.inventory);
    expect((await persistence.loadPlayer(characterId)).equipment).toEqual(
      restored.equipment
    );

    // A snapshot from an older server must not erase stored experience.
    const { experience: _experience, ...legacyCharacter } = restored.character;
    await persistence.saveCharacterState(legacyCharacter);
    expect((await persistence.loadPlayer(characterId)).character.experience).toBe(275);
  });

  it("round-trips bag contents and claims a reward once with atomic snapshots", async () => {
    const characterId = await createPersistentCharacter();
    const persistence = new PlayerPersistenceService(pool);
    const bagInstanceId = randomUUID();
    const storedItemId = randomUUID();
    const equipment = { items: [{ slot: "bag-1", itemInstanceId: bagInstanceId }] };
    const startingInventory: InventorySnapshot = {
      items: [
        {
          instanceId: bagInstanceId,
          itemId: "simple-bag",
          name: "Zwykły worek",
          quantity: 1,
          category: "bag",
          description: "Prosty worek.",
          containerCapacity: 8
        },
        {
          instanceId: storedItemId,
          itemId: "wolf-pelt",
          name: "Wilcza skóra",
          quantity: 1,
          category: "material",
          description: "Skóra.",
          containerInstanceId: bagInstanceId
        }
      ]
    };

    await persistence.saveInventoryAndEquipment(characterId, startingInventory, equipment);
    const restored = await persistence.loadPlayer(characterId);
    expect(restored.inventory.items.find((item) => item.instanceId === storedItemId))
      .toMatchObject({ containerInstanceId: bagInstanceId });
    expect(restored.equipment).toEqual(equipment);

    const rewardKey = "quartermaster-simple-bag";
    expect(await persistence.hasNpcRewardClaim(characterId, rewardKey)).toBe(false);
    const rewardItem = {
      instanceId: randomUUID(),
      itemId: "simple-bag",
      name: "Zwykły worek",
      quantity: 1,
      category: "bag" as const,
      description: "Prosty worek.",
      containerCapacity: 8
    };
    const claimedInventory = { items: [...startingInventory.items, rewardItem] };
    expect(await persistence.claimNpcRewardOnce(characterId, rewardKey, claimedInventory, equipment))
      .toBe(true);
    expect(await persistence.hasNpcRewardClaim(characterId, rewardKey)).toBe(true);

    const beforeDuplicate = await persistence.loadPlayer(characterId);
    expect(await persistence.claimNpcRewardOnce(characterId, rewardKey, { items: [] }, { items: [] }))
      .toBe(false);
    expect(await persistence.loadPlayer(characterId)).toEqual(beforeDuplicate);

    await expect(persistence.claimNpcRewardOnce(
      characterId,
      "quartermaster-rollback-probe",
      { items: [] },
      { items: [{ slot: "mainHand", itemInstanceId: "missing-item" }] }
    )).rejects.toBeDefined();
    expect(await persistence.hasNpcRewardClaim(characterId, "quartermaster-rollback-probe"))
      .toBe(false);
    expect(await persistence.loadPlayer(characterId)).toEqual(beforeDuplicate);
  });

  it("applies admin grants atomically and returns the durable snapshot on an identical replay", async () => {
    const characterId = await createPersistentCharacter();
    const accountId = await accountIdForCharacter(characterId);
    const persistence = new PlayerPersistenceService(pool);
    const bagInstanceId = randomUUID();
    const nestedItemId = randomUUID();
    const startingInventory: InventorySnapshot = {
      items: [
        {
          instanceId: bagInstanceId,
          itemId: "simple-bag",
          name: "Zwykły worek",
          quantity: 1,
          category: "bag",
          description: "Prosty worek.",
          containerCapacity: 8
        },
        {
          instanceId: nestedItemId,
          itemId: "wolf-pelt",
          name: "Wolf Pelt",
          quantity: 1,
          category: "material",
          description: "A rough pelt taken from a forest wolf.",
          containerInstanceId: bagInstanceId
        }
      ]
    };
    const equipment = {
      items: [{ slot: "bag-1", itemInstanceId: bagInstanceId }]
    };
    await persistence.saveInventoryAndEquipment(characterId, startingInventory, equipment);

    const newItem = {
      instanceId: randomUUID(),
      itemId: "field-bandage",
      name: "Field Bandage",
      quantity: 3,
      category: "medical" as const,
      description: "A simple bandage for field treatment."
    };
    const grantedInventory = { items: [...startingInventory.items, newItem] };
    const operationId = randomUUID();
    const applied = await persistence.applyAdminGrant({
      operationId,
      accountId,
      characterId,
      itemId: "field-bandage",
      quantity: 3,
      inventory: grantedInventory,
      equipment
    });

    expect(applied.status).toBe("applied");
    expect(applied.inventory.items).toEqual(grantedInventory.items);
    expect(applied.equipment).toEqual(equipment);
    expect((await persistence.loadPlayer(characterId)).inventory.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instanceId: newItem.instanceId, quantity: 3 }),
        expect.objectContaining({ instanceId: nestedItemId, containerInstanceId: bagInstanceId })
      ])
    );

    const replay = await persistence.applyAdminGrant({
      operationId,
      accountId,
      characterId,
      itemId: "field-bandage",
      quantity: 3,
      inventory: { items: [] },
      equipment: { items: [] }
    });
    expect(replay.status).toBe("alreadyApplied");
    expect(replay.inventory.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ instanceId: newItem.instanceId, quantity: 3 }),
        expect.objectContaining({ instanceId: nestedItemId, containerInstanceId: bagInstanceId })
      ])
    );
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM admin_item_grants WHERE operation_id = $1", [operationId]))
        .rows[0]?.count
    ).toBe(1);

    await expect(
      persistence.applyAdminGrant({
        operationId,
        accountId,
        characterId,
        itemId: "field-bandage",
        quantity: 4,
        inventory: { items: [] },
        equipment: { items: [] }
      })
    ).rejects.toMatchObject({ code: "ADMIN_OPERATION_CONFLICT" });

    const failedOperationId = randomUUID();
    await expect(
      persistence.applyAdminGrant({
        operationId: failedOperationId,
        accountId,
        characterId,
        itemId: "wolf-pelt",
        quantity: 1,
        inventory: grantedInventory,
        equipment: { items: [{ slot: "bag-1", itemInstanceId: "missing-item" }] }
      })
    ).rejects.toBeDefined();
    expect(
      (await pool.query("SELECT count(*)::int AS count FROM admin_item_grants WHERE operation_id = $1", [failedOperationId]))
        .rows[0]?.count
    ).toBe(0);
  });
});
