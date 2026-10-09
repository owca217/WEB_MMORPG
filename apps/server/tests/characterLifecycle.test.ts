import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import {
  CharacterLifecycleError,
  CharacterLifecycleService
} from "../src/character/CharacterLifecycleService";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

async function createAccount(pool: ReturnType<typeof createPool>, username: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO accounts
      (id, username, username_normalized, password_hash, recovery_code_hash)
     VALUES ($1,$2,$3,'test-password-hash','test-recovery-hash')`,
    [id, username, username.toLowerCase()]
  );
  return id;
}

describeDatabase("persistent character lifecycle", () => {
  const pool = createPool(databaseUrl);

  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("routes an account from no character to the same persistent active character after reload", async () => {
    const accountId = await createAccount(pool, "owner_one");
    const service = new CharacterLifecycleService(pool);

    expect(await service.getLifecycle(accountId, new Date())).toEqual({ state: "none" });

    const created = await service.createCharacter(accountId, {
      nickname: "Owczy",
      appearance: { body: "default", hair: "short" }
    });
    expect(created.nickname).toBe("Owczy");

    const reloaded = new CharacterLifecycleService(pool);
    expect(await reloaded.getLifecycle(accountId, new Date())).toEqual({
      state: "active",
      characterId: created.id,
      nickname: "Owczy"
    });
    expect((await reloaded.getCharacter(accountId))?.id).toBe(created.id);
  });

  it("rejects a second character for one account and duplicate nickname case-insensitively", async () => {
    const ownerA = await createAccount(pool, "owner_a");
    const ownerB = await createAccount(pool, "owner_b");
    const service = new CharacterLifecycleService(pool);

    await service.createCharacter(ownerA, { nickname: "HeroName", appearance: {} });

    await expect(
      service.createCharacter(ownerA, { nickname: "OtherHero", appearance: {} })
    ).rejects.toMatchObject({ code: "CHARACTER_ALREADY_EXISTS", status: 409 });

    await expect(
      service.createCharacter(ownerB, { nickname: " heroname ", appearance: {} })
    ).rejects.toMatchObject({ code: "NICKNAME_TAKEN", status: 409 });
  });

  it("validates nickname and appearance on the server", async () => {
    const accountId = await createAccount(pool, "owner_validation");
    const service = new CharacterLifecycleService(pool);

    await expect(
      service.createCharacter(accountId, { nickname: "ab", appearance: {} })
    ).rejects.toMatchObject({ code: "INVALID_NICKNAME", status: 400 });

    await expect(
      service.createCharacter(accountId, { nickname: "ValidHero", appearance: null })
    ).rejects.toMatchObject({ code: "INVALID_APPEARANCE", status: 400 });
  });

  it("persists gameplay vitals and position across service reconstruction", async () => {
    const accountId = await createAccount(pool, "owner_state");
    const service = new CharacterLifecycleService(pool);
    const created = await service.createCharacter(accountId, {
      nickname: "StateHero",
      appearance: { body: "default" }
    });

    await service.saveGameplayState(created.id, {
      locationId: "forest-settlement-01",
      x: 321,
      y: 654,
      level: 3,
      hp: 47,
      maxHp: 120,
      maxAp: 6,
      initiative: 14,
      severelyInjured: true,
      injuries: ["bleeding"]
    });

    const persisted = await new CharacterLifecycleService(pool).getCharacter(accountId);
    expect(persisted).toMatchObject({
      id: created.id,
      x: 321,
      y: 654,
      level: 3,
      hp: 47,
      maxHp: 120,
      maxAp: 6,
      initiative: 14,
      severelyInjured: true,
      injuries: ["bleeding"]
    });
  });

  it("exposes lifecycle errors as typed service errors", () => {
    const error = new CharacterLifecycleError("INVALID_NICKNAME", 400, "bad nickname");
    expect(error).toMatchObject({ code: "INVALID_NICKNAME", status: 400 });
  });
});
