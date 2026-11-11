import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { AccountRepository } from "../src/persistence/AccountRepository";
import { AuthService } from "../src/auth/AuthService";
import { GoogleAuthService } from "../src/auth/GoogleAuthService";
import type { AuthContext } from "../src/auth/AuthContext";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";

const url = process.env.GOOGLE_AUTH_TEST_DATABASE_URL;
if (url && (new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/google_auth_tests")) {
  throw new Error("Google auth tests require the dedicated disposable localhost database");
}
const databaseTests = url ? describe : describe.skip;
const PASSWORD = "correct-horse-battery-staple";

databaseTests("optional Google account authentication", () => {
  const pool = createPool(url);
  let auth: AuthService;
  let google: GoogleAuthService;
  let now: Date;
  const verifier = { verify: async (token: string) => JSON.parse(token) as { subject: string; nonce: string } };

  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
    now = new Date();
    auth = new AuthService(pool, new AccountRepository(pool));
    google = new GoogleAuthService(pool, auth, "test.apps.googleusercontent.com", verifier, () => now);
  });
  afterAll(async () => { await pool.end(); });

  function token(challenge: { nonce: string }, subject = "google-user-1"): string {
    return JSON.stringify({ subject, nonce: challenge.nonce });
  }
  async function local(name = "old_player"): Promise<{ accountId: string; context: AuthContext; passwordHash: string | null; recoveryCodeHash: string | null }> {
    await auth.register(name, PASSWORD);
    const login = await auth.login(name, PASSWORD);
    const session = (await auth.validateToken(login.token))!;
    return { accountId: login.accountId, context: { accountId: login.accountId, sessionId: session.session.id, role: session.account.role }, passwordHash: session.account.passwordHash, recoveryCodeHash: session.account.recoveryCodeHash };
  }

  it("creates a private PLAYER account and returns the same account on later Google login", async () => {
    const first = await google.createChallenge("login");
    const login = await google.login(first.challengeId, token(first));
    const account = await new AccountRepository(pool).findById(login.accountId);
    expect(account).toMatchObject({ role: "PLAYER", status: "active", passwordHash: null, recoveryCodeHash: null });
    expect(account?.username).toMatch(/^gracz_[a-f0-9]{24}$/);
    expect((await auth.validateToken(login.token))?.account.id).toBe(login.accountId);
    const next = await google.createChallenge("login");
    const returned = await google.login(next.challengeId, token(next));
    expect(returned.accountId).toBe(login.accountId);
    expect(await auth.validateToken(login.token)).toBeNull();
    expect((await pool.query("SELECT count(*) FROM accounts")).rows[0].count).toBe("1");
    await expect(auth.login(account!.username, PASSWORD)).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    await expect(auth.recover(account!.username, "ANY-CODE", PASSWORD)).rejects.toMatchObject({ code: "INVALID_RECOVERY_CODE" });
  });

  it("serializes concurrent first logins without orphan accounts", async () => {
    const challenges = await Promise.all([google.createChallenge("login"), google.createChallenge("login")]);
    const logins = await Promise.all(challenges.map(c => google.login(c.challengeId, token(c))));
    expect(logins[0]!.accountId).toBe(logins[1]!.accountId);
    expect((await pool.query("SELECT count(*) FROM accounts")).rows[0].count).toBe("1");
    expect((await pool.query("SELECT count(*) FROM account_google_identities")).rows[0].count).toBe("1");
  });

  it.each(["google", "password"] as const)("completes %s login with a real lifecycle reader and only one pooled connection", async method => {
    const single = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 300 });
    try {
      const singleAuth = new AuthService(single, new AccountRepository(single), new CharacterLifecycleService(single));
      if (method === "google") {
        const singleGoogle = new GoogleAuthService(single, singleAuth, "test.apps.googleusercontent.com", verifier);
        const challenge = await singleGoogle.createChallenge("login");
        await expect(singleGoogle.login(challenge.challengeId, token(challenge))).resolves.toMatchObject({ session: { character: { state: "none" } } });
      } else {
        await singleAuth.register("single_player", PASSWORD);
        await expect(singleAuth.login("single_player", PASSWORD)).resolves.toMatchObject({ session: { character: { state: "none" } } });
      }
    } finally { await single.end(); }
  });

  it("links only after password confirmation and preserves local credentials and character data", async () => {
    const old = await local();
    await pool.query("INSERT INTO characters (id, account_id, nickname, nickname_normalized, appearance, location_id, x, y) VALUES ($1, $2, 'Stary Gracz', 'stary gracz', '{}', 'village', 1, 2)", [randomUUID(), old.accountId]);
    const before = (await pool.query("SELECT * FROM characters WHERE account_id=$1", [old.accountId])).rows;
    const challenge = await google.createChallenge("link", old.context);
    await expect(google.link(old.context, challenge.challengeId, token(challenge), "incorrect")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(await google.getStatus(old.accountId)).toMatchObject({ linked: false, canLink: true });
    await expect(google.link(old.context, challenge.challengeId, token(challenge), PASSWORD)).resolves.toMatchObject({ linked: true });
    const account = await new AccountRepository(pool).findById(old.accountId);
    expect(account).toMatchObject({ username: "old_player", passwordHash: old.passwordHash, recoveryCodeHash: old.recoveryCodeHash });
    expect((await pool.query("SELECT * FROM characters WHERE account_id=$1", [old.accountId])).rows).toEqual(before);
    const signIn = await google.createChallenge("login");
    expect((await google.login(signIn.challengeId, token(signIn))).accountId).toBe(old.accountId);
    expect((await auth.login("old_player", PASSWORD)).accountId).toBe(old.accountId);
  });

  it("rejects conflicting links and keeps both local accounts intact", async () => {
    const a = await local("player_one");
    const b = await local("player_two");
    const ca = await google.createChallenge("link", a.context);
    await google.link(a.context, ca.challengeId, token(ca), PASSWORD);
    const cb = await google.createChallenge("link", b.context);
    await expect(google.link(b.context, cb.challengeId, token(cb), PASSWORD)).rejects.toMatchObject({ code: "GOOGLE_ALREADY_LINKED", status: 409 });
    expect(await google.getStatus(b.accountId)).toMatchObject({ linked: false });
    const repeat = await google.createChallenge("link", a.context);
    await expect(google.link(a.context, repeat.challengeId, token(repeat), PASSWORD)).resolves.toMatchObject({ linked: true });
    const change = await google.createChallenge("link", a.context);
    await expect(google.link(a.context, change.challengeId, token(change, "another-google"), PASSWORD)).rejects.toMatchObject({ code: "GOOGLE_ALREADY_LINKED" });
    expect((await pool.query("SELECT count(*) FROM accounts")).rows[0].count).toBe("2");
  });

  it("rejects mismatched, expired, replayed and wrong-intent challenges before account mutation", async () => {
    const mismatch = await google.createChallenge("login");
    await expect(google.login(mismatch.challengeId, token({ nonce: "wrong" }))).rejects.toMatchObject({ code: "GOOGLE_CHALLENGE_INVALID" });
    const expired = await google.createChallenge("login");
    now = new Date(now.getTime() + 301_000);
    await expect(google.login(expired.challengeId, token(expired))).rejects.toMatchObject({ code: "GOOGLE_CHALLENGE_INVALID" });
    expect((await pool.query("SELECT count(*) FROM accounts")).rows[0].count).toBe("0");
    const valid = await google.createChallenge("login");
    await google.login(valid.challengeId, token(valid));
    await expect(google.login(valid.challengeId, token(valid))).rejects.toMatchObject({ code: "GOOGLE_CHALLENGE_INVALID" });
    const old = await local();
    const link = await google.createChallenge("link", old.context);
    await expect(google.login(link.challengeId, token(link))).rejects.toMatchObject({ code: "GOOGLE_CHALLENGE_INVALID" });
    const login = await google.createChallenge("login");
    await expect(google.link(old.context, login.challengeId, token(login), PASSWORD)).rejects.toMatchObject({ code: "GOOGLE_CHALLENGE_INVALID" });
  });

  it("binds linking to the current account and live session", async () => {
    const a = await local("player_one");
    const b = await local("player_two");
    const challenge = await google.createChallenge("link", a.context);
    await expect(google.link(b.context, challenge.challengeId, token(challenge), PASSWORD)).rejects.toMatchObject({ code: "GOOGLE_CHALLENGE_INVALID" });
    await auth.login("player_one", PASSWORD);
    await expect(google.link(a.context, challenge.challengeId, token(challenge), PASSWORD)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect((await pool.query("SELECT count(*) FROM account_google_identities")).rows[0].count).toBe("0");
  });

  it("does not bypass account disablement and does not enable Google without configuration", async () => {
    const challenge = await google.createChallenge("login");
    const login = await google.login(challenge.challengeId, token(challenge));
    await new AccountRepository(pool).updateStatus(login.accountId, "banned");
    const next = await google.createChallenge("login");
    await expect(google.login(next.challengeId, token(next))).rejects.toMatchObject({ code: "ACCOUNT_DISABLED" });
    const disabled = new GoogleAuthService(pool, auth, null, verifier);
    expect(disabled.providers()).toEqual({ google: { enabled: false, clientId: null } });
    await expect(disabled.createChallenge("login")).rejects.toMatchObject({ code: "GOOGLE_UNAVAILABLE" });
  });
});
