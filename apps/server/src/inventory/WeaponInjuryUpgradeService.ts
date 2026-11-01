import { canApplyWeaponInjury, isWeaponInjuryStone, isWeaponInjuryUpgrade, rollWeaponInjuryUpgrade,
  type InventorySnapshot, type WeaponInjuryUpgrade, type WeaponInjuryUpgradeRequest } from "@web-mmorpg/shared";
import type { Pool } from "pg";
import { InventoryService } from "./InventoryService";
import { autoStoreOwnedItems } from "./autoStorage";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
interface ReceiptRow { character_id: string; weapon_instance_id: string; stone_instance_id: string; upgrade: unknown }

/** One character lock serializes material consumption, equipment changes and request retries. */
export class WeaponInjuryUpgradeService {
  constructor(private readonly pool: Pool, private readonly inventory = new InventoryService(pool)) {}

  async apply(characterId: string, payload: WeaponInjuryUpgradeRequest, assertCurrent: () => void = () => undefined): Promise<{ inventory: InventorySnapshot; upgrade: WeaponInjuryUpgrade }> {
    if (!UUID.test(characterId)) throw new Error("CHARACTER_NOT_FOUND");
    if (!payload || typeof payload !== "object" ||
        ![payload.requestId, payload.weaponInstanceId, payload.stoneInstanceId].every(value => typeof value === "string" && UUID.test(value))) {
      throw new Error("WEAPON_INJURY_INVALID_REQUEST");
    }
    // Copy inputs before the first await; caller mutation cannot change receipt identity.
    const request = { requestId: payload.requestId.toLowerCase(), weaponInstanceId: payload.weaponInstanceId.toLowerCase(), stoneInstanceId: payload.stoneInstanceId.toLowerCase() };
    const client = await this.pool.connect();
    let committing = false;
    try {
      await client.query("BEGIN");
      const character = await client.query(
        `SELECT character.id FROM characters character JOIN accounts account ON account.id=character.account_id
         WHERE character.id=$1 AND account.status='active' AND character.deletion_requested_at IS NULL
           AND character.deletion_effective_at IS NULL FOR UPDATE OF character FOR SHARE OF account`, [characterId]
      );
      if (!character.rowCount) throw new Error("CHARACTER_NOT_FOUND");
      const receipt = (await client.query<ReceiptRow>(
        "SELECT character_id,weapon_instance_id,stone_instance_id,upgrade FROM weapon_injury_upgrade_receipts WHERE request_id=$1", [request.requestId]
      )).rows[0];
      let upgrade: WeaponInjuryUpgrade;
      if (receipt) {
        if (receipt.character_id !== characterId || receipt.weapon_instance_id !== request.weaponInstanceId || receipt.stone_instance_id !== request.stoneInstanceId) throw new Error("WEAPON_INJURY_REQUEST_CONFLICT");
        if (!isWeaponInjuryUpgrade(receipt.upgrade)) throw new Error("WEAPON_INJURY_RECEIPT_INVALID");
        upgrade = receipt.upgrade;
      } else {
        const locked = await client.query<{ id: string }>(
          `SELECT instance.id FROM item_instances instance JOIN items item ON item.id=instance.item_id
           JOIN item_versions version ON version.item_id=item.id AND version.version_no=item.active_version_no AND version.state='PUBLISHED'
           WHERE instance.character_id=$1 AND instance.id=ANY($2::uuid[]) AND item.status='PUBLISHED'
           ORDER BY instance.id FOR UPDATE OF instance FOR SHARE OF item,version`,
          [characterId, [request.weaponInstanceId, request.stoneInstanceId]]
        );
        if (locked.rows.length !== 2) throw new Error("INVENTORY_ITEM_NOT_OWNED");
        const before = await this.inventory.getSnapshot(characterId, client);
        const weapon = before.items.find(item => item.instanceId === request.weaponInstanceId);
        const stone = before.items.find(item => item.instanceId === request.stoneInstanceId);
        if (!weapon || !stone) throw new Error("INVENTORY_ITEM_NOT_OWNED");
        if (!canApplyWeaponInjury(weapon)) throw new Error("WEAPON_INJURY_INELIGIBLE");
        if (!isWeaponInjuryStone(stone) || stone.quantity < 1 || stone.permanentContainer) throw new Error("WEAPON_INJURY_INVALID_STONE");
        upgrade = rollWeaponInjuryUpgrade(weapon.quality!);
        const inserted = await client.query(
          `INSERT INTO weapon_injury_upgrade_receipts(request_id,character_id,weapon_instance_id,stone_instance_id,upgrade)
           VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(request_id) DO NOTHING RETURNING request_id`,
          [request.requestId, characterId, request.weaponInstanceId, request.stoneInstanceId, JSON.stringify(upgrade)]
        );
        if (!inserted.rowCount) throw new Error("WEAPON_INJURY_REQUEST_CONFLICT");
        await client.query("UPDATE item_instances SET injury_upgrade=$3::jsonb,updated_at=NOW() WHERE id=$1 AND character_id=$2", [request.weaponInstanceId, characterId, JSON.stringify(upgrade)]);
        if (stone.quantity === 1) await client.query("DELETE FROM item_instances WHERE id=$1 AND character_id=$2", [request.stoneInstanceId, characterId]);
        else await client.query("UPDATE item_instances SET quantity=quantity-1,updated_at=NOW() WHERE id=$1 AND character_id=$2", [request.stoneInstanceId, characterId]);
        await autoStoreOwnedItems(client, characterId);
      }
      const inventory = await this.inventory.getSnapshot(characterId, client);
      // Includes live battle/trade checks. No await between this assertion and issuing COMMIT.
      assertCurrent();
      committing = true;
      await client.query("COMMIT");
      return { inventory, upgrade };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      if (committing) throw new Error("WEAPON_INJURY_REQUEST_UNCERTAIN");
      throw error;
    } finally { client.release(); }
  }
}
