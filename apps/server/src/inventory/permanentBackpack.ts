import { randomUUID } from "node:crypto";
import { PERMANENT_BACKPACK_CAPACITY, PERMANENT_BACKPACK_ICON_PATH, PERMANENT_BACKPACK_ITEM_ID, PERMANENT_BACKPACK_NAME, PERMANENT_BACKPACK_SLOT_INDEX } from "@web-mmorpg/shared";
import type { PoolClient } from "pg";

interface DefinitionRow {id:string;status:string;active_version_no:number|null;usable:boolean;}
const SEED_ACTOR="00000000-0000-4000-8000-000000000001";

/** Ensure a published FK target without overwriting authored versions or an existing draft. */
export async function ensurePermanentBackpackDefinition(client:PoolClient):Promise<string> {
  const read=async(lock=false)=>(await client.query<DefinitionRow>(
    `SELECT item.id,item.status,item.active_version_no,
       EXISTS(SELECT 1 FROM item_versions version WHERE version.item_id=item.id
         AND version.version_no=item.active_version_no AND version.state='PUBLISHED') AS usable
     FROM items item WHERE item.item_id=$1 ${lock?"FOR UPDATE OF item":""}`,[PERMANENT_BACKPACK_ITEM_ID]
  )).rows[0];
  const current=await read();
  if(current?.usable&&current.status==="PUBLISHED")return current.id;
  await client.query("INSERT INTO item_categories(id,name,system) VALUES('container','Pojemniki',TRUE) ON CONFLICT(id) DO NOTHING");
  await client.query("INSERT INTO items(id,item_id) VALUES($1,$2) ON CONFLICT(item_id) DO NOTHING",[randomUUID(),PERMANENT_BACKPACK_ITEM_ID]);
  const item=(await read(true))!;
  let active=item.usable&&item.active_version_no!==null?item.active_version_no:undefined;
  if(active===undefined){
    active=(await client.query<{version_no:number}>("SELECT version_no FROM item_versions WHERE item_id=$1 AND state='PUBLISHED' ORDER BY version_no DESC LIMIT 1",[item.id])).rows[0]?.version_no;
  }
  if(active===undefined){
    active=(await client.query<{version_no:number}>("SELECT COALESCE(MAX(version_no),0)+1 AS version_no FROM item_versions WHERE item_id=$1",[item.id])).rows[0]!.version_no;
    await client.query(
      `INSERT INTO item_versions(id,item_id,version_no,state,name,category_id,description,icon_url,rarity,
         sellable,tradable,droppable,stackable,max_stack,soulbound,unique_item,special_data,created_by)
       VALUES($1,$2,$3,'PUBLISHED',$4,'container',$5,$6,'COMMON',FALSE,FALSE,FALSE,FALSE,1,'ON_PICKUP',TRUE,$7::jsonb,$8)`,
      [randomUUID(),item.id,active,PERMANENT_BACKPACK_NAME,"Stały plecak postaci mieszczący szesnaście przedmiotów.",`/${PERMANENT_BACKPACK_ICON_PATH}`,JSON.stringify({capacity:PERMANENT_BACKPACK_CAPACITY}),SEED_ACTOR]
    );
  }
  await client.query("UPDATE items SET status='PUBLISHED',active_version_no=$2,updated_at=NOW() WHERE id=$1",[item.id,active]);
  return item.id;
}

/** Caller owns the transaction; character locking makes simultaneous provisioning idempotent. */
export async function ensurePermanentBackpack(client:PoolClient,characterId:string):Promise<string> {
  if(!(await client.query("SELECT id FROM characters WHERE id=$1 FOR UPDATE",[characterId])).rowCount)throw new Error("CHARACTER_NOT_FOUND");
  const definitionId=await ensurePermanentBackpackDefinition(client);
  const existing=(await client.query<{id:string}>("SELECT id FROM item_instances WHERE character_id=$1 AND permanent_container FOR UPDATE",[characterId])).rows[0];
  if(existing)return existing.id;
  await client.query("UPDATE item_instances SET container_slot=NULL,updated_at=NOW() WHERE character_id=$1 AND container_slot=$2 AND NOT permanent_container",[characterId,PERMANENT_BACKPACK_SLOT_INDEX]);
  const instanceId=randomUUID();
  const inserted=await client.query(
    `INSERT INTO item_instances(id,character_id,item_id,quantity,container_slot,container_capacity,permanent_container,bound_to_player_id,quality)
     SELECT $1,$2,item.id,1,$4,$5,TRUE,$2,version.quality FROM items item JOIN item_versions version
       ON version.item_id=item.id AND version.version_no=item.active_version_no AND version.state='PUBLISHED'
     WHERE item.id=$3`,[instanceId,characterId,definitionId,PERMANENT_BACKPACK_SLOT_INDEX,PERMANENT_BACKPACK_CAPACITY]
  );
  if(inserted.rowCount!==1)throw new Error("PERMANENT_BACKPACK_UNAVAILABLE");
  return instanceId;
}
