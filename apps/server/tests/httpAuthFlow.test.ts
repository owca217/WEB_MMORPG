import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { LoginResponse, RegisterResponse } from "@web-mmorpg/shared";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthService } from "../src/auth/AuthService";
import { runMigrations } from "../src/db/migrate";
import { createApiHandler } from "../src/http/createApiHandler";
import { AccountRepository } from "../src/persistence/AccountRepository";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for database tests.");

const pool = new Pool({ connectionString: databaseUrl });
const servers: Server[] = [];

beforeAll(async () => {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await runMigrations(pool);
});

beforeEach(async () => {
  await pool.query("TRUNCATE account_sessions, characters, accounts CASCADE");
});

afterAll(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
  await pool.end();
});

async function startApi() {
  const authService = new AuthService(pool, new AccountRepository(pool));
  const server = createServer(
    createApiHandler({ authService, clientOrigin: "https://client.test" })
  );
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

describe("auth HTTP API", () => {
  it("registers, logs in and validates a bearer session", async () => {
    const baseUrl = await startApi();

    const register = await fetch(baseUrl + "/api/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://client.test" },
      body: JSON.stringify({
        username: "Owczy217",
        password: "correct horse battery",
        passwordConfirmation: "correct horse battery"
      })
    });
    expect(register.status).toBe(201);
    const registered = (await register.json()) as RegisterResponse;
    expect(registered.recoveryCode).toBeTruthy();

    const login = await fetch(baseUrl + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://client.test" },
      body: JSON.stringify({
        username: "Owczy217",
        password: "correct horse battery"
      })
    });
    expect(login.status).toBe(200);
    const loggedIn = (await login.json()) as LoginResponse;

    const session = await fetch(baseUrl + "/api/auth/session", {
      headers: {
        authorization: `Bearer ${loggedIn.token}`,
        origin: "https://client.test"
      }
    });
    expect(session.status).toBe(200);
    expect(await session.json()).toMatchObject({
      accountUsername: "Owczy217",
      character: { state: "none" }
    });
  });

  it("does not allow an unapproved origin through CORS", async () => {
    const baseUrl = await startApi();
    const response = await fetch(baseUrl + "/api/auth/session", {
      headers: { origin: "https://evil.test" }
    });
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rate limits repeated failed authentication attempts", async () => {
    const baseUrl = await startApi();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(baseUrl + "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "missing", password: "incorrect password" })
      });
      expect(response.status).toBe(401);
    }

    const sixth = await fetch(baseUrl + "/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "missing", password: "incorrect password" })
    });

    expect(sixth.status).toBe(429);
  });
});
