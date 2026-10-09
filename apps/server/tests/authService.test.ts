import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { AuthError, AuthService } from "../src/auth/AuthService";
import { verifyPassword } from "../src/auth/credentials";
import { hashOpaqueSecret } from "../src/auth/secrets";
import { AccountRepository } from "../src/persistence/AccountRepository";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const PASSWORD = "correct-horse-battery-staple";
const NEW_PASSWORD = "new-correct-horse-battery-staple";

describeDatabase("durable account authentication", () => {
  const pool = createPool(databaseUrl);

  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  function service(): AuthService {
    return new AuthService(pool, new AccountRepository(pool));
  }

  it("registers a PLAYER account with Argon2id and no plaintext secrets", async () => {
    const auth = service();
    const registered = await auth.register(" Owczy_1 ", PASSWORD);

    expect(registered.recoveryCode).toMatch(/^[A-F0-9]{4}(?:-[A-F0-9]{4})+$/);

    const row = await pool.query<{
      username: string;
      username_normalized: string;
      password_hash: string;
      recovery_code_hash: string;
      role: string;
      status: string;
    }>(
      `SELECT username, username_normalized, password_hash, recovery_code_hash, role, status
       FROM accounts WHERE username_normalized = 'owczy_1'`
    );
    const account = row.rows[0]!;

    expect(account.username).toBe("Owczy_1");
    expect(account.role).toBe("PLAYER");
    expect(account.status).toBe("active");
    expect(account.password_hash).not.toContain(PASSWORD);
    expect(account.password_hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(account.password_hash, PASSWORD)).toBe(true);
    expect(account.recovery_code_hash).toBe(hashOpaqueSecret(registered.recoveryCode));
    expect(JSON.stringify(account)).not.toContain(registered.recoveryCode);
  });

  it("rejects invalid registration and case-insensitive duplicate usernames", async () => {
    const auth = service();

    await expect(auth.register("ab", PASSWORD)).rejects.toMatchObject({
      code: "INVALID_USERNAME",
      status: 400
    });
    await expect(auth.register("valid_name", "short")).rejects.toMatchObject({
      code: "INVALID_PASSWORD",
      status: 400
    });

    await auth.register("Case_User", PASSWORD);
    await expect(auth.register(" case_user ", PASSWORD)).rejects.toMatchObject({
      code: "USERNAME_TAKEN",
      status: 409
    });
  });

  it("logs in with an opaque token, validates it, and never stores the raw token", async () => {
    const auth = service();
    await auth.register("player_one", PASSWORD);

    const loggedIn = await auth.login("PLAYER_ONE", PASSWORD);
    expect(loggedIn.session).toEqual({
      accountUsername: "player_one",
      accountRole: "PLAYER",
      character: { state: "none" }
    });

    const sessionRow = await pool.query<{ token_hash: string }>(
      "SELECT token_hash FROM account_sessions"
    );
    expect(sessionRow.rows[0]!.token_hash).toBe(hashOpaqueSecret(loggedIn.token));
    expect(sessionRow.rows[0]!.token_hash).not.toContain(loggedIn.token);

    const validated = await auth.validateToken(loggedIn.token);
    expect(validated?.account.username).toBe("player_one");
    expect(validated?.view.accountRole).toBe("PLAYER");
  });

  it("uses the same generic error for unknown username and wrong password and blocks banned accounts", async () => {
    const auth = service();
    await auth.register("player_two", PASSWORD);

    for (const attempt of [
      auth.login("missing_user", PASSWORD),
      auth.login("player_two", `${PASSWORD}-wrong`)
    ]) {
      await expect(attempt).rejects.toMatchObject({
        code: "INVALID_CREDENTIALS",
        status: 401
      });
    }

    await pool.query(
      "UPDATE accounts SET status = 'banned' WHERE username_normalized = 'player_two'"
    );
    await expect(auth.login("player_two", PASSWORD)).rejects.toMatchObject({
      code: "ACCOUNT_DISABLED",
      status: 403
    });
  });

  it("replaces the previous active session and logout revokes the current session", async () => {
    const auth = service();
    await auth.register("player_three", PASSWORD);

    const first = await auth.login("player_three", PASSWORD);
    const second = await auth.login("player_three", PASSWORD);

    expect(await auth.validateToken(first.token)).toBeNull();
    expect(await auth.validateToken(second.token)).not.toBeNull();

    await auth.logout(second.token);
    expect(await auth.validateToken(second.token)).toBeNull();
  });

  it("rejects expired sessions", async () => {
    const auth = service();
    await auth.register("player_expired", PASSWORD);
    const loggedIn = await auth.login("player_expired", PASSWORD);

    await pool.query(
      "UPDATE account_sessions SET expires_at = NOW() - INTERVAL '1 minute' WHERE token_hash = $1",
      [hashOpaqueSecret(loggedIn.token)]
    );

    expect(await auth.validateToken(loggedIn.token)).toBeNull();
  });

  it("recovers credentials atomically, rotates recovery code, and revokes sessions", async () => {
    const auth = service();
    const registered = await auth.register("player_recover", PASSWORD);
    const oldSession = await auth.login("player_recover", PASSWORD);

    const recovered = await auth.recover(
      "player_recover",
      registered.recoveryCode,
      NEW_PASSWORD
    );

    expect(recovered.response.recoveryCode).not.toBe(registered.recoveryCode);
    expect(await auth.validateToken(oldSession.token)).toBeNull();
    await expect(auth.login("player_recover", PASSWORD)).rejects.toBeInstanceOf(AuthError);
    await expect(auth.login("player_recover", NEW_PASSWORD)).resolves.toMatchObject({
      session: { accountUsername: "player_recover" }
    });

    await expect(
      auth.recover("player_recover", registered.recoveryCode, `${NEW_PASSWORD}-2`)
    ).rejects.toMatchObject({ code: "INVALID_RECOVERY_CODE", status: 401 });

    const account = await new AccountRepository(pool).findByNormalizedUsername("player_recover");
    expect(account?.recoveryCodeHash).toBe(
      hashOpaqueSecret(recovered.response.recoveryCode)
    );
    expect(JSON.stringify(account)).not.toContain(recovered.response.recoveryCode);
  });
});
