import type {
  InventoryItem,
  InventorySnapshot
} from "@web-mmorpg/shared";
import type { DbExecutor } from "./dbTypes";

interface InventoryRow {
  instance_id: string;
  item_id: string;
  name: string;
  quantity: number;
  category: InventoryItem["category"];
  description: string;
  container_capacity: number | null;
  container_instance_id: string | null;
}

export class InventoryRepository {
  constructor(private readonly db: DbExecutor) {}

  async load(characterId: string): Promise<InventorySnapshot> {
    const result = await this.db.query<InventoryRow>(
      `SELECT instance_id, item_id, name, quantity, category, description, container_capacity, container_instance_id
       FROM character_items
       WHERE character_id = $1
       ORDER BY instance_id`,
      [characterId]
    );

    return {
      items: result.rows.map((row) => ({
        instanceId: row.instance_id,
        itemId: row.item_id,
        name: row.name,
        quantity: row.quantity,
        category: row.category,
        description: row.description,
        ...(row.container_capacity === null
          ? {}
          : { containerCapacity: row.container_capacity }),
        ...(row.container_instance_id === null
          ? {}
          : { containerInstanceId: row.container_instance_id })
      }))
    };
  }

  async replaceAll(
    characterId: string,
    snapshot: InventorySnapshot
  ): Promise<void> {
    await this.db.query(
      "DELETE FROM character_equipment WHERE character_id = $1",
      [characterId]
    );
    await this.db.query(
      "DELETE FROM character_items WHERE character_id = $1",
      [characterId]
    );

    for (const item of snapshot.items) {
      await this.db.query(
        `INSERT INTO character_items
         (instance_id, character_id, item_id, name, quantity, category, description, container_capacity, container_instance_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          item.instanceId,
          characterId,
          item.itemId,
          item.name,
          item.quantity,
          item.category,
          item.description,
          item.containerCapacity ?? null,
          item.containerInstanceId ?? null
        ]
      );
    }
  }
}
