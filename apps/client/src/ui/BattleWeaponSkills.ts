import { areBattleEnemies, getWeaponSkill, getWeaponSkillPreview, type BattleSnapshot, type CombatantSnapshot, type WeaponSkillDefinition, type WeaponSkillId } from "@web-mmorpg/shared";
import "./BattleWeaponSkills.css";

/** Native controls work with both mouse and touch, independently of canvas hit tests. */
export class BattleWeaponSkills {
 readonly element=document.createElement("section");
 private snapshot:BattleSnapshot|undefined;
 private actor:CombatantSnapshot|undefined;
 private canAct=false;
 private selectedSkill:WeaponSkillId|undefined;
 private selectedTarget:string|undefined;
 private submitted=false;
 private compact=false;
 private expanded=false;
 private readonly onBack=(event:Event)=>{
  if(!event.defaultPrevented&&this.compact&&this.expanded){event.preventDefault();this.expanded=false;this.render();this.element.querySelector<HTMLButtonElement>("[data-toggle-skills]")?.focus();}
 };

 constructor(private readonly onUse:(skill:WeaponSkillId,targetId?:string)=>void){
  this.element.className="battle-weapon-skills";this.element.dataset.battleWeaponSkills="";this.element.setAttribute("aria-label","Wyuczone techniki");this.element.hidden=true;
  document.addEventListener("game-ui-back",this.onBack);
  this.element.addEventListener("keydown",event=>{if(event.key==="Escape"&&this.compact&&this.expanded){event.stopPropagation();this.onBack(event);}});
 }
 setCompact(compact:boolean):void {if(this.compact!==compact){this.compact=compact;this.expanded=false;this.render();}}
 destroy():void {document.removeEventListener("game-ui-back",this.onBack);this.element.remove();}
 update(snapshot:BattleSnapshot|undefined,actor:CombatantSnapshot|undefined,canAct:boolean):void {
  if(this.actor?.id!==actor?.id||this.snapshot?.id!==snapshot?.id){this.selectedSkill=undefined;this.selectedTarget=undefined;}
  this.snapshot=snapshot;this.actor=actor;this.canAct=canAct;this.submitted=false;this.render();
 }
 private render():void {
  const actor=this.actor,snapshot=this.snapshot;
  const skills=[...new Set(actor?.weaponSkills??[])].map(getWeaponSkill).filter((skill):skill is WeaponSkillDefinition=>skill!==undefined&&skill.kind!=="passive");
  this.element.hidden=!actor||!snapshot||skills.length===0;
  if(this.element.hidden){this.element.replaceChildren();return;}
  const focusKey=document.activeElement instanceof HTMLElement&&this.element.contains(document.activeElement)?document.activeElement.dataset.battleSkillFocus:undefined;
  if(!skills.some(skill=>skill.id===this.selectedSkill)){this.selectedSkill=skills[0]!.id;this.selectedTarget=undefined;}
  const skill=getWeaponSkill(this.selectedSkill)!;
  const targets=snapshot!.combatants.filter(unit=>unit.hp>0&&(skill.target==="self"?unit.id===actor!.id:skill.target==="enemy"?areBattleEnemies(actor!,unit):unit.id===actor!.id||!!actor!.side&&unit.side===actor!.side));
  if(!targets.some(unit=>unit.id===this.selectedTarget))this.selectedTarget=targets[0]?.id;
  const preview=getWeaponSkillPreview(snapshot!,actor!.id,skill.id,this.selectedTarget);
  this.element.replaceChildren();
  this.element.dataset.compact=String(this.compact);
  const toggle=document.createElement("button");toggle.type="button";toggle.className="battle-weapon-skills__toggle";toggle.dataset.toggleSkills="";toggle.dataset.battleSkillFocus="toggle";toggle.textContent=`Techniki (${skills.length}) · ${skill.name}`;toggle.setAttribute("aria-expanded",String(this.expanded));toggle.hidden=!this.compact;
  toggle.addEventListener("click",()=>{this.expanded=!this.expanded;this.render();});
  const panel=document.createElement("div");panel.className="battle-weapon-skills__panel";panel.hidden=this.compact&&!this.expanded;
  const list=document.createElement("div");list.className="battle-weapon-skills__list";list.setAttribute("role","group");list.setAttribute("aria-label","Wybierz technikę");
  for(const definition of skills){
   const button=document.createElement("button");button.type="button";button.dataset.selectWeaponSkill=definition.id;button.dataset.battleSkillFocus=`skill:${definition.id}`;button.setAttribute("aria-pressed",String(definition.id===skill.id));
   const cooldown=actor!.weaponSkillCooldowns?.[definition.id]??0;button.textContent=`${definition.name}${cooldown>0?` · ${cooldown} tur`:""}`;button.title=definition.description;
   button.addEventListener("click",()=>{if(this.selectedSkill!==definition.id){this.selectedSkill=definition.id;this.selectedTarget=undefined;this.render();}});list.append(button);
  }
  const controls=document.createElement("div");controls.className="battle-weapon-skills__controls";
  const label=document.createElement("label");label.textContent="Cel techniki";label.hidden=skill.target==="self";
  const select=document.createElement("select");select.dataset.skillTarget="";select.dataset.battleSkillFocus="target";select.setAttribute("aria-label","Cel techniki");select.disabled=!this.canAct;
  for(const unit of targets){const option=document.createElement("option");option.value=unit.id;option.textContent=`${unit.name}${unit.id===actor!.id?" (Ty)":""} · ${unit.hp}/${unit.maxHp} HP`;select.append(option);}
  select.value=this.selectedTarget??"";select.addEventListener("change",()=>{this.selectedTarget=select.value;this.render();});label.append(select);
  const details=document.createElement("p");details.className="battle-weapon-skills__preview";details.dataset.skillBattlePreview="";
  const effect=skill.kind==="attack"?`${preview.amount} obrażeń`:skill.kind==="heal"?`${preview.amount} HP`:"Osłona";
  details.textContent=`${effect} · ${preview.apCost} AP · odnowienie ${preview.cooldownRemaining>0?`${preview.cooldownRemaining} tur`: `${skill.cooldownTurns} tur po użyciu`}${preview.reason?` · ${preview.reason}`:""}`;details.title=skill.description;
  const use=document.createElement("button");use.type="button";use.dataset.useWeaponSkill="";use.dataset.battleSkillFocus="use";use.textContent=`Użyj: ${skill.name}`;use.disabled=!this.canAct||!preview.available||this.submitted;use.title=preview.reason??skill.description;
  use.addEventListener("click",()=>{if(!this.canAct||!preview.available||this.submitted)return;this.submitted=true;use.disabled=true;this.expanded=false;this.render();this.onUse(skill.id,preview.targetId??this.selectedTarget);});
  controls.append(label,details,use);panel.append(list,controls);this.element.append(toggle,panel);
  if(focusKey)[...this.element.querySelectorAll<HTMLElement>("[data-battle-skill-focus]")].find(element=>element.dataset.battleSkillFocus===focusKey)?.focus();
 }
}
