import { randomUUID } from "node:crypto";
import { getEquipmentItemProperties, type InventorySnapshot, type ItemStatModifier, type MerchantOffer, type MerchantPurchase, type MerchantSnapshot } from "@web-mmorpg/shared";
import type { Pool, PoolClient } from "pg";
import { InventoryService } from "../inventory/InventoryService";
import { BASIC_EQUIPMENT_ITEMS } from "../items/basicEquipment";

const MERCHANT_ID = "merchant-miro";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_GOLD = 2_147_483_647;
const STOCK = [
  { itemId: "field-bandage", unitPrice: 5, category: "consumable", maxQuantity: 20 },
  { itemId: "rag-bag", unitPrice: 30, category: "container", maxQuantity: 1 },
  { itemId: "minor-healing-potion", unitPrice: 10, category: "consumable", maxQuantity: 20 },
  { itemId: "invigorating-tonic", unitPrice: 12, category: "consumable", maxQuantity: 20 },
  ...BASIC_EQUIPMENT_ITEMS.map(item=>({itemId:item.itemId,unitPrice:item.unitPrice,category:item.categoryId,maxQuantity:1}))
] as const;

interface DefinitionRow {
  id: string;
  item_id: string;
  name: string;
  quality: NonNullable<MerchantOffer["quality"]>;
  description: string;
  category_id: string;
  subcategory_id:string|null;
  stats:ItemStatModifier[];
  stackable: boolean;
  max_stack: number;
  unique_item: boolean;
  soulbound: "NONE" | "ON_PICKUP" | "ON_EQUIP";
  minimum_level: number;
  special_data: Record<string, unknown>;
  heal_hp: string | number | null;
  restore_ap: string | number | null;
  has_requirements: boolean;
}
interface Definition { row: DefinitionRow; offer: MerchantOffer }
interface ReceiptRow { character_id: string; npc_id: string; item_id: string; quantity: number }

/** Gold and item changes are committed together; callers supply current-session/range validation. */
export class MerchantService {
  constructor(private readonly pool: Pool) {}

  async getGold(characterId: string): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockCharacter(client, characterId);
      const gold = await this.lockWallet(client, characterId);
      await client.query("COMMIT");
      return gold;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async getShop(characterId: string): Promise<MerchantSnapshot> {
    const gold = await this.getGold(characterId);
    const definitions = await this.readDefinitions();
    return { npcId: MERCHANT_ID, npcName: "Miro", gold, offers: definitions.map(definition => definition.offer) };
  }

  async purchase(
    characterId: string,
    payload: MerchantPurchase,
    assertCurrent: () => void = () => undefined
  ): Promise<{ shop: MerchantSnapshot; inventory: InventorySnapshot }> {
    const request = this.normalizePurchase(payload);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const level = await this.lockCharacter(client, characterId);
      const gold = await this.lockWallet(client, characterId);
      const receipt = (await client.query<ReceiptRow>(
        "SELECT character_id,npc_id,item_id,quantity FROM merchant_purchase_receipts WHERE request_id=$1",
        [request.requestId]
      )).rows[0];
      if (receipt) {
        if (receipt.character_id !== characterId || receipt.npc_id !== request.npcId ||
            receipt.item_id !== request.itemId || receipt.quantity !== request.quantity) {
          throw new Error("MERCHANT_REQUEST_CONFLICT");
        }
      } else {
        const definition = (await this.readDefinitions(client)).find(entry => entry.offer.itemId === request.itemId);
        if (!definition) throw new Error("MERCHANT_ITEM_UNAVAILABLE");
        if (request.quantity > definition.offer.maxQuantity) throw new Error("MERCHANT_INVALID_QUANTITY");
        if (definition.row.minimum_level > level) throw new Error("MERCHANT_LEVEL_REQUIRED");
        const total = definition.offer.unitPrice * request.quantity;
        if (gold < total) throw new Error("MERCHANT_INSUFFICIENT_GOLD");
        if (definition.row.unique_item) {
          const owned = await client.query("SELECT id FROM item_instances WHERE character_id=$1 AND item_id=$2 LIMIT 1 FOR UPDATE", [characterId, definition.row.id]);
          if (owned.rowCount) throw new Error("MERCHANT_UNIQUE_ITEM_EXISTS");
        }
        const inserted = await client.query(
          `INSERT INTO merchant_purchase_receipts(request_id,character_id,npc_id,item_id,quantity,total_price)
           VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(request_id) DO NOTHING RETURNING request_id`,
          [request.requestId, characterId, request.npcId, request.itemId, request.quantity, total]
        );
        if (!inserted.rowCount) throw new Error("MERCHANT_REQUEST_CONFLICT");
        await client.query("UPDATE character_wallets SET gold=gold-$2,updated_at=NOW() WHERE character_id=$1", [characterId, total]);
        await this.grantItems(client, characterId, definition, request.quantity);
      }
      // Do not await anything between validating the owner/range and issuing COMMIT.
      assertCurrent();
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    try {
      const shop = await this.getShop(characterId);
      const inventory = await new InventoryService(this.pool).getSnapshot(characterId);
      return { shop, inventory };
    } catch {
      // The purchase is durable. The client must retry this request ID, never start a new order.
      throw new Error("MERCHANT_REQUEST_UNCERTAIN");
    }
  }

  async rewardVictory(characterId: string, battleId: string, amount = 15): Promise<number> {
    if (typeof battleId !== "string" || !battleId.trim() || battleId.length > 200 ||
        !Number.isSafeInteger(amount) || amount < 0 || amount > 10_000) throw new Error("MERCHANT_INVALID_REWARD");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await this.lockCharacter(client, characterId);
      const gold = await this.lockWallet(client, characterId);
      const previous = (await client.query<{ amount: number }>(
        "SELECT amount FROM character_gold_rewards WHERE character_id=$1 AND battle_id=$2", [characterId, battleId]
      )).rows[0];
      if (previous) {
        if (previous.amount !== amount) throw new Error("MERCHANT_REWARD_CONFLICT");
        await client.query("COMMIT");
        return gold;
      }
      if (gold > MAX_GOLD - amount) throw new Error("MERCHANT_GOLD_LIMIT");
      await client.query("INSERT INTO character_gold_rewards(character_id,battle_id,amount) VALUES($1,$2,$3)", [characterId, battleId, amount]);
      await client.query("UPDATE character_wallets SET gold=gold+$2,updated_at=NOW() WHERE character_id=$1", [characterId, amount]);
      await client.query("COMMIT");
      return gold + amount;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  private normalizePurchase(value: MerchantPurchase): MerchantPurchase {
    if (!value || typeof value !== "object" || typeof value.requestId !== "string" || !UUID.test(value.requestId) ||
        value.npcId !== MERCHANT_ID || !STOCK.some(stock => stock.itemId === value.itemId)) throw new Error("MERCHANT_INVALID_PURCHASE");
    const stock = STOCK.find(entry => entry.itemId === value.itemId)!;
    if (!Number.isSafeInteger(value.quantity) || value.quantity < 1 || value.quantity > stock.maxQuantity) throw new Error("MERCHANT_INVALID_QUANTITY");
    return { npcId: MERCHANT_ID, requestId: value.requestId.toLowerCase(), itemId: value.itemId, quantity: value.quantity };
  }

  private async lockCharacter(client: PoolClient, characterId: string): Promise<number> {
    if (!UUID.test(characterId)) throw new Error("CHARACTER_NOT_FOUND");
    const result = await client.query<{ level: number }>(
      `SELECT character.level FROM characters character JOIN accounts account ON account.id=character.account_id
       WHERE character.id=$1 AND account.status='active' AND character.deletion_requested_at IS NULL
         AND character.deletion_effective_at IS NULL FOR UPDATE OF character FOR SHARE OF account`, [characterId]
    );
    if (!result.rows[0]) throw new Error("CHARACTER_NOT_FOUND");
    return result.rows[0].level;
  }

  private async lockWallet(client: PoolClient, characterId: string): Promise<number> {
    await client.query("INSERT INTO character_wallets(character_id) VALUES($1) ON CONFLICT(character_id) DO NOTHING", [characterId]);
    return (await client.query<{ gold: number }>("SELECT gold FROM character_wallets WHERE character_id=$1 FOR UPDATE", [characterId])).rows[0]!.gold;
  }

  private async readDefinitions(client?: PoolClient): Promise<Definition[]> {
    const result = await (client ?? this.pool).query<DefinitionRow>(
      `SELECT item.id,item.item_id,version.name,version.quality,version.description,version.category_id,version.subcategory_id,version.stackable,
         version.max_stack,version.unique_item,version.soulbound,version.minimum_level,version.special_data,
         COALESCE((SELECT jsonb_agg(jsonb_build_object('statCode',stat.stat_code,'modifierType',stat.modifier_type,'value',stat.value))
           FROM item_stat_modifiers stat WHERE stat.version_id=version.id),'[]'::jsonb) AS stats,
         (SELECT SUM(stat.value) FROM item_stat_modifiers stat WHERE stat.version_id=version.id
           AND stat.stat_code='HEAL_AMOUNT' AND stat.modifier_type='flat') AS heal_hp,
         (SELECT SUM(stat.value) FROM item_stat_modifiers stat WHERE stat.version_id=version.id
           AND stat.stat_code='AP_RESTORE' AND stat.modifier_type='flat') AS restore_ap,
         EXISTS(SELECT 1 FROM item_requirements requirement WHERE requirement.version_id=version.id) AS has_requirements
       FROM items item JOIN item_versions version ON version.item_id=item.id
         AND version.version_no=item.active_version_no AND version.state='PUBLISHED'
       WHERE item.item_id=ANY($1::text[]) AND item.status='PUBLISHED'
       ORDER BY item.id ${client ? "FOR SHARE OF item,version" : ""}`, [STOCK.map(stock => stock.itemId)]
    );
    return STOCK.flatMap(stock => {
      const row = result.rows.find(definition => definition.item_id === stock.itemId);
      if (!row || row.category_id !== stock.category || row.has_requirements ||
          !Number.isSafeInteger(row.max_stack) || row.max_stack < 1 || (!row.stackable && row.max_stack !== 1)) return [];
      const positiveAmount = (value: string | number | null): number | undefined => {
        const amount = Math.floor(Number(value));
        return Number.isFinite(amount) && amount > 0 && amount <= 1_000_000 ? amount : undefined;
      };
      const healHp = positiveAmount(row.heal_hp), restoreAp = positiveAmount(row.restore_ap);
      const capacity = row.special_data?.capacity;
      if (stock.category === "container" && (row.stackable || typeof capacity !== "number" ||
          !Number.isSafeInteger(capacity) || capacity < 1 || capacity > 10_000)) return [];
      if (stock.category === "consumable" && !healHp && !restoreAp) return [];
      if((stock.category==="weapon"||stock.category==="armor") && (row.stackable || !getEquipmentItemProperties({category:row.category_id,...(row.subcategory_id?{subcategory:row.subcategory_id}:{}),minimumLevel:row.minimum_level,stats:row.stats,specialData:row.special_data})))return [];
      const offer: MerchantOffer = {
        itemId: row.item_id, name: row.name, description: row.description, categoryId: row.category_id,
        quality: row.quality,
        unitPrice: stock.unitPrice, maxQuantity: Math.min(stock.maxQuantity, row.max_stack, row.unique_item ? 1 : 20),
        ...(healHp ? { healHp } : {}), ...(restoreAp ? { restoreAp } : {}),
        ...(stock.category === "container" ? { capacity: capacity as number } : {})
      };
      return [{ row, offer }];
    });
  }

  private async grantItems(client: PoolClient, characterId: string, definition: Definition, quantity: number): Promise<void> {
    const { row } = definition;
    const boundTo = row.soulbound === "ON_PICKUP" ? characterId : null;
    let remaining = quantity;
    if (row.stackable && !row.unique_item) {
      const stacks = await client.query<{ id: string; quantity: number }>(
        `SELECT id,quantity FROM item_instances WHERE character_id=$1 AND item_id=$2 AND quantity<$3
           AND container_instance_id IS NULL AND container_slot IS NULL AND durability IS NULL
           AND max_durability IS NULL AND upgrade_level=0 AND affixes='[]'::jsonb AND sockets='[]'::jsonb
           AND bound_to_player_id IS NOT DISTINCT FROM $4::uuid
           AND quality=$5
         ORDER BY created_at,id FOR UPDATE`, [characterId, row.id, row.max_stack, boundTo, row.quality]
      );
      for (const stack of stacks.rows) {
        const added = Math.min(remaining, row.max_stack - stack.quantity);
        if (added <= 0) break;
        await client.query("UPDATE item_instances SET quantity=quantity+$2,updated_at=NOW() WHERE id=$1", [stack.id, added]);
        remaining -= added;
      }
    }
    while (remaining > 0) {
      const count = row.stackable ? Math.min(remaining, row.max_stack) : 1;
      await client.query(
        `INSERT INTO item_instances(id,character_id,item_id,quantity,bound_to_player_id,container_capacity,quality)
         VALUES($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), characterId, row.id, count, boundTo, definition.offer.capacity ?? null, row.quality]
      );
      remaining -= count;
    }
  }
}
