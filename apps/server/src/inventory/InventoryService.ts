import { randomUUID } from "node:crypto";
import {
  BAG_EQUIPMENT_SLOTS,
  type BagEquipmentSlot,
  type EquipmentSnapshot,
  type InventoryItem,
  type InventorySnapshot,
  type PlayerId
} from "@web-mmorpg/shared";
import { moveItemToContainer } from "./bagStorage";
import { setContainerSlot as applyContainerSlot } from "./containerEquipment";
import type { Pool, PoolClient } from "pg";

export interface InventoryReward {
  itemId: string;
  quantity: number;
}

interface PublishedDefinitionRow {
  id: string;
  item_id: string;
  category_id: string;
  container_capacity: string | number | null;
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
  container_capacity: string | number | null;
  container_instance_id: string | null;
  computed_container_capacity?: string | number | null;
  icon_url: string | null;
  rarity: InventoryItem["rarity"];
  durability: string | number | null;
  max_durability: string | number | null;
  upgrade_level: number;
  bound_to_player_id: string | null;
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

  async getEquipmentSnapshot(characterId: string): Promise<EquipmentSnapshot> {
    const result = await this.pool.query<{ slot: string; item_instance_id: string }>(
      "SELECT slot, item_instance_id FROM character_equipment WHERE character_id = $1 ORDER BY slot",
      [characterId]
    );
    return { items: result.rows.map((row) => ({ slot: row.slot, itemInstanceId: row.item_instance_id })) };
  }

  async hasRewardClaim(characterId: string, rewardKey: string): Promise<boolean> {
    const result = await this.pool.query(
      "SELECT 1 FROM character_reward_claims WHERE character_id = $1 AND reward_key = $2",
      [characterId, rewardKey]
    );
    return Boolean(result.rowCount);
  }

  async claimSimpleBag(characterId: string): Promise<{ claimed: boolean; inventory: InventorySnapshot; equipment: EquipmentSnapshot }> {
    const client = await this.pool.connect();
    let claimed = false;
    try {
      await client.query("BEGIN");
      const insertedClaim = await client.query(
        "INSERT INTO character_reward_claims (character_id, reward_key) VALUES ($1, 'quartermaster-simple-bag') ON CONFLICT (character_id, reward_key) DO NOTHING RETURNING reward_key",
        [characterId]
      );
      claimed = Boolean(insertedClaim.rowCount);
      if (claimed) {
        const definition = await this.requirePublishedDefinition(client, "simple-bag");
        if (definition.category_id !== "backpack") throw new Error("SIMPLE_BAG_DEFINITION_INVALID");
        const instanceId = await this.insertInstance(client, "character", characterId, definition.id, 1, definition.container_capacity);
        const equipped = await client.query(
          "SELECT 1 FROM character_equipment WHERE character_id = $1 AND slot = ANY($2::text[]) LIMIT 1 FOR UPDATE",
          [characterId, [...BAG_EQUIPMENT_SLOTS]]
        );
        if (!equipped.rowCount) {
          await client.query("INSERT INTO character_equipment (character_id, slot, item_instance_id) VALUES ($1, $2, $3)", [characterId, BAG_EQUIPMENT_SLOTS[0], instanceId]);
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const [inventory, equipment] = await Promise.all([this.getSnapshot(characterId), this.getEquipmentSnapshot(characterId)]);
    return { claimed, inventory, equipment };
  }

  async setContainerSlot(characterId: string, slot: BagEquipmentSlot, itemInstanceId: string | null): Promise<EquipmentSnapshot> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inventory = await this.getSnapshotForOwner("character", characterId, client);
      const current = await this.getEquipmentSnapshotWithClient(client, characterId);
      const next = applyContainerSlot(current, inventory, slot, itemInstanceId);
      await client.query("DELETE FROM character_equipment WHERE character_id = $1 AND slot = ANY($2::text[])", [characterId, [...BAG_EQUIPMENT_SLOTS]]);
      for (const entry of next.items) {
        if (!(BAG_EQUIPMENT_SLOTS as readonly string[]).includes(entry.slot)) continue;
        const ownership = await client.query("SELECT 1 FROM item_instances WHERE id = $1 AND character_id = $2 FOR UPDATE", [entry.itemInstanceId, characterId]);
        if (!ownership.rowCount) throw new Error("CONTAINER_ITEM_NOT_FOUND");
        await client.query("INSERT INTO character_equipment (character_id, slot, item_instance_id) VALUES ($1, $2, $3)", [characterId, entry.slot, entry.itemInstanceId]);
      }
      await client.query("COMMIT");
      return next;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async moveInventoryItem(characterId: string, itemInstanceId: string, containerInstanceId: string | null): Promise<InventorySnapshot> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const current = await this.getSnapshotForOwner("character", characterId, client);
      const next = moveItemToContainer(current, itemInstanceId, containerInstanceId);
      if (next !== current) {
        const item = next.items.find((entry) => entry.instanceId === itemInstanceId);
        if (!item) throw new Error("SOURCE_ITEM_NOT_FOUND");
        const updated = await client.query("UPDATE item_instances SET container_instance_id = $3, updated_at = NOW() WHERE id = $1 AND character_id = $2", [itemInstanceId, characterId, item.containerInstanceId ?? null]);
        if (!updated.rowCount) throw new Error("SOURCE_ITEM_NOT_FOUND");
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return this.getSnapshot(characterId);
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

  private async getSnapshotForOwner(ownerKind: OwnerKind, ownerId: string, client?: PoolClient): Promise<InventorySnapshot> {
    const ownerColumn = this.ownerColumn(ownerKind);
    const query = `SELECT
        instance.id AS instance_id, item.id AS item_definition_id, item.item_id, instance.quantity,
        version.name, version.category_id, version.description,
        instance.container_capacity, instance.container_instance_id,
        COALESCE(instance.container_capacity, (SELECT modifier.value FROM item_stat_modifiers modifier
          WHERE modifier.version_id = version.id AND modifier.stat_code = 'EXTRA_SLOTS'
            AND modifier.modifier_type = 'flat' LIMIT 1)) AS computed_container_capacity,
        version.icon_url, version.rarity, instance.durability, instance.max_durability,
        instance.upgrade_level, instance.bound_to_player_id
       FROM item_instances instance
       JOIN items item ON item.id = instance.item_id
       JOIN item_versions version ON version.item_id = item.id
        AND version.version_no = item.active_version_no AND version.state = 'PUBLISHED'
       WHERE instance.${ownerColumn} = $1
       ORDER BY instance.created_at ASC, instance.id ASC${client ? " FOR UPDATE OF instance" : ""}`;
    const result = client ? await client.query<InventoryRow>(query, [ownerId]) : await this.pool.query<InventoryRow>(query, [ownerId]);
    return { items: result.rows.map((row) => this.mapInventoryRow(row)) };
  }

  private async getEquipmentSnapshotWithClient(client: PoolClient, characterId: string): Promise<EquipmentSnapshot> {
    const result = await client.query<{ slot: string; item_instance_id: string }>(
      "SELECT slot, item_instance_id FROM character_equipment WHERE character_id = $1 ORDER BY slot FOR UPDATE",
      [characterId]
    );
    return { items: result.rows.map((row) => ({ slot: row.slot, itemInstanceId: row.item_instance_id })) };
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
      `SELECT item.id, item.item_id, version.category_id, version.stackable, version.max_stack,
              (SELECT modifier.value FROM item_stat_modifiers modifier
               WHERE modifier.version_id = version.id AND modifier.stat_code = 'EXTRA_SLOTS'
                 AND modifier.modifier_type = 'flat' LIMIT 1) AS container_capacity
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
        await this.insertInstance(client, ownerKind, ownerId, definition.id, 1, definition.container_capacity);
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
        stackQuantity,
        definition.container_capacity
      );
      remaining -= stackQuantity;
    }
  }

  private async insertInstance(
    client: PoolClient,
    ownerKind: OwnerKind,
    ownerId: string,
    itemDefinitionUuid: string,
    quantity: number,
    containerCapacity: string | number | null = null
  ): Promise<string> {
    const ownerColumn = this.ownerColumn(ownerKind);
    const instanceId = randomUUID();
    const parsedCapacity = containerCapacity === null ? null : Math.trunc(Number(containerCapacity));
    const capacity = parsedCapacity !== null && Number.isFinite(parsedCapacity) && parsedCapacity > 0 ? parsedCapacity : null;
    await client.query(
      `INSERT INTO item_instances (
        id, ${ownerColumn}, item_id, quantity, container_capacity, upgrade_level, affixes, sockets
       ) VALUES ($1, $2, $3, $4, $5, 0, '[]'::jsonb, '[]'::jsonb)`,
      [instanceId, ownerId, itemDefinitionUuid, quantity, capacity]
    );
    return instanceId;
  }

  private mapInventoryRow(row: InventoryRow): InventoryItem {
    const category = row.category_id === "backpack" ? "bag" : row.category_id;
    const capacity = row.container_capacity ?? row.computed_container_capacity;
    return {
      instanceId: row.instance_id,
      itemId: row.item_id,
      itemDefinitionId: row.item_definition_id,
      name: row.name,
      quantity: row.quantity,
      category,
      description: row.description,
      ...(category === "bag" && capacity !== null && capacity !== undefined ? { containerCapacity: Number(capacity) } : {}),
      ...(row.container_instance_id ? { containerInstanceId: row.container_instance_id } : {}),
      ...(row.icon_url ? { iconUrl: row.icon_url } : {}),
      rarity: row.rarity,
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
