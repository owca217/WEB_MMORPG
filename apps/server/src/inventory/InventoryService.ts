import { randomUUID } from "node:crypto";
import {
  CONTAINER_ITEM_CATEGORY,
  CONTAINER_SLOT_COUNT,
  type ContainerSlots,
  type InventoryItem,
  type InventorySnapshot,
  type PlayerId
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
  container_slot: number | null;
  container_instance_id: string | null;
  container_capacity: number | null;
  special_data: Record<string, unknown> | null;
}

interface ContainerAssignmentRow {
  category_id: string;
  container_instance_id: string | null;
}

interface ContainerStorageRow extends ContainerAssignmentRow {
  container_slot: number | null;
  container_capacity: number | null;
  special_data: Record<string, unknown> | null;
}

type OwnerKind = "character" | "legacyPlayer";

export class InventoryService {
  constructor(private readonly pool: Pool) {}

  async addItems(
    characterId: string,
    rewards: readonly InventoryReward[]
  ): Promise<InventorySnapshot> {
    await this.addItemsForOwner("character", characterId, rewards);
    return this.getSnapshot(characterId);
  }

  async getSnapshot(characterId: string): Promise<InventorySnapshot> {
    return this.getSnapshotForOwner("character", characterId);
  }

  async setContainerSlot(
    characterId: string,
    slotIndex: number,
    itemInstanceId: string | null
  ): Promise<InventorySnapshot> {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= CONTAINER_SLOT_COUNT) {
      throw new Error("INVALID_CONTAINER_SLOT");
    }
    if (itemInstanceId !== null && !this.isInstanceId(itemInstanceId)) {
      throw new Error("INVALID_CONTAINER_INSTANCE_ID");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const character = await client.query(
        "SELECT id FROM characters WHERE id = $1 FOR UPDATE",
        [characterId]
      );
      if (!character.rowCount) throw new Error("CHARACTER_NOT_FOUND");

      if (itemInstanceId !== null) {
        const candidate = await client.query<ContainerAssignmentRow>(
          `SELECT version.category_id, instance.container_instance_id
           FROM item_instances instance
           JOIN items item ON item.id = instance.item_id
           JOIN item_versions version
             ON version.item_id = item.id
            AND version.version_no = item.active_version_no
            AND version.state = 'PUBLISHED'
           WHERE instance.id = $1 AND instance.character_id = $2
           FOR UPDATE OF instance
           FOR SHARE OF item, version`,
          [itemInstanceId, characterId]
        );
        const row = candidate.rows[0];
        if (!row) throw new Error("CONTAINER_ITEM_NOT_OWNED");
        if (row.category_id !== CONTAINER_ITEM_CATEGORY) {
          throw new Error("ITEM_NOT_CONTAINER");
        }
        if (row.container_instance_id !== null) throw new Error("CONTAINER_ITEM_STORED");
      }

      await client.query(
        `UPDATE item_instances
         SET container_slot = NULL, updated_at = NOW()
         WHERE character_id = $1 AND (container_slot = $2 OR id = $3)`,
        [characterId, slotIndex, itemInstanceId]
      );
      if (itemInstanceId !== null) {
        await client.query(
          `UPDATE item_instances
           SET container_slot = $2, updated_at = NOW()
           WHERE id = $1 AND character_id = $3`,
          [itemInstanceId, slotIndex, characterId]
        );
      }
      const snapshot = await this.getSnapshotForOwner("character", characterId, client);
      await client.query("COMMIT");
      return snapshot;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async moveItemToContainer(
    characterId: string,
    itemInstanceId: string,
    targetContainerInstanceId: string | null
  ): Promise<InventorySnapshot> {
    if (!this.isInstanceId(itemInstanceId)) throw new Error("INVALID_ITEM_INSTANCE_ID");
    if (targetContainerInstanceId !== null && !this.isInstanceId(targetContainerInstanceId)) {
      throw new Error("INVALID_CONTAINER_INSTANCE_ID");
    }
    itemInstanceId = itemInstanceId.toLowerCase();
    targetContainerInstanceId = targetContainerInstanceId?.toLowerCase() ?? null;
    if (itemInstanceId === targetContainerInstanceId) throw new Error("CONTAINER_CANNOT_STORE_SELF");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const character = await client.query("SELECT id FROM characters WHERE id = $1 FOR UPDATE", [characterId]);
      if (!character.rowCount) throw new Error("CHARACTER_NOT_FOUND");
      const readOwned = async (id: string, missingCode: string): Promise<ContainerStorageRow> => {
        const result = await client.query<ContainerStorageRow>(
          `SELECT instance.container_slot, instance.container_instance_id, instance.container_capacity,
             version.category_id, version.special_data
           FROM item_instances instance
           JOIN items item ON item.id = instance.item_id
           JOIN item_versions version
             ON version.item_id = item.id
            AND version.version_no = item.active_version_no
            AND version.state = 'PUBLISHED'
           WHERE instance.id = $1 AND instance.character_id = $2
           FOR UPDATE OF instance
           FOR SHARE OF item, version`,
          [id, characterId]
        );
        const row = result.rows[0];
        if (!row) throw new Error(missingCode);
        return row;
      };

      const source = await readOwned(itemInstanceId, "INVENTORY_ITEM_NOT_OWNED");
      if (targetContainerInstanceId !== null) {
        const target = await readOwned(targetContainerInstanceId, "CONTAINER_ITEM_NOT_OWNED");
        if (target.category_id !== CONTAINER_ITEM_CATEGORY) throw new Error("ITEM_NOT_CONTAINER");
        if (target.container_instance_id !== null) throw new Error("CONTAINER_ITEM_STORED");
        const capacity = this.getContainerCapacity(target);
        if (capacity === undefined) throw new Error("CONTAINER_CAPACITY_INVALID");
        if (source.container_slot !== null) throw new Error("CONTAINER_ITEM_EQUIPPED");

        const children = await client.query(
          "SELECT 1 FROM item_instances WHERE container_instance_id = $1 LIMIT 1",
          [itemInstanceId]
        );
        if (children.rowCount) throw new Error("CONTAINER_NOT_EMPTY");
        if (source.container_instance_id !== targetContainerInstanceId) {
          const occupied = await client.query<{ count: number }>(
            "SELECT COUNT(*)::int AS count FROM item_instances WHERE container_instance_id = $1",
            [targetContainerInstanceId]
          );
          if ((occupied.rows[0]?.count ?? 0) >= capacity) throw new Error("CONTAINER_FULL");
        }
      }

      if (source.container_instance_id !== targetContainerInstanceId) {
        await client.query(
          `UPDATE item_instances SET container_instance_id = $2, updated_at = NOW()
           WHERE id = $1 AND character_id = $3`,
          [itemInstanceId, targetContainerInstanceId, characterId]
        );
      }
      const snapshot = await this.getSnapshotForOwner("character", characterId, client);
      await client.query("COMMIT");
      return snapshot;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Transitional compatibility for the pre-account Socket.IO flow.
   * Task 7 removes these methods when gameplay identity becomes character.id.
   */
  async addLegacySessionItems(
    playerId: PlayerId,
    rewards: readonly InventoryReward[]
  ): Promise<InventorySnapshot> {
    await this.addItemsForOwner("legacyPlayer", playerId, rewards);
    return this.getLegacySessionSnapshot(playerId);
  }

  /** @deprecated Removed with legacy socket sessions in Task 7. */
  getLegacySessionSnapshot(playerId: PlayerId): Promise<InventorySnapshot> {
    return this.getSnapshotForOwner("legacyPlayer", playerId);
  }

  removePlayer(_playerId: PlayerId): void {
    // Inventory is persistent. Disconnecting a player must never delete item instances.
  }

  private ownerColumn(ownerKind: OwnerKind): "character_id" | "player_id" {
    return ownerKind === "character" ? "character_id" : "player_id";
  }

  private async addItemsForOwner(
    ownerKind: OwnerKind,
    ownerId: string,
    rewards: readonly InventoryReward[]
  ): Promise<void> {
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      for (const reward of rewards) {
        this.validateReward(reward);
        const definition = await this.requirePublishedDefinition(client, reward.itemId);
        await this.addReward(
          client,
          ownerKind,
          ownerId,
          definition,
          reward.quantity
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async getSnapshotForOwner(
    ownerKind: OwnerKind,
    ownerId: string,
    client?: PoolClient
  ): Promise<InventorySnapshot> {
    const ownerColumn = this.ownerColumn(ownerKind);
    const result = await (client ?? this.pool).query<InventoryRow>(
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
        instance.bound_to_player_id,
        instance.container_slot,
        instance.container_instance_id,
        instance.container_capacity,
        version.special_data
       FROM item_instances instance
       JOIN items item ON item.id = instance.item_id
       JOIN item_versions version
         ON version.item_id = item.id
        AND version.version_no = item.active_version_no
        AND version.state = 'PUBLISHED'
       WHERE instance.${ownerColumn} = $1
       ORDER BY instance.created_at ASC, instance.id ASC`,
      [ownerId]
    );

    const containerSlots: ContainerSlots = [null, null, null, null];
    if (ownerKind === "character") {
      for (const row of result.rows) {
        if (row.container_slot !== null &&
          row.container_slot >= 0 && row.container_slot < CONTAINER_SLOT_COUNT &&
          row.category_id === CONTAINER_ITEM_CATEGORY &&
          row.container_instance_id === null) {
          containerSlots[row.container_slot] = row.instance_id;
        }
      }
    }
    return {
      items: result.rows.map((row) => this.mapInventoryRow(row)),
      containerSlots
    };
  }

  private validateReward(reward: InventoryReward): void {
    if (!reward.itemId.trim()) throw new Error("INVALID_REWARD_ITEM_ID");
    if (!Number.isInteger(reward.quantity) || reward.quantity <= 0) {
      throw new Error("INVALID_REWARD_QUANTITY");
    }
  }

  private isInstanceId(value: unknown): value is string {
    return typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
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
    ownerKind: OwnerKind,
    ownerId: string,
    definition: PublishedDefinitionRow,
    quantity: number
  ): Promise<void> {
    if (!definition.stackable) {
      for (let index = 0; index < quantity; index += 1) {
        await this.insertInstance(client, ownerKind, ownerId, definition.id, 1);
      }
      return;
    }

    const ownerColumn = this.ownerColumn(ownerKind);
    let remaining = quantity;
    while (remaining > 0) {
      const existingResult = await client.query<StackRow>(
        `SELECT id, quantity
         FROM item_instances
         WHERE ${ownerColumn} = $1
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
        [ownerId, definition.id, definition.max_stack]
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
      await this.insertInstance(
        client,
        ownerKind,
        ownerId,
        definition.id,
        stackQuantity
      );
      remaining -= stackQuantity;
    }
  }

  private async insertInstance(
    client: PoolClient,
    ownerKind: OwnerKind,
    ownerId: string,
    itemDefinitionUuid: string,
    quantity: number
  ): Promise<void> {
    const ownerColumn = this.ownerColumn(ownerKind);
    await client.query(
      `INSERT INTO item_instances (
        id, ${ownerColumn}, item_id, quantity, upgrade_level, affixes, sockets
       ) VALUES ($1, $2, $3, $4, 0, '[]'::jsonb, '[]'::jsonb)`,
      [randomUUID(), ownerId, itemDefinitionUuid, quantity]
    );
  }

  private getContainerCapacity(row: Pick<InventoryRow, "special_data" | "container_capacity" | "category_id">): number | undefined {
    const capacity = row.special_data?.capacity ?? row.container_capacity;
    return (
      (row.category_id === CONTAINER_ITEM_CATEGORY || row.category_id === "backpack") &&
      typeof capacity === "number" && Number.isSafeInteger(capacity) && capacity > 0 && capacity <= 10000
        ? capacity
        : undefined
    );
  }

  private mapInventoryRow(row: InventoryRow): InventoryItem {
    const containerCapacity = this.getContainerCapacity(row);
    return {
      instanceId: row.instance_id,
      itemId: row.item_id,
      itemDefinitionId: row.item_definition_id,
      name: row.name,
      quantity: row.quantity,
      category: row.category_id,
      description: row.description,
      ...(row.icon_url ? { iconUrl: row.icon_url } : {}),
      rarity: row.rarity,
      ...(row.durability === null ? {} : { durability: Number(row.durability) }),
      ...(row.max_durability === null
        ? {}
        : { maxDurability: Number(row.max_durability) }),
      upgradeLevel: row.upgrade_level,
      ...(containerCapacity === undefined ? {} : { containerCapacity }),
      ...(row.container_instance_id
        ? { containerInstanceId: row.container_instance_id }
        : {}),
      ...(row.bound_to_player_id
        ? { boundToPlayerId: row.bound_to_player_id }
        : {})
    };
  }
}
