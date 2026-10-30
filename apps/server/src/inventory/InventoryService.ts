import { randomUUID } from "node:crypto";
import {
  CONTAINER_ITEM_CATEGORY,
  CONTAINER_SLOT_COUNT,
  PERMANENT_BACKPACK_ICON_PATH,
  PERMANENT_BACKPACK_ITEM_ID,
  PERMANENT_BACKPACK_NAME,
  PERMANENT_BACKPACK_SLOT_INDEX,
  emptyEquipmentSlots,
  getEquipmentItemProperties,
  isEquipmentSlot,
  type CharacterSnapshot,
  type ConsumableEffects,
  type ContainerSlots,
  type InventoryItem,
  type InventorySnapshot,
  type PlayerId,
  type ItemStatModifier
} from "@web-mmorpg/shared";
import type { Pool, PoolClient } from "pg";
import { ensurePermanentBackpack } from "./permanentBackpack";
import { autoStoreOwnedItems, getStorageDestinations } from "./autoStorage";
import { isInventoryContainer, LEGACY_CAPACITY_COLUMN, resolveContainerCapacity, type ContainerCapacitySource } from "./containerCapacity";

export interface InventoryReward {
  itemId: string;
  quantity: number;
}

interface PublishedDefinitionRow {
  id: string;
  quality: NonNullable<InventoryItem["quality"]>;
  stackable: boolean;
  max_stack: number;
}

interface StackRow {
  id: string;
  quantity: number;
}

interface InventoryRow extends ContainerCapacitySource {
  instance_id: string;
  item_definition_id: string;
  item_id: string;
  quantity: number;
  name: string;
  category_id: string;
  subcategory_id: string | null;
  item_status: string;
  minimum_level: number;
  equipment_slot: string | null;
  stats: ItemStatModifier[];
  description: string;
  icon_url: string | null;
  rarity: InventoryItem["rarity"];
  quality: NonNullable<InventoryItem["quality"]>;
  durability: string | number | null;
  max_durability: string | number | null;
  upgrade_level: number;
  bound_to_player_id: string | null;
  container_slot: number | null;
  container_instance_id: string | null;
  container_capacity: number | null;
  permanent_container: boolean;
  special_data: Record<string, unknown> | null;
  heal_hp: string | number | null;
  restore_ap: string | number | null;
}

const CONSUMABLE_EFFECT_COLUMNS = `
  (SELECT SUM(stat.value) FROM item_stat_modifiers stat
   WHERE stat.version_id = version.id AND stat.stat_code = 'HEAL_AMOUNT'
     AND stat.modifier_type = 'flat') AS heal_hp,
  (SELECT SUM(stat.value) FROM item_stat_modifiers stat
   WHERE stat.version_id = version.id AND stat.stat_code = 'AP_RESTORE'
     AND stat.modifier_type = 'flat') AS restore_ap`;

interface ContainerAssignmentRow extends ContainerCapacitySource {
  permanent_container: boolean;
  category_id: string;
  container_instance_id: string | null;
  equipment_slot: string | null;
}

interface ContainerStorageRow extends ContainerAssignmentRow {
  container_slot: number | null;
  container_capacity: number | null;
  special_data: Record<string, unknown> | null;
}

type OwnerKind = "character" | "legacyPlayer";

export class InventoryService {
  constructor(private readonly pool: Pool) {}

  async ensurePermanentBackpack(characterId:string):Promise<void> {
    const client=await this.pool.connect();
    try {await client.query("BEGIN");await ensurePermanentBackpack(client,characterId);await autoStoreOwnedItems(client,characterId);await client.query("COMMIT");}
    catch(error){await client.query("ROLLBACK");throw error;}
    finally{client.release();}
  }

  async addItems(
    characterId: string,
    rewards: readonly InventoryReward[]
  ): Promise<InventorySnapshot> {
    await this.addItemsForOwner("character", characterId, rewards);
    return this.getSnapshot(characterId);
  }

  /** Caller owns the transaction; provisioning locks the character before catalog rows. */
  async addItemsWithClient(
    characterId: string,
    rewards: readonly InventoryReward[],
    client: PoolClient
  ): Promise<InventorySnapshot> {
    await this.addRewardsWithClient(client, "character", characterId, rewards);
    return this.getSnapshot(characterId, client);
  }

  async getSnapshot(characterId: string,client?:PoolClient): Promise<InventorySnapshot> {
    return this.getSnapshotForOwner("character", characterId,client);
  }

  async consumeBattleItem(
    characterId: string,
    itemInstanceId: string,
    prepare: (effects: ConsumableEffects) => Pick<CharacterSnapshot, "hp" | "severelyInjured" | "injuries">,
    assertCurrent: () => void = () => undefined
  ): Promise<InventorySnapshot> {
    if (!this.isInstanceId(itemInstanceId)) throw new Error("INVALID_ITEM_INSTANCE_ID");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const character = await client.query("SELECT id FROM characters WHERE id = $1 FOR UPDATE", [characterId]);
      if (!character.rowCount) throw new Error("CHARACTER_NOT_FOUND");
      const found = await client.query<Pick<InventoryRow, "quantity" | "category_id" | "heal_hp" | "restore_ap" | "container_instance_id" | "permanent_container">>(
        `SELECT instance.quantity, instance.container_instance_id, instance.permanent_container, version.category_id, ${CONSUMABLE_EFFECT_COLUMNS}
         FROM item_instances instance
         JOIN items item ON item.id = instance.item_id
         JOIN item_versions version ON version.item_id = item.id
           AND version.version_no = item.active_version_no AND version.state = 'PUBLISHED'
         WHERE instance.id = $1 AND instance.character_id = $2
         FOR UPDATE OF instance FOR SHARE OF item, version`,
        [itemInstanceId, characterId]
      );
      const item = found.rows[0];
      if (!item || item.quantity < 1) throw new Error("INVENTORY_ITEM_NOT_OWNED");
      if(item.permanent_container)throw new Error("PERMANENT_BACKPACK_FIXED");
      if (item.category_id !== "consumable") throw new Error("ITEM_NOT_CONSUMABLE");
      if (item.container_instance_id) {
        const container = await client.query("SELECT id FROM item_instances WHERE id = $1 AND character_id = $2 FOR SHARE", [item.container_instance_id, characterId]);
        if (!container.rowCount) throw new Error("INVENTORY_ITEM_NOT_OWNED");
      }
      const effects = this.getConsumableEffects(item);
      if (!effects) throw new Error("ITEM_NO_EFFECT");
      assertCurrent();
      const outcome = prepare(effects);
      if (item.quantity === 1) {
        await client.query("DELETE FROM item_instances WHERE id = $1 AND character_id = $2", [itemInstanceId, characterId]);
      } else {
        await client.query("UPDATE item_instances SET quantity = quantity - 1, updated_at = NOW() WHERE id = $1 AND character_id = $2", [itemInstanceId, characterId]);
      }
      await client.query(
        "UPDATE characters SET hp = $2, severely_injured = $3, injuries = $4::jsonb, updated_at = NOW() WHERE id = $1",
        [characterId, outcome.hp, outcome.severelyInjured, JSON.stringify(outcome.injuries)]
      );
      await autoStoreOwnedItems(client,characterId);
      const snapshot = await this.getSnapshotForOwner("character", characterId, client);
      assertCurrent();
      await client.query("COMMIT");
      return snapshot;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async setContainerSlot(
    characterId: string,
    slotIndex: number,
    itemInstanceId: string | null
  ): Promise<InventorySnapshot> {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= CONTAINER_SLOT_COUNT) {
      throw new Error("INVALID_CONTAINER_SLOT");
    }
    if(slotIndex===PERMANENT_BACKPACK_SLOT_INDEX)throw new Error("PERMANENT_BACKPACK_FIXED");
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
          `SELECT version.category_id, version.special_data, instance.container_capacity,
             instance.container_instance_id, instance.equipment_slot, instance.permanent_container,
             ${LEGACY_CAPACITY_COLUMN}
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
        if(row.permanent_container)throw new Error("PERMANENT_BACKPACK_FIXED");
        if(row.equipment_slot!==null)throw new Error("EQUIPMENT_ITEM_EQUIPPED");
        if (!isInventoryContainer(row)) {
          throw new Error("ITEM_NOT_CONTAINER");
        }
        if (row.container_instance_id !== null && !(await getStorageDestinations(client,characterId)).some(parent=>parent.id===row.container_instance_id))throw new Error("CONTAINER_ITEM_STORED");
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
           SET container_slot = $2, container_instance_id=NULL, updated_at = NOW()
           WHERE id = $1 AND character_id = $3`,
          [itemInstanceId, slotIndex, characterId]
        );
      }
      await autoStoreOwnedItems(client,characterId);
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
          `SELECT instance.container_slot, instance.container_instance_id, instance.container_capacity, instance.equipment_slot, instance.permanent_container,
             version.category_id, version.special_data, ${LEGACY_CAPACITY_COLUMN}
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
      if(source.permanent_container)throw new Error("PERMANENT_BACKPACK_FIXED");
      if (targetContainerInstanceId !== null) {
        if(source.equipment_slot!==null)throw new Error("EQUIPMENT_ITEM_EQUIPPED");
        const target = await readOwned(targetContainerInstanceId, "CONTAINER_ITEM_NOT_OWNED");
        if (!isInventoryContainer(target)) throw new Error("ITEM_NOT_CONTAINER");
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
      await autoStoreOwnedItems(client,characterId);
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
      await this.addRewardsWithClient(client, ownerKind, ownerId, rewards);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async addRewardsWithClient(
    client: PoolClient,
    ownerKind: OwnerKind,
    ownerId: string,
    rewards: readonly InventoryReward[]
  ): Promise<void> {
    if(ownerKind==="character")await ensurePermanentBackpack(client,ownerId);
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
    if(ownerKind==="character")await autoStoreOwnedItems(client,ownerId);
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
        version.subcategory_id,
        item.status AS item_status,
        version.minimum_level,
        instance.equipment_slot,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('statCode',stat.stat_code,'modifierType',stat.modifier_type,'value',stat.value))
          FROM item_stat_modifiers stat WHERE stat.version_id=version.id),'[]'::jsonb) AS stats,
        version.description,
        version.icon_url,
        version.rarity,
        instance.quality,
        instance.durability,
        instance.max_durability,
        instance.upgrade_level,
        instance.bound_to_player_id,
        instance.container_slot,
        instance.container_instance_id,
        instance.container_capacity,
        instance.permanent_container,
        version.special_data,
        ${LEGACY_CAPACITY_COLUMN},
        ${CONSUMABLE_EFFECT_COLUMNS}
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
    const equipmentSlots=emptyEquipmentSlots();
    if (ownerKind === "character") {
      for (const row of result.rows) {
        if(isEquipmentSlot(row.equipment_slot))equipmentSlots[row.equipment_slot]=row.instance_id;
        if (row.container_slot !== null &&
          row.container_slot >= 0 && row.container_slot < CONTAINER_SLOT_COUNT &&
          isInventoryContainer(row) &&
          row.container_instance_id === null) {
          containerSlots[row.container_slot] = row.instance_id;
        }
      }
    }
    return {
      items: result.rows.map((row) => this.mapInventoryRow(row)),
      containerSlots,
      ...(ownerKind==="character"?{equipmentSlots}:{})
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
      `SELECT item.id, version.stackable, version.max_stack, version.quality
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
        await this.insertInstance(client, ownerKind, ownerId, definition.id, 1, definition.quality);
      }
      return;
    }

    const ownerColumn = this.ownerColumn(ownerKind);
    let remaining = quantity;
    const storageIds=ownerKind==="character"?(await getStorageDestinations(client,ownerId)).map(item=>item.id):[];
    while (remaining > 0) {
      const existingResult = await client.query<StackRow>(
        `SELECT id, quantity
         FROM item_instances
         WHERE ${ownerColumn} = $1
           AND item_id = $2
           AND quantity < $3
           AND quality = $4
           AND durability IS NULL
           AND max_durability IS NULL
           AND upgrade_level = 0
           AND affixes = '[]'::jsonb
           AND sockets = '[]'::jsonb
           AND bound_to_player_id IS NULL
           ${ownerKind==="character"?"AND equipment_slot IS NULL AND NOT permanent_container AND (container_instance_id IS NULL OR container_instance_id=ANY($5::uuid[]))":""}
         ORDER BY ${ownerKind==="character"?"array_position($5::uuid[],container_instance_id) ASC NULLS LAST,":""} created_at ASC, id ASC
         LIMIT 1
         FOR UPDATE`,
        [ownerId, definition.id, definition.max_stack, definition.quality,...(ownerKind==="character"?[storageIds]:[])]
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
        definition.quality
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
    quality: NonNullable<InventoryItem["quality"]>
  ): Promise<void> {
    const ownerColumn = this.ownerColumn(ownerKind);
    await client.query(
      `INSERT INTO item_instances (
        id, ${ownerColumn}, item_id, quantity, upgrade_level, affixes, sockets, quality
       ) VALUES ($1, $2, $3, $4, 0, '[]'::jsonb, '[]'::jsonb, $5)`,
      [randomUUID(), ownerId, itemDefinitionUuid, quantity, quality]
    );
  }

  private getContainerCapacity(row: ContainerCapacitySource): number | undefined {
    return resolveContainerCapacity(row);
  }

  private mapInventoryRow(row: InventoryRow): InventoryItem {
    const containerCapacity = this.getContainerCapacity(row);
    const consumableEffects = row.permanent_container?undefined:this.getConsumableEffects(row);
    const equipment=!row.permanent_container&&row.item_status==="PUBLISHED" ? getEquipmentItemProperties({
      category:row.category_id,...(row.subcategory_id?{subcategory:row.subcategory_id}:{}),
      minimumLevel:row.minimum_level,stats:row.stats??[],specialData:row.special_data??{}
    }) : undefined;
    return {
      instanceId: row.instance_id,
      itemId: row.permanent_container?PERMANENT_BACKPACK_ITEM_ID:row.item_id,
      itemDefinitionId: row.item_definition_id,
      name: row.permanent_container?PERMANENT_BACKPACK_NAME:row.name,
      quantity: row.quantity,
      category: isInventoryContainer(row)?CONTAINER_ITEM_CATEGORY:row.category_id,
      description: row.description,
      ...(row.permanent_container ? {iconUrl:`/${PERMANENT_BACKPACK_ICON_PATH}`,permanentContainer:true} : row.icon_url ? { iconUrl: row.icon_url } : {}),
      rarity: row.rarity,
      quality: row.quality,
      ...(row.durability === null ? {} : { durability: Number(row.durability) }),
      ...(row.max_durability === null
        ? {}
        : { maxDurability: Number(row.max_durability) }),
      upgradeLevel: row.upgrade_level,
      ...(equipment?{equipment}:{}),
      ...(isEquipmentSlot(row.equipment_slot)?{equippedSlot:row.equipment_slot}:{}),
      ...(consumableEffects ? { consumableEffects } : {}),
      ...(containerCapacity === undefined ? {} : { containerCapacity }),
      ...(row.container_instance_id
        ? { containerInstanceId: row.container_instance_id }
        : {}),
      ...(row.bound_to_player_id
        ? { boundToPlayerId: row.bound_to_player_id }
        : {})
    };
  }

  private getConsumableEffects(row: Pick<InventoryRow, "category_id" | "heal_hp" | "restore_ap">): ConsumableEffects | undefined {
    if (row.category_id !== "consumable") return undefined;
    const positiveAmount = (value: string | number | null): number => {
      const amount = Math.floor(Number(value));
      return Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
    };
    const healHp = positiveAmount(row.heal_hp);
    const restoreAp = positiveAmount(row.restore_ap);
    return healHp || restoreAp ? { ...(healHp ? { healHp } : {}), ...(restoreAp ? { restoreAp } : {}) } : undefined;
  }
}
