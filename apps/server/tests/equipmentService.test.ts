import { randomUUID } from "node:crypto";
import type { EquipmentUpdateRequest, InventoryItem, SocialPlayer } from "@web-mmorpg/shared";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { EquipmentService } from "../src/equipment/EquipmentService";
import { InventoryService } from "../src/inventory/InventoryService";
import { BASIC_EQUIPMENT_ITEMS } from "../src/items/basicEquipment";
import { ItemMetadataRepository } from "../src/items/ItemMetadataRepository";
import { validateItemDraft } from "../src/items/itemValidation";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { MerchantService } from "../src/merchant/MerchantService";
import { TradeService } from "../src/social/TradeService";

const url=process.env.DATABASE_URL;
const target=url ? new URL(url) : null;
const local=target && ["localhost","127.0.0.1"].includes(target.hostname) && target.pathname==="/web_mmorpg_test";
const describeDb=local ? describe : describe.skip;

describeDb("persistent real equipment",()=>{
  const pool=createPool(url??"postgresql://unused/unused");
  const inventory=new InventoryService(pool),equipment=new EquipmentService(pool,inventory);
  let alice:string,bob:string;
  async function character(name:string){const id=randomUUID(),account=randomUUID();await pool.query("INSERT INTO accounts(id,username,username_normalized,password_hash,recovery_code_hash) VALUES($1,$2,$2,'hash','hash')",[account,name]);await pool.query("INSERT INTO characters(id,account_id,nickname,nickname_normalized) VALUES($1,$2,$3,$3)",[id,account,name]);return id;}
  async function grant(itemId:string,owner=alice):Promise<InventoryItem>{return(await inventory.addItems(owner,[{itemId,quantity:1}])).items.find(item=>item.itemId===itemId)!;}
  const set=(slot:"mainHand"|"offHand"|"helmet"|"chest",itemInstanceId:string|null,assertCurrent=()=>undefined)=>equipment.setSlot(alice,{slot,itemInstanceId},assertCurrent);
  beforeEach(async()=>{await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");await runMigrations(pool);await seedItemMetadata(pool);alice=await character("EquipmentAlice");bob=await character("EquipmentBob");});
  afterEach(()=>vi.restoreAllMocks());afterAll(async()=>pool.end());

  it("projects published item metadata, persists slots and atomically swaps shield out for a two-handed bow",async()=>{
    const sword=await grant("training-sword"),shield=await grant("training-shield"),bow=await grant("training-bow");
    expect(sword.equipment).toMatchObject({slot:"mainHand",weaponFamily:"sword",twoHanded:false,minimumLevel:1,modifiers:[{statCode:"PHYSICAL_DAMAGE",modifierType:"flat",value:12}]});
    await set("mainHand",sword.instanceId);await set("offHand",shield.instanceId);
    const swapped=await set("mainHand",bow.instanceId);
    expect(swapped.equipmentSlots).toMatchObject({mainHand:bow.instanceId,offHand:null});
    expect(swapped.items.find(item=>item.instanceId===sword.instanceId)?.equippedSlot).toBeUndefined();
    expect(swapped.items.find(item=>item.instanceId===shield.instanceId)?.equippedSlot).toBeUndefined();
    await expect(set("offHand",shield.instanceId)).rejects.toThrow("EQUIPMENT_TWO_HANDED");
    expect((await new InventoryService(pool).getSnapshot(alice)).equipmentSlots?.mainHand).toBe(bow.instanceId);
    expect(swapped.items).toHaveLength(4);
    const backpack=swapped.items.find(item=>item.permanentContainer)!;
    for(const id of [sword.instanceId,shield.instanceId])expect(swapped.items.find(item=>item.instanceId===id)?.containerInstanceId).toBe(backpack.instanceId);
  });

  it("equips from a bag, prohibits storing equipped items, and automatically stores unequipped gear",async()=>{
    const bag=await grant("rag-bag"),sword=await grant("training-sword");
    await inventory.setContainerSlot(alice,1,bag.instanceId);
    await inventory.moveItemToContainer(alice,sword.instanceId,bag.instanceId);
    const equipped=await set("mainHand",sword.instanceId);
    expect(equipped.items.find(item=>item.instanceId===sword.instanceId)).toMatchObject({equippedSlot:"mainHand"});
    expect(equipped.items.find(item=>item.instanceId===sword.instanceId)?.containerInstanceId).toBeUndefined();
    await expect(inventory.moveItemToContainer(alice,sword.instanceId,bag.instanceId)).rejects.toThrow("EQUIPMENT_ITEM_EQUIPPED");
    const removed=await set("mainHand",null);
    expect(removed.items.find(item=>item.instanceId===sword.instanceId)?.equippedSlot).toBeUndefined();
    expect(removed.items.find(item=>item.instanceId===sword.instanceId)?.containerInstanceId).toBe(removed.items.find(item=>item.permanentContainer)!.instanceId);
  });

  it("rejects other owners, wrong slots, level requirements, broken gear and unsupported requirements",async()=>{
    const sword=await grant("training-sword"),helmet=await grant("cloth-helmet"),foreign=await grant("training-axe",bob);
    await expect(set("mainHand",foreign.instanceId)).rejects.toThrow("EQUIPMENT_ITEM_NOT_OWNED");
    await expect(set("mainHand",helmet.instanceId)).rejects.toThrow("EQUIPMENT_SLOT_MISMATCH");
    await pool.query("UPDATE item_versions SET minimum_level=5 WHERE item_id=$1",[sword.itemDefinitionId]);
    await expect(set("mainHand",sword.instanceId)).rejects.toThrow("EQUIPMENT_LEVEL_REQUIRED");
    await pool.query("UPDATE item_versions SET minimum_level=1 WHERE item_id=$1",[sword.itemDefinitionId]);
    await pool.query("UPDATE item_instances SET durability=0,max_durability=20 WHERE id=$1",[sword.instanceId]);
    await expect(set("mainHand",sword.instanceId)).rejects.toThrow("EQUIPMENT_ITEM_BROKEN");
    await pool.query("UPDATE item_instances SET durability=20 WHERE id=$1",[sword.instanceId]);
    await pool.query("INSERT INTO item_requirements(id,version_id,requirement_type,code,value_json) SELECT $1,id,'STAT','STRENGTH','11'::jsonb FROM item_versions WHERE item_id=$2",[randomUUID(),sword.itemDefinitionId]);
    await expect(set("mainHand",sword.instanceId)).rejects.toThrow("EQUIPMENT_REQUIREMENTS_NOT_MET");
    await pool.query("UPDATE item_requirements SET value_json='10'::jsonb WHERE version_id IN(SELECT id FROM item_versions WHERE item_id=$1)",[sword.itemDefinitionId]);
    await set("mainHand",sword.instanceId);await set("mainHand",null);
    await pool.query("UPDATE item_requirements SET requirement_type='QUEST',code='unknown-quest' WHERE version_id IN(SELECT id FROM item_versions WHERE item_id=$1)",[sword.itemDefinitionId]);
    await expect(set("mainHand",sword.instanceId)).rejects.toThrow("EQUIPMENT_REQUIREMENTS_NOT_MET");
  });

  it("binds ON_EQUIP and rolls back every slot change when the session is replaced",async()=>{
    const sword=await grant("training-sword"),axe=await grant("training-axe");
    await pool.query("UPDATE item_versions SET soulbound='ON_EQUIP' WHERE item_id=$1",[sword.itemDefinitionId]);
    expect((await set("mainHand",sword.instanceId)).items.find(item=>item.instanceId===sword.instanceId)?.boundToPlayerId).toBe(alice);
    await expect(set("mainHand",axe.instanceId,()=>{throw new Error("SESSION_REPLACED");})).rejects.toThrow("SESSION_REPLACED");
    expect((await inventory.getSnapshot(alice)).equipmentSlots?.mainHand).toBe(sword.instanceId);
    const results=await Promise.all([set("mainHand",sword.instanceId),set("mainHand",axe.instanceId)]);
    expect(results).toHaveLength(2);
    expect((await inventory.getSnapshot(alice)).items.filter(item=>item.equippedSlot==="mainHand")).toHaveLength(1);
  });

  it("keeps the validated slot when caller input changes during an open transaction",async()=>{
    const sword=await grant("training-sword"),client=await pool.connect();
    const originalQuery=client.query.bind(client);
    let entered!:()=>void,resume!:()=>void;
    const began=new Promise<void>(resolve=>{entered=resolve;});
    const continueTransaction=new Promise<void>(resolve=>{resume=resolve;});
    vi.spyOn(client,"query").mockImplementation((async (...args:unknown[])=>{
      const result=await (originalQuery as (...args:unknown[])=>Promise<unknown>)(...args);
      if(args[0]==="BEGIN"){entered();await continueTransaction;}
      return result;
    }) as typeof client.query);
    vi.spyOn(pool,"connect").mockImplementationOnce((async()=>client) as typeof pool.connect);
    const request:EquipmentUpdateRequest={slot:"mainHand",itemInstanceId:sword.instanceId};
    const pending=equipment.setSlot(alice,request);
    await began;request.slot="chest";request.itemInstanceId=null;resume();
    expect((await pending).equipmentSlots?.mainHand).toBe(sword.instanceId);
  });

  it("rejects equipped trade offers and revalidates equipment at final barter commit",async()=>{
    const sword=await grant("training-sword");
    const players=new Map<string,SocialPlayer>([alice,bob].map(id=>[id,{id,nickname:id,online:true,inBattle:false,level:1}]));
    const trade=new TradeService(pool,id=>players.get(id),()=>({locationId:"forest-settlement-01",x:450,y:420}));
    const request=await trade.request(alice,bob);await trade.respond(bob,request.id,true);
    await set("mainHand",sword.instanceId);
    await expect(trade.setOffer(alice,request.id,0,[{instanceId:sword.instanceId,quantity:1}])).rejects.toThrow("TRADE_ITEM_EQUIPPED");
    await set("mainHand",null);
    const offered=await trade.setOffer(alice,request.id,0,[{instanceId:sword.instanceId,quantity:1}]);
    await set("mainHand",sword.instanceId);await trade.confirm(alice,request.id,offered.revision);
    await expect(trade.confirm(bob,request.id,offered.revision)).rejects.toThrow("TRADE_ITEM_EQUIPPED");
    expect((await inventory.getSnapshot(alice)).equipmentSlots?.mainHand).toBe(sword.instanceId);
    expect((await inventory.getSnapshot(bob)).items).toHaveLength(0);
  });

  it("offers all basic gear without overwriting authored published versions when reseeded",async()=>{
    const merchant=new MerchantService(pool),shop=await merchant.getShop(alice);
    const gear=shop.offers.filter(offer=>offer.categoryId==="weapon"||offer.categoryId==="armor");
    expect(gear).toHaveLength(15);expect(gear.every(offer=>offer.maxQuantity===1)).toBe(true);
    const bought=await merchant.purchase(alice,{npcId:"merchant-miro",itemId:"training-sword",quantity:1,requestId:randomUUID()});
    expect(bought.inventory.items.find(item=>item.itemId==="training-sword")?.equipment?.weaponFamily).toBe("sword");
    await pool.query("UPDATE item_versions SET name='Autorski miecz',revision=2 WHERE item_id IN(SELECT id FROM items WHERE item_id='training-sword')");
    await seedItemMetadata(pool);
    expect((await merchant.getShop(alice)).offers.find(offer=>offer.itemId==="training-sword")?.name).toBe("Autorski miecz");
  });

  it("allows every basic equipment definition to be edited through the item creator",async()=>{
    const metadata=await new ItemMetadataRepository(pool).listMetadata();
    for(const item of BASIC_EQUIPMENT_ITEMS){
      expect(validateItemDraft({
        itemId:item.itemId,name:item.name,categoryId:item.categoryId,subcategoryId:item.subcategoryId,
        description:"Podstawowe uzbrojenie dla początkującej postaci.",rarity:"COMMON",itemLevel:1,minimumLevel:1,
        sellValue:0,sellable:true,tradable:true,droppable:true,stackable:false,maxStack:1,weight:1,soulbound:"NONE",unique:false,
        tags:[],stats:item.stats,requirements:[],effects:[],specialData:item.weaponFamily?{weaponFamily:item.weaponFamily}:{armorSlot:item.subcategoryId}
      },metadata),item.itemId).toEqual({ok:true});
    }
  });

  it("upgrades untouched staff mappings on existing databases and preserves authored restrictions",async()=>{
    const downgrade=async()=>{
      await pool.query("ALTER TABLE item_instances DROP COLUMN equipment_slot CASCADE");
      await pool.query("DELETE FROM schema_migrations WHERE migration_name='011_equipment_slots'");
      await pool.query("DELETE FROM category_allowed_stats WHERE category_id='weapon' AND subcategory_id='staff' AND stat_code='PHYSICAL_DAMAGE'");
    };
    const sword=await grant("training-sword");
    await downgrade();await runMigrations(pool);
    const metadata=await new ItemMetadataRepository(pool).listMetadata();
    expect(metadata.subcategories.find(item=>item.id==="staff")?.allowedStatCodes).toContain("PHYSICAL_DAMAGE");
    expect((await inventory.getSnapshot(alice)).items.find(item=>item.instanceId===sword.instanceId)?.quantity).toBe(1);
    await downgrade();
    await pool.query("DELETE FROM category_allowed_stats WHERE category_id='weapon' AND subcategory_id='staff' AND stat_code='CRIT_CHANCE'");
    await runMigrations(pool);
    const authored=await new ItemMetadataRepository(pool).listMetadata();
    expect(authored.subcategories.find(item=>item.id==="staff")?.allowedStatCodes).not.toContain("PHYSICAL_DAMAGE");
  });
});
