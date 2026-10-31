import type { PoolClient } from "pg";
import { LEGACY_CAPACITY_COLUMN, resolveContainerCapacity, type ContainerCapacitySource } from "./containerCapacity";

interface DestinationRow extends ContainerCapacitySource {id:string;container_slot:number;}
export interface StorageDestination {id:string;capacity:number;}

/** Fill only missing legacy positions; never move an already positioned row. */
export async function ensureOwnedContainerPositions(client:PoolClient,characterId:string):Promise<Map<string,Set<number>>> {
 const rows=await client.query<{id:string;container_instance_id:string;container_position:number|null}>(
  "SELECT id,container_instance_id,container_position FROM item_instances WHERE character_id=$1 AND container_instance_id IS NOT NULL ORDER BY created_at,id FOR UPDATE",[characterId]
 );
 const occupied=new Map<string,Set<number>>();
 for(const row of rows.rows){const positions=occupied.get(row.container_instance_id)??new Set<number>();occupied.set(row.container_instance_id,positions);if(row.container_position!==null)positions.add(row.container_position);}
 for(const row of rows.rows){if(row.container_position!==null)continue;const positions=occupied.get(row.container_instance_id)!;let position=0;while(positions.has(position))position++;
  await client.query("UPDATE item_instances SET container_position=$2 WHERE id=$1",[row.id,position]);positions.add(position);
 }
 return occupied;
}

/** Caller holds the owning character lock before reading or changing storage. */
export async function getStorageDestinations(client:PoolClient,characterId:string):Promise<StorageDestination[]> {
 const result=await client.query<DestinationRow>(
  `SELECT instance.id,instance.permanent_container,instance.container_slot,instance.container_capacity,version.category_id,version.special_data,
     ${LEGACY_CAPACITY_COLUMN}
   FROM item_instances instance JOIN items item ON item.id=instance.item_id
   JOIN item_versions version ON version.item_id=item.id AND version.version_no=item.active_version_no AND version.state='PUBLISHED'
   WHERE instance.character_id=$1 AND instance.container_slot IS NOT NULL
     AND instance.container_instance_id IS NULL AND instance.equipment_slot IS NULL
   ORDER BY item.id,instance.id FOR SHARE OF item,version`,[characterId]
 );
 return result.rows.sort((a,b)=>Number(b.permanent_container)-Number(a.permanent_container)||a.container_slot-b.container_slot).flatMap(row=>{
  const capacity=resolveContainerCapacity(row);
  return capacity===undefined?[]:[{id:row.id,capacity}];
 });
}

/** Store eligible loose instances; overflow remains durable owned rows rather than an error. */
export async function autoStoreOwnedItems(client:PoolClient,characterId:string):Promise<void> {
 const occupied=await ensureOwnedContainerPositions(client,characterId);
 const destinations=await getStorageDestinations(client,characterId);
 if(!destinations.length)return;
 const free=new Map(destinations.map(item=>[item.id,Array.from({length:item.capacity},(_,index)=>index).filter(index=>!occupied.get(item.id)?.has(index))]));
 const loose=await client.query<{id:string}>(
  `SELECT instance.id FROM item_instances instance WHERE instance.character_id=$1
     AND instance.container_instance_id IS NULL AND instance.container_slot IS NULL
     AND instance.equipment_slot IS NULL AND NOT instance.permanent_container
     AND NOT EXISTS(SELECT 1 FROM item_instances child WHERE child.container_instance_id=instance.id)
   ORDER BY instance.created_at,instance.id FOR UPDATE OF instance`,[characterId]
 );
 for(const item of loose.rows){
  const destination=destinations.find(target=>(free.get(target.id)?.length??0)>0);
  if(!destination)break;
  const position=free.get(destination.id)!.shift()!;
  await client.query("UPDATE item_instances SET container_instance_id=$2,container_position=$4,updated_at=NOW() WHERE id=$1 AND character_id=$3",[item.id,destination.id,characterId,position]);
 }
}
