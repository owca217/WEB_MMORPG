import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { AccountRepository } from "../src/persistence/AccountRepository";
import { AuthService } from "../src/auth/AuthService";
import { GoogleAuthService } from "../src/auth/GoogleAuthService";
import { createGoogleAuthRouter } from "../src/http/createGoogleAuthRouter";
import { AuthRateLimiter } from "../src/http/AuthRateLimiter";

const url = process.env.GOOGLE_AUTH_TEST_DATABASE_URL;
if (url && (new URL(url).hostname !== "127.0.0.1" || new URL(url).pathname !== "/google_auth_tests")) throw new Error("Dedicated local test database required");
const databaseTests = url ? describe : describe.skip;
databaseTests("Google authentication HTTP boundary", () => {
  const pool = createPool(url);
  let auth: AuthService;
  let google: GoogleAuthService;
  const PASSWORD = "correct-horse-battery-staple";
  const verifier = { verify: async (token: string) => JSON.parse(token) };
  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
    auth = new AuthService(pool, new AccountRepository(pool));
    google = new GoogleAuthService(pool, auth, "test.apps.googleusercontent.com", verifier);
  });
  afterAll(async () => { await pool.end(); });
  function app(limit = 8) {
    const app = express();
    app.use(express.json());
    app.use("/api", createGoogleAuthRouter({ authService: auth, googleService: google, rateLimiter: new AuthRateLimiter(limit) }));
    return app;
  }
  it("exposes only public configuration and accepts a verified Google login", async () => {
    const http = app();
    expect((await request(http).get("/api/auth/providers").expect(200)).body).toEqual({ google: { enabled: true, clientId: "test.apps.googleusercontent.com" } });
    const challenge = (await request(http).post("/api/auth/google/challenge").send({ intent: "login" }).expect(200)).body;
    const response = await request(http).post("/api/auth/google/login").send({ challengeId: challenge.challengeId, idToken: JSON.stringify({ subject: "one", nonce: challenge.nonce }), role: "ADMIN" }).expect(200);
    expect(response.body.session.accountRole).toBe("PLAYER");
    expect((await auth.validateToken(response.body.token))?.account.role).toBe("PLAYER");
    expect(response.body.accountId).toBeUndefined();
  });
  it("requires bearer authentication and the game password to link", async () => {
    const http = app();
    await request(http).post("/api/auth/google/challenge").send({ intent: "link" }).expect(401);
    await request(http).get("/api/account/google").expect(401);
    await auth.register("old_player", PASSWORD);
    const login = await auth.login("old_player", PASSWORD);
    const bearer = `Bearer ${login.token}`;
    expect((await request(http).get("/api/account/google").set("Authorization", bearer).expect(200)).body).toEqual({ linked: false, canLink: true, googleEnabled: true });
    const challenge = (await request(http).post("/api/auth/google/challenge").set("Authorization", bearer).send({ intent: "link" }).expect(200)).body;
    const body = { challengeId: challenge.challengeId, idToken: JSON.stringify({ subject: "one", nonce: challenge.nonce }) };
    await request(http).post("/api/account/google/link").set("Authorization", bearer).send(body).expect(401);
    const linked = await request(http).post("/api/account/google/link").set("Authorization", bearer).send({ ...body, password: PASSWORD }).expect(200);
    expect(linked.body).toEqual({ linked: true, canLink: false, googleEnabled: true });
  });
  it("rejects malformed attempts and rate-limits challenge generation", async () => {
    const http = app(2);
    await request(http).post("/api/auth/google/challenge").send({ intent: "other" }).expect(400);
    await request(http).post("/api/auth/google/login").send({ challengeId: "malformed", idToken: "" }).expect(401);
    await request(http).post("/api/auth/google/challenge").send({ intent: "login" }).expect(200);
    expect((await request(http).post("/api/auth/google/challenge").send({ intent: "login" }).expect(429)).body.code).toBe("RATE_LIMITED");
  });
});
