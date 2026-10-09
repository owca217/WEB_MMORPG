import type { ItemDraftInput } from "@web-mmorpg/shared";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AdminAuditRepository } from "../src/audit/AdminAuditRepository";
import type { IconStorage } from "../src/admin/IconStorage";
import { createAdminRouter } from "../src/admin/createAdminRouter";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { ItemCatalogService } from "../src/items/ItemCatalogService";
import { ItemMetadataRepository } from "../src/items/ItemMetadataRepository";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { SessionStore } from "../src/session/SessionStore";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const originalAdminToken = process.env.ADMIN_ACCESS_TOKEN;

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
    specialData: {},
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
    process.env.ADMIN_ACCESS_TOKEN = "history-api-secret";
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
    await seedItemMetadata(pool);
  });

  beforeEach(async () => {
    await pool.query(
      `TRUNCATE item_instances, item_tags, item_effects, item_requirements,
       item_stat_modifiers, item_versions, items, admin_audit_log CASCADE`
    );
    await seedItemMetadata(pool);

    const sessions = new SessionStore();
    const login = sessions.login("HistoryAdmin", "history-api-secret");
    if (!login.ok) throw new Error("HISTORY_ADMIN_LOGIN_FAILED");
    token = login.sessionToken;

    const metadata = new ItemMetadataRepository(pool);
    const catalog = new ItemCatalogService(pool, metadata);
    const audit = new AdminAuditRepository(pool);
    await catalog.createDraft(draft(), login.playerId);
    await catalog.publish("history-api-sword", 1, login.playerId);

    app = express();
    app.use(express.json());
    app.use(
      "/api/admin",
      createAdminRouter({ sessions, metadata, catalog, audit, iconStorage: icons })
    );
  });

  afterAll(async () => {
    if (originalAdminToken === undefined) delete process.env.ADMIN_ACCESS_TOKEN;
    else process.env.ADMIN_ACCESS_TOKEN = originalAdminToken;
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
