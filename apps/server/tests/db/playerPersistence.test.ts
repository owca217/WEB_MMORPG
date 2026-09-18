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

  await new AccountRepository(pool).create({
    id: accountId,
    username: "PersistenceOwner",
    usernameNormalized: "persistenceowner",
    passwordHash: "hash",
    recoveryCodeHash: "recovery"
  });

  await new CharacterRepository(pool).create({
    id: characterId,
    accountId,
    nickname: "PersistedHero",
    nicknameNormalized: "persistedhero",
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
    expect(loaded.inventory.items).toEqual([]);
    expect(loaded.equipment).toEqual({ items: [] });

    const character: CharacterSnapshot = {
      ...loaded.character,
      hp: 37,
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
        }
      ]
    };

    await persistence.saveBattleOutcome(character, inventory);

    const restored = await persistence.loadPlayer(characterId);
    expect(restored.character).toMatchObject({
      hp: 37,
      severelyInjured: true,
      injuries: ["legTrauma"]
    });
    expect(restored.inventory.items[0]).toMatchObject({
      itemId: "wolf-pelt",
      quantity: 2
    });
    expect(restored.equipment).toEqual({ items: [] });
  });
});
