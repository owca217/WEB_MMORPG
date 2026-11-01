import { WEAPON_FAMILIES, WEAPON_SKILLS, getWeaponSkill, getWeaponSkillProgress, type WeaponFamily, type WeaponSkillId } from "@web-mmorpg/shared";
import "./WeaponSkillTreeView.css";

interface TreeOptions { editable:boolean; busy:boolean; status?:string; }
interface TreeHandlers { onLearn:(id:WeaponSkillId)=>void; onReset:(family:WeaponFamily)=>void; }

/** Owns its family selection independently of surrounding character snapshots. */
export class WeaponSkillTreeView {
 readonly element=document.createElement("section");
 private family:WeaponFamily="sword";
 private training:unknown;
 private options:TreeOptions={editable:false,busy:false};

 constructor(private readonly handlers:TreeHandlers){
  this.element.className="weapon-skill-tree";this.element.dataset.weaponSkillTree="";
 }

 update(training:unknown,options:TreeOptions):void {this.training=training;this.options=options;this.render();}
 selectFamily(family:WeaponFamily):void {this.family=family;this.render();}
 resetSelection():void {this.family="sword";}

 private render():void {
  const focused=document.activeElement instanceof HTMLElement&&this.element.contains(document.activeElement)?document.activeElement.dataset.skillFocus:undefined;
  const progress=getWeaponSkillProgress(this.training,this.family);
  const family=WEAPON_FAMILIES.find(item=>item.id===this.family)!;
  this.element.replaceChildren();
  const heading=document.createElement("h3");heading.textContent="Drzewka umiejętności";
  const intro=document.createElement("p");intro.className="weapon-skill-tree__intro";intro.textContent="1 punkt co 5 poziomów władania. Każda rodzina ma własną pulę. Wyuczone techniki wymagają odpowiedniego uzbrojenia.";
  const families=document.createElement("nav");families.className="weapon-skill-tree__families";families.setAttribute("aria-label","Rodzina drzewka");
  for(const item of WEAPON_FAMILIES){
   const button=document.createElement("button");button.type="button";button.textContent=item.label;button.dataset.skillFamily=item.id;button.dataset.skillFocus=`family:${item.id}`;button.setAttribute("aria-pressed",String(item.id===this.family));
   button.addEventListener("click",()=>this.selectFamily(item.id));families.append(button);
  }
  const summary=document.createElement("div");summary.className="weapon-skill-tree__summary";
  const title=document.createElement("h4");title.textContent=`${family.label} · władanie ${progress.level}/100`;
  const points=document.createElement("p");points.dataset.skillPoints="";points.textContent=`Dostępne punkty: ${progress.availablePoints} · wydane: ${progress.spentPoints}/${progress.earnedPoints}`;
  summary.append(title,points);
  const branches=document.createElement("div");branches.className="weapon-skill-tree__branches";
  for(const branch of ["power","tactics"] as const){
   const column=document.createElement("section");column.className="weapon-skill-tree__branch";column.dataset.skillBranch=branch;
   const label=document.createElement("h5");label.textContent=branch==="power"?"Siła techniki":"Taktyka i specjalizacja";column.append(label);
   const skills=WEAPON_SKILLS.filter(skill=>skill.family===this.family&&skill.branch===branch).sort((a,b)=>a.requiredLevel-b.requiredLevel);
   for(const skill of skills){
    const learned=progress.learnedSkills.includes(skill.id);
    const reason=learned?"":!this.options.editable?"Rozwój umiejętności jest dostępny poza walką."
     :this.options.busy?"Oczekiwanie na serwer…"
      :progress.level<skill.requiredLevel?`Wymaga władania na poziomie ${skill.requiredLevel}.`
       :skill.prerequisite&&!progress.learnedSkills.includes(skill.prerequisite)?`Najpierw naucz się: ${getWeaponSkill(skill.prerequisite)?.name??"poprzedniej umiejętności"}.`
        :progress.availablePoints<skill.pointCost?`Brakuje punktów: potrzeba ${skill.pointCost}.`:"";
    const card=document.createElement("article");card.className="weapon-skill-tree__node";card.dataset.skillNode=skill.id;card.dataset.learned=String(learned);card.dataset.locked=String(!!reason);
    const name=document.createElement("h6");name.textContent=skill.name;
    const kind=document.createElement("span");kind.className="weapon-skill-tree__kind";kind.textContent=skill.kind==="passive"?"Pasywna":"Aktywna";
    const description=document.createElement("p");description.textContent=skill.description;
    const cost=document.createElement("small");cost.textContent=`Władanie ${skill.requiredLevel} · ${skill.pointCost} pkt${skill.kind!=="passive"?` · ${skill.apCost} AP · odnowienie ${skill.cooldownTurns} tur`:""}`;
    const requirement=document.createElement("p");requirement.className="weapon-skill-tree__requirement";requirement.id=`skill-requirement-${skill.id.replace(":","-")}`;requirement.textContent=learned?"Wyuczona":reason||"Możesz się nauczyć";
    const learn=document.createElement("button");learn.type="button";learn.dataset.learnSkill=skill.id;learn.dataset.skillFocus=`learn:${skill.id}`;learn.textContent=learned?"Wyuczona":"Naucz się";learn.disabled=learned||!!reason;learn.setAttribute("aria-label",`${learned?"Wyuczona":"Naucz się"}: ${skill.name}`);learn.setAttribute("aria-describedby",requirement.id);
    learn.addEventListener("click",()=>{if(!learn.disabled)this.handlers.onLearn(skill.id);});card.append(kind,name,description,cost,requirement,learn);column.append(card);
   }
   branches.append(column);
  }
  const footer=document.createElement("div");footer.className="weapon-skill-tree__footer";
  const reset=document.createElement("button");reset.type="button";reset.dataset.resetSkills="";reset.dataset.skillFocus="reset";reset.textContent="Zresetuj tę rodzinę";reset.disabled=!this.options.editable||this.options.busy||!progress.learnedSkills.length;reset.addEventListener("click",()=>{if(!reset.disabled)this.handlers.onReset(this.family);});
  const resetNote=document.createElement("small");resetNote.textContent="Reset jest darmowy poza walką. Oddaje punkty tej rodziny; poziom i XP pozostają.";
  const status=document.createElement("p");status.dataset.skillStatus="";status.setAttribute("role","status");status.setAttribute("aria-live","polite");status.textContent=this.options.status??"";
  footer.append(reset,resetNote,status);this.element.append(heading,intro,families,summary,branches,footer);this.element.setAttribute("aria-busy",String(this.options.busy));
  if(focused){[...this.element.querySelectorAll<HTMLElement>("[data-skill-focus]")].find(element=>element.dataset.skillFocus===focused)?.focus();}
 }
}
