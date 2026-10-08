import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AccountRole } from "@web-mmorpg/shared";
import { AuthService } from "../../src/auth/AuthService";
import { runMigrations } from "../../src/db/migrate";
import { AccountRepository } from "../../src/persistence/AccountRepository";

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

describe("admin account role migration", () => {
  it("defaults accounts to PLAYER and rejects roles outside the supported enum", async () => {
    const accountId = randomUUID();
    await pool.query(
      `INSERT INTO accounts
       (id, username, username_normalized, password_hash, recovery_code_hash)
       VALUES ($1, $2, $3, $4, $5)`,
      [accountId, "RoleOwner", "roleowner", "hash", "recovery"]
    );

    const result = await pool.query<{ role: AccountRole }>(
      "SELECT role FROM accounts WHERE id = $1",
      [accountId]
    );
    expect(result.rows[0]?.role).toBe("PLAYER");

    await expect(
      pool.query("UPDATE accounts SET role = 'OWNER' WHERE id = $1", [accountId])
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("persists an updated role and exposes the current value through token validation", async () => {
    const repository = new AccountRepository(pool);
    const service = new AuthService(pool, repository);
    await service.register("RoleSessionOwner", "correct horse battery");

    const account = await repository.findByNormalizedUsername("rolesessionowner");
    expect(account?.role).toBe("PLAYER");
    if (!account) throw new Error("account was not created");

    const role: AccountRole = "ADMIN";
    await repository.updateRole(account.id, role);
    expect((await repository.findById(account.id))?.role).toBe("ADMIN");

    const login = await service.login("RoleSessionOwner", "correct horse battery");
    const validated = await service.validateToken(login.token);
    expect(validated?.account.role).toBe("ADMIN");
    expect(validated?.view.accountRole).toBe("ADMIN");
  });
});
