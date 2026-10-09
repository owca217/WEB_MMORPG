import type { ItemDraftInput } from "@web-mmorpg/shared";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AccountAdminService } from "../src/admin/AccountAdminService";
import type { IconStorage, IconUploadInput } from "../src/admin/IconStorage";
import { createAdminRouter } from "../src/admin/createAdminRouter";
import { AdminAuditRepository } from "../src/audit/AdminAuditRepository";
import { AuthService } from "../src/auth/AuthService";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { InventoryService } from "../src/inventory/InventoryService";
import { ItemCatalogService } from "../src/items/ItemCatalogService";
import { ItemMetadataRepository } from "../src/items/ItemMetadataRepository";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { AccountRepository } from "../src/persistence/AccountRepository";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const PASSWORD = "correct-horse-battery-staple";

function sword(overrides: Partial<ItemDraftInput> = {}): ItemDraftInput {
  return {
    itemId: "e2e-storm-sword",
    name: "Miecz Burzy",
    categoryId: "weapon",
    subcategoryId: "sword",
    description: "Miecz przechodzący pełny test kreatora.",
    rarity: "RARE",
    itemLevel: 12,
    minimumLevel: 8,
    sellValue: 350,
    sellable: true,
    tradable: true,
    droppable: true,
    stackable: false,
    maxStack: 1,
    weight: 2.5,
    soulbound: "NONE",
    unique: false,
    tags: ["e2e", "storm"],
    stats: [
      { statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 24 },
      { statCode: "CRIT_CHANCE", modifierType: "percent", value: 5 }
    ],
    requirements: [{ type: "LEVEL", value: 8 }],
    effects: [],
    specialData: { weaponFamily: "sword" },
    ...overrides
  };
}

class FakeIconStorage implements IconStorage {
  readonly writes: IconUploadInput[] = [];

  async putIcon(input: IconUploadInput) {
    this.writes.push(input);
    return {
      key: "icons/e2e-storm-sword.png",
      url: "https://assets.example.test/icons/e2e-storm-sword.png"
    };
  }
}

describeDatabase("item creator end-to-end acceptance", () => {
  const pool = createPool(databaseUrl);
  let metadata: ItemMetadataRepository;
  let catalog: ItemCatalogService;
  let audit: AdminAuditRepository;
  let icons: FakeIconStorage;
  let app: express.Express;
  let adminToken: string;
  let adminAccountId: string;
  let inventoryCharacterId: string;

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

    metadata = new ItemMetadataRepository(pool);
    catalog = new ItemCatalogService(pool, metadata);
    audit = new AdminAuditRepository(pool);
    icons = new FakeIconStorage();

    const lifecycle = new CharacterLifecycleService(pool);
    const accounts = new AccountRepository(pool);
    const authService = new AuthService(pool, accounts, lifecycle);
    const accountAdmin = new AccountAdminService(pool, audit);

    await authService.register("E2EAdmin", PASSWORD);
    const admin = await accounts.findByNormalizedUsername("e2eadmin");
    if (!admin) throw new Error("E2E_ADMIN_ACCOUNT_MISSING");
    await accounts.updateRole(admin.id, "ADMIN");
    adminAccountId = admin.id;
    adminToken = (await authService.login("E2EAdmin", PASSWORD)).token;

    await authService.register("E2EInventory", PASSWORD);
    const inventoryAccount = await accounts.findByNormalizedUsername("e2einventory");
    if (!inventoryAccount) throw new Error("E2E_INVENTORY_ACCOUNT_MISSING");
    const inventoryCharacter = await lifecycle.createCharacter(inventoryAccount.id, {
      nickname: "InventoryHero",
      appearance: {}
    });
    inventoryCharacterId = inventoryCharacter.id;

    app = express();
    app.use(express.json());
    app.use(
      "/api/admin",
      createAdminRouter({
        authService,
        accountAdmin,
        metadata,
        catalog,
        audit,
        iconStorage: icons
      })
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  it("runs ADMIN metadata -> draft -> icon -> publish v1/v2 -> restore v1 as v3 -> archive with audit and persistent inventory", async () => {
    const auth = { Authorization: `Bearer ${adminToken}` };

    const metadataResponse = await request(app)
      .get("/api/admin/item-metadata")
      .set(auth)
      .expect(200);
    expect(metadataResponse.body.categories).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "weapon" })])
    );
    expect(metadataResponse.body.subcategories).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "sword", categoryId: "weapon" })])
    );
    expect(metadataResponse.body.stats).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "PHYSICAL_DAMAGE" })])
    );

    const created = await request(app)
      .post("/api/admin/items")
      .set(auth)
      .send(sword())
      .expect(201);
    expect(created.body).toMatchObject({ itemId: "e2e-storm-sword", versionNo: 1, revision: 1 });

    const icon = await request(app)
      .post("/api/admin/icons")
      .set(auth)
      .attach("icon", Buffer.from("fake-png-bytes"), {
        filename: "storm-sword.png",
        contentType: "image/png"
      })
      .expect(201);
    expect(icon.body).toEqual({
      key: "icons/e2e-storm-sword.png",
      url: "https://assets.example.test/icons/e2e-storm-sword.png"
    });
    expect(icons.writes).toHaveLength(1);

    const v1Draft = sword({
      iconKey: icon.body.key,
      iconUrl: icon.body.url,
      stats: [
        { statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 30 },
        { statCode: "CRIT_CHANCE", modifierType: "percent", value: 7.5 }
      ],
      effects: [
        {
          triggerCode: "ON_HIT",
          effectCode: "DEAL_DAMAGE",
          value: 8,
          chance: 0.25,
          cooldownMs: 1500
        }
      ]
    });
    const savedV1 = await request(app)
      .put("/api/admin/items/e2e-storm-sword/draft")
      .set(auth)
      .send({ expectedRevision: 1, draft: v1Draft })
      .expect(200);
    expect(savedV1.body).toMatchObject({ revision: 2, versionNo: 1 });

    const publishedV1 = await request(app)
      .post("/api/admin/items/e2e-storm-sword/publish")
      .set(auth)
      .send({ expectedRevision: 2 })
      .expect(200);
    expect(publishedV1.body).toMatchObject({ versionNo: 1, state: "PUBLISHED", name: "Miecz Burzy" });

    const inventory = new InventoryService(pool);
    await inventory.addItems(inventoryCharacterId, [{ itemId: "e2e-storm-sword", quantity: 1 }]);
    const instanceBefore = (await inventory.getSnapshot(inventoryCharacterId)).items[0]!;
    expect(instanceBefore).toMatchObject({
      itemId: "e2e-storm-sword",
      name: "Miecz Burzy",
      quantity: 1
    });

    const catalogV1 = await request(app)
      .get("/api/admin/items?itemId=e2e-storm-sword&status=PUBLISHED")
      .set(auth)
      .expect(200);
    expect(catalogV1.body).toMatchObject({ total: 1 });

    const historyV1 = await request(app)
      .get("/api/admin/items/e2e-storm-sword/versions")
      .set(auth)
      .expect(200);
    expect(historyV1.body).toEqual([
      expect.objectContaining({ versionNo: 1, state: "PUBLISHED", revision: 2 })
    ]);

    const draftV2 = sword({
      name: "Miecz Burzy v2",
      description: "Zbalansowana druga wersja.",
      rarity: "EPIC",
      iconKey: icon.body.key,
      iconUrl: icon.body.url,
      stats: [
        { statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 42 },
        { statCode: "CRIT_CHANCE", modifierType: "percent", value: 10 }
      ],
      effects: [
        {
          triggerCode: "ON_CRIT",
          effectCode: "DEAL_DAMAGE",
          value: 16,
          chance: 0.5,
          durationMs: 500,
          cooldownMs: 1000
        }
      ]
    });
    const savedV2 = await request(app)
      .put("/api/admin/items/e2e-storm-sword/draft")
      .set(auth)
      .send({ expectedRevision: 2, draft: draftV2 })
      .expect(200);
    expect(savedV2.body).toMatchObject({ versionNo: 2, revision: 1, name: "Miecz Burzy v2" });

    const publishedV2 = await request(app)
      .post("/api/admin/items/e2e-storm-sword/publish")
      .set(auth)
      .send({ expectedRevision: 1 })
      .expect(200);
    expect(publishedV2.body).toMatchObject({ versionNo: 2, state: "PUBLISHED", rarity: "EPIC" });

    const instanceAfterV2 = (await inventory.getSnapshot(inventoryCharacterId)).items[0]!;
    expect(instanceAfterV2.instanceId).toBe(instanceBefore.instanceId);
    expect(instanceAfterV2.quantity).toBe(instanceBefore.quantity);
    expect(instanceAfterV2).toMatchObject({ name: "Miecz Burzy v2", rarity: "EPIC" });

    const reconnectedPool = createPool(databaseUrl);
    try {
      const reconnectedMetadata = new ItemMetadataRepository(reconnectedPool);
      const reconnectedCatalog = new ItemCatalogService(reconnectedPool, reconnectedMetadata);
      const reconnectedInventory = new InventoryService(reconnectedPool);

      const persistedItem = await reconnectedCatalog.getItem("e2e-storm-sword");
      const persistedVersions = await reconnectedCatalog.listVersions("e2e-storm-sword");
      const persistedInstance = (await reconnectedInventory.getSnapshot(inventoryCharacterId)).items[0]!;

      expect(persistedItem.item).toMatchObject({ activeVersionNo: 2, name: "Miecz Burzy v2" });
      expect(persistedVersions.map((entry) => entry.versionNo)).toEqual([2, 1]);
      expect(persistedInstance.instanceId).toBe(instanceBefore.instanceId);
      expect(persistedInstance.quantity).toBe(1);
    } finally {
      await reconnectedPool.end();
    }

    const restored = await request(app)
      .post("/api/admin/items/e2e-storm-sword/versions/1/restore")
      .set(auth)
      .send({})
      .expect(200);
    expect(restored.body).toMatchObject({ versionNo: 3, state: "PUBLISHED", name: "Miecz Burzy" });

    const historyV3 = await request(app)
      .get("/api/admin/items/e2e-storm-sword/versions")
      .set(auth)
      .expect(200);
    expect(historyV3.body.map((entry: { versionNo: number }) => entry.versionNo)).toEqual([3, 2, 1]);

    await request(app)
      .post("/api/admin/items/e2e-storm-sword/archive")
      .set(auth)
      .send({})
      .expect(204);

    const archived = await request(app)
      .get("/api/admin/items/e2e-storm-sword")
      .set(auth)
      .expect(200);
    expect(archived.body.item.status).toBe("ARCHIVED");

    const itemAudit = await request(app)
      .get("/api/admin/audit?objectType=item&objectId=e2e-storm-sword")
      .set(auth)
      .expect(200);
    expect(itemAudit.body.map((entry: { action: string }) => entry.action)).toEqual(
      expect.arrayContaining([
        "CREATE_DRAFT",
        "UPDATE_DRAFT",
        "PUBLISH",
        "RESTORE",
        "ARCHIVE"
      ])
    );
    expect(
      itemAudit.body.every(
        (entry: { actorAccountId?: string; actorPlayerId?: string }) =>
          entry.actorAccountId === adminAccountId && entry.actorPlayerId === undefined
      )
    ).toBe(true);

    const iconAudit = await request(app)
      .get("/api/admin/audit?objectType=item_icon&objectId=icons/e2e-storm-sword.png")
      .set(auth)
      .expect(200);
    expect(iconAudit.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: "UPLOAD_ICON", actorAccountId: adminAccountId })
      ])
    );
  });
});
