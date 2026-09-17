import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthService } from "../src/auth/AuthService";
import { runMigrations } from "../src/db/migrate";
import { AccountRepository } from "../src/persistence/AccountRepository";

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

describe("AuthService", () => {
  it("registers, logs in and revokes an opaque session", async () => {
    const service = new AuthService(pool, new AccountRepository(pool));
    const registration = await service.register("Owczy217", "correct horse battery");
    expect(registration.recoveryCode).toMatch(/^[A-F0-9-]+$/);

    const account = await new AccountRepository(pool).findByNormalizedUsername("owczy217");
    expect(account?.username).toBe("Owczy217");
    expect(account?.passwordHash.startsWith("$argon2id$")).toBe(true);

    const login = await service.login("OWCZY217", "correct horse battery");
    expect(login.token.length).toBeGreaterThanOrEqual(40);
    expect((await service.validateToken(login.token))?.account.id).toBe(account?.id);

    await service.logout(login.token);
    await expect(service.validateToken(login.token)).resolves.toBeNull();
  });

  it("rotates recovery credentials and revokes previous sessions", async () => {
    const service = new AuthService(pool, new AccountRepository(pool));
    const registration = await service.register("RecoveryOwner", "original password");
    const login = await service.login("RecoveryOwner", "original password");

    const recovered = await service.recover(
      "RecoveryOwner",
      registration.recoveryCode,
      "replacement password"
    );

    expect(recovered.response.recoveryCode).not.toBe(registration.recoveryCode);
    await expect(service.validateToken(login.token)).resolves.toBeNull();
    await expect(service.login("RecoveryOwner", "original password")).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS"
    });
    await expect(service.login("RecoveryOwner", "replacement password")).resolves.toBeTruthy();
    await expect(
      service.recover("RecoveryOwner", registration.recoveryCode, "another password")
    ).rejects.toMatchObject({ code: "INVALID_RECOVERY_CODE" });
  });

  it("leaves exactly one valid session after simultaneous logins", async () => {
    const service = new AuthService(pool, new AccountRepository(pool));
    await service.register("ConcurrentOwner", "correct horse battery");

    const [a, b] = await Promise.all([
      service.login("ConcurrentOwner", "correct horse battery"),
      service.login("ConcurrentOwner", "correct horse battery")
    ]);

    const valid = await Promise.all([
      service.validateToken(a.token),
      service.validateToken(b.token)
    ]);

    expect(valid.filter(Boolean)).toHaveLength(1);
  });
});
