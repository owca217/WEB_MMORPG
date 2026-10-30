import { getCharacterEquipment, type CharacterSnapshot, type InventoryItem, type InventorySnapshot } from "@web-mmorpg/shared";

const STAT_LABELS:Record<string,string>={STRENGTH:"Siła",DEXTERITY:"Zręczność",VITALITY:"Żywotność",MAX_HP:"Maksymalne HP",MIN_DAMAGE:"Obrażenia minimalne",MAX_DAMAGE:"Obrażenia maksymalne",PHYSICAL_DAMAGE:"Obrażenia",ARMOR:"Pancerz",BLOCK_POWER:"Siła tarczy",BLOCK_CHANCE:"Blok",SPELL_POWER:"Moc leczenia",HEAL_POWER:"Moc leczenia",HEALING_POWER:"Moc leczenia",ACCURACY:"Celność",ATTACK_RANGE:"Zasięg"};
export function equipmentIcon(item?:InventoryItem):HTMLSpanElement {
 const root=document.createElement("span");root.className="equipment-icon";root.setAttribute("aria-hidden","true");
 const fallback=()=>{root.replaceChildren();root.textContent=item?.equipment?.slot==="mainHand"?"⚔":item?.equipment?.slot==="offHand"?"◈":"▣";};fallback();
 if(item?.iconUrl){const image=document.createElement("img");image.src=item.iconUrl;image.alt="";image.addEventListener("error",fallback,{once:true});root.replaceChildren(image);}
 return root;
}
export function equipmentItemSummary(item:InventoryItem):string {
 const properties=item.equipment;if(!properties)return"";
 const modifiers=properties.modifiers.flatMap(stat=>STAT_LABELS[stat.statCode]?[`${STAT_LABELS[stat.statCode]} ${stat.value>0?"+":""}${stat.value}${stat.modifierType==="percent"?"%":stat.modifierType==="multiplier"?"×":""}`]:[]);
 return [`Poziom ${properties.minimumLevel}`,properties.twoHanded?"Broń dwuręczna":"",...modifiers].filter(Boolean).join(" · ");
}
export function equipmentDisabledReason(item:InventoryItem,character?:CharacterSnapshot,inventory?:InventorySnapshot):string|undefined {
 if(!item.equipment)return"Tego przedmiotu nie można założyć.";
 if(item.quantity!==1)return"Przedmiot do założenia musi mieć ilość 1.";
 if(item.durability!==undefined&&item.durability<=0)return"Przedmiot jest zniszczony.";
 if(character&&character.level<item.equipment.minimumLevel)return`Wymagany poziom: ${item.equipment.minimumLevel}.`;
 const equipment=character?.equipment??(inventory?getCharacterEquipment(inventory,character?.level):undefined);
 if(item.equipment.slot==="offHand"&&equipment?.mainHand?.equipment?.twoHanded)return"Najpierw zdejmij broń dwuręczną, aby założyć tarczę.";
 return undefined;
}
