import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "../src/auth/credentials";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { runMigrations } from "../src/db/migrate";
import { AccountRepository } from "../src/persistence/AccountRepository";
import { NicknameReservationRepository } from "../src/persistence/NicknameReservationRepository";
import { defaultAppearance } from "./helpers/testApp";

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

async function createAccount(username: string, password = "correct horse battery") {
  return new AccountRepository(pool).create({
    id: randomUUID(),
    username,
    usernameNormalized: username.toLowerCase(),
    passwordHash: await hashPassword(password),
    recoveryCodeHash: "recovery"
  });
}

describe("character deletion lifecycle", () => {
  it("requires password, waits 24 hours and can be cancelled", async () => {
    const account = await createAccount("DeletionOwner");
    const service = new CharacterLifecycleService(pool);
    await service.createCharacter(account.id, {
      nickname: "DeleteHero",
      appearance: defaultAppearance
    });

    const requestedAt = new Date("2026-09-18T10:00:00.000Z");
    const effectiveAt = new Date("2026-09-19T10:00:00.000Z");

    await expect(
      service.requestDeletion(account.id, "wrong password", requestedAt)
    ).rejects.toMatchObject({ code: "INVALID_PASSWORD" });

    const pending = await service.requestDeletion(
      account.id,
      "correct horse battery",
      requestedAt
    );
    expect(pending).toEqual({
      state: "pendingDeletion",
      characterId: expect.any(String),
      nickname: "DeleteHero",
      deletionEffectiveAt: effectiveAt.toISOString()
    });

    expect(await service.getLifecycle(account.id, requestedAt)).toEqual(pending);

    const restored = await service.cancelDeletion(account.id);
    expect(restored).toMatchObject({
      state: "active",
      nickname: "DeleteHero"
    });
  });

  it("finalizes after 24 hours and reserves the nickname for exactly seven more days", async () => {
    const owner = await createAccount("FinalDeleteOwner");
    const claimant = await createAccount("NicknameClaimant");
    const service = new CharacterLifecycleService(pool);

    await service.createCharacter(owner.id, {
      nickname: "ReservedHero",
      appearance: defaultAppearance
    });

    const requestedAt = new Date("2026-09-18T10:00:00.000Z");
    const effectiveAt = new Date("2026-09-19T10:00:00.000Z");
    const reservedUntil = new Date("2026-09-26T10:00:00.000Z");

    await service.requestDeletion(
      owner.id,
      "correct horse battery",
      requestedAt
    );

    expect(
      await service.getLifecycle(
        owner.id,
        new Date("2026-09-19T10:00:01.000Z")
      )
    ).toEqual({ state: "none" });

    const reservations = new NicknameReservationRepository(pool);
    const reservation = await reservations.findActive(
      "reservedhero",
      new Date("2026-09-20T00:00:00.000Z")
    );
    expect(reservation?.reservedUntil.toISOString()).toBe(
      reservedUntil.toISOString()
    );

    await expect(
      service.createCharacter(
        claimant.id,
        {
          nickname: "reservedhero",
          appearance: defaultAppearance
        },
        new Date("2026-09-25T12:00:00.000Z")
      )
    ).rejects.toMatchObject({ code: "NICKNAME_TAKEN" });

    const claimed = await service.createCharacter(
      claimant.id,
      {
        nickname: "ReservedHero",
        appearance: defaultAppearance
      },
      new Date("2026-09-26T10:00:01.000Z")
    );
    expect(claimed.nickname).toBe("ReservedHero");
  });
});
