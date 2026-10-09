import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ItemDraftInput } from "@web-mmorpg/shared";
import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AccountAdminService } from "../src/admin/AccountAdminService";
import type { IconStorage } from "../src/admin/IconStorage";
import { createAdminRouter } from "../src/admin/createAdminRouter";
import { AdminAuditRepository } from "../src/audit/AdminAuditRepository";
import { AuthService } from "../src/auth/AuthService";
import { bootstrapInitialAdmin } from "../src/auth/bootstrapInitialAdmin";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { createAuthRouter } from "../src/http/createAuthRouter";
import { ItemCatalogService } from "../src/items/ItemCatalogService";
import { ItemMetadataRepository } from "../src/items/ItemMetadataRepository";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { AccountRepository } from "../src/persistence/AccountRepository";
import { ActiveConnectionRegistry } from "../src/server/ActiveConnectionRegistry";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const PLAYER_PASSWORD = "correct-horse-battery-staple";
const ADMIN_PASSWORD = "bootstrap-admin-password-2026";
const ADMIN_RECOVERY = "ABCD-EFGH-IJKL-MNOP";

class NoopIconStorage implements IconStorage {
  async putIcon() {
    return { key: "icons/noop.png", url: "https://assets.test/icons/noop.png" };
  }
}

function draft(): ItemDraftInput {
  return {
    itemId: "auth-e2e-token",
    name: "Token Strażnika",
    categoryId: "special",
    description: "Przedmiot publikowany w końcowym E2E kont.",
    rarity: "COMMON",
    itemLevel: 1,
    minimumLevel: 1,
    sellValue: 0,
    sellable: false,
    tradable: false,
    droppable: false,
    stackable: true,
    maxStack: 99,
    weight: 0,
    soulbound: "NONE",
    unique: false,
    tags: ["auth-e2e"],
    stats: [],
    requirements: [],
    effects: [],
    specialData: {}
  };
}

describeDatabase("final persistent account authentication E2E", () => {
  const pool = createPool(databaseUrl);
  let app: express.Express;

  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
    await seedItemMetadata(pool);

    await bootstrapInitialAdmin(pool, {
      INITIAL_ADMIN_USERNAME: "BootstrapAdmin",
      INITIAL_ADMIN_PASSWORD: ADMIN_PASSWORD,
      INITIAL_ADMIN_RECOVERY_CODE: ADMIN_RECOVERY
    });

    const characters = new CharacterLifecycleService(pool);
    const accounts = new AccountRepository(pool);
    const auth = new AuthService(pool, accounts, characters);
    const audit = new AdminAuditRepository(pool);
    const connections = new ActiveConnectionRegistry();
    const accountAdmin = new AccountAdminService(pool, audit, connections);
    const metadata = new ItemMetadataRepository(pool);
    const catalog = new ItemCatalogService(pool, metadata);

    app = express();
    app.use(express.json());
    app.use("/api", createAuthRouter({ authService: auth, characterService: characters, connections }));
    app.use(
      "/api/admin",
      createAdminRouter({
        authService: auth,
        accountAdmin,
        metadata,
        catalog,
        audit,
        iconStorage: new NoopIconStorage()
      })
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("runs PLAYER registration through ADMIN promotion and recovery without temporary admin tokens", async () => {
    const registered = await request(app)
      .post("/api/auth/register")
      .send({
        username: "E2EPlayer",
        password: PLAYER_PASSWORD,
        passwordConfirmation: PLAYER_PASSWORD
      })
      .expect(201);
    const recoveryCode = String(registered.body.recoveryCode);
    expect(recoveryCode).toBeTruthy();
    expect(registered.body.token).toBeUndefined();

    const playerLogin = await request(app)
      .post("/api/auth/login")
      .send({ username: "E2EPlayer", password: PLAYER_PASSWORD })
      .expect(200);
    const playerToken = String(playerLogin.body.token);
    expect(playerLogin.body.session).toMatchObject({
      accountUsername: "E2EPlayer",
      accountRole: "PLAYER",
      character: { state: "none" }
    });

    await request(app)
      .post("/api/character")
      .set("Authorization", `Bearer ${playerToken}`)
      .send({ nickname: "E2EHero", appearance: { bodyType: "balanced" } })
      .expect(201);

    const resumed = await request(app)
      .get("/api/auth/session")
      .set("Authorization", `Bearer ${playerToken}`)
      .expect(200);
    expect(resumed.body.character).toMatchObject({ state: "active", nickname: "E2EHero" });

    await request(app)
      .get("/api/admin/items")
      .set("Authorization", `Bearer ${playerToken}`)
      .expect(403);

    const adminLogin = await request(app)
      .post("/api/auth/login")
      .send({ username: "BootstrapAdmin", password: ADMIN_PASSWORD })
      .expect(200);
    const adminToken = String(adminLogin.body.token);
    expect(adminLogin.body.session.accountRole).toBe("ADMIN");

    const created = await request(app)
      .post("/api/admin/items")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(draft())
      .expect(201);
    await request(app)
      .post("/api/admin/items/auth-e2e-token/publish")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ expectedRevision: created.body.revision })
      .expect(200);

    const accounts = await request(app)
      .get("/api/admin/accounts?search=E2EPlayer")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    const playerAccountId = String(accounts.body.accounts[0].id);

    await request(app)
      .put(`/api/admin/accounts/${playerAccountId}/access`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ role: "ADMIN" })
      .expect(200);

    await request(app)
      .get("/api/admin/accounts")
      .set("Authorization", `Bearer ${playerToken}`)
      .expect(200);

    const newPassword = `${PLAYER_PASSWORD}-new`;
    const recovered = await request(app)
      .post("/api/auth/recover")
      .send({
        username: "E2EPlayer",
        recoveryCode,
        newPassword,
        passwordConfirmation: newPassword
      })
      .expect(200);
    expect(recovered.body.recoveryCode).toBeTruthy();
    expect(recovered.body.recoveryCode).not.toBe(recoveryCode);

    await request(app)
      .get("/api/auth/session")
      .set("Authorization", `Bearer ${playerToken}`)
      .expect(401);

    const relogin = await request(app)
      .post("/api/auth/login")
      .send({ username: "E2EPlayer", password: newPassword })
      .expect(200);
    expect(relogin.body.session).toMatchObject({
      accountRole: "ADMIN",
      character: { state: "active", nickname: "E2EHero" }
    });
  });

  it("has no legacy in-memory SessionStore runtime file", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const legacy = resolve(here, "../src/session/SessionStore.ts");
    expect(existsSync(legacy)).toBe(false);
  });
});
