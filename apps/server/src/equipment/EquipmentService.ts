import {
  getCharacterStatistics,
  getEquipmentItemProperties,
  isEquipmentSlot,
  type EquipmentUpdateRequest,
  type InventorySnapshot,
  type ItemStatModifier
} from "@web-mmorpg/shared";
import type { Pool } from "pg";
import { InventoryService } from "../inventory/InventoryService";

interface EquipmentRow {
  id:string;
  permanent_container:boolean;
  quantity:number;
  equipment_slot:string|null;
  durability:string|number|null;
  bound_to_player_id:string|null;
  category_id:string;
  subcategory_id:string|null;
  minimum_level:number;
  soulbound:string;
  special_data:Record<string,unknown>;
  stats:ItemStatModifier[];
  has_children:boolean;
  requirements:Array<{type:string;code?:string;value:unknown}>;
}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ownership, requirements, bindings and both hand slots change in one transaction. */
export class EquipmentService {
  constructor(private readonly pool:Pool,private readonly inventory=new InventoryService(pool)){}
  async setSlot(characterId:string,payload:EquipmentUpdateRequest,assertCurrent:()=>void=()=>undefined):Promise<InventorySnapshot>{
    if(!payload || !isEquipmentSlot(payload.slot))throw new Error("INVALID_EQUIPMENT_SLOT");
    if(payload.itemInstanceId!==null && (typeof payload.itemInstanceId!=="string" || !UUID.test(payload.itemInstanceId)))throw new Error("INVALID_ITEM_INSTANCE_ID");
    if(!UUID.test(characterId))throw new Error("CHARACTER_NOT_FOUND");
    const slot=payload.slot;
    const instanceId=payload.itemInstanceId?.toLowerCase()??null;
    const client=await this.pool.connect();
    try {
      await client.query("BEGIN");
      const character=(await client.query<{level:number}>(
        `SELECT character.level FROM characters character JOIN accounts account ON account.id=character.account_id
         WHERE character.id=$1 AND account.status='active' AND character.deletion_requested_at IS NULL
           AND character.deletion_effective_at IS NULL FOR UPDATE OF character FOR SHARE OF account`,[characterId]
      )).rows[0];
      if(!character)throw new Error("CHARACTER_NOT_FOUND");
      // Every owner mutation locks the character first; lock item rows in stable order.
      const rows=(await client.query<EquipmentRow>(
        `SELECT instance.id,instance.quantity,instance.equipment_slot,instance.durability,instance.bound_to_player_id,instance.permanent_container,
           version.category_id,version.subcategory_id,version.minimum_level,version.soulbound,version.special_data,
           EXISTS(SELECT 1 FROM item_instances child WHERE child.container_instance_id=instance.id) AS has_children,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('statCode',stat.stat_code,'modifierType',stat.modifier_type,'value',stat.value))
             FROM item_stat_modifiers stat WHERE stat.version_id=version.id),'[]'::jsonb) AS stats,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('type',requirement.requirement_type,'code',requirement.code,'value',requirement.value_json))
             FROM item_requirements requirement WHERE requirement.version_id=version.id),'[]'::jsonb) AS requirements
         FROM item_instances instance JOIN items item ON item.id=instance.item_id
         JOIN item_versions version ON version.item_id=item.id AND version.version_no=item.active_version_no AND version.state='PUBLISHED'
         WHERE instance.character_id=$1 AND (instance.id=$2 OR instance.equipment_slot IS NOT NULL) AND item.status='PUBLISHED'
         ORDER BY instance.id FOR UPDATE OF instance FOR SHARE OF item,version`,[characterId,instanceId]
      )).rows;
      let twoHanded=false;
      if(instanceId!==null) {
        const item=rows.find(row=>row.id===instanceId);
        if(!item)throw new Error("EQUIPMENT_ITEM_NOT_OWNED");
        if(item.permanent_container)throw new Error("PERMANENT_BACKPACK_FIXED");
        const properties=this.properties(item);
        if(!properties || properties.slot!==slot || item.quantity!==1)throw new Error("EQUIPMENT_SLOT_MISMATCH");
        if(properties.minimumLevel>character.level)throw new Error("EQUIPMENT_LEVEL_REQUIRED");
        if(item.durability!==null && Number(item.durability)<=0)throw new Error("EQUIPMENT_ITEM_BROKEN");
        if(item.bound_to_player_id && item.bound_to_player_id!==characterId)throw new Error("EQUIPMENT_ITEM_BOUND");
        if(item.has_children)throw new Error("EQUIPMENT_ITEM_NOT_EMPTY");
        this.assertRequirements(item.requirements,character.level);
        const mainHand=rows.find(row=>row.equipment_slot==="mainHand");
        if(slot==="offHand" && mainHand && this.properties(mainHand)?.twoHanded)throw new Error("EQUIPMENT_TWO_HANDED");
        twoHanded=slot==="mainHand" && properties.twoHanded;
      }
      await client.query(
        `UPDATE item_instances SET equipment_slot=NULL,updated_at=NOW()
         WHERE character_id=$1 AND (equipment_slot=$2 OR id=$3 OR ($4::boolean AND equipment_slot='offHand'))`,
        [characterId,slot,instanceId,twoHanded]
      );
      if(instanceId!==null) {
        const item=rows.find(row=>row.id===instanceId)!;
        await client.query(
          `UPDATE item_instances SET equipment_slot=$2,container_instance_id=NULL,container_slot=NULL,
             bound_to_player_id=CASE WHEN $4::boolean THEN $3::uuid ELSE bound_to_player_id END,updated_at=NOW()
           WHERE id=$1 AND character_id=$3`,
          [instanceId,slot,characterId,item.soulbound==="ON_EQUIP"||item.soulbound==="ON_PICKUP"]
        );
      }
      const snapshot=await this.inventory.getSnapshot(characterId,client);
      // No await is allowed between the current-session assertion and COMMIT.
      assertCurrent();
      await client.query("COMMIT");
      return snapshot;
    }catch(error){await client.query("ROLLBACK");throw error;}
    finally{client.release();}
  }

  private properties(item:EquipmentRow){
    return getEquipmentItemProperties({category:item.category_id,...(item.subcategory_id?{subcategory:item.subcategory_id}:{}),minimumLevel:item.minimum_level,stats:item.stats??[],specialData:item.special_data??{}});
  }

  private assertRequirements(requirements:EquipmentRow["requirements"],level:number):void {
    const statistics=getCharacterStatistics(level);
    const values:Record<string,number>={STRENGTH:statistics.strength,DEXTERITY:statistics.dexterity,VITALITY:statistics.vitality,MAX_HP:statistics.maxHp,MAX_AP:statistics.maxAp,INITIATIVE:statistics.initiative,ARMOR:statistics.armor};
    for(const requirement of requirements??[]) {
      const value=requirement.value;
      if(typeof value!=="number" || !Number.isFinite(value) || value<0)throw new Error("EQUIPMENT_REQUIREMENTS_NOT_MET");
      if(requirement.type==="LEVEL" && level>=value)continue;
      if(requirement.type==="STAT" && requirement.code && Object.hasOwn(values,requirement.code.toUpperCase()) && values[requirement.code.toUpperCase()]!>=value)continue;
      throw new Error("EQUIPMENT_REQUIREMENTS_NOT_MET");
    }
  }
}
