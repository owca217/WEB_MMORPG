import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AuthService } from "../src/auth/AuthService";
import { requireAuthContext } from "../src/auth/AuthContext";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { createAuthRouter } from "../src/http/createAuthRouter";
import { AccountRepository } from "../src/persistence/AccountRepository";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const PASSWORD = "correct-horse-battery-staple";

describeDatabase("account auth REST API", () => {
  const pool = createPool(databaseUrl);
  let auth: AuthService;
  let characters: CharacterLifecycleService;
  let app: express.Express;

  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
    characters = new CharacterLifecycleService(pool);
    auth = new AuthService(pool, new AccountRepository(pool), characters);
    app = express();
    app.use(express.json());
    app.use("/api", createAuthRouter({ authService: auth, characterService: characters }));
  });

  afterAll(async () => {
    await pool.end();
  });

  it("registers PLAYER without auto-login and ignores forged role/status fields", async () => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({
        username: "new_player",
        password: PASSWORD,
        passwordConfirmation: PASSWORD,
        role: "ADMIN",
        status: "active"
      })
      .expect(201);

    expect(response.body.recoveryCode).toBeTruthy();
    expect(response.body.token).toBeUndefined();
    expect(response.body.session).toBeUndefined();

    const account = await new AccountRepository(pool).findByNormalizedUsername("new_player");
    expect(account?.role).toBe("PLAYER");
  });

  it("validates password confirmation and maps bad credentials generically", async () => {
    await request(app)
      .post("/api/auth/register")
      .send({ username: "mismatch", password: PASSWORD, passwordConfirmation: `${PASSWORD}-x` })
      .expect(400, expect.objectContaining({ code: "PASSWORD_MISMATCH" }));

    await request(app)
      .post("/api/auth/login")
      .send({ username: "missing", password: PASSWORD })
      .expect(401, expect.objectContaining({ code: "INVALID_CREDENTIALS" }));
  });

  it("logs in, resumes the session, creates/reads a character, and logs out", async () => {
    const registered = await request(app)
      .post("/api/auth/register")
      .send({ username: "api_player", password: PASSWORD, passwordConfirmation: PASSWORD })
      .expect(201);
    expect(registered.body.recoveryCode).toBeTruthy();

    const login = await request(app)
      .post("/api/auth/login")
      .send({ username: "api_player", password: PASSWORD })
      .expect(200);
    const token = String(login.body.token);
    expect(login.body.session.character).toEqual({ state: "none" });

    await request(app)
      .get("/api/auth/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(200, expect.objectContaining({ accountUsername: "api_player", accountRole: "PLAYER" }));

    await request(app)
      .post("/api/character")
      .set("Authorization", `Bearer ${token}`)
      .send({ nickname: "ApiHero", appearance: {} })
      .expect(201, expect.objectContaining({ nickname: "ApiHero" }));

    await request(app)
      .get("/api/character")
      .set("Authorization", `Bearer ${token}`)
      .expect(200, expect.objectContaining({ nickname: "ApiHero" }));

    await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
    await request(app)
      .get("/api/auth/session")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);
  });

  it("recovers the account, rotates recovery code, and keeps error response generic", async () => {
    const registration = await request(app)
      .post("/api/auth/register")
      .send({ username: "recover_api", password: PASSWORD, passwordConfirmation: PASSWORD })
      .expect(201);

    const newPassword = `${PASSWORD}-new`;
    const recovered = await request(app)
      .post("/api/auth/recover")
      .send({
        username: "recover_api",
        recoveryCode: registration.body.recoveryCode,
        newPassword,
        passwordConfirmation: newPassword
      })
      .expect(200);
    expect(recovered.body.recoveryCode).toBeTruthy();
    expect(recovered.body.recoveryCode).not.toBe(registration.body.recoveryCode);

    await request(app)
      .post("/api/auth/recover")
      .send({
        username: "missing_api",
        recoveryCode: "AAAA-BBBB-CCCC-DDDD",
        newPassword,
        passwordConfirmation: newPassword
      })
      .expect(401, expect.objectContaining({ code: "INVALID_RECOVERY_CODE" }));
  });

  it("returns 403 for a banned account whose otherwise-valid session is reused", async () => {
    await auth.register("ban_me", PASSWORD);
    const login = await auth.login("ban_me", PASSWORD);
    await pool.query("UPDATE accounts SET status = 'banned' WHERE username_normalized = 'ban_me'");

    await request(app)
      .get("/api/auth/session")
      .set("Authorization", `Bearer ${login.token}`)
      .expect(403, expect.objectContaining({ code: "ACCOUNT_DISABLED" }));
  });

  it("derives AuthContext from the bearer session and ignores forged identity fields", async () => {
    await auth.register("context_player", PASSWORD);
    const login = await auth.login("context_player", PASSWORD);
    const account = await new AccountRepository(pool).findByNormalizedUsername("context_player");
    if (!account) throw new Error("ACCOUNT_MISSING");
    const character = await characters.createCharacter(account.id, { nickname: "ContextHero", appearance: {} });

    const context = await requireAuthContext(auth, `Bearer ${login.token}`);
    expect(context).toEqual({
      accountId: account.id,
      sessionId: expect.any(String),
      role: "PLAYER",
      characterId: character.id
    });

    const forged = { role: "ADMIN", accountId: randomUUID(), characterId: randomUUID() };
    expect(forged).not.toMatchObject(context);
  });

  it("rate limits repeated authentication attempts", async () => {
    for (let index = 0; index < 8; index += 1) {
      await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", "203.0.113.10")
        .send({ username: "missing", password: PASSWORD });
    }
    await request(app)
      .post("/api/auth/login")
      .set("X-Forwarded-For", "203.0.113.10")
      .send({ username: "missing", password: PASSWORD })
      .expect(429, expect.objectContaining({ code: "RATE_LIMITED" }));
  });
});
