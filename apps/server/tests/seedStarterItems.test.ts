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
    expect(new Set(equipment.map((row) => row.item_id)).size).toBe(15);
    expect(equipment.find((row) => row.item_id === "training-sword")).toMatchObject({
      stat_code: "PHYSICAL_DAMAGE", modifier_type: "flat", value: "12"
    });

    await seedItemMetadata(pool);

    expect(await authoredSnapshot()).toEqual(original);
    expect(await equipmentSnapshot()).toEqual(equipment);
  });
});
