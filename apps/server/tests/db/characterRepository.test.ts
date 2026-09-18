import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate";
import { AccountRepository } from "../../src/persistence/AccountRepository";
import { CharacterRepository } from "../../src/persistence/CharacterRepository";

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

describe("CharacterRepository", () => {
  it("creates and reloads persistent appearance and world state", async () => {
    const account = await createAccount("CharacterOwner");
    const repository = new CharacterRepository(pool);
    const character = await repository.create({
      id: randomUUID(),
      accountId: account.id,
      nickname: "Owczy",
      nicknameNormalized: "owczy",
      appearance,
      locationId: "forest-settlement-01",
      x: 360,
      y: 470
    });

    expect(character.nickname).toBe("Owczy");
    expect((await repository.findByAccountId(account.id))?.id).toBe(character.id);
    expect((await repository.findById(character.id))?.appearance).toEqual(appearance);
  });

  it("enforces normalized nickname uniqueness", async () => {
    const first = await createAccount("FirstNickOwner");
    const second = await createAccount("SecondNickOwner");
    const repository = new CharacterRepository(pool);

    await repository.create({
      id: randomUUID(),
      accountId: first.id,
      nickname: "UniqueHero",
      nicknameNormalized: "uniquehero",
      appearance,
      locationId: "forest-settlement-01",
      x: 360,
      y: 470
    });

    await expect(
      repository.create({
        id: randomUUID(),
        accountId: second.id,
        nickname: "uniquehero",
        nicknameNormalized: "uniquehero",
        appearance,
        locationId: "forest-settlement-01",
        x: 360,
        y: 470
      })
    ).rejects.toMatchObject({ code: "23505" });
  });
});
