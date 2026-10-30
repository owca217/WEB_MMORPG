import {
 getCharacterStatistics,getWeaponProficiency,normalizeWeaponTraining,WEAPON_FAMILIES,MAX_CHARACTER_LEVEL,
 EQUIPMENT_SLOTS,EQUIPMENT_SLOT_LABELS,getCharacterEquipment,
 type CharacterSnapshot,type EquipmentSlot,type EquipmentUpdateRequest,type EquipmentUpdateResult,type InventoryItem,type InventorySnapshot,type InjuryKind
} from "@web-mmorpg/shared";
import { experienceProgressMarkup } from "./ExperienceProgress";
import {equipmentDisabledReason,equipmentIcon,equipmentItemSummary} from "./EquipmentIcon";
const INJURY_LABELS:Record<InjuryKind,string>={brokenArm:"Złamana ręka",legTrauma:"Uraz nogi",bleeding:"Krwawienie",concussion:"Wstrząśnienie",chestWound:"Rana klatki piersiowej",burn:"Oparzenie",poison:"Zatrucie"};
type CharacterTab="statistics"|"proficiency"|"equipment";
interface CharacterPanelHandlers {
 onSetEquipmentSlot:(request:EquipmentUpdateRequest)=>Promise<EquipmentUpdateResult>;
 onChanged?:(result:Extract<EquipmentUpdateResult,{ok:true}>)=>void;
 onTypingChange?:()=>void;
}
export class CharacterPanel {
 private readonly root:HTMLDivElement;
 private readonly content:HTMLDivElement;
 private character:CharacterSnapshot|undefined;
 private inventory:InventorySnapshot={items:[]};
 private activeTab:CharacterTab="statistics";
 private saving=false;
 private requestVersion=0;
 private dataVersion=0;
 private destroyed=false;
 private status="";
 constructor(private readonly handlers?:CharacterPanelHandlers){
  this.root=document.createElement("div");this.root.className="game-panel game-panel--character is-hidden";this.root.dataset.characterSheet="";
  this.root.setAttribute("role","dialog");this.root.setAttribute("aria-label","Postać");
  this.root.innerHTML=`<div class="game-panel__header"><h2>Postać</h2><button type="button" data-close aria-label="Zamknij">×</button></div>
   <nav class="character-tabs" role="tablist" aria-label="Postać">
    <button type="button" role="tab" id="character-tab-statistics" data-character-tab="statistics" aria-controls="character-panel-statistics">Statystyki</button>
    <button type="button" role="tab" id="character-tab-proficiency" data-character-tab="proficiency" aria-controls="character-panel-proficiency">Władanie</button>
    <button type="button" role="tab" id="character-tab-equipment" data-character-tab="equipment" aria-controls="character-panel-equipment">Uzbrojenie</button>
   </nav><div class="character-sheet" data-content></div>`;
  document.body.append(this.root);this.content=this.require<HTMLDivElement>("[data-content]");
  for(const type of["pointerdown","pointerup","mousedown","mouseup","touchstart","touchend"])this.root.addEventListener(type,event=>event.stopPropagation());
  this.require<HTMLButtonElement>("[data-close]").addEventListener("click",()=>this.hide());
  for(const button of this.root.querySelectorAll<HTMLButtonElement>("[data-character-tab]")){
   button.addEventListener("click",()=>this.selectTab(button.dataset.characterTab as CharacterTab));
   button.addEventListener("keydown",event=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();const tabs=[...this.root.querySelectorAll<HTMLButtonElement>("[data-character-tab]")];const index=tabs.indexOf(button);const next=event.key==="Home"?0:event.key==="End"?2:(index+(event.key==="ArrowRight"?1:2))%3;this.selectTab(tabs[next]!.dataset.characterTab as CharacterTab);tabs[next]!.focus();});
  }
  this.root.addEventListener("keydown",event=>{if(event.key==="Escape"){event.stopPropagation();this.hide();}});
  this.root.addEventListener("focusin",()=>this.handlers?.onTypingChange?.());this.root.addEventListener("focusout",()=>queueMicrotask(()=>this.handlers?.onTypingChange?.()));this.syncTabs();
 }
 update(character:CharacterSnapshot,inventory?:InventorySnapshot):void {
  if(this.destroyed)return;
  if(this.character?.playerId!==character.playerId){this.requestVersion++;this.saving=false;this.status="";this.activeTab="statistics";this.inventory={items:[]};}
  this.character=structuredClone(character);if(inventory)this.inventory=structuredClone(inventory);this.dataVersion++;this.render();
 }
 private selectTab(tab:CharacterTab):void{this.activeTab=tab;this.syncTabs();this.handlers?.onTypingChange?.();}
 private syncTabs():void {
  for(const button of this.root.querySelectorAll<HTMLButtonElement>("[data-character-tab]")){const selected=button.dataset.characterTab===this.activeTab;button.setAttribute("aria-selected",String(selected));button.tabIndex=selected?0:-1;}
  for(const panel of this.root.querySelectorAll<HTMLElement>("[data-character-panel]"))panel.hidden=panel.dataset.characterPanel!==this.activeTab;
 }
 private render():void {
  const character=this.character;if(!character)return;
  const focusKey=document.activeElement instanceof HTMLElement&&this.root.contains(document.activeElement)?document.activeElement.dataset.equipmentAction:undefined;
  const training=normalizeWeaponTraining(character.weaponTraining),statistics=character.statistics??getCharacterStatistics(character.level),currentBase=getCharacterStatistics(character.level),next=getCharacterStatistics(character.level+1);
  const growth=character.level>=MAX_CHARACTER_LEVEL?"Osiągnięto maksymalny poziom.":`Poziom ${character.level+1}: +${next.strength-currentBase.strength} STR, +${next.dexterity-currentBase.dexterity} DEX, +${next.vitality-currentBase.vitality} VIT, +${next.maxHp-currentBase.maxHp} HP, +${next.meleeDamage-currentBase.meleeDamage} obrażeń wręcz, +${next.rangedDamage-currentBase.rangedDamage} obrażeń dystansowych, +${next.armor-currentBase.armor} pancerza${next.maxAp>currentBase.maxAp?`, +${next.maxAp-currentBase.maxAp} AP`:""}${next.initiative>currentBase.initiative?`, +${next.initiative-currentBase.initiative} inicjatywy`:""}.`;
  this.content.innerHTML=`<section role="tabpanel" id="character-panel-statistics" aria-labelledby="character-tab-statistics" data-character-panel="statistics">
   <dl class="character-sheet__stats"><div><dt>Imię</dt><dd data-name></dd></div><div><dt>Poziom</dt><dd>${character.level}</dd></div><div><dt>HP</dt><dd data-stat="hp">${character.hp}/${character.maxHp}</dd></div><div><dt>AP na turę</dt><dd data-stat="maxAp">${character.maxAp}</dd></div><div><dt>Inicjatywa</dt><dd data-stat="initiative">${character.initiative}</dd></div><div><dt>Stan</dt><dd>${character.severelyInjured?"Ciężko ranny":"Stabilny"}</dd></div></dl>
   ${experienceProgressMarkup(character)}<section class="character-sheet__section"><h3>Atrybuty i walka</h3><dl class="character-sheet__stats">
   ${([['strength','Siła (STR)'],['dexterity','Zręczność (DEX)'],['vitality','Żywotność (VIT)'],['meleeDamage','Obrażenia wręcz'],['rangedDamage','Obrażenia dystansowe'],['armor','Pancerz']] as const).map(([stat,label])=>`<div><dt>${label}</dt><dd data-stat="${stat}">${statistics[stat]}</dd></div>`).join("")}
   ${statistics.healingPower?`<div><dt>Moc leczenia</dt><dd data-stat="healingPower">${statistics.healingPower} HP</dd></div>`:""}${statistics.blockPercent?`<div><dt>Redukcja tarczy</dt><dd data-stat="blockPercent">${new Intl.NumberFormat("pl-PL",{maximumFractionDigits:2}).format(statistics.blockPercent)}%</dd></div>`:""}</dl><p>STR zwiększa obrażenia wręcz, DEX obrażenia dystansowe, a VIT maksymalne HP. Pancerz zmniejsza otrzymywane obrażenia.</p><p>Obrażenia podano przed pancerzem celu i wpływem urazów.</p></section>
   <section class="character-sheet__section"><h3>Automatyczny rozwój</h3><p>Statystyki rosną automatycznie przy awansie. Inicjatywa rośnie co 2 poziomy, a AP co 10 poziomów, do 8 AP.</p><p data-next-growth>${growth}</p></section><section class="character-sheet__section"><h3>Urazy</h3><p data-injuries></p></section></section>
   <section role="tabpanel" id="character-panel-proficiency" aria-labelledby="character-tab-proficiency" data-character-panel="proficiency"><h3>Władanie bronią</h3><p>Używanie założonej broni podczas walki rozwija jej władanie. Po walce otrzymujesz na trening połowę zdobytego XP, dzieloną między używane rodzaje broni i tarczę. Leczenie poza walką nie daje XP. Trening działa także w Auto; biegłości mają poziomy 0–100.</p><div class="weapon-proficiencies">
   ${WEAPON_FAMILIES.map(family=>{const skill=getWeaponProficiency(training.experience[family.id]);const format=(value:number)=>new Intl.NumberFormat("pl-PL",{maximumFractionDigits:2}).format(value);const bonus=family.mode==="defense"?`+${format(skill.level*0.15)}% redukcji`:`+${format(skill.damageBonusPercent)}% ${family.mode==="support"?"leczenia":"obrażeń"}`;return`<div class="weapon-proficiency" data-weapon-family="${family.id}"><div class="weapon-proficiency__summary"><strong>${family.label}</strong><span data-weapon-level>${skill.level}/100</span><span data-weapon-bonus>${bonus}</span></div><div class="weapon-proficiency__bar" role="progressbar" aria-label="Biegłość: ${family.label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${skill.percentage}"><span style="width:${skill.percentage}%"></span></div><small>${skill.level===100?"Maksymalna biegłość":`${skill.current} / ${skill.required} punktów do kolejnego poziomu`}</small></div>`;}).join("")}</div></section>
   <section role="tabpanel" id="character-panel-equipment" aria-labelledby="character-tab-equipment" data-character-panel="equipment"><p>Załóż przedmioty, aby korzystać z ich obrażeń i ochrony. Broń dwuręczna zajmuje obie ręce i zdejmuje tarczę. Uzbrojenie zmienisz poza walką.</p><div class="equipment-slots" data-equipment-slots></div><h3>Przedmioty do założenia</h3><div class="equipment-candidates" data-equipment-candidates></div><p role="status" aria-live="polite" data-equipment-status></p></section>`;
  this.require("[data-name]").textContent=character.nickname;this.require("[data-injuries]").textContent=character.injuries.length?character.injuries.map(injury=>INJURY_LABELS[injury]).join(", "):"Brak";
  const equipment=character.equipment??getCharacterEquipment(this.inventory,character.level),slots=this.require("[data-equipment-slots]");
  for(const slot of EQUIPMENT_SLOTS){const row=document.createElement("article");row.className="equipment-slot";row.dataset.equipmentSlot=slot;const label=document.createElement("strong");label.textContent=EQUIPMENT_SLOT_LABELS[slot];row.append(label);const item=equipment[slot];if(item){row.append(this.itemIdentity(item));const remove=document.createElement("button");remove.type="button";remove.textContent="Zdejmij";remove.dataset.equipmentUnequip=slot;remove.dataset.equipmentAction=`unequip:${slot}`;remove.setAttribute("aria-label",`Zdejmij ${item.name}`);remove.disabled=this.saving||!this.handlers;remove.addEventListener("click",()=>{void this.changeEquipment({slot,itemInstanceId:null});});row.append(remove);}else{const empty=document.createElement("span");empty.className="equipment-slot__empty";empty.textContent=slot==="offHand"&&equipment.mainHand?.equipment?.twoHanded?"Zajęte przez broń dwuręczną":"Puste miejsce";row.append(empty);}slots.append(row);}
  const list=this.require("[data-equipment-candidates]"),candidates=this.inventory.items.filter(item=>item.equipment&&!item.equippedSlot);
  if(!candidates.length){const empty=document.createElement("p");empty.textContent="Brak broni i pancerza do założenia. Początkowe wyposażenie kupisz u Miro.";list.append(empty);}
  for(const item of candidates){const row=document.createElement("article");row.className="equipment-candidate";row.dataset.equipmentItem=item.instanceId;row.append(this.itemIdentity(item));const reason=equipmentDisabledReason(item,character,this.inventory);if(reason){const note=document.createElement("small");note.className="equipment-requirement";note.textContent=reason;row.append(note);}const equip=document.createElement("button");equip.type="button";equip.textContent="Załóż";equip.dataset.equipmentEquip=item.instanceId;equip.dataset.equipmentAction=`equip:${item.instanceId}`;equip.setAttribute("aria-label",`Załóż ${item.name}`);equip.disabled=this.saving||!this.handlers||!!reason;if(reason)equip.title=reason;equip.addEventListener("click",()=>{void this.changeEquipment({slot:item.equipment!.slot,itemInstanceId:item.instanceId});});row.append(equip);list.append(row);}
  this.require("[data-equipment-status]").textContent=this.status;this.root.setAttribute("aria-busy",String(this.saving));this.syncTabs();
  if(focusKey&&!this.saving){const focus=[...this.content.querySelectorAll<HTMLButtonElement>("[data-equipment-action]")].find(button=>button.dataset.equipmentAction===focusKey);focus?.focus();}
  this.handlers?.onTypingChange?.();
 }
 private itemIdentity(item:InventoryItem):HTMLElement {const identity=document.createElement("div");identity.className="equipment-item";const text=document.createElement("div"),name=document.createElement("strong"),summary=document.createElement("small");name.textContent=item.name;summary.textContent=equipmentItemSummary(item);text.append(name,summary);identity.append(equipmentIcon(item),text);return identity;}
 private async changeEquipment(request:EquipmentUpdateRequest):Promise<void>{
  if(this.saving||this.destroyed||!this.handlers||!this.character)return;
  const version=++this.requestVersion,playerId=this.character.playerId,dataVersion=this.dataVersion;this.saving=true;this.status="Zmienianie uzbrojenia…";this.render();let result:EquipmentUpdateResult;
  try{result=await this.handlers.onSetEquipmentSlot(request);}catch{result={ok:false,code:"EQUIPMENT_UPDATE_FAILED",message:"Nie otrzymano potwierdzenia zmiany uzbrojenia. Otwórz panel ponownie."};}
  if(this.destroyed||version!==this.requestVersion||this.character?.playerId!==playerId)return;
  this.saving=false;
  if(result.ok&&result.character.playerId===playerId){this.status=request.itemInstanceId?"Założono przedmiot.":"Zdjęto przedmiot.";if(this.dataVersion===dataVersion){this.character=structuredClone(result.character);this.inventory=structuredClone(result.inventory);}this.handlers.onChanged?.(result);}else this.status=result.ok?"Połączenie postaci zmieniło się. Otwórz panel ponownie.":result.message;
  this.render();
 }
 get isTyping():boolean{const active=document.activeElement;return!this.root.classList.contains("is-hidden")&&active instanceof HTMLElement&&this.root.contains(active)&&active.matches("select,input,textarea");}
 show():void{if(this.character)this.render();this.root.classList.remove("is-hidden");}
 hide():void{this.root.classList.add("is-hidden");this.requestVersion++;this.saving=false;if(document.activeElement instanceof HTMLElement&&this.root.contains(document.activeElement))document.activeElement.blur();this.handlers?.onTypingChange?.();}
 toggle():void{if(this.root.classList.contains("is-hidden"))this.show();else this.hide();}
 destroy():void{this.hide();this.destroyed=true;this.root.remove();}
 private require<T extends HTMLElement=HTMLElement>(selector:string):T{const element=this.root.querySelector<T>(selector);if(!element)throw new Error(`Character panel element missing: ${selector}`);return element;}
}
