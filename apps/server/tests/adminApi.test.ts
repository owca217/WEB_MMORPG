import type { InventoryItem, InventorySnapshot, ItemDraftInput } from "@web-mmorpg/shared";
import { PERMANENT_BACKPACK_ITEM_ID } from "@web-mmorpg/shared";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountAdminService } from "../src/admin/AccountAdminService";
import { ItemGrantService } from "../src/admin/ItemGrantService";
import { InventoryService } from "../src/inventory/InventoryService";
import type { IconStorage, IconUploadInput } from "../src/admin/IconStorage";
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

function sword(overrides: Partial<ItemDraftInput> = {}): ItemDraftInput {
  return {
    itemId: "api-iron-sword",
    name: "Miecz API",
    categoryId: "weapon",
    subcategoryId: "sword",
    description: "Miecz utworzony przez zabezpieczone API.",
    rarity: "COMMON",
    itemLevel: 5,
    minimumLevel: 2,
    sellValue: 100,
    sellable: true,
    tradable: true,
    droppable: true,
    stackable: false,
    maxStack: 1,
    weight: 2,
    soulbound: "NONE",
    unique: false,
    tags: ["api-test"],
    stats: [{ statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 10 }],
    requirements: [],
    effects: [],
    specialData: {},
    ...overrides
  };
}

class FakeIconStorage implements IconStorage {
  readonly writes: IconUploadInput[] = [];

  async putIcon(input: IconUploadInput) {
    this.writes.push(input);
    return {
      key: "icons/admin-api-test.png",
      url: "https://assets.example.test/icons/admin-api-test.png"
    };
  }
}

describeDatabase("ADMIN item REST API", () => {
  const pool = createPool(databaseUrl);
  let metadata: ItemMetadataRepository;
  let catalog: ItemCatalogService;
  let audit: AdminAuditRepository;
  let icons: FakeIconStorage;
  let app: express.Express;
  let adminToken: string;
  let playerToken: string;
  let adminAccountId: string;
  let characterId: string;
  let foreignCharacterId: string;

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
    await pool.query("DELETE FROM category_allowed_stats WHERE category_id LIKE 'api-%'");
    await pool.query("DELETE FROM item_subcategories WHERE category_id LIKE 'api-%'");
    await pool.query("DELETE FROM item_categories WHERE id LIKE 'api-%'");

    metadata = new ItemMetadataRepository(pool);
    catalog = new ItemCatalogService(pool, metadata);
    audit = new AdminAuditRepository(pool);
    icons = new FakeIconStorage();

    const lifecycle = new CharacterLifecycleService(pool);
    const accounts = new AccountRepository(pool);
    const auth = new AuthService(pool, accounts, lifecycle);
    const connections = new ActiveConnectionRegistry();
    const accountAdmin = new AccountAdminService(pool, audit, connections);

    await auth.register("ApiAdmin", PASSWORD);
    const adminAccount = await accounts.findByNormalizedUsername("apiadmin");
    if (!adminAccount) throw new Error("ADMIN_ACCOUNT_MISSING");
    await accounts.updateRole(adminAccount.id, "ADMIN");
    adminAccountId = adminAccount.id;
    adminToken = (await auth.login("ApiAdmin", PASSWORD)).token;

    await auth.register("ApiPlayer", PASSWORD);
    playerToken = (await auth.login("ApiPlayer", PASSWORD)).token;
    characterId = (await lifecycle.createCharacter(adminAccountId, { nickname: "AdminHero", appearance: {} })).id;
    const playerAccount = await accounts.findByNormalizedUsername("apiplayer");
    foreignCharacterId = (await lifecycle.createCharacter(playerAccount!.id, { nickname: "PlayerHero", appearance: {} })).id;

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
        itemGrants: new ItemGrantService(pool, new InventoryService(pool), audit),
        iconStorage: icons
      })
    );
  });

  afterAll(async () => {
    await pool.end();
  });

  describe("item grants", () => {
    const grantPath = "/api/admin/items/api-iron-sword/grant";
    const grant = (quantity: unknown = 1, overrides: Record<string, unknown> = {}) =>
      request(app).post(grantPath).set("Authorization", `Bearer ${adminToken}`)
        .send({ characterId, quantity, requestId: randomUUID(), ...overrides });

    it("requires an ADMIN session, own active character and strictly bounded input", async () => {
      await request(app).post(grantPath).send({}).expect(401);
      await request(app).post(grantPath).set("Authorization", `Bearer ${playerToken}`).send({}).expect(403);
      await grant(1, { characterId: foreignCharacterId }).expect(404);
      for (const quantity of [0, 101, 1.5, "2", null]) await grant(quantity).expect(400);
      await grant(1, { requestId: "invalid" }).expect(400);
      await grant(1, { characterId: "invalid" }).expect(400);
      await pool.query("UPDATE characters SET deletion_requested_at=NOW(), deletion_effective_at=NOW()+INTERVAL '1 day' WHERE id=$1", [characterId]);
      await grant().expect(409);
      expect((await pool.query("SELECT 1 FROM admin_audit_log WHERE action='ITEM_GRANTED'")).rowCount).toBe(0);
    });

    it("accepts only the current published definition and rejects the permanent backpack", async () => {
      await grant().expect(404);
      await catalog.createDraft(sword(), adminAccountId);
      await grant().expect(400);
      await catalog.publish("api-iron-sword", 1, adminAccountId);
      await catalog.archive("api-iron-sword", adminAccountId);
      await grant().expect(400);
      await request(app).post(`/api/admin/items/${PERMANENT_BACKPACK_ITEM_ID}/grant`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ characterId, quantity: 1, requestId: randomUUID() }).expect(400);
    });

    it("grants quality-aware stacks, stores overflow durably, audits once and replays concurrent retries", async () => {
      await catalog.createDraft(sword({ stackable: true, maxStack: 10, quality: "MASTERWORK" }), adminAccountId);
      await catalog.publish("api-iron-sword", 1, adminAccountId);
      const requestId = randomUUID();
      const [first, replay] = await Promise.all([grant(17, { requestId }), grant(17, { requestId })]);
      expect(first.status).toBe(200);
      expect(replay.status).toBe(200);
      expect(first.body.characterId).toBe(characterId);
      const granted = first.body.inventory.items.filter((item: { itemId: string }) => item.itemId === "api-iron-sword");
      expect(granted.map((item: { quantity: number }) => item.quantity).sort((a: number, b: number) => a-b)).toEqual([7, 10]);
      expect(granted.every((item: { quality: string; containerInstanceId?: string }) => item.quality === "MASTERWORK" && item.containerInstanceId)).toBe(true);
      expect(replay.body.inventory).toEqual(first.body.inventory);
      await grant(18, { requestId }).expect(409);
      const audits = await pool.query("SELECT actor_account_id,summary FROM admin_audit_log WHERE action='ITEM_GRANTED'");
      expect(audits.rows).toEqual([{ actor_account_id: adminAccountId, summary: { requestId, characterId, itemId: "api-iron-sword", quantity: 17 } }]);

      await catalog.createDraft(sword({ itemId: "grant-filler" }), adminAccountId);
      await catalog.publish("grant-filler", 1, adminAccountId);
      const overflow = await request(app).post("/api/admin/items/grant-filler/grant")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ characterId, quantity: 20, requestId: randomUUID() }).expect(200);
      const filler = overflow.body.inventory.items.filter((item: { itemId: string }) => item.itemId === "grant-filler");
      expect(filler).toHaveLength(20);
      expect(filler.filter((item: { containerInstanceId?: string }) => !item.containerInstanceId)).toHaveLength(6);
    });

    it("rolls back both items and receipt if audit persistence fails, then permits a safe retry", async () => {
      await catalog.createDraft(sword(), adminAccountId);
      await catalog.publish("api-iron-sword", 1, adminAccountId);
      const append = vi.spyOn(audit, "appendWithClient").mockRejectedValueOnce(new Error("audit unavailable"));
      const logging = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const requestId = randomUUID();
      try {
        await grant(2, { requestId }).expect(500);
        expect((await pool.query("SELECT 1 FROM item_instances instance JOIN items item ON item.id=instance.item_id WHERE item.item_id='api-iron-sword'")).rowCount).toBe(0);
        expect((await pool.query("SELECT 1 FROM admin_audit_log WHERE action='ITEM_GRANTED'")).rowCount).toBe(0);
        const retry = await grant(2, { requestId }).expect(200);
        expect(retry.body.inventory.items.filter((item: { itemId: string }) => item.itemId === "api-iron-sword")).toHaveLength(2);
      } finally {
        append.mockRestore();
        logging.mockRestore();
      }
    });

    it("grants legacy backpacks and equips full pending bags without losing contents or quality", async () => {
      const bagDraft = sword({ itemId: "expedition-backpack", categoryId: "backpack", quality: "MASTERWORK",
        stats: [{ statCode: "EXTRA_SLOTS", modifierType: "flat", value: 60 }] });
      delete bagDraft.subcategoryId;
      await catalog.createDraft(bagDraft, adminAccountId);
      await catalog.publish("expedition-backpack", 1, adminAccountId);
      await catalog.createDraft(sword({ quality: "GOOD" }), adminAccountId);
      await catalog.publish("api-iron-sword", 1, adminAccountId);
      const grantBag = () => request(app).post("/api/admin/items/expedition-backpack/grant")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ characterId, quantity: 1, requestId: randomUUID() });
      const firstGrant = await grantBag().expect(200);
      const firstInventory = firstGrant.body.inventory as InventorySnapshot;
      const bag = firstInventory.items.find(item => item.itemId === "expedition-backpack")!;
      expect(bag).toMatchObject({ category: "container", containerCapacity: 60, quality: "MASTERWORK" });
      const permanent = firstInventory.items.find(item => item.permanentContainer)!;
      const swords = ((await grant(77).expect(200)).body.inventory as InventorySnapshot).items
        .filter(item => item.itemId === "api-iron-sword");
      const loose = swords.filter(item => !item.containerInstanceId);
      const originalChildren = loose.slice(0, 60).map(item => item.instanceId);
      // Reproduce a persisted, full legacy bag awaiting assignment with the permanent bag full too.
      await pool.query("UPDATE item_instances SET container_instance_id=NULL,container_position=NULL WHERE id=$1", [bag.instanceId]);
      await pool.query("UPDATE item_instances SET container_instance_id=$1 WHERE id=ANY($2::uuid[])", [bag.instanceId, originalChildren]);
      await pool.query("UPDATE item_instances SET container_instance_id=$1 WHERE id=$2", [permanent.instanceId, loose[60]!.instanceId]);
      const inventory = new InventoryService(pool);
      const assigned = await inventory.setContainerSlot(characterId, 1, bag.instanceId);
      expect(assigned.containerSlots?.[1]).toBe(bag.instanceId);
      expect(assigned.items.find(item => item.instanceId === bag.instanceId)).toMatchObject({ category: "container", containerCapacity: 60, quality: "MASTERWORK" });
      expect(assigned.items.filter(item => item.containerInstanceId === bag.instanceId).map(item => item.instanceId).sort()).toEqual([...originalChildren].sort());

      const secondInventory = (await grantBag().expect(200)).body.inventory as InventorySnapshot;
      const secondBag = secondInventory.items.find(item => item.itemId === "expedition-backpack" && item.instanceId !== bag.instanceId)!;
      expect(secondBag.containerInstanceId).toBeUndefined();
      const secondAssigned = await inventory.setContainerSlot(characterId, 2, secondBag.instanceId);
      expect(secondAssigned.containerSlots?.[2]).toBe(secondBag.instanceId);
      expect(secondAssigned.items.find(item => item.instanceId === loose[61]!.instanceId)?.containerInstanceId).toBe(secondBag.instanceId);
      const movedChild = originalChildren[0]!;
      const moved = await inventory.moveItemToContainer(characterId, movedChild, secondBag.instanceId);
      expect(moved.items.find(item => item.instanceId === movedChild)).toMatchObject({ containerInstanceId: secondBag.instanceId, quality: "GOOD" });
      const final = (await grant().expect(200)).body.inventory as InventorySnapshot;
      expect(final.items.filter(item => item.containerInstanceId === bag.instanceId)).toHaveLength(60);
      expect(final.items.filter(item => item.itemId === "api-iron-sword")).toHaveLength(78);
      expect(final.items.filter(item => item.itemId === "api-iron-sword").every((item: InventoryItem) => item.quality === "GOOD")).toBe(true);
      expect((await catalog.getItem("expedition-backpack")).item).toMatchObject({ categoryId: "backpack", specialData: {} });
    });
  });

  it("enforces bearer authentication and ADMIN role server-side", async () => {
    await request(app).get("/api/admin/item-metadata").expect(401);
    await request(app)
      .get("/api/admin/item-metadata")
      .set("Authorization", "Bearer forged-token")
      .expect(401);
    await request(app)
      .get("/api/admin/item-metadata")
      .set("Authorization", `Bearer ${playerToken}`)
      .expect(403);

    const allowed = await request(app)
      .get("/api/admin/item-metadata")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(allowed.body.categories).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "weapon" })])
    );
  });

  it("rejects PLAYER bearer tokens for every mutation family without changing persistent rows", async () => {
    await catalog.createDraft(sword(), adminAccountId);
    await catalog.publish("api-iron-sword", 1, adminAccountId);

    const before = await mutationCounts();
    const playerAuth = { Authorization: `Bearer ${playerToken}` };

    await request(app).post("/api/admin/items").set(playerAuth).send(sword({ itemId: "api-forbidden" })).expect(403);
    await request(app)
      .put("/api/admin/items/api-iron-sword/draft")
      .set(playerAuth)
      .send({ expectedRevision: 1, draft: sword({ name: "Forbidden" }) })
      .expect(403);
    await request(app)
      .post("/api/admin/items/api-iron-sword/publish")
      .set(playerAuth)
      .send({ expectedRevision: 1 })
      .expect(403);
    await request(app)
      .post("/api/admin/items/api-iron-sword/duplicate")
      .set(playerAuth)
      .send({ newItemId: "api-forbidden-copy" })
      .expect(403);
    await request(app).post("/api/admin/items/api-iron-sword/archive").set(playerAuth).send({}).expect(403);
    await request(app)
      .post("/api/admin/items/api-iron-sword/versions/1/restore")
      .set(playerAuth)
      .send({})
      .expect(403);
    await request(app)
      .post("/api/admin/categories")
      .set(playerAuth)
      .send({ id: "api-forbidden-category", name: "Forbidden", allowedStatCodes: ["ARMOR"] })
      .expect(403);
    await request(app)
      .post("/api/admin/subcategories")
      .set(playerAuth)
      .send({
        id: "api-forbidden-subcategory",
        categoryId: "weapon",
        name: "Forbidden",
        allowedStatCodes: ["PHYSICAL_DAMAGE"]
      })
      .expect(403);
    await request(app)
      .put("/api/admin/categories/weapon/allowed-stats")
      .set(playerAuth)
      .send({ allowedStatCodes: ["ARMOR"] })
      .expect(403);
    await request(app)
      .post("/api/admin/icons")
      .set(playerAuth)
      .attach("icon", Buffer.from("png"), { filename: "forbidden.png", contentType: "image/png" })
      .expect(403);

    expect(await mutationCounts()).toEqual(before);
    expect(icons.writes).toHaveLength(0);
  });

  it("creates, updates, rejects stale writes, publishes and reads history", async () => {
    const created = await request(app)
      .post("/api/admin/items")
      .set("Authorization", `Bearer ${adminToken}`)
      .send(sword())
      .expect(201);

    expect(created.body).toMatchObject({ itemId: "api-iron-sword", revision: 1 });

    const saved = await request(app)
      .put("/api/admin/items/api-iron-sword/draft")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        expectedRevision: 1,
        draft: sword({ name: "Miecz po zapisie" })
      })
      .expect(200);

    expect(saved.body.revision).toBe(2);

    await request(app)
      .put("/api/admin/items/api-iron-sword/draft")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        expectedRevision: 1,
        draft: sword({ name: "NIE WOLNO NADPISAĆ" })
      })
      .expect(409);

    const afterConflict = await request(app)
      .get("/api/admin/items/api-iron-sword")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(afterConflict.body.draft.name).toBe("Miecz po zapisie");

    const published = await request(app)
      .post("/api/admin/items/api-iron-sword/publish")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ expectedRevision: 2 })
      .expect(200);
    expect(published.body).toMatchObject({ versionNo: 1, state: "PUBLISHED" });

    const versions = await request(app)
      .get("/api/admin/items/api-iron-sword/versions")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(versions.body).toHaveLength(1);

    const restored = await request(app)
      .post("/api/admin/items/api-iron-sword/versions/1/restore")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({})
      .expect(200);
    expect(restored.body).toMatchObject({ versionNo: 2, state: "PUBLISHED" });
  });

  it("supports catalog queries, duplication, archive and audit reads", async () => {
    await catalog.createDraft(sword(), adminAccountId);

    const list = await request(app)
      .get("/api/admin/items?search=Miecz&categoryId=weapon&status=DRAFT&page=1&pageSize=10")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(list.body.total).toBe(1);

    const duplicate = await request(app)
      .post("/api/admin/items/api-iron-sword/duplicate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ newItemId: "api-iron-sword-copy" })
      .expect(201);
    expect(duplicate.body.itemId).toBe("api-iron-sword-copy");

    await request(app)
      .post("/api/admin/items/api-iron-sword/archive")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({})
      .expect(204);

    const auditResponse = await request(app)
      .get("/api/admin/audit?objectType=item&objectId=api-iron-sword")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(auditResponse.body.length).toBeGreaterThan(0);
    expect(auditResponse.body.every((entry: { actorAccountId?: string }) => entry.actorAccountId === adminAccountId)).toBe(true);
  });

  it("creates categories/subcategories and updates allowed stat mappings", async () => {
    const category = await request(app)
      .post("/api/admin/categories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ id: "api-relic", name: "Relikty API", allowedStatCodes: ["ARMOR"] })
      .expect(201);
    expect(category.body.allowedStatCodes).toEqual(["ARMOR"]);

    await request(app)
      .post("/api/admin/subcategories")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        id: "api-charm",
        categoryId: "api-relic",
        name: "Talizmany API",
        allowedStatCodes: ["ARMOR"]
      })
      .expect(201);

    const updated = await request(app)
      .put("/api/admin/categories/api-relic/allowed-stats")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ allowedStatCodes: ["ARMOR", "MAX_HP"] })
      .expect(200);
    expect(updated.body.allowedStatCodes).toEqual(["ARMOR", "MAX_HP"]);
  });

  it("uploads an allowed icon and rejects invalid item input with mapped errors", async () => {
    const uploaded = await request(app)
      .post("/api/admin/icons")
      .set("Authorization", `Bearer ${adminToken}`)
      .attach("icon", Buffer.from("png"), {
        filename: "sword.png",
        contentType: "image/png"
      })
      .expect(201);

    expect(uploaded.body).toEqual({
      key: "icons/admin-api-test.png",
      url: "https://assets.example.test/icons/admin-api-test.png"
    });
    expect(icons.writes).toHaveLength(1);

    await request(app)
      .post("/api/admin/items")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ itemId: "broken" })
      .expect(400);

    await request(app)
      .get("/api/admin/items/does-not-exist")
      .set("Authorization", `Bearer ${adminToken}`)
      .expect(404);
  });

  async function mutationCounts(): Promise<Record<string, string>> {
    const result = await pool.query<{
      items: string;
      versions: string;
      categories: string;
      subcategories: string;
      audit: string;
    }>(
      `SELECT
        (SELECT COUNT(*)::text FROM items) AS items,
        (SELECT COUNT(*)::text FROM item_versions) AS versions,
        (SELECT COUNT(*)::text FROM item_categories) AS categories,
        (SELECT COUNT(*)::text FROM item_subcategories) AS subcategories,
        (SELECT COUNT(*)::text FROM admin_audit_log) AS audit`
    );
    const row = result.rows[0];
    if (!row) throw new Error("COUNT_QUERY_FAILED");
    return row;
  }
});
