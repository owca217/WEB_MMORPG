import { randomUUID } from "node:crypto";
import { ITEM_QUALITIES, type ItemDefinition, type ItemDraftInput, type ItemQuality, type SocialPlayer } from "@web-mmorpg/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "../src/db/createPool";
import { runMigrations } from "../src/db/migrate";
import { InventoryService } from "../src/inventory/InventoryService";
import { ItemCatalogService } from "../src/items/ItemCatalogService";
import { ItemMetadataRepository } from "../src/items/ItemMetadataRepository";
import { seedItemMetadata } from "../src/items/seedItemMetadata";
import { LootService } from "../src/loot/LootService";
import { MerchantService } from "../src/merchant/MerchantService";
import { TradeService } from "../src/social/TradeService";

const databaseUrl=process.env.DATABASE_URL;
const target=databaseUrl?new URL(databaseUrl):undefined;
const describeDatabase=target&&["localhost","127.0.0.1"].includes(target.hostname)&&target.pathname==="/web_mmorpg_test"?describe:describe.skip;

function draft(item:ItemDefinition,overrides:Partial<ItemDraftInput>={}):ItemDraftInput {
  const {status:_status,activeVersionNo:_version,createdAt:_created,updatedAt:_updated,...input}=item;
  return {...input,...overrides};
}

describeDatabase("cosmetic item quality persistence",()=>{
  const pool=createPool(databaseUrl??"postgresql://unused/unused");
  const catalog=new ItemCatalogService(pool,new ItemMetadataRepository(pool));
  const inventory=new InventoryService(pool);
  let alice:string,bob:string;
  beforeAll(async()=>{
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await runMigrations(pool);
  });
  beforeEach(async()=>{
    await pool.query("TRUNCATE accounts,item_instances,items,admin_audit_log CASCADE");
    await seedItemMetadata(pool);
    const ids=[];
    for(const name of ["QualityAlice","QualityBob"]){
      const account=randomUUID(),id=randomUUID();
      await pool.query("INSERT INTO accounts(id,username,username_normalized,password_hash,recovery_code_hash) VALUES($1,$2,$2,'hash','hash')",[account,name.toLowerCase()]);
      await pool.query("INSERT INTO characters(id,account_id,nickname,nickname_normalized) VALUES($1,$2,$3,$3)",[id,account,name]);
      ids.push(id);
    }
    [alice,bob]=[ids[0]!,ids[1]!];
  });
  afterAll(async()=>{await pool.end();});

  async function publishQuality(itemId:string,quality:ItemQuality){
    const source=(await catalog.getItem(itemId)).item;
    const current=await catalog.getVersion(itemId,source.activeVersionNo!);
    const updated=await catalog.updateDraft(itemId,draft(source,{quality}),current.revision,alice);
    await catalog.publish(itemId,updated.revision,alice);
  }

  it("accepts exactly six qualities, defaults old drafts and keeps numeric material quality separate",async()=>{
    const source=(await catalog.getItem("wolf-pelt")).item;
    for(const quality of ITEM_QUALITIES){
      const created=await catalog.createDraft(draft(source,{itemId:`quality-${quality.toLowerCase()}`,quality,specialData:{...source.specialData,quality:70}}),alice);
      expect(created).toMatchObject({quality,rarity:source.rarity,specialData:{quality:70},stats:source.stats});
    }
    const legacy=draft(source,{itemId:"quality-legacy"});delete legacy.quality;
    expect(await catalog.createDraft(legacy,alice)).toMatchObject({quality:"NORMAL"});
    await expect(catalog.createDraft(draft(source,{itemId:"quality-invalid",quality:"RAINBOW" as ItemQuality}),alice)).rejects.toMatchObject({code:"ITEM_VALIDATION",fieldErrors:{quality:expect.any(String)}});
    expect((await pool.query("SELECT 1 FROM items WHERE item_id='quality-invalid'")).rowCount).toBe(0);
  });

  it("retains authored quality through draft edits, publication, duplication and version restoration",async()=>{
    const source=(await catalog.getItem("training-sword")).item;
    let version=await catalog.createDraft(draft(source,{itemId:"quality-sword",quality:"EXCELLENT"}),alice);
    version=await catalog.updateDraft(version.itemId,{...version,quality:"PERFECT"},version.revision,alice);
    const published=await catalog.publish(version.itemId,version.revision,alice);
    expect((await catalog.getItem(version.itemId)).item).toMatchObject({quality:"PERFECT",rarity:source.rarity,stats:source.stats});
    expect(await catalog.duplicate(version.itemId,"quality-copy",alice)).toMatchObject({quality:"PERFECT",rarity:source.rarity,stats:source.stats});
    await publishQuality(version.itemId,"GOOD");
    expect(await catalog.restoreVersion(version.itemId,published.versionNo,alice)).toMatchObject({quality:"PERFECT",rarity:source.rarity,stats:source.stats});
    expect((await catalog.listItems({})).items.find(item=>item.itemId===version.itemId)?.quality).toBe("PERFECT");
    const oldPayload=draft((await catalog.getItem("quality-copy")).item);delete oldPayload.quality;
    expect(await catalog.updateDraft("quality-copy",oldPayload,1,alice)).toMatchObject({quality:"PERFECT"});
    const active=(await catalog.getItem(version.itemId)).item;
    const activeVersion=await catalog.getVersion(version.itemId,active.activeVersionNo!);
    const oldActivePayload=draft(active);delete oldActivePayload.quality;
    const inherited=await catalog.updateDraft(version.itemId,oldActivePayload,activeVersion.revision,alice);
    expect(inherited).toMatchObject({quality:"PERFECT"});
    expect(await catalog.updateDraft(version.itemId,{...oldActivePayload,quality:"NORMAL"},inherited.revision,alice)).toMatchObject({quality:"NORMAL"});
  });

  it("snapshots quality at grant and merges only matching qualities for ordinary rewards and loot",async()=>{
    const normal=(await inventory.addItems(alice,[{itemId:"field-bandage",quantity:2}])).items.find(item=>item.itemId==="field-bandage")!;
    expect(normal.quality).toBe("NORMAL");
    await publishQuality("field-bandage","GOOD");
    await inventory.addItems(alice,[{itemId:"field-bandage",quantity:3}]);
    await inventory.addItems(alice,new LootService().rollEncounterLoot("wolf-pack-01",1));
    const items=(await new InventoryService(pool).getSnapshot(alice)).items.filter(item=>item.itemId==="field-bandage");
    expect(items).toHaveLength(2);
    expect(items.find(item=>item.instanceId===normal.instanceId)).toMatchObject({quality:"NORMAL",quantity:2});
    expect(items.find(item=>item.quality==="GOOD")).toMatchObject({quantity:5,consumableEffects:{healHp:30}});
  });

  it("shows merchant quality and purchases separate stacks without changing prices or replaying grants",async()=>{
    const merchant=new MerchantService(pool);
    const request=(quantity=1)=>({npcId:"merchant-miro",itemId:"field-bandage",quantity,requestId:randomUUID()});
    await merchant.purchase(alice,request());
    await publishQuality("field-bandage","MASTERWORK");
    expect((await merchant.getShop(alice)).offers.find(item=>item.itemId==="field-bandage")).toMatchObject({quality:"MASTERWORK",unitPrice:5,healHp:30});
    const original=request(2);await merchant.purchase(alice,original);
    await publishQuality("field-bandage","BASIC");
    await merchant.purchase(alice,original);
    const final=await merchant.purchase(alice,request());
    expect(final.shop.gold).toBe(80);
    expect(final.inventory.items.filter(item=>item.itemId==="field-bandage").map(item=>({quality:item.quality,quantity:item.quantity}))).toEqual(expect.arrayContaining([{quality:"NORMAL",quantity:1},{quality:"MASTERWORK",quantity:2},{quality:"BASIC",quantity:1}]));
    expect(final.inventory.items.filter(item=>item.itemId==="field-bandage")).toHaveLength(3);
    expect(final.inventory.items.find(item=>item.permanentContainer)).toMatchObject({containerCapacity:16});
  });

  it("preserves quality on whole and split trades, displays it and never merges different-quality stacks",async()=>{
    await inventory.addItems(bob,[{itemId:"field-bandage",quantity:3}]);
    await publishQuality("field-bandage","MASTERWORK");
    await publishQuality("training-sword","BASIC");
    const granted=await inventory.addItems(alice,[{itemId:"field-bandage",quantity:10},{itemId:"training-sword",quantity:1}]);
    const stack=granted.items.find(item=>item.itemId==="field-bandage")!,whole=granted.items.find(item=>item.itemId==="training-sword")!;
    const players=new Map<string,SocialPlayer>([alice,bob].map(id=>[id,{id,nickname:id,online:true,inBattle:false}]));
    const trade=new TradeService(pool,id=>players.get(id),()=>({locationId:"forest",x:0,y:0}));
    let state=await trade.request(alice,bob);state=await trade.respond(bob,state.id,true);
    state=await trade.setOffer(alice,state.id,state.revision,[{instanceId:stack.instanceId,quantity:4},{instanceId:whole.instanceId,quantity:1}]);
    expect(state.participants[0].offer).toEqual(expect.arrayContaining([expect.objectContaining({instanceId:stack.instanceId,quality:"MASTERWORK"}),expect.objectContaining({instanceId:whole.instanceId,quality:"BASIC"})]));
    await trade.confirm(alice,state.id,state.revision);await trade.confirm(bob,state.id,state.revision);
    expect((await inventory.getSnapshot(alice)).items.filter(item=>!item.permanentContainer)).toEqual([expect.objectContaining({instanceId:stack.instanceId,quality:"MASTERWORK",quantity:6,containerInstanceId:expect.any(String)})]);
    const received=(await inventory.getSnapshot(bob)).items;
    expect(received.find(item=>item.instanceId===whole.instanceId)).toMatchObject({quality:"BASIC"});
    expect(received.filter(item=>item.itemId==="field-bandage")).toEqual(expect.arrayContaining([expect.objectContaining({quality:"NORMAL",quantity:3}),expect.objectContaining({quality:"MASTERWORK",quantity:4})]));
    await trade.confirm(bob,state.id,state.revision);
    expect((await inventory.getSnapshot(bob)).items).toEqual(received);
  });

  it("upgrades existing definitions and instances to normal quality and enforces durable enum constraints",async()=>{
    const instance=(await inventory.addItems(alice,[{itemId:"field-bandage",quantity:2}])).items.find(item=>item.itemId==="field-bandage")!;
    await pool.query("ALTER TABLE item_instances DROP COLUMN IF EXISTS quality; ALTER TABLE item_versions DROP COLUMN IF EXISTS quality; DROP TYPE IF EXISTS item_quality; DELETE FROM schema_migrations WHERE migration_name='012_item_quality'");
    await runMigrations(pool);await runMigrations(pool);
    expect((await catalog.getItem("field-bandage")).item.quality).toBe("NORMAL");
    expect((await inventory.getSnapshot(alice)).items.find(item=>item.instanceId===instance.instanceId)).toMatchObject({instanceId:instance.instanceId,quality:"NORMAL",quantity:2});
    await expect(pool.query("UPDATE item_instances SET quality='INVALID' WHERE id=$1",[instance.instanceId])).rejects.toMatchObject({code:"22P02"});
    await expect(pool.query("UPDATE item_versions SET quality=NULL")).rejects.toMatchObject({code:"23502"});
  });
});
