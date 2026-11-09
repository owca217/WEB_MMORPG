import {
 getCharacterStatistics,
 EQUIPMENT_SLOTS,EQUIPMENT_SLOT_LABELS,getCharacterEquipment,resolveCharacterSkin,getInjuryDefinition,
 type CharacterSnapshot,type EquipmentSlot,type EquipmentUpdateRequest,type EquipmentUpdateResult,type InventoryItem,type InventorySnapshot
} from "@web-mmorpg/shared";
import {equipmentDisabledReason,equipmentIcon,equipmentItemSummary} from "./EquipmentIcon";
import { CHARACTER_SKIN_ATLASES, getCharacterSkinFrame } from "../characters/characterSkinAssets";
import "./ItemPanels.css";
type CharacterTab="statistics"|"equipment";
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
 private returnFocus:HTMLElement|null=null;
 constructor(private readonly handlers?:CharacterPanelHandlers){
  this.root=document.createElement("div");this.root.className="game-panel game-panel--character item-panel is-hidden";this.root.dataset.characterSheet="";
  this.root.setAttribute("role","dialog");this.root.setAttribute("aria-labelledby","character-panel-title");
  this.root.innerHTML=`<div class="game-panel__header"><h2 id="character-panel-title">Postać</h2><button type="button" data-close aria-label="Zamknij">×</button></div>
   <nav class="character-tabs" role="tablist" aria-label="Postać">
    <button type="button" role="tab" id="character-tab-statistics" data-character-tab="statistics" aria-controls="character-panel-statistics">Statystyki</button>
    <button type="button" role="tab" id="character-tab-equipment" data-character-tab="equipment" aria-controls="character-panel-equipment">Uzbrojenie</button>
   </nav><div class="character-sheet" data-content></div>`;
  document.body.append(this.root);this.content=this.require<HTMLDivElement>("[data-content]");
  for(const type of["pointerdown","pointerup","mousedown","mouseup","touchstart","touchend","click"])this.root.addEventListener(type,event=>event.stopPropagation());
  this.require<HTMLButtonElement>("[data-close]").addEventListener("click",()=>this.hide());
  for(const button of this.root.querySelectorAll<HTMLButtonElement>("[data-character-tab]")){
   button.addEventListener("click",()=>this.selectTab(button.dataset.characterTab as CharacterTab));
   button.addEventListener("keydown",event=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();const tabs=[...this.root.querySelectorAll<HTMLButtonElement>("[data-character-tab]")];const index=tabs.indexOf(button);const next=event.key==="Home"?0:event.key==="End"?tabs.length-1:(index+(event.key==="ArrowRight"?1:tabs.length-1))%tabs.length;this.selectTab(tabs[next]!.dataset.characterTab as CharacterTab);tabs[next]!.focus();});
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
  const acceptsEquipment=!!this.handlers&&!this.saving&&this.activeTab==="equipment"&&!this.root.classList.contains("is-hidden");
  for(const row of this.root.querySelectorAll<HTMLElement>("[data-equipment-slot]")){
   const slot=row.dataset.equipmentSlot as EquipmentSlot;row.setAttribute("aria-label",EQUIPMENT_SLOT_LABELS[slot]);
   if(acceptsEquipment){row.dataset.equipmentDropTarget=slot;row.tabIndex=0;}
   else{delete row.dataset.equipmentDropTarget;row.removeAttribute("tabindex");}
  }
 }
 private render():void {
  const character=this.character;if(!character)return;
  const focusKey=document.activeElement instanceof HTMLElement&&this.root.contains(document.activeElement)?document.activeElement.dataset.equipmentAction:undefined;
  const statistics=character.statistics??getCharacterStatistics();
  this.content.innerHTML=`<section role="tabpanel" id="character-panel-statistics" aria-labelledby="character-tab-statistics" data-character-panel="statistics">
   <div class="character-sheet__identity"><div class="character-sheet__portrait" data-character-portrait role="img"><span class="character-sheet__sprite" data-character-sprite aria-hidden="true"></span></div><section class="character-sheet__resources" aria-label="Zasoby postaci"><h3 data-name></h3><dl class="character-sheet__stats"><div><dt>HP</dt><dd data-stat="hp">${character.hp}/${character.maxHp}</dd></div><div><dt>AP na turę</dt><dd data-stat="maxAp">${character.maxAp}</dd></div><div><dt>Inicjatywa</dt><dd data-stat="initiative">${character.initiative}</dd></div><div><dt>Stan</dt><dd>${character.severelyInjured?"Ciężko ranny":"Stabilny"}</dd></div></dl></section></div>
   <section class="character-sheet__section"><h3>Atrybuty i walka</h3><dl class="character-sheet__stats">
   ${([['strength','Siła (STR)'],['dexterity','Zręczność (DEX)'],['vitality','Żywotność (VIT)'],['meleeDamage','Obrażenia wręcz'],['rangedDamage','Obrażenia dystansowe'],['armor','Pancerz']] as const).map(([stat,label])=>`<div><dt>${label}</dt><dd data-stat="${stat}">${statistics[stat]}</dd></div>`).join("")}
   ${statistics.healingPower?`<div><dt>Moc leczenia</dt><dd data-stat="healingPower">${statistics.healingPower} HP</dd></div>`:""}${statistics.blockPercent?`<div><dt>Redukcja tarczy</dt><dd data-stat="blockPercent">${new Intl.NumberFormat("pl-PL",{maximumFractionDigits:2}).format(statistics.blockPercent)}%</dd></div>`:""}</dl><p>STR zwiększa obrażenia wręcz, DEX fizyczne obrażenia dystansowe, a VIT maksymalne HP. Różdżki korzystają z obrażeń magicznych i mocy zaklęć. Pancerz zmniejsza otrzymywane obrażenia.</p><p>Obrażenia podano przed pancerzem celu i wpływem urazów.</p></section>
   <section class="character-sheet__section"><h3>Sprzęt i specjalizacje</h3><p>Statystyki zapewniają noszone przedmioty i premie ich specjalizacji. Rozwijaj rodziny broni i pancerzy w osobnym oknie „Drzewko specjalizacji” (K).</p></section><section class="character-sheet__section"><h3>Urazy</h3><div data-injuries></div></section></section>
   <section role="tabpanel" id="character-panel-equipment" aria-labelledby="character-tab-equipment" data-character-panel="equipment"><p>Załóż przedmioty, aby korzystać z ich obrażeń i ochrony. Broń dwuręczna zajmuje obie ręce i zdejmuje tarczę. Uzbrojenie zmienisz poza walką.</p><div class="equipment-slots" data-equipment-slots></div><h3>Przedmioty do założenia</h3><div class="equipment-candidates" data-equipment-candidates></div><p role="status" aria-live="polite" data-equipment-status></p></section>`;
  this.require("[data-name]").textContent=character.nickname;
  this.renderInjuries(character);
  const skin=resolveCharacterSkin(character.appearance),atlas=CHARACTER_SKIN_ATLASES[skin.id],frame=getCharacterSkinFrame(skin.id,0),sprite=this.require("[data-character-sprite]"),scale=.42;
  sprite.style.backgroundImage=`url("${atlas.url}")`;sprite.style.backgroundSize=`${atlas.columns*atlas.frameWidth*scale}px ${atlas.rows*atlas.frameHeight*scale}px`;sprite.style.backgroundPosition=`${-frame.x*scale}px ${-frame.y*scale}px`;sprite.style.width=`${frame.width*scale}px`;sprite.style.height=`${frame.height*scale}px`;
  this.require("[data-character-portrait]").setAttribute("aria-label",`Wygląd postaci: ${skin.name}`);
  const equipment=character.equipment??getCharacterEquipment(this.inventory),slots=this.require("[data-equipment-slots]");
  for(const slot of EQUIPMENT_SLOTS){const row=document.createElement("article");row.className="equipment-slot";row.dataset.equipmentSlot=slot;const label=document.createElement("strong");label.textContent=EQUIPMENT_SLOT_LABELS[slot];row.append(label);const item=equipment[slot];if(item){row.append(this.itemIdentity(item));const remove=document.createElement("button");remove.type="button";remove.textContent="Zdejmij";remove.dataset.equipmentUnequip=slot;remove.dataset.equipmentAction=`unequip:${slot}`;remove.setAttribute("aria-label",`Zdejmij ${item.name}`);remove.disabled=this.saving||!this.handlers;remove.addEventListener("click",()=>{void this.changeEquipment({slot,itemInstanceId:null});});row.append(remove);}else{const empty=document.createElement("span");empty.className="equipment-slot__empty";empty.textContent=slot==="offHand"&&equipment.mainHand?.equipment?.twoHanded?"Zajęte przez broń dwuręczną":"Puste miejsce";row.append(empty);}slots.append(row);}
  const list=this.require("[data-equipment-candidates]"),candidates=this.inventory.items.filter(item=>item.equipment&&!item.equippedSlot);
  if(!candidates.length){const empty=document.createElement("p");empty.textContent="Brak broni i pancerza do założenia. Początkowe wyposażenie kupisz u Miro.";list.append(empty);}
  for(const item of candidates){const row=document.createElement("article");row.className="equipment-candidate";row.dataset.equipmentItem=item.instanceId;row.append(this.itemIdentity(item));const reason=equipmentDisabledReason(item,character,this.inventory);if(reason){const note=document.createElement("small");note.className="equipment-requirement";note.textContent=reason;row.append(note);}const equip=document.createElement("button");equip.type="button";equip.textContent="Załóż";equip.dataset.equipmentEquip=item.instanceId;equip.dataset.equipmentAction=`equip:${item.instanceId}`;equip.setAttribute("aria-label",`Załóż ${item.name}`);equip.disabled=this.saving||!this.handlers||!!reason;if(reason)equip.title=reason;equip.addEventListener("click",()=>{void this.changeEquipment({slot:item.equipment!.slot,itemInstanceId:item.instanceId});});row.append(equip);list.append(row);}
  this.require("[data-equipment-status]").textContent=this.status;this.root.setAttribute("aria-busy",String(this.saving));this.syncTabs();
  if(focusKey&&!this.saving){const focus=[...this.content.querySelectorAll<HTMLButtonElement>("[data-equipment-action]")].find(button=>button.dataset.equipmentAction===focusKey);focus?.focus();}
  this.handlers?.onTypingChange?.();
 }
 private renderInjuries(character:CharacterSnapshot):void {
  const host=this.require("[data-injuries]");
  if(!character.injuries.length){host.textContent="Brak";return;}
  const list=document.createElement("ul");list.className="character-injuries";list.setAttribute("aria-label","Posiadane urazy");
  for(const kind of new Set(character.injuries)){
   const definition=getInjuryDefinition(kind);
   const row=document.createElement("li");row.dataset.characterInjury=kind;
   const name=document.createElement("strong");name.textContent=definition.label;
   const description=document.createElement("p");description.textContent=definition.description;
   row.append(name,description);list.append(row);
  }
  host.replaceChildren(list);
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
 show():void{if(this.destroyed)return;const opening=this.root.classList.contains("is-hidden");if(opening)this.returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;if(this.character)this.render();this.root.classList.remove("is-hidden");this.syncTabs();if(opening)this.require<HTMLButtonElement>("[data-close]").focus();}
 showEquipment(slot?:EquipmentSlot):void {
  if(this.destroyed)return;
  this.show();this.selectTab("equipment");
  const target=slot?[...this.root.querySelectorAll<HTMLElement>("[data-equipment-slot]")].find(row=>row.dataset.equipmentSlot===slot):undefined;
  if(target?.tabIndex===0)target.focus();
 }
 hide():void{const visible=!this.root.classList.contains("is-hidden");this.root.classList.add("is-hidden");this.requestVersion++;this.saving=false;this.syncTabs();if(document.activeElement instanceof HTMLElement&&this.root.contains(document.activeElement))document.activeElement.blur();if(visible&&this.returnFocus?.isConnected)this.returnFocus.focus();this.handlers?.onTypingChange?.();}
 toggle():void{if(this.root.classList.contains("is-hidden"))this.show();else this.hide();}
 destroy():void{this.hide();this.destroyed=true;this.root.remove();}
 private require<T extends HTMLElement=HTMLElement>(selector:string):T{const element=this.root.querySelector<T>(selector);if(!element)throw new Error(`Character panel element missing: ${selector}`);return element;}
}
