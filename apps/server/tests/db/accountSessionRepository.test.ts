import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../src/db/migrate";
import { AccountRepository } from "../../src/persistence/AccountRepository";
import { SessionRepository } from "../../src/persistence/SessionRepository";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for database tests.");

const pool = new Pool({ connectionString: databaseUrl });

beforeAll(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await runMigrations(pool);
});

afterAll(async () => {
  await pool.end();
});

describe("account and session repositories", () => {
  it("creates and finds an account by normalized username", async () => {
    const accounts = new AccountRepository(pool);
    const account = await accounts.create({
      id: randomUUID(),
      username: "Owczy217",
      usernameNormalized: "owczy217",
      passwordHash: "password-hash",
      recoveryCodeHash: "recovery-hash"
    });

    expect((await accounts.findByNormalizedUsername("owczy217"))?.id).toBe(account.id);
    expect((await accounts.findById(account.id))?.username).toBe("Owczy217");
  });

  it("relies on the database for case-normalized uniqueness", async () => {
    const accounts = new AccountRepository(pool);
    await accounts.create({
      id: randomUUID(),
      username: "UniqueOwner",
      usernameNormalized: "uniqueowner",
      passwordHash: "password-hash",
      recoveryCodeHash: "recovery-hash"
    });

    await expect(
      accounts.create({
        id: randomUUID(),
        username: "uniqueowner",
        usernameNormalized: "uniqueowner",
        passwordHash: "password-hash",
        recoveryCodeHash: "recovery-hash"
      })
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("replaces the active session and invalidates the previous token", async () => {
    const accounts = new AccountRepository(pool);
    const account = await accounts.create({
      id: randomUUID(),
      username: "SessionOwner",
      usernameNormalized: "sessionowner",
      passwordHash: "password-hash",
      recoveryCodeHash: "recovery-hash"
    });
    const sessions = new SessionRepository(pool);

    const first = await sessions.replaceActiveSession({
      id: randomUUID(),
      accountId: account.id,
      tokenHash: "a".repeat(64),
      expiresAt: new Date(Date.now() + 60_000)
    });
    const second = await sessions.replaceActiveSession({
      id: randomUUID(),
      accountId: account.id,
      tokenHash: "b".repeat(64),
      expiresAt: new Date(Date.now() + 60_000)
    });

    expect(await sessions.findValidByTokenHash(first.tokenHash, new Date())).toBeNull();
    expect((await sessions.findValidByTokenHash(second.tokenHash, new Date()))?.accountId).toBe(account.id);
  });
});
