import { describe, expect, it } from "vitest";
import type { DbExecutor } from "../src/persistence/dbTypes";
import { InventoryRepository } from "../src/persistence/InventoryRepository";

describe("InventoryRepository bag ownership", () => {
  it("loads and saves the bag instance ID for stored items", async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const rows = [
      {
        instance_id: "bag-instance",
        item_id: "simple-bag",
        name: "Zwykły worek",
        quantity: 1,
        category: "bag",
        description: "Worek.",
        container_capacity: 8,
        container_instance_id: null
      },
      {
        instance_id: "stored-item",
        item_id: "wolf-pelt",
        name: "Wilcza skóra",
        quantity: 1,
        category: "material",
        description: "Skóra.",
        container_capacity: null,
        container_instance_id: "bag-instance"
      }
    ];
    const db = {
      query: async <Row>(sql: string, values: unknown[] = []) => {
        calls.push({ sql, values });
        return {
          rows: sql.startsWith("SELECT") ? rows as Row[] : [],
          rowCount: sql.startsWith("SELECT") ? rows.length : 1
        };
      }
    } as unknown as DbExecutor;
    const repository = new InventoryRepository(db);

    const loaded = await repository.load("character-id");
    expect(loaded.items.find((item) => item.instanceId === "stored-item"))
      .toMatchObject({ containerInstanceId: "bag-instance" });
    expect(loaded.items.find((item) => item.instanceId === "bag-instance"))
      .not.toHaveProperty("containerInstanceId");

    await repository.replaceAll("character-id", {
      items: [
        {
          instanceId: "bag-instance",
          itemId: "simple-bag",
          name: "Zwykły worek",
          quantity: 1,
          category: "bag",
          description: "Worek.",
          containerCapacity: 8
        },
        {
          instanceId: "stored-item",
          itemId: "wolf-pelt",
          name: "Wilcza skóra",
          quantity: 1,
          category: "material",
          description: "Skóra.",
          containerInstanceId: "bag-instance"
        }
      ]
    });

    const inserts = calls.filter(({ sql }) => sql.includes("INSERT INTO character_items"));
    expect(inserts.map(({ values }) => values)).toEqual([
      ["bag-instance", "character-id", "simple-bag", "Zwykły worek", 1, "bag", "Worek.", 8, null],
      ["stored-item", "character-id", "wolf-pelt", "Wilcza skóra", 1, "material", "Skóra.", null, "bag-instance"]
    ]);
  });
});
