import { randomUUID } from "node:crypto";
import type {
  InventoryItem,
  InventorySnapshot,
  PlayerId
} from "@web-mmorpg/shared";
import type { Pool, PoolClient } from "pg";

export interface InventoryReward {
  itemId: string;
  quantity: number;
}

interface PublishedDefinitionRow {
  id: string;
  stackable: boolean;
  max_stack: number;
}

interface StackRow {
  id: string;
  quantity: number;
}

interface InventoryRow {
  instance_id: string;
  item_definition_id: string;
  item_id: string;
  quantity: number;
  name: string;
  category_id: string;
  description: string;
  icon_url: string | null;
  rarity: InventoryItem["rarity"];
  durability: string | number | null;
  max_durability: string | number | null;
  upgrade_level: number;
  bound_to_player_id: string | null;
}

export class InventoryService {
  constructor(private readonly pool: Pool) {}

  async addItems(
    playerId: PlayerId,
    rewards: readonly InventoryReward[]
  ): Promise<InventorySnapshot> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      for (const reward of rewards) {
        this.validateReward(reward);
        const definition = await this.requirePublishedDefinition(client, reward.itemId);
        await this.addReward(client, playerId, definition, reward.quantity);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    return this.getSnapshot(playerId);
  }

  async getSnapshot(playerId: PlayerId): Promise<InventorySnapshot> {
    const result = await this.pool.query<InventoryRow>(
      `SELECT
        instance.id AS instance_id,
        item.id AS item_definition_id,
        item.item_id,
        instance.quantity,
        version.name,
        version.category_id,
        version.description,
        version.icon_url,
        version.rarity,
        instance.durability,
        instance.max_durability,
        instance.upgrade_level,
        instance.bound_to_player_id
       FROM item_instances instance
       JOIN items item ON item.id = instance.item_id
       JOIN item_versions version
         ON version.item_id = item.id
        AND version.version_no = item.active_version_no
        AND version.state = 'PUBLISHED'
       WHERE instance.player_id = $1
       ORDER BY instance.created_at ASC, instance.id ASC`,
      [playerId]
    );

    return {
      items: result.rows.map((row) => this.mapInventoryRow(row))
    };
  }

  removePlayer(_playerId: PlayerId): void {
    // Inventory is persistent. Disconnecting a player must never delete item instances.
  }

  private validateReward(reward: InventoryReward): void {
    if (!reward.itemId.trim()) throw new Error("INVALID_REWARD_ITEM_ID");
    if (!Number.isInteger(reward.quantity) || reward.quantity <= 0) {
      throw new Error("INVALID_REWARD_QUANTITY");
    }
  }

  private async requirePublishedDefinition(
    client: PoolClient,
    stableItemId: string
  ): Promise<PublishedDefinitionRow> {
    const result = await client.query<PublishedDefinitionRow>(
      `SELECT item.id, version.stackable, version.max_stack
       FROM items item
       JOIN item_versions version
         ON version.item_id = item.id
        AND version.version_no = item.active_version_no
        AND version.state = 'PUBLISHED'
       WHERE item.item_id = $1
         AND item.status = 'PUBLISHED'
       FOR SHARE OF item, version`,
      [stableItemId]
    );
    const definition = result.rows[0];
    if (!definition) {
      throw new Error(`ITEM_DEFINITION_NOT_PUBLISHED:${stableItemId}`);
    }
    return definition;
  }

  private async addReward(
    client: PoolClient,
    playerId: PlayerId,
    definition: PublishedDefinitionRow,
    quantity: number
  ): Promise<void> {
    if (!definition.stackable) {
      for (let index = 0; index < quantity; index += 1) {
        await this.insertInstance(client, playerId, definition.id, 1);
      }
      return;
    }

    let remaining = quantity;
    while (remaining > 0) {
      const existingResult = await client.query<StackRow>(
        `SELECT id, quantity
         FROM item_instances
         WHERE player_id = $1
           AND item_id = $2
           AND quantity < $3
           AND durability IS NULL
           AND max_durability IS NULL
           AND upgrade_level = 0
           AND affixes = '[]'::jsonb
           AND sockets = '[]'::jsonb
           AND bound_to_player_id IS NULL
         ORDER BY created_at ASC, id ASC
         LIMIT 1
         FOR UPDATE`,
        [playerId, definition.id, definition.max_stack]
      );

      const existing = existingResult.rows[0];
      if (existing) {
        const space = definition.max_stack - existing.quantity;
        const added = Math.min(space, remaining);
        await client.query(
          `UPDATE item_instances
           SET quantity = quantity + $2, updated_at = NOW()
           WHERE id = $1`,
          [existing.id, added]
        );
        remaining -= added;
        continue;
      }

      const stackQuantity = Math.min(definition.max_stack, remaining);
      await this.insertInstance(client, playerId, definition.id, stackQuantity);
      remaining -= stackQuantity;
    }
  }

  private async insertInstance(
    client: PoolClient,
    playerId: PlayerId,
    itemDefinitionUuid: string,
    quantity: number
  ): Promise<void> {
    await client.query(
      `INSERT INTO item_instances (
        id, player_id, item_id, quantity, upgrade_level, affixes, sockets
       ) VALUES ($1, $2, $3, $4, 0, '[]'::jsonb, '[]'::jsonb)`,
      [randomUUID(), playerId, itemDefinitionUuid, quantity]
    );
  }

  private mapInventoryRow(row: InventoryRow): InventoryItem {
    return {
      instanceId: row.instance_id,
      itemId: row.item_id,
      itemDefinitionId: row.item_definition_id,
      name: row.name,
      quantity: row.quantity,
      category: row.category_id,
      description: row.description,
      ...(row.icon_url ? { iconUrl: row.icon_url } : {}),
      ...(row.rarity ? { rarity: row.rarity } : {}),
      ...(row.durability === null ? {} : { durability: Number(row.durability) }),
      ...(row.max_durability === null
        ? {}
        : { maxDurability: Number(row.max_durability) }),
      upgradeLevel: row.upgrade_level,
      ...(row.bound_to_player_id
        ? { boundToPlayerId: row.bound_to_player_id }
        : {})
    };
  }
}
