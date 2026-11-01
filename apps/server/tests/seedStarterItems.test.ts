import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { seedItemMetadata } from "../src/items/seedItemMetadata";

const databaseUrl = process.env.DATABASE_URL;
const target = databaseUrl ? new URL(databaseUrl) : null;
const localTestDatabase = target
  && ["localhost", "127.0.0.1"].includes(target.hostname)
  && target.pathname === "/web_mmorpg_test";
const describeDatabase = localTestDatabase ? describe : describe.skip;

describeDatabase("starter equipment seeding", () => {
  const pool = createPool(databaseUrl ?? "postgresql://unused/unused");
  const authoredItemId = "20000000-0000-4000-8000-000000000001";
  const authoredVersionId = "21000000-0000-4000-8000-000000000001";
  const authoredStatId = "22000000-0000-4000-8000-000000000001";

  beforeAll(async () => {
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
    await seedItemMetadata(pool);
    await pool.query("TRUNCATE items CASCADE");
  });

  afterAll(async () => {
    await pool.end();
  });

  async function authoredSnapshot() {
    return (await pool.query(
      `SELECT to_jsonb(item) AS item, to_jsonb(version) AS version, to_jsonb(stat) AS stat
       FROM items item
       JOIN item_versions version ON version.item_id = item.id
       JOIN item_stat_modifiers stat ON stat.version_id = version.id
       WHERE item.id = $1`,
      [authoredItemId]
    )).rows;
  }

  async function equipmentSnapshot() {
    return (await pool.query(
      `SELECT item.item_id, item.id, version.id AS version_id,
              stat.id AS stat_id, stat.stat_code, stat.modifier_type, stat.value
       FROM items item
       JOIN item_versions version ON version.item_id = item.id
       JOIN item_stat_modifiers stat ON stat.version_id = version.id
       WHERE version.category_id IN ('weapon', 'armor') AND item.id <> $1
       ORDER BY item.item_id, stat.stat_code`,
      [authoredItemId]
    )).rows;
  }

  it("preserves authored rows occupying former seed IDs and reuses seeded equipment on startup", async () => {
    await pool.query(
      `INSERT INTO items (id, item_id, status, active_version_no)
       VALUES ($1, 'starter-sword', 'PUBLISHED', 1)`,
      [authoredItemId]
    );
    await pool.query(
      `INSERT INTO item_versions (
         id, item_id, version_no, revision, state, name, category_id, subcategory_id,
         description, rarity, special_data, created_by
       ) VALUES ($1, $2, 1, 3, 'PUBLISHED', 'Autorski miecz', 'weapon', 'sword',
                 'Zachowany przedmiot autora.', 'RARE', '{"weaponFamily":"sword"}'::jsonb,
                 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')`,
      [authoredVersionId, authoredItemId]
    );
    await pool.query(
      `INSERT INTO item_stat_modifiers (id, version_id, stat_code, modifier_type, value)
       VALUES ($1, $2, 'PHYSICAL_DAMAGE', 'flat', 77)`,
      [authoredStatId, authoredVersionId]
    );
    const original = await authoredSnapshot();

    await seedItemMetadata(pool);

    expect(await authoredSnapshot()).toEqual(original);
    const equipment = await equipmentSnapshot();
    // Current training gear, 66 progression weapons and ten other starter weapons;
    // the author's starter-sword row above must remain untouched.
    expect(new Set(equipment.map((row) => row.item_id)).size).toBe(91);
    expect(equipment.find((row) => row.item_id === "training-sword")).toMatchObject({
      stat_code: "PHYSICAL_DAMAGE", modifier_type: "flat", value: "12"
    });

    await seedItemMetadata(pool);

    expect(await authoredSnapshot()).toEqual(original);
    expect(await equipmentSnapshot()).toEqual(equipment);
  });

  it("upgrades initialized system stat lists additively without replacing authored metadata", async () => {
    await pool.query(`DELETE FROM category_allowed_stats WHERE category_id = 'weapon' AND (
      (subcategory_id IS NULL AND stat_code IN ('ARMOR', 'INITIATIVE', 'BLOCK_POWER')) OR
      (subcategory_id IN ('sword', 'hammer') AND stat_code = 'ARMOR') OR
      (subcategory_id IN ('dagger', 'spear') AND stat_code = 'INITIATIVE') OR
      (subcategory_id = 'offensive-shield' AND stat_code = 'MAGIC_DAMAGE'))`);
    await pool.query("INSERT INTO category_allowed_stats(category_id, subcategory_id, stat_code) VALUES ('weapon', 'sword', 'FIRE_DAMAGE')");
    await pool.query("UPDATE item_subcategories SET system = FALSE WHERE id = 'hammer'");
    const authoredBefore = (await pool.query("SELECT * FROM category_allowed_stats ORDER BY id")).rows;
    await pool.query("DELETE FROM schema_migrations WHERE migration_name = '016_progression_weapon_metadata'");

    await runMigrations(pool);

    const after = (await pool.query("SELECT * FROM category_allowed_stats ORDER BY id")).rows;
    for (const original of authoredBefore) expect(after).toContainEqual(original);
    const mappings = after.filter((row) => row.category_id === "weapon");
    for (const [subcategory, code] of [
      [null, "ARMOR"], [null, "INITIATIVE"], [null, "BLOCK_POWER"],
      ["sword", "ARMOR"], ["dagger", "INITIATIVE"], ["spear", "INITIATIVE"],
      ["offensive-shield", "MAGIC_DAMAGE"]
    ]) expect(mappings.some((row) => row.subcategory_id === subcategory && row.stat_code === code)).toBe(true);
    expect(mappings.some((row) => row.subcategory_id === "hammer" && row.stat_code === "ARMOR")).toBe(false);
    await runMigrations(pool);
    expect((await pool.query("SELECT * FROM category_allowed_stats ORDER BY id")).rows).toEqual(after);
  });
});
