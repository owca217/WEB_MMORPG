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
});
