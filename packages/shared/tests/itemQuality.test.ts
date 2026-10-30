import {describe,expect,it} from "vitest";
import {DEFAULT_ITEM_QUALITY,ITEM_QUALITIES,ITEM_QUALITY_DEFINITIONS,emptyCharacterEquipment,getCharacterStatistics,getEquipmentCombatStatistics,getItemQualityDefinition,isItemQuality,normalizeItemQuality} from "../src/index";

describe("cosmetic item quality",()=>{
  it("defines the six requested qualities in ascending order with their colors",()=>{
    expect(ITEM_QUALITIES).toEqual(["BASIC","NORMAL","GOOD","EXCELLENT","PERFECT","MASTERWORK"]);
    expect(ITEM_QUALITY_DEFINITIONS.map(({label,color})=>[label,color])).toEqual([
      ["Zwykła","#8b8b8b"],["Normalna","#ffffff"],["Dobra","#2ecc71"],
      ["Znakomita","#3498db"],["Doskonała","#ffd700"],["Arcydzieło","#e74c3c"]
    ]);
    for(const quality of ITEM_QUALITIES){expect(isItemQuality(quality)).toBe(true);expect(getItemQualityDefinition(quality).id).toBe(quality);}
  });
  it("defaults older payloads safely without interpreting rarity or material quality as item quality",()=>{
    expect(DEFAULT_ITEM_QUALITY).toBe("NORMAL");
    for(const value of [undefined,null,"",42,"LEGENDARY","<script>",{}]){
      expect(isItemQuality(value)).toBe(false);expect(normalizeItemQuality(value)).toBe("NORMAL");
      expect(getItemQualityDefinition(value)).toMatchObject({id:"NORMAL",label:"Normalna",color:"#ffffff"});
    }
  });
  it("keeps combat statistics identical for all six cosmetic qualities",()=>{
    const equipment=emptyCharacterEquipment();
    equipment.mainHand={instanceId:"weapon",itemId:"sword",itemDefinitionId:"sword",name:"Miecz",quantity:1,category:"weapon",description:"",rarity:"RARE",upgradeLevel:0,equipment:{slot:"mainHand",weaponFamily:"sword",twoHanded:false,minimumLevel:1,modifiers:[{statCode:"PHYSICAL_DAMAGE",modifierType:"flat",value:12}]}};
    const expected=getEquipmentCombatStatistics(getCharacterStatistics(6),undefined,equipment);
    for(const quality of ITEM_QUALITIES){
      equipment.mainHand.quality=quality;
      expect(getEquipmentCombatStatistics(getCharacterStatistics(6),undefined,equipment)).toEqual(expected);
      expect(equipment.mainHand.rarity).toBe("RARE");
    }
  });
});
