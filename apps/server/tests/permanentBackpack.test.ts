import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { PERMANENT_BACKPACK_CAPACITY, PERMANENT_BACKPACK_ICON_PATH, PERMANENT_BACKPACK_ITEM_ID, PERMANENT_BACKPACK_NAME, type SocialPlayer } from "@web-mmorpg/shared";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CharacterLifecycleService } from "../src/character/CharacterLifecycleService";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { EquipmentService } from "../src/equipment/EquipmentService";
import { InventoryService } from "../src/inventory/InventoryService";
import { ensurePermanentBackpack } from "../src/inventory/permanentBackpack";
import { ItemCatalogService } from "../src/items/ItemCatalogService";
import { ItemMetadataRepository } from "../src/items/ItemMetadataRepository";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { TradeService } from "../src/social/TradeService";

const databaseUrl=process.env.DATABASE_URL,target=databaseUrl?new URL(databaseUrl):undefined;
const describeDatabase=target&&["localhost","127.0.0.1"].includes(target.hostname)&&["/web_mmorpg_test","/web_mmorpg_slot_order_tests"].includes(target.pathname)?describe:describe.skip;

describeDatabase("permanent character backpack",()=>{
 const pool=createPool(databaseUrl??"postgresql://unused/unused"),inventory=new InventoryService(pool);
 const catalog=new ItemCatalogService(pool,new ItemMetadataRepository(pool));
 let alice:string,bob:string;
 async function account(name:string){const id=randomUUID();await pool.query("INSERT INTO accounts(id,username,username_normalized,password_hash,recovery_code_hash) VALUES($1,$2,$2,'hash','hash')",[id,name]);return id;}
 beforeEach(async()=>{
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");await runMigrations(pool);await seedItemMetadata(pool);
  const ids=[];
  for(const name of ["BackpackAlice","BackpackBob"]){const id=randomUUID(),owner=await account(name.toLowerCase());await pool.query("INSERT INTO characters(id,account_id,nickname,nickname_normalized) VALUES($1,$2,$3,$3)",[id,owner,name]);ids.push(id);}
  [alice,bob]=[ids[0]!,ids[1]!];
 });
 afterAll(async()=>{await pool.end();});
 async function bag(owner=alice){await inventory.ensurePermanentBackpack(owner);return (await inventory.getSnapshot(owner)).items.find(item=>item.permanentContainer)!;}

 it("gives a newly created character a real owned backpack atomically, even before ordinary catalog seeding",async()=>{
  await pool.query("TRUNCATE items CASCADE");
  const owner=await account("newbackpackowner");
  const character=await new CharacterLifecycleService(pool).createCharacter(owner,{nickname:"NewBackpack",appearance:{}});
  const snapshot=await inventory.getSnapshot(character.id),pack=snapshot.items.find(item=>item.permanentContainer)!;
  expect(pack).toMatchObject({itemId:PERMANENT_BACKPACK_ITEM_ID,name:PERMANENT_BACKPACK_NAME,category:"container",quantity:1,permanentContainer:true,containerCapacity:16,boundToPlayerId:character.id,iconUrl:`/${PERMANENT_BACKPACK_ICON_PATH}`});
  expect(snapshot.containerSlots).toEqual([pack.instanceId,null,null,null]);
  const stored=(await pool.query("SELECT * FROM item_instances WHERE id=$1",[pack.instanceId])).rows[0];
  expect(stored).toMatchObject({character_id:character.id,player_id:null,permanent_container:true,container_slot:0,container_capacity:16});
 });

 it("repairs existing characters at startup and safely repeats concurrent authentication provisioning",async()=>{
  await seedItemMetadata(pool);
  const original=(await inventory.getSnapshot(alice)).items.find(item=>item.permanentContainer)!;
  expect(original).toBeDefined();
  await pool.query("UPDATE item_instances SET quality='GOOD' WHERE id=$1",[original.instanceId]);
  await Promise.all(Array.from({length:8},()=>inventory.ensurePermanentBackpack(alice)));await seedItemMetadata(pool);
  expect((await inventory.getSnapshot(alice)).items.filter(item=>item.permanentContainer)).toEqual([expect.objectContaining({instanceId:original.instanceId,quality:"GOOD",containerCapacity:16})]);
  expect((await inventory.getLegacySessionSnapshot(randomUUID())).items).toEqual([]);
 });

 it("finishes archived-definition startup repair alongside authentication without reversing character/item locks",async()=>{
  const original=await bag();await catalog.archive(PERMANENT_BACKPACK_ITEM_ID,alice);
  const authClient=await pool.connect(),seedClient=await pool.connect();
  let authLocked!:()=>void,seedReachedCharacter!:()=>void;
  const characterLocked=new Promise<void>(resolve=>{authLocked=resolve;});
  const seedAtCharacter=new Promise<void>(resolve=>{seedReachedCharacter=resolve;});
  const isCharacterLock=(text:string)=>text.startsWith("SELECT id FROM characters WHERE")&&text.includes("FOR UPDATE");
  const authConnection={query:async(text:string,values?:unknown[])=>{
   const result=await authClient.query(text,values);
   if(isCharacterLock(text)){authLocked();await seedAtCharacter;}
   return result;
  }} as unknown as PoolClient;
  const seedConnection={query:async(text:string,values?:unknown[])=>{
   if(isCharacterLock(text)&&values?.[0]===alice)seedReachedCharacter();
   return seedClient.query(text,values);
  },release:()=>{}} as unknown as PoolClient;
  const startupPool={connect:async()=>seedConnection} as unknown as Pool;
  try {
   const authentication=(async()=>{
    await authClient.query("BEGIN");
    try {await ensurePermanentBackpack(authConnection,alice);await authClient.query("COMMIT");}
    catch(error){await authClient.query("ROLLBACK");throw error;}
   })();
   await characterLocked;
   const outcomes=await Promise.allSettled([authentication,seedItemMetadata(startupPool)]);
   expect(outcomes).toEqual([{status:"fulfilled",value:undefined},{status:"fulfilled",value:undefined}]);
   expect((await inventory.getSnapshot(alice)).items.filter(item=>item.permanentContainer)).toEqual([expect.objectContaining({instanceId:original.instanceId,containerCapacity:16})]);
  } finally {authClient.release();seedClient.release();}
 });

 it("migrates a full former first-slot bag without deleting the bag, its contents or their parent links",async()=>{
  const granted=await inventory.addItems(alice,[{itemId:"rag-bag",quantity:1},{itemId:"training-dagger",quantity:8}]);
  const old=granted.items.find(item=>item.itemId==="rag-bag")!,children=granted.items.filter(item=>item.itemId==="training-dagger");
  await inventory.setContainerSlot(alice,1,old.instanceId);
  for(const child of children)await inventory.moveItemToContainer(alice,child.instanceId,old.instanceId);
  const removed=await pool.query("DELETE FROM item_instances pack WHERE pack.character_id=$1 AND pack.permanent_container AND NOT EXISTS(SELECT 1 FROM item_instances child WHERE child.container_instance_id=pack.id)",[alice]);
  expect(removed.rowCount).toBe(1);
  await pool.query("ALTER TABLE item_instances DROP COLUMN IF EXISTS permanent_container CASCADE; DELETE FROM schema_migrations WHERE migration_name='013_permanent_backpack'");
  await pool.query("UPDATE item_instances SET container_slot=0 WHERE id=$1",[old.instanceId]);
  await runMigrations(pool);await seedItemMetadata(pool);
  const snapshot=await inventory.getSnapshot(alice),pack=snapshot.items.find(item=>item.permanentContainer)!;
  expect(snapshot.items.find(item=>item.instanceId===old.instanceId)).toMatchObject({itemId:"rag-bag",containerCapacity:8});
  expect((await pool.query("SELECT container_slot FROM item_instances WHERE id=$1",[old.instanceId])).rows[0].container_slot).toBeNull();
  expect(snapshot.items.filter(item=>item.containerInstanceId===old.instanceId).map(item=>item.instanceId).sort()).toEqual(children.map(item=>item.instanceId).sort());
  expect(snapshot.containerSlots).toEqual([pack.instanceId,null,null,null]);
  expect(snapshot.items).toHaveLength(10);
 });

 it("stores sixteen complete instances and rejects a seventeenth despite edited catalog capacity",async()=>{
  const pack=await bag();
  await pool.query("UPDATE item_versions SET special_data='{\"capacity\":999}' WHERE item_id=$1",[pack.itemDefinitionId]);
  const tokens=(await inventory.addItems(alice,[{itemId:"training-dagger",quantity:17}])).items.filter(item=>item.itemId==="training-dagger");
  for(const token of tokens.slice(0,16))await inventory.moveItemToContainer(alice,token.instanceId,pack.instanceId);
  await expect(inventory.moveItemToContainer(alice,tokens[16]!.instanceId,pack.instanceId)).rejects.toThrow("CONTAINER_FULL");
  const snapshot=await inventory.getSnapshot(alice);
  expect(snapshot.items.filter(item=>item.containerInstanceId===pack.instanceId)).toHaveLength(PERMANENT_BACKPACK_CAPACITY);
  expect(snapshot.items.find(item=>item.instanceId===tokens[16]!.instanceId)?.containerInstanceId).toBeUndefined();
 });

 it("protects permanent identity, slot, capacity and ownership across every item action and metadata edits",async()=>{
  const pack=await bag(),ordinary=(await inventory.addItems(alice,[{itemId:"rag-bag",quantity:1}])).items.find(item=>item.itemId==="rag-bag")!;
  await pool.query("UPDATE item_instances SET quality='MASTERWORK' WHERE id=$1",[pack.instanceId]);
  await pool.query("UPDATE item_versions SET name='Changed',category_id='consumable',subcategory_id=NULL,icon_url='https://example.com/changed.png',special_data='{\"capacity\":999}' WHERE item_id=$1",[pack.itemDefinitionId]);
  await pool.query("INSERT INTO item_stat_modifiers(id,version_id,stat_code,modifier_type,value) SELECT $1,id,'HEAL_AMOUNT','flat',50 FROM item_versions WHERE item_id=$2",[randomUUID(),pack.itemDefinitionId]);
  const view=(await inventory.getSnapshot(alice)).items.find(item=>item.instanceId===pack.instanceId)!;
  expect(view).toMatchObject({name:PERMANENT_BACKPACK_NAME,category:"container",iconUrl:`/${PERMANENT_BACKPACK_ICON_PATH}`,containerCapacity:16,quality:"MASTERWORK",permanentContainer:true});
  expect(view.consumableEffects).toBeUndefined();expect(view.equipment).toBeUndefined();
  await expect(inventory.setContainerSlot(alice,0,null)).rejects.toThrow("PERMANENT_BACKPACK_FIXED");
  await expect(inventory.setContainerSlot(alice,0,ordinary.instanceId)).rejects.toThrow("PERMANENT_BACKPACK_FIXED");
  await expect(inventory.setContainerSlot(alice,1,pack.instanceId)).rejects.toThrow("PERMANENT_BACKPACK_FIXED");
  await expect(inventory.moveItemToContainer(alice,pack.instanceId,ordinary.instanceId)).rejects.toThrow("PERMANENT_BACKPACK_FIXED");
  await expect(inventory.moveItemToContainer(alice,pack.instanceId,null)).rejects.toThrow("PERMANENT_BACKPACK_FIXED");
  await expect(new EquipmentService(pool).setSlot(alice,{slot:"mainHand",itemInstanceId:pack.instanceId})).rejects.toThrow("PERMANENT_BACKPACK_FIXED");
  const prepare=vi.fn(()=>({hp:100,severelyInjured:false,injuries:[]}));
  await expect(inventory.consumeBattleItem(alice,pack.instanceId,prepare)).rejects.toThrow("PERMANENT_BACKPACK_FIXED");expect(prepare).not.toHaveBeenCalled();
  const players=new Map<string,SocialPlayer>([alice,bob].map(id=>[id,{id,nickname:id,online:true,inBattle:false}]));
  const trades=new TradeService(pool,id=>players.get(id),()=>({locationId:"forest",x:0,y:0}));
  let trade=await trades.request(alice,bob);trade=await trades.respond(bob,trade.id,true);
  await expect(trades.setOffer(alice,trade.id,trade.revision,[{instanceId:pack.instanceId,quantity:1}])).rejects.toThrow("TRADE_PERMANENT_BACKPACK");
  for(const patch of ["container_slot=NULL","container_capacity=NULL","container_capacity=17","container_instance_id='00000000-0000-4000-8000-000000000999'","equipment_slot='mainHand'","quantity=2","bound_to_player_id=NULL",`character_id='${bob}'`]){
   await expect(pool.query(`UPDATE item_instances SET ${patch} WHERE id=$1`,[pack.instanceId])).rejects.toMatchObject({code:"23514"});
  }
 });

 it("provides a usable definition without destroying an existing draft and survives archive or republish",async()=>{
  await pool.query("DELETE FROM item_versions WHERE item_id=(SELECT id FROM items WHERE item_id=$1)",[PERMANENT_BACKPACK_ITEM_ID]);
  await pool.query("DELETE FROM items WHERE item_id=$1",[PERMANENT_BACKPACK_ITEM_ID]);
  const source=(await catalog.getItem("wolf-pelt")).item;
  await catalog.createDraft({...source,itemId:PERMANENT_BACKPACK_ITEM_ID,name:"Existing authored draft"},alice);
  const pack=await bag();
  expect((await catalog.getItem(PERMANENT_BACKPACK_ITEM_ID)).draft?.name).toBe("Existing authored draft");
  await catalog.archive(PERMANENT_BACKPACK_ITEM_ID,alice);await inventory.ensurePermanentBackpack(alice);
  expect((await inventory.getSnapshot(alice)).items.find(item=>item.permanentContainer)?.instanceId).toBe(pack.instanceId);
  await catalog.publish(PERMANENT_BACKPACK_ITEM_ID,1,alice);
  expect((await inventory.getSnapshot(alice)).items.find(item=>item.permanentContainer)).toMatchObject({name:PERMANENT_BACKPACK_NAME,category:"container",containerCapacity:16});
 });

 it("rolls character creation back if the owned backpack cannot be persisted",async()=>{
  const owner=await account("failedbackpackowner");
  await pool.query("CREATE FUNCTION fail_backpack_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.permanent_container THEN RETURN NULL; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_backpack_insert BEFORE INSERT ON item_instances FOR EACH ROW EXECUTE FUNCTION fail_backpack_insert()");
  await expect(new CharacterLifecycleService(pool).createCharacter(owner,{nickname:"RollbackBackpack",appearance:{}})).rejects.toThrow("PERMANENT_BACKPACK_UNAVAILABLE");
  expect((await pool.query("SELECT id FROM characters WHERE account_id=$1",[owner])).rowCount).toBe(0);
 });
});
