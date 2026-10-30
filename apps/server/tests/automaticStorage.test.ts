import { randomUUID } from "node:crypto";
import { getPendingInventoryItems, type SocialPlayer } from "@web-mmorpg/shared";
import { afterAll,beforeEach,describe,expect,it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { EquipmentService } from "../src/equipment/EquipmentService";
import { InventoryService } from "../src/inventory/InventoryService";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { MerchantService } from "../src/merchant/MerchantService";
import { TradeService } from "../src/social/TradeService";

const url=process.env.DATABASE_URL,target=url?new URL(url):undefined;
const describeDatabase=target&&["localhost","127.0.0.1"].includes(target.hostname)&&target.pathname==="/web_mmorpg_test"?describe:describe.skip;
describeDatabase("automatic owned item storage",()=>{
 const pool=createPool(url??"postgresql://unused/unused"),inventory=new InventoryService(pool);
 let alice:string,bob:string;
 beforeEach(async()=>{
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");await runMigrations(pool);await seedItemMetadata(pool);
  const ids=[];
  for(const name of ["StorageAlice","StorageBob"]){const account=randomUUID(),id=randomUUID();await pool.query("INSERT INTO accounts(id,username,username_normalized,password_hash,recovery_code_hash) VALUES($1,$2,$2,'hash','hash')",[account,name]);await pool.query("INSERT INTO characters(id,account_id,nickname,nickname_normalized,hp) VALUES($1,$2,$3,$3,50)",[id,account,name]);ids.push(id);}
  [alice,bob]=[ids[0]!,ids[1]!];
 });
 afterAll(async()=>{await pool.end();});
 async function pack(owner=alice){await inventory.ensurePermanentBackpack(owner);return (await inventory.getSnapshot(owner)).items.find(item=>item.permanentContainer)!;}
 async function give(itemId:string,quantity=1,owner=alice){return (await inventory.addItems(owner,[{itemId,quantity}])).items.filter(item=>item.itemId===itemId);}

 it("puts rewards into sixteen backpack cells, persists overflow and fills the freed cell after consuming an item",async()=>{
  const backpack=await pack(),bandage=(await give("field-bandage"))[0]!;
  const weapons=await give("training-dagger",16),before=await inventory.getSnapshot(alice);
  expect(before.items.filter(item=>item.containerInstanceId===backpack.instanceId)).toHaveLength(16);
  const waiting=getPendingInventoryItems(before);expect(waiting).toHaveLength(1);expect(weapons.some(item=>item.instanceId===waiting[0]!.instanceId)).toBe(true);
  expect(getPendingInventoryItems(await new InventoryService(pool).getSnapshot(alice)).map(item=>item.instanceId)).toEqual(waiting.map(item=>item.instanceId));
  const after=await inventory.consumeBattleItem(alice,bandage.instanceId,()=>({hp:80,severelyInjured:false,injuries:[]}));
  expect(getPendingInventoryItems(after)).toEqual([]);
  expect(after.items.find(item=>item.instanceId===waiting[0]!.instanceId)?.containerInstanceId).toBe(backpack.instanceId);
  expect(after.items.filter(item=>item.itemId==="training-dagger")).toHaveLength(16);
 });

 it("assigns a stored ordinary bag directly and falls back to it without relocating already stored items",async()=>{
  const backpack=await pack(),bag=(await give("rag-bag"))[0]!;
  expect(bag.containerInstanceId).toBe(backpack.instanceId);
  await inventory.setContainerSlot(alice,1,bag.instanceId);
  const weapons=await give("training-dagger",17),inside=weapons.filter(item=>item.containerInstanceId===backpack.instanceId),fallback=weapons.filter(item=>item.containerInstanceId===bag.instanceId);
  expect(inside).toHaveLength(16);expect(fallback).toHaveLength(1);
  await inventory.moveItemToContainer(alice,inside[0]!.instanceId,bag.instanceId);
  await inventory.ensurePermanentBackpack(alice);
  const final=await inventory.getSnapshot(alice);
  expect(final.items.find(item=>item.instanceId===inside[0]!.instanceId)?.containerInstanceId).toBe(bag.instanceId);
  expect(final.items.find(item=>item.instanceId===fallback[0]!.instanceId)?.containerInstanceId).toBe(bag.instanceId);
 });

 it("prioritizes matching accessible stacks and leaves inaccessible bag contents, quality and custom rolls intact",async()=>{
  const backpack=await pack(),bag=(await give("rag-bag"))[0]!,bandage=(await give("field-bandage",10))[0]!;
  await inventory.setContainerSlot(alice,1,bag.instanceId);await inventory.moveItemToContainer(alice,bandage.instanceId,bag.instanceId);await inventory.setContainerSlot(alice,1,null);
  const fresh=(await give("field-bandage",3)).find(item=>item.instanceId!==bandage.instanceId)!;
  expect(fresh.containerInstanceId).toBe(backpack.instanceId);expect(fresh.quantity).toBe(3);
  expect((await inventory.getSnapshot(alice)).items.find(item=>item.instanceId===bandage.instanceId)).toMatchObject({quantity:10,containerInstanceId:bag.instanceId});
  const definition=(await pool.query("SELECT item_id FROM item_instances WHERE id=$1",[fresh.instanceId])).rows[0].item_id;
  const pendingId=randomUUID();
  await pool.query("INSERT INTO item_instances(id,character_id,item_id,quantity,created_at) VALUES($1,$2,$3,2,'2000-01-01')",[pendingId,alice,definition]);
  await give("field-bandage",2);
  expect((await inventory.getSnapshot(alice)).items.find(item=>item.instanceId===fresh.instanceId)?.quantity).toBe(5);
  await pool.query("UPDATE item_instances SET quality='GOOD',upgrade_level=3,affixes='[{\"custom\":9}]' WHERE id=$1",[pendingId]);
  await inventory.ensurePermanentBackpack(alice);
  const actual=(await pool.query("SELECT quality,upgrade_level,affixes FROM item_instances WHERE id=$1",[pendingId])).rows[0];
  expect(actual).toMatchObject({quality:"GOOD",upgrade_level:3,affixes:[{custom:9}]});
 });

 it("delivers purchases to durable overflow without duplicate grants or charges on receipt replay",async()=>{
  await pack();await give("training-dagger",16);
  const merchant=new MerchantService(pool),request={npcId:"merchant-miro",itemId:"field-bandage",quantity:2,requestId:randomUUID()};
  const first=await merchant.purchase(alice,request),second=await merchant.purchase(alice,request);
  expect(first.shop.gold).toBe(90);expect(second.shop.gold).toBe(90);
  const waiting=getPendingInventoryItems(second.inventory);expect(waiting).toEqual([expect.objectContaining({itemId:"field-bandage",quantity:2})]);
  expect((await inventory.getSnapshot(alice)).items.find(item=>item.instanceId===waiting[0]!.instanceId)?.quantity).toBe(2);
 });

 it("clears sender parents on whole and split trades while retaining split source parents, rolls and overflow",async()=>{
  const sourcePack=await pack(),targetPack=await pack(bob);
  const stack=(await give("field-bandage",10))[0]!,whole=(await give("training-sword"))[0]!;
  await pool.query("UPDATE item_instances SET quality='PERFECT',upgrade_level=3,affixes='[{\"custom\":9}]' WHERE id=ANY($1::uuid[])",[[stack.instanceId,whole.instanceId]]);
  await give("training-dagger",16,bob);
  const players=new Map<string,SocialPlayer>([alice,bob].map(id=>[id,{id,nickname:id,online:true,inBattle:false}]));
  const trade=new TradeService(pool,id=>players.get(id),()=>({locationId:"forest",x:0,y:0}));
  let state=await trade.request(alice,bob);state=await trade.respond(bob,state.id,true);
  state=await trade.setOffer(alice,state.id,state.revision,[{instanceId:stack.instanceId,quantity:4},{instanceId:whole.instanceId,quantity:1}]);
  await trade.confirm(alice,state.id,state.revision);await trade.confirm(bob,state.id,state.revision);await trade.confirm(bob,state.id,state.revision);
  expect((await inventory.getSnapshot(alice)).items.find(item=>item.instanceId===stack.instanceId)).toMatchObject({quantity:6,containerInstanceId:sourcePack.instanceId});
  const received=(await inventory.getSnapshot(bob)).items,waiting=getPendingInventoryItems({items:received,containerSlots:[targetPack.instanceId,null,null,null]});
  expect(waiting).toHaveLength(2);expect(waiting.find(item=>item.instanceId===whole.instanceId)).toMatchObject({quality:"PERFECT",upgradeLevel:3});
  const split=waiting.find(item=>item.itemId==="field-bandage")!;expect(split).toMatchObject({quantity:4,quality:"PERFECT",upgradeLevel:3});expect(split.instanceId).not.toBe(stack.instanceId);
  expect((await pool.query("SELECT affixes FROM item_instances WHERE id=$1",[split.instanceId])).rows[0].affixes).toEqual([{custom:9}]);
 });

 it("reuses the cell vacated by newly equipped gear before storing the displaced weapon",async()=>{
  const backpack=await pack(),first=(await give("training-sword"))[0]!,gear=new EquipmentService(pool);
  await gear.setSlot(alice,{slot:"mainHand",itemInstanceId:first.instanceId});
  const second=(await give("training-axe"))[0]!;await give("training-dagger",15);
  const swapped=await gear.setSlot(alice,{slot:"mainHand",itemInstanceId:second.instanceId});
  expect(swapped.items.find(item=>item.instanceId===first.instanceId)?.containerInstanceId).toBe(backpack.instanceId);
  expect(swapped.items.find(item=>item.instanceId===second.instanceId)?.equippedSlot).toBe("mainHand");
  expect(getPendingInventoryItems(swapped)).toEqual([]);
  const unequipped=await gear.setSlot(alice,{slot:"mainHand",itemInstanceId:null});
  expect(getPendingInventoryItems(unequipped).map(item=>item.instanceId)).toEqual([second.instanceId]);
 });

 it("organizes old loose items on startup without flattening full bags and rejects a foreign stored-bag parent",async()=>{
  const backpack=await pack(),old=(await give("rag-bag"))[0]!,child=(await give("training-dagger"))[0]!;
  await inventory.setContainerSlot(alice,1,old.instanceId);await inventory.moveItemToContainer(alice,child.instanceId,old.instanceId);await inventory.setContainerSlot(alice,1,null);
  const loose=(await give("training-sword"))[0]!;await pool.query("UPDATE item_instances SET container_instance_id=NULL WHERE id=$1",[loose.instanceId]);
  expect((await inventory.getSnapshot(alice)).items.find(item=>item.instanceId===loose.instanceId)?.containerInstanceId).toBeUndefined();
  await seedItemMetadata(pool);
  const organized=await inventory.getSnapshot(alice);
  expect(organized.items.find(item=>item.instanceId===loose.instanceId)?.containerInstanceId).toBe(backpack.instanceId);
  expect(organized.items.find(item=>item.instanceId===old.instanceId)?.containerInstanceId).toBeUndefined();
  expect(organized.items.find(item=>item.instanceId===child.instanceId)?.containerInstanceId).toBe(old.instanceId);
  const foreign=await pack(bob),empty=(await give("rag-bag"))[1]!;
  await pool.query("UPDATE item_instances SET container_instance_id=$2 WHERE id=$1",[empty.instanceId,foreign.instanceId]);
  await expect(inventory.setContainerSlot(alice,2,empty.instanceId)).rejects.toThrow("CONTAINER_ITEM_STORED");
 });
});
