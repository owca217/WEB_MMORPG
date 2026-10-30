import {describe,expect,it} from "vitest";
import {getPendingInventoryItems,type InventoryItem,type InventorySnapshot} from "../src/index";

const item=(instanceId:string,overrides:Partial<InventoryItem>={}):InventoryItem=>({instanceId,itemId:instanceId,itemDefinitionId:instanceId,name:instanceId,quantity:1,category:"material",description:"",rarity:"COMMON",quality:"NORMAL",upgradeLevel:0,...overrides});

describe("pending inventory projection",()=>{
  it("exposes owned overflow without listing worn gear, assigned bags, permanent storage or stored contents",()=>{
    const snapshot:InventorySnapshot={items:[item("pack",{permanentContainer:true}),item("bag",{category:"container"}),item("gear",{equippedSlot:"mainHand"}),item("stored",{containerInstanceId:"pack"}),item("loose"),item("old-full-bag",{category:"container"}),item("old-child",{containerInstanceId:"old-full-bag"})],containerSlots:["pack","bag",null,null]};
    const before=structuredClone(snapshot);
    expect(getPendingInventoryItems(snapshot).map(entry=>entry.instanceId)).toEqual(["loose","old-full-bag"]);
    expect(snapshot).toEqual(before);
  });
  it("keeps legacy loose items accessible when a snapshot has no slot metadata",()=>{
    const entries=[item("pelt"),item("sword",{category:"weapon"})];
    expect(getPendingInventoryItems({items:entries})).toEqual(entries);
    expect(getPendingInventoryItems({items:[]})).toEqual([]);
  });
});
