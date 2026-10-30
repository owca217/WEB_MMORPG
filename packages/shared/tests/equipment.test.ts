import {describe,expect,it} from "vitest";
import {emptyEquipmentSlots,getCharacterEquipment,getEquipmentItemProperties,type InventoryItem} from "../src/index";

function sword(overrides:Partial<InventoryItem>={}):InventoryItem {
  return {instanceId:"sword-1",itemId:"training-sword",itemDefinitionId:"definition",name:"Miecz",quantity:1,category:"weapon",description:"",rarity:"COMMON",upgradeLevel:0,equippedSlot:"mainHand",equipment:{slot:"mainHand",weaponFamily:"sword",twoHanded:false,minimumLevel:1,modifiers:[{statCode:"PHYSICAL_DAMAGE",modifierType:"flat",value:12}]},...overrides};
}
describe("equipment metadata and projection",()=>{
  it("resolves real weapon and armor slots while rejecting unsupported categories and families",()=>{
    expect(getEquipmentItemProperties({category:"weapon",subcategory:"bow",minimumLevel:1,stats:[]})).toMatchObject({slot:"mainHand",weaponFamily:"bow",twoHanded:true});
    expect(getEquipmentItemProperties({category:"weapon",subcategory:"two-handed",specialData:{weaponFamily:"axe"},minimumLevel:1,stats:[]})).toMatchObject({slot:"mainHand",weaponFamily:"axe",twoHanded:true});
    expect(getEquipmentItemProperties({category:"armor",subcategory:"shield",minimumLevel:1,stats:[]})).toMatchObject({slot:"offHand",weaponFamily:"shield"});
    expect(getEquipmentItemProperties({category:"armor",subcategory:"boots",minimumLevel:1,stats:[]})).toMatchObject({slot:"boots"});
    expect(getEquipmentItemProperties({category:"weapon",subcategory:"wand",minimumLevel:1,stats:[]})).toBeUndefined();
    expect(getEquipmentItemProperties({category:"consumable",minimumLevel:1,stats:[]})).toBeUndefined();
  });
  it("projects only usable actually equipped single items",()=>{
    const unequipped=sword();delete unequipped.equippedSlot;
    for(const item of [unequipped,sword({quantity:2}),sword({durability:0}),sword({equippedSlot:"boots"}),sword({equipment:{...sword().equipment!,minimumLevel:20}})]){
      expect(getCharacterEquipment({items:[item]},1).mainHand).toBeNull();
    }
    expect(getCharacterEquipment({items:[sword()]},1).mainHand?.instanceId).toBe("sword-1");
  });
  it("ignores an incompatible shield and never mutates the inventory snapshot",()=>{
    const staff=sword({equipment:{...sword().equipment!,weaponFamily:"staff",twoHanded:true}});
    const shield=sword({instanceId:"shield-1",category:"armor",equippedSlot:"offHand",equipment:{slot:"offHand",weaponFamily:"shield",twoHanded:false,minimumLevel:1,modifiers:[]}});
    const inventory={items:[staff,shield]};const before=structuredClone(inventory);
    const projected=getCharacterEquipment(inventory,1);
    expect(projected.mainHand?.instanceId).toBe("sword-1");expect(projected.offHand).toBeNull();
    projected.mainHand!.equipment!.modifiers[0]!.value=999;
    expect(inventory).toEqual(before);
  });
  it("creates independent empty slot maps",()=>{
    const first=emptyEquipmentSlots(),second=emptyEquipmentSlots();first.mainHand="item";
    expect(second.mainHand).toBeNull();expect(Object.values(second)).toHaveLength(8);
  });
});
