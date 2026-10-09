import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { IconStorage } from "../src/admin/IconStorage";
import { AccountAdminError, AccountAdminService } from "../src/admin/AccountAdminService";
import { createAdminRouter } from "../src/admin/createAdminRouter";
import { AdminAuditRepository } from "../src/audit/AdminAuditRepository";
import { AuthService } from "../src/auth/AuthService";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { ItemCatalogService } from "../src/items/ItemCatalogService";
import { ItemMetadataRepository } from "../src/items/ItemMetadataRepository";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { AccountRepository } from "../src/persistence/AccountRepository";
import { ActiveConnectionRegistry } from "../src/server/ActiveConnectionRegistry";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const PASSWORD = "correct-horse-battery-staple";

class NoopIconStorage implements IconStorage {
  async putIcon() {
    return { key: "icons/noop.png", url: "https://assets.test/icons/noop.png" };
  }
}

describeDatabase("persistent ADMIN account access", () => {
  const pool = createPool(databaseUrl);
  let auth: AuthService;
  let accounts: AccountRepository;
  let accountAdmin: AccountAdminService;
  let audit: AdminAuditRepository;
  let app: express.Express;

  async function identity(username: string, role: "PLAYER" | "ADMIN" = "PLAYER") {
    await auth.register(username, PASSWORD);
    const account = await accounts.findByNormalizedUsername(username.toLowerCase());
    if (!account) throw new Error("ACCOUNT_NOT_CREATED");
    if (role !== account.role) await accounts.updateRole(account.id, role);
    const login = await auth.login(username, PASSWORD);
    return { accountId: account.id, token: login.token };
  }

  beforeEach(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
    await seedItemMetadata(pool);

    const lifecycle = new CharacterLifecycleService(pool);
    accounts = new AccountRepository(pool);
    auth = new AuthService(pool, accounts, lifecycle);
    audit = new AdminAuditRepository(pool);
    const connections = new ActiveConnectionRegistry();
    accountAdmin = new AccountAdminService(pool, audit, connections);
    const metadata = new ItemMetadataRepository(pool);
    const catalog = new ItemCatalogService(pool, metadata);

    app = express();
    app.use(express.json());
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

  it("rejects PLAYER access and ignores forged role/account fields", async () => {
    const player = await identity("plain_player");

    await request(app)
      .get("/api/admin/items")
      .set("Authorization", `Bearer ${player.token}`)
      .set("X-Account-Role", "ADMIN")
      .expect(403);

    await request(app)
      .put(`/api/admin/accounts/${player.accountId}/access`)
      .set("Authorization", `Bearer ${player.token}`)
      .send({ role: "ADMIN", actorAccountId: player.accountId, actorRole: "ADMIN" })
      .expect(403);

    expect((await accounts.findById(player.accountId))?.role).toBe("PLAYER");
  });

  it("lists accounts for ADMIN and applies role/status from persistent account state", async () => {
    const admin = await identity("admin_one", "ADMIN");
    const target = await identity("target_player");

    const listed = await request(app)
      .get("/api/admin/accounts?search=target&page=1&pageSize=10")
      .set("Authorization", `Bearer ${admin.token}`)
      .expect(200);

    expect(listed.body).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    expect(listed.body.accounts).toEqual([
      expect.objectContaining({
        id: target.accountId,
        username: "target_player",
        role: "PLAYER",
        status: "active"
      })
    ]);

    const promoted = await request(app)
      .put(`/api/admin/accounts/${target.accountId}/access`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ role: "ADMIN" })
      .expect(200);
    expect(promoted.body).toEqual(
      expect.objectContaining({ id: target.accountId, role: "ADMIN", status: "active" })
    );

    const targetAdminRequest = await request(app)
      .get("/api/admin/accounts")
      .set("Authorization", `Bearer ${target.token}`)
      .expect(200);
    expect(targetAdminRequest.body.total).toBeGreaterThanOrEqual(2);

    await request(app)
      .put(`/api/admin/accounts/${target.accountId}/access`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ status: "banned" })
      .expect(200);

    await request(app)
      .get("/api/admin/accounts")
      .set("Authorization", `Bearer ${target.token}`)
      .expect(403);
  });

  it("protects the last active ADMIN from demotion or ban", async () => {
    const admin = await identity("sole_admin", "ADMIN");

    const demote = await request(app)
      .put(`/api/admin/accounts/${admin.accountId}/access`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ role: "PLAYER" })
      .expect(409);
    expect(demote.body).toEqual(expect.objectContaining({ code: "LAST_ACTIVE_ADMIN" }));

    const ban = await request(app)
      .put(`/api/admin/accounts/${admin.accountId}/access`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ status: "banned" })
      .expect(409);
    expect(ban.body).toEqual(expect.objectContaining({ code: "LAST_ACTIVE_ADMIN" }));

    expect(await accounts.findById(admin.accountId)).toMatchObject({
      role: "ADMIN",
      status: "active"
    });
  });

  it("serializes concurrent changes so two final ADMINs cannot both stop being active admins", async () => {
    const first = await identity("admin_first", "ADMIN");
    const second = await identity("admin_second", "ADMIN");

    const results = await Promise.allSettled([
      accountAdmin.updateAccess(first.accountId, first.accountId, { role: "PLAYER" }),
      accountAdmin.updateAccess(second.accountId, second.accountId, { status: "banned" })
    ]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(AccountAdminError);
    expect((rejected[0] as PromiseRejectedResult).reason.code).toBe("LAST_ACTIVE_ADMIN");

    const activeAdmins = await pool.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM accounts WHERE role = 'ADMIN' AND status = 'active'"
    );
    expect(activeAdmins.rows[0]?.count).toBe("1");
  });

  it("audits account access changes with actor_account_id and without credential material", async () => {
    const admin = await identity("audit_admin", "ADMIN");
    const target = await identity("audit_target");

    await request(app)
      .put(`/api/admin/accounts/${target.accountId}/access`)
      .set("Authorization", `Bearer ${admin.token}`)
      .send({ role: "ADMIN", status: "banned", password: "should-not-appear", recoveryCode: "NOPE" })
      .expect(200);

    const entries = await audit.listForObject("account_access", target.accountId);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorAccountId: admin.accountId,
      action: "UPDATE_ACCOUNT_ACCESS",
      objectType: "account_access",
      objectId: target.accountId,
      summary: {
        previousRole: "PLAYER",
        newRole: "ADMIN",
        previousStatus: "active",
        newStatus: "banned"
      }
    });
    expect(JSON.stringify(entries[0])).not.toContain("should-not-appear");
    expect(JSON.stringify(entries[0])).not.toContain("NOPE");
  });
});
