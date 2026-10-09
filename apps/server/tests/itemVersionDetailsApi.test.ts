import type { ItemDraftInput } from "@web-mmorpg/shared";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AccountAdminService } from "../src/admin/AccountAdminService";
import type { IconStorage } from "../src/admin/IconStorage";
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

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const PASSWORD = "correct-horse-battery-staple";

function draft(): ItemDraftInput {
  return {
    itemId: "history-api-sword",
    name: "History Sword",
    categoryId: "weapon",
    subcategoryId: "sword",
    description: "Historical definition",
    rarity: "RARE",
    itemLevel: 10,
    minimumLevel: 1,
    sellValue: 10,
    sellable: true,
    tradable: true,
    droppable: true,
    stackable: false,
    maxStack: 1,
    weight: 2,
    soulbound: "NONE",
    unique: false,
    tags: ["history"],
    stats: [{ statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 25 }],
    requirements: [],
    effects: [],
    specialData: {}
  };
}

const icons: IconStorage = {
  async putIcon() {
    return { key: "icons/unused.png", url: "https://assets.example.test/icons/unused.png" };
  }
};

describeDatabase("ADMIN historical item version endpoint", () => {
  const pool = createPool(databaseUrl);
  let app: express.Express;
  let token: string;

  beforeAll(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
    await seedItemMetadata(pool);
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE item_instances, item_tags, item_effects, item_requirements,
       item_stat_modifiers, item_versions, items, admin_audit_log,
       account_sessions, characters, accounts CASCADE`
    );
    await seedItemMetadata(pool);

    const lifecycle = new CharacterLifecycleService(pool);
    const accounts = new AccountRepository(pool);
    const auth = new AuthService(pool, accounts, lifecycle);
    await auth.register("HistoryAdmin", PASSWORD);
    const admin = await accounts.findByNormalizedUsername("historyadmin");
    if (!admin) throw new Error("HISTORY_ADMIN_ACCOUNT_MISSING");
    await accounts.updateRole(admin.id, "ADMIN");
    token = (await auth.login("HistoryAdmin", PASSWORD)).token;

    const metadata = new ItemMetadataRepository(pool);
    const catalog = new ItemCatalogService(pool, metadata);
    const audit = new AdminAuditRepository(pool);
    const accountAdmin = new AccountAdminService(pool, audit);
    await catalog.createDraft(draft(), admin.id);
    await catalog.publish("history-api-sword", 1, admin.id);

    app = express();
    app.use(express.json());
    app.use(
      "/api/admin",
      createAdminRouter({ authService: auth, accountAdmin, metadata, catalog, audit, iconStorage: icons })
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("returns the complete requested historical definition", async () => {
    const response = await request(app)
      .get("/api/admin/items/history-api-sword/versions/1")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body).toMatchObject({
      itemId: "history-api-sword",
      versionNo: 1,
      state: "PUBLISHED",
      rarity: "RARE",
      stats: [{ statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 25 }]
    });
  });
});
