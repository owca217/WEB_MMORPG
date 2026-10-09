import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyPassword } from "../src/auth/credentials";
import { hashOpaqueSecret } from "../src/auth/secrets";
import { bootstrapInitialAdmin } from "../src/auth/bootstrapInitialAdmin";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { AccountRepository } from "../src/persistence/AccountRepository";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const BOOTSTRAP_PASSWORD = "bootstrap-correct-horse-battery-staple";
const BOOTSTRAP_RECOVERY = "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG";

function env(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return {
    INITIAL_ADMIN_USERNAME: "OwczyAdmin",
    INITIAL_ADMIN_PASSWORD: BOOTSTRAP_PASSWORD,
    INITIAL_ADMIN_RECOVERY_CODE: BOOTSTRAP_RECOVERY,
    ...overrides
  };
}

describeDatabase("initial ADMIN bootstrap", () => {
  const pool = createPool(databaseUrl);

  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates the first ADMIN with hashed bootstrap credentials and recovery code", async () => {
    const result = await bootstrapInitialAdmin(pool, env());
    expect(result).toBe("created");

    const account = await new AccountRepository(pool).findByNormalizedUsername("owczyadmin");
    expect(account).toMatchObject({ role: "ADMIN", status: "active" });
    expect(await verifyPassword(account!.passwordHash, BOOTSTRAP_PASSWORD)).toBe(true);
    expect(account!.recoveryCodeHash).toBe(hashOpaqueSecret(BOOTSTRAP_RECOVERY));
    expect(JSON.stringify(account)).not.toContain(BOOTSTRAP_PASSWORD);
    expect(JSON.stringify(account)).not.toContain(BOOTSTRAP_RECOVERY);
  });

  it("skips when an active ADMIN already exists", async () => {
    await pool.query(
      `INSERT INTO accounts
        (id, username, username_normalized, password_hash, recovery_code_hash, role, status)
       VALUES ($1,'ExistingAdmin','existingadmin','hash','recovery','ADMIN','active')`,
      [randomUUID()]
    );

    expect(await bootstrapInitialAdmin(pool, env())).toBe("skipped");
    const count = await pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM accounts");
    expect(count.rows[0]?.count).toBe("1");
  });

  it("does not silently elevate an existing PLAYER with the bootstrap username", async () => {
    await pool.query(
      `INSERT INTO accounts
        (id, username, username_normalized, password_hash, recovery_code_hash, role, status)
       VALUES ($1,'OwczyAdmin','owczyadmin','hash','recovery','PLAYER','active')`,
      [randomUUID()]
    );

    await expect(bootstrapInitialAdmin(pool, env())).rejects.toMatchObject({
      code: "INITIAL_ADMIN_USERNAME_CONFLICT"
    });
    const account = await new AccountRepository(pool).findByNormalizedUsername("owczyadmin");
    expect(account?.role).toBe("PLAYER");
  });

  it("requires all bootstrap values when bootstrap is requested", async () => {
    await expect(
      bootstrapInitialAdmin(pool, env({ INITIAL_ADMIN_RECOVERY_CODE: undefined }))
    ).rejects.toMatchObject({ code: "INITIAL_ADMIN_CONFIG_INCOMPLETE" });
  });

  it("never logs bootstrap password or recovery code", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await bootstrapInitialAdmin(pool, env());
      const output = [...log.mock.calls, ...error.mock.calls].flat().join(" ");
      expect(output).not.toContain(BOOTSTRAP_PASSWORD);
      expect(output).not.toContain(BOOTSTRAP_RECOVERY);
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});
