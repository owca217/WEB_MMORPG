import type {
  EquipmentEntry,
  EquipmentSnapshot
} from "@web-mmorpg/shared";
import type { DbExecutor } from "./dbTypes";

interface EquipmentRow {
  slot: string;
  item_instance_id: string;
}

export class EquipmentRepository {
  constructor(private readonly db: DbExecutor) {}

  async load(characterId: string): Promise<EquipmentSnapshot> {
    const result = await this.db.query<EquipmentRow>(
      `SELECT slot, item_instance_id
       FROM character_equipment
       WHERE character_id = $1
       ORDER BY slot`,
      [characterId]
    );

    return {
      items: result.rows.map(
        (row): EquipmentEntry => ({
          slot: row.slot,
          itemInstanceId: row.item_instance_id
        })
      )
    };
  }

  async replaceAll(
    characterId: string,
    snapshot: EquipmentSnapshot
  ): Promise<void> {
    await this.db.query(
      "DELETE FROM character_equipment WHERE character_id = $1",
      [characterId]
    );

    for (const item of snapshot.items) {
      await this.db.query(
        `INSERT INTO character_equipment
         (character_id, slot, item_instance_id)
         VALUES ($1,$2,$3)`,
        [characterId, item.slot, item.itemInstanceId]
      );
    }
  }
}
