import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { runMigrations } from "../src/db/migrate";
import { AccountRepository } from "../src/persistence/AccountRepository";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for database tests.");
const pool = new Pool({ connectionString: databaseUrl });

const appearance = {
  bodyType: "body-01",
  skinTone: "skin-01",
  face: "face-01",
  eyes: "eyes-01",
  hair: "hair-01",
  hairColor: "hair-color-01",
  facialHair: "facial-hair-none",
  marking: "marking-none",
  startingOutfit: "outfit-01"
};

beforeAll(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
});

async function createAccount(username: string) {
  return new AccountRepository(pool).create({
    id: randomUUID(),
    username,
    usernameNormalized: username.toLowerCase(),
    passwordHash: "hash",
    recoveryCodeHash: "recovery"
  });
}

describe("CharacterLifecycleService", () => {
  it("creates exactly one persistent character for an account", async () => {
    const account = await createAccount("LifecycleOwner");
    const service = new CharacterLifecycleService(pool);
    const now = new Date();

    expect(await service.getLifecycle(account.id, now)).toEqual({ state: "none" });

    const created = await service.createCharacter(account.id, {
      nickname: "Owczy",
      appearance
    });

    expect(created.nickname).toBe("Owczy");
    expect(await service.getLifecycle(account.id, now)).toMatchObject({
      state: "active",
      characterId: created.id,
      nickname: "Owczy"
    });

    await expect(
      service.createCharacter(account.id, { nickname: "Second", appearance })
    ).rejects.toMatchObject({ code: "CHARACTER_ALREADY_EXISTS" });
  });

  it.each(["eyes-sad", "eyes-angry", "eyes-closed"])("persists and reloads %s", async (eyes) => {
    const account = await createAccount(`Owner-${eyes}`);
    const service = new CharacterLifecycleService(pool);
    const created = await service.createCharacter(account.id, {
      nickname: `Hero-${eyes.slice(5)}`,
      appearance: { ...appearance, eyes }
    });
    const stored = await pool.query("SELECT appearance FROM characters WHERE id = $1", [created.id]);
    expect(stored.rows[0].appearance.eyes).toBe(eyes);
  });

  it("rejects appearance ids outside the shared catalog", async () => {
    const account = await createAccount("BadAppearanceOwner");
    const service = new CharacterLifecycleService(pool);

    await expect(
      service.createCharacter(account.id, {
        nickname: "BadLook",
        appearance: { ...appearance, hair: "hacked-hair" }
      })
    ).rejects.toMatchObject({ code: "INVALID_APPEARANCE" });
  });
});
