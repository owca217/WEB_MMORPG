import {
 ARMOR_FAMILIES, ARMOR_SKILLS, WEAPON_FAMILIES, WEAPON_SKILLS, getArmorSkill, getArmorSkillProgress,
 getWeaponSkill, getWeaponSkillProgress, getWeaponProficiency, normalizeWeaponTraining, type ArmorFamily, type ArmorSkillId, type CharacterSnapshot,
 type WeaponFamily, type WeaponSkillId, type WeaponSkillUpdateResult
} from '@web-mmorpg/shared';
import './SpecializationPanel.css';

type Family=WeaponFamily|ArmorFamily;
type SkillId=WeaponSkillId|ArmorSkillId;
type Skill=(typeof WEAPON_SKILLS)[number]|(typeof ARMOR_SKILLS)[number];
interface SpecializationHandlers {
 onLearnWeaponSkill:(id:WeaponSkillId)=>Promise<WeaponSkillUpdateResult>;
 onResetWeaponSkills:(family:WeaponFamily)=>Promise<WeaponSkillUpdateResult>;
 onLearnArmorSkill:(id:ArmorSkillId)=>Promise<WeaponSkillUpdateResult>;
 onResetArmorSkills:(family:ArmorFamily)=>Promise<WeaponSkillUpdateResult>;
 onChanged?:(result:Extract<WeaponSkillUpdateResult,{ok:true}>)=>void;
 onTypingChange?:()=>void;
}
const armorFamily=(family:Family):family is ArmorFamily=>ARMOR_FAMILIES.some(item=>item.id===family);
const familyDefinitions=[...WEAPON_FAMILIES,...ARMOR_FAMILIES];
const icons:Record<Family,string>={
 sword:'M7 21 20 8l1-5-5 1L4 17m0-4 7 7m-8 1 3-3',
 axe:'M6 23 17 4m-5 1c6-4 11 0 9 7l-8-4',
 hammer:'M9 23 14 11M7 3l14 4-3 8-14-4Z',
 dagger:'m4 23 9-10m-6 0 6 6m-2-6 9-10-1 8-6 6',
 spear:'M3 24 18 9m-3-1 9-6-4 10Z',
 bow:'M6 3c19 3 19 19 0 22L9 14Zm1 11h17m-4-4 4 4-4 4',
 crossbow:'m6 23 10-14m-7-6c13 1 18 12 11 18M5 8l15 13m-8-8 8-10',
 staff:'M7 24 16 8m-4-6 8 2 1 6-6 2-5-5Z',
 shield:'M5 4 14 1l9 3v9c0 6-9 12-9 12S5 19 5 13Zm9-3v24',
 wand:'M5 24 17 10m1-9 2 5 5 1-4 4 1 5-5-3-5 2 1-5-3-4 6-1Z',
 cloth:'m4 8 6-5h8l6 5-4 5-2-2v14h-8V11l-2 2Zm6-5c0 7 8 7 8 0',
 leather:'m8 3 6 3 6-3 3 9-4 1 2 12H7l2-12-4-1Zm6 3v19m-4-8h8',
 plate:'m4 7 5-4 5 3 5-3 5 4-3 6-3-2v9l-4 5-4-5v-9l-3 2Zm6 5h8'
};
function icon(family:Family):string{return `<svg viewBox="0 0 28 28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[family]}"/></svg>`;}
function element<K extends keyof HTMLElementTagNameMap>(tag:K,className='',text?:string):HTMLElementTagNameMap[K]{const item=document.createElement(tag);item.className=className;if(text!==undefined)item.textContent=text;return item;}
const polar=(angle:number,radius:number)=>({x:560+Math.cos(angle*Math.PI/180)*radius,y:560+Math.sin(angle*Math.PI/180)*radius});

/** Independent scene-owned window. Snapshots update progress without resetting its camera or selection. */
export class SpecializationPanel {
 private readonly root=element('div','game-panel specialization-panel is-hidden');
 private readonly viewport:HTMLDivElement;
 private readonly map:HTMLDivElement;
 private readonly details:HTMLElement;
 private readonly familySelect:HTMLSelectElement;
 private character:CharacterSnapshot|undefined;
 private family:Family='sword';
 private selectedSkill:SkillId|undefined;
 private saving=false;
 private editable=true;
 private status='';
 private requestVersion=0;
 private dataVersion=0;
 private destroyed=false;
 private returnFocus:HTMLElement|null=null;
 private camera={x:0,y:0,zoom:.5};
 private fitted=false;
 private readonly pointers=new Map<number,{x:number;y:number}>();
 private dragDistance=0;
 private ignoreClickUntil=0;
 private readonly onResize=()=>{if(this.isOpen)this.fitCamera();};
 constructor(private readonly handlers:SpecializationHandlers){
  this.root.dataset.specializationPanel='';this.root.setAttribute('role','dialog');this.root.setAttribute('aria-labelledby','specialization-title');
  this.root.innerHTML=`<div class="game-panel__header"><div><span class="specialization-panel__eyebrow">KRONIKI POGRANICZA · ROZWÓJ</span><h2 id="specialization-title">Drzewko specjalizacji</h2></div><button type="button" data-close aria-label="Zamknij drzewko specjalizacji">×</button></div>
   <div class="specialization-panel__intro"><p>Twój oręż. Twoja droga.</p><span>Rozwijaj sprzęt w walce · 1 punkt co 5 rang · osobne pule</span></div>
   <div class="specialization-panel__body"><section class="specialization-board" aria-label="Mapa specjalizacji"><div class="specialization-board__toolbar"><label>Rodzina <select data-specialization-family aria-label="Wybierz rodzinę specjalizacji"></select></label><div role="group" aria-label="Widok mapy"><button type="button" data-zoom-out aria-label="Oddal mapę">−</button><output data-zoom-label aria-live="off">50%</output><button type="button" data-zoom-in aria-label="Przybliż mapę">+</button><button type="button" data-reset-view aria-label="Dopasuj mapę">⌖</button></div></div>
    <div class="specialization-board__viewport" data-specialization-viewport tabindex="0" role="region" aria-label="Przesuwana mapa specjalizacji. Strzałki przesuwają, plus i minus zmieniają skalę, Home dopasowuje widok." aria-describedby="specialization-map-help"><div class="specialization-board__map" data-specialization-map></div></div>
    <div class="specialization-board__legend"><span><i class="is-learned"></i>Wyuczona</span><span><i class="is-available"></i>Dostępna</span><span><i></i>Zablokowana</span></div><p id="specialization-map-help" class="specialization-board__help">Przeciągnij mapę · kółko / dwa palce: skala · wybierz węzeł</p></section>
   <aside class="specialization-details" data-specialization-details aria-label="Szczegóły specjalizacji"></aside></div><p class="specialization-panel__status" data-skill-status role="status" aria-live="polite"></p>`;
  this.viewport=this.require('[data-specialization-viewport]');this.map=this.require('[data-specialization-map]');this.details=this.require('[data-specialization-details]');this.familySelect=this.require('[data-specialization-family]');
  for(const [label,families] of [['Broń',WEAPON_FAMILIES],['Pancerz',ARMOR_FAMILIES]] as const){const group=element('optgroup');group.label=label;for(const family of families){const option=element('option','',family.label);option.value=family.id;group.append(option);}this.familySelect.append(group);}
  this.familySelect.addEventListener('change',()=>this.selectFamily(this.familySelect.value as Family));
  this.require('[data-close]').addEventListener('click',()=>this.hide());
  this.require('[data-zoom-in]').addEventListener('click',()=>this.zoom(this.camera.zoom*1.2));
  this.require('[data-zoom-out]').addEventListener('click',()=>this.zoom(this.camera.zoom/1.2));
  this.require('[data-reset-view]').addEventListener('click',()=>this.fitCamera());
  for(const type of ['pointerdown','pointerup','pointermove','mousedown','mouseup','touchstart','touchend','click','dblclick'])this.root.addEventListener(type,event=>event.stopPropagation());
  this.root.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.hide();}});
  this.root.addEventListener('focusin',()=>this.handlers.onTypingChange?.());this.root.addEventListener('focusout',()=>queueMicrotask(()=>this.handlers.onTypingChange?.()));
  this.viewport.addEventListener('keydown',event=>{if(event.target!==this.viewport)return;const moves:Record<string,[number,number]>={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]};if(moves[event.key]){event.preventDefault();event.stopPropagation();this.camera.x+=moves[event.key]![0];this.camera.y+=moves[event.key]![1];this.applyCamera();}else if(['+','=','-','Home'].includes(event.key)){event.preventDefault();event.stopPropagation();if(event.key==='Home')this.fitCamera();else this.zoom(this.camera.zoom*(event.key==='-'?1/1.2:1.2));}});
  this.viewport.addEventListener('wheel',event=>{event.preventDefault();event.stopPropagation();const bounds=this.viewport.getBoundingClientRect();this.zoom(this.camera.zoom*Math.exp(-event.deltaY*.0015),event.clientX-bounds.left-bounds.width/2,event.clientY-bounds.top-bounds.height/2);},{passive:false});
  this.viewport.addEventListener('pointerdown',event=>{if(event.button!==0&&event.pointerType!=='touch')return;this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});if(this.pointers.size===1)this.dragDistance=0;});
  this.viewport.addEventListener('pointermove',event=>this.movePointer(event));
  for(const type of ['pointerup','pointercancel','lostpointercapture'] as const)this.viewport.addEventListener(type,event=>{this.pointers.delete(event.pointerId);if(this.dragDistance>5)this.ignoreClickUntil=Date.now()+200;});
  this.viewport.addEventListener('click',event=>{if(Date.now()<this.ignoreClickUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
  window.addEventListener('resize',this.onResize);document.body.append(this.root);this.applyCamera();
 }
 update(character:CharacterSnapshot,options:{editable?:boolean}={}):void{
  if(this.destroyed)return;
  if(this.character?.playerId!==character.playerId){this.requestVersion++;this.saving=false;this.status='';this.family='sword';this.selectedSkill=undefined;this.camera={x:0,y:0,zoom:.5};this.fitted=false;}
  this.character=structuredClone(character);this.editable=options.editable??true;this.dataVersion++;this.render();
 }
 private progress(family:Family){return armorFamily(family)?getArmorSkillProgress(this.character?.armorTraining,family):{...getWeaponProficiency(normalizeWeaponTraining(this.character?.weaponTraining).experience[family]),...getWeaponSkillProgress(this.character?.weaponTraining,family)};}
 private skills(family:Family):Skill[]{return armorFamily(family)?ARMOR_SKILLS.filter(skill=>skill.family===family):WEAPON_SKILLS.filter(skill=>skill.family===family);}
 private reason(skill:Skill):string{
  const progress=this.progress(skill.family);
  if(progress.learnedSkills.some(id=>id===skill.id))return '';
  if(!this.editable)return 'Specjalizacje zmienisz poza walką.';
  if(this.saving)return 'Oczekiwanie na serwer…';
  if(progress.level<skill.requiredLevel)return `Wymagana ranga ${skill.requiredLevel}.`;
  if(skill.prerequisite&&!progress.learnedSkills.some(id=>id===skill.prerequisite))return `Najpierw naucz się: ${getWeaponSkill(skill.prerequisite)?.name??getArmorSkill(skill.prerequisite)?.name??'poprzedniego węzła'}.`;
  if(progress.availablePoints<skill.pointCost)return `Brakuje punktów: potrzeba ${skill.pointCost}.`;
  return '';
 }
 private selectFamily(family:Family,skillId?:SkillId):void{this.family=family;this.selectedSkill=skillId;this.render();}
 private render():void{
  if(!this.character)return;
  const focused=document.activeElement instanceof HTMLElement&&this.root.contains(document.activeElement)?document.activeElement.dataset.skillFocus:undefined;
  const detailScroll=this.details.scrollTop;
  this.familySelect.value=this.family;this.renderMap();this.renderDetails();this.details.scrollTop=detailScroll;
  this.require('[data-skill-status]').textContent=this.status;this.root.setAttribute('aria-busy',String(this.saving));
  if(focused)[...this.root.querySelectorAll<HTMLElement>('[data-skill-focus]')].find(item=>item.dataset.skillFocus===focused)?.focus({preventScroll:true});
 }
 private renderMap():void{
  this.map.replaceChildren();const ns='http://www.w3.org/2000/svg';const lines=document.createElementNS(ns,'svg');lines.setAttribute('viewBox','0 0 1120 1120');lines.classList.add('specialization-board__connections');lines.setAttribute('aria-hidden','true');this.map.append(lines);
  const line=(from:{x:number;y:number},to:{x:number;y:number},learned=false)=>{const path=document.createElementNS(ns,'path');path.setAttribute('d',`M ${from.x} ${from.y} L ${to.x} ${to.y}`);if(learned)path.classList.add('is-learned');lines.append(path);};
  const circle=(radius:number)=>{const item=document.createElementNS(ns,'circle');item.setAttribute('cx','560');item.setAttribute('cy','560');item.setAttribute('r',String(radius));lines.append(item);};circle(276);circle(480);
  const center=element('div','specialization-board__center');center.innerHTML='<span aria-hidden="true">K</span><strong>Twoja droga</strong><small>Specjalizacje</small>';this.map.append(center);
  const groups={weapon:polar(270,125),armor:polar(90,125)};
  for(const [kind,label] of [['weapon','Oręż'],['armor','Pancerze']] as const){const group=element('div',`specialization-board__group specialization-board__group--${kind}`,label);group.style.left=`${groups[kind].x}px`;group.style.top=`${groups[kind].y}px`;this.map.append(group);line({x:560,y:560},groups[kind]);}
  for(const [index,family] of familyDefinitions.entries()){
   const armor=armorFamily(family.id),familyIndex=armor?ARMOR_FAMILIES.findIndex(item=>item.id===family.id):index;
   const angle=armor?55+familyIndex*35:186+familyIndex*21,position=polar(angle,276),progress=this.progress(family.id),skills=this.skills(family.id);
   line(groups[armor?'armor':'weapon'],position,progress.level>0);
   const familyButton=element('button',`specialization-board__family${armor?' specialization-board__family--armor':''}`);familyButton.type='button';familyButton.dataset.skillFamily=family.id;familyButton.dataset.skillFocus=`family:${family.id}`;familyButton.dataset.weaponFamily=family.id;familyButton.setAttribute('aria-label',`${family.label}, ranga ${progress.level}/100, ${progress.availablePoints} dostępnych punktów`);familyButton.setAttribute('aria-pressed',String(family.id===this.family));familyButton.style.left=`${position.x}px`;familyButton.style.top=`${position.y}px`;familyButton.style.setProperty('--progress',`${progress.level*3.6}deg`);familyButton.innerHTML=`<span class="specialization-board__family-icon">${icon(family.id)}</span><span class="specialization-board__family-label">${family.label}</span><small data-weapon-level>${progress.level}/100</small>`;familyButton.addEventListener('click',()=>this.selectFamily(family.id));this.map.append(familyButton);
   const skillPositions=new Map<string,{x:number;y:number}>();
   for(const [skillIndex,skill] of skills.entries()){
    const branch='branch' in skill?(skill.branch==='power'?0:1):skillIndex%2;
    const depth='branch' in skill?(skill.requiredLevel>=50?1:0):(skillIndex>=2?1:0);
    const nodePosition=polar(angle+(branch===0?-5.6:5.6),depth?475:377);skillPositions.set(skill.id,nodePosition);
    const learned=progress.learnedSkills.some(id=>id===skill.id),reason=this.reason(skill),node=element('button','specialization-board__node');
    node.type='button';node.dataset.specializationNode=skill.id;node.dataset.skillNode=skill.id;node.dataset.skillFocus=`node:${skill.id}`;node.dataset.learned=String(learned);node.dataset.locked=String(!!reason);node.setAttribute('aria-pressed',String(this.selectedSkill===skill.id));node.setAttribute('aria-label',`${skill.name} · ${learned?'Wyuczona':reason||'Dostępna'} · ${skill.pointCost} pkt`);node.title=`${skill.name} · ranga ${skill.requiredLevel} · ${skill.pointCost} pkt`;node.style.left=`${nodePosition.x}px`;node.style.top=`${nodePosition.y}px`;node.innerHTML=`${icon(family.id)}<span>${learned?'✓':skill.requiredLevel}</span>`;node.addEventListener('click',()=>this.selectFamily(family.id,skill.id));this.map.append(node);
    line(skill.prerequisite?skillPositions.get(skill.prerequisite)??position:position,nodePosition,learned);
   }
  }
 }
 private renderDetails():void{
  const progress=this.progress(this.family),family=familyDefinitions.find(item=>item.id===this.family)!,armor=armorFamily(this.family);
  this.details.replaceChildren();
  const header=element('div','specialization-details__heading');const badge=element('span','specialization-details__icon');badge.innerHTML=icon(this.family);const titles=element('div');titles.append(element('span','specialization-panel__eyebrow',armor?'SPECJALIZACJA PANCERZA':'SPECJALIZACJA BRONI'),element('h3','',family.label));header.append(badge,titles);this.details.append(header);
  const summary=element('section','specialization-details__progress');summary.append(element('strong','',`Ranga ${progress.level} / 100`));const xp=element('p','',progress.level===100?'Maksymalna ranga':`${progress.current} / ${progress.required} XP do następnej rangi`);summary.append(xp);
  const meter=element('div','specialization-details__meter');meter.setAttribute('role','progressbar');meter.setAttribute('aria-label',`Postęp specjalizacji: ${family.label}`);meter.setAttribute('aria-valuemin','0');meter.setAttribute('aria-valuemax','100');meter.setAttribute('aria-valuenow',String(progress.percentage));const fill=element('span');fill.style.width=`${progress.percentage}%`;meter.append(fill);summary.append(meter);
  const points=element('p','specialization-details__points',`Dostępne punkty: ${progress.availablePoints} · wydane: ${progress.spentPoints}/${progress.earnedPoints}`);points.dataset.skillPoints='';summary.append(points);this.details.append(summary);
  this.details.append(element('p','specialization-details__explanation',armor?'Rangi wzmacniają pancerz, maksymalne HP i żywotność pasujących, noszonych elementów o 0,2% za rangę. Połowa nagrody XP trafia do noszonych rodzin proporcjonalnie do liczby elementów.':'Połowę nagrody XP dzielisz między rodzaje broni używane w walce i tarczę. Techniki wymagają właściwego uzbrojenia. Druga połowa rozwija noszone pancerze. Leczenie poza walką nie daje XP.'));
  const skills=this.skills(this.family),selected=this.selectedSkill?skills.filter(skill=>skill.id===this.selectedSkill):skills;
  if(this.selectedSkill){const back=element('button','specialization-details__back','← Wszystkie węzły rodziny');back.type='button';back.dataset.skillFocus='family-details';back.addEventListener('click',()=>this.selectFamily(this.family));this.details.append(back);}
  for(const skill of selected){
   const learned=progress.learnedSkills.some(id=>id===skill.id),reason=this.reason(skill),card=element('article','specialization-details__skill');card.dataset.skillDetail=skill.id;card.dataset.learned=String(learned);
   card.append(element('span','specialization-panel__eyebrow','kind' in skill&&skill.kind!=='passive'?'TECHNIKA AKTYWNA':'PREMIA PASYWNA'),element('h4','',skill.name),element('p','',skill.description));
   card.append(element('small','',`Ranga ${skill.requiredLevel} · ${skill.pointCost} pkt${'kind' in skill&&skill.kind!=='passive'?` · ${skill.apCost} AP · odnowienie ${skill.cooldownTurns} tur`:''}`));
   const requirement=element('p','specialization-details__requirement',learned?'Wyuczona':reason||'Możesz się nauczyć');requirement.id=`specialization-requirement-${skill.id.replace(':','-')}`;
   const learn=element('button','',learned?'Wyuczona':'Naucz się');learn.type='button';learn.dataset.learnSkill=skill.id;learn.dataset.skillFocus=`learn:${skill.id}`;learn.disabled=learned||!!reason;learn.setAttribute('aria-describedby',requirement.id);learn.addEventListener('click',()=>{if(!learn.disabled)void this.changeSkills({skillId:skill.id});});card.append(requirement,learn);this.details.append(card);
  }
  const footer=element('footer','specialization-details__footer'),reset=element('button','','Zresetuj tę rodzinę');reset.type='button';reset.dataset.resetSkills='';reset.dataset.skillFocus='reset';reset.disabled=!this.editable||this.saving||!progress.learnedSkills.length;reset.addEventListener('click',()=>{if(!reset.disabled)void this.changeSkills({family:this.family});});footer.append(reset,element('small','','Reset jest darmowy poza walką. Zwraca punkty tej rodziny. Ranga i XP pozostają.'));this.details.append(footer);
 }
 private async changeSkills(request:{skillId:SkillId}|{family:Family}):Promise<void>{
  if(this.saving||this.destroyed||!this.editable||!this.character)return;
  const version=++this.requestVersion,playerId=this.character.playerId,dataVersion=this.dataVersion;
  this.saving=true;this.status='Zapisywanie drzewka…';this.render();let result:WeaponSkillUpdateResult;
  try{if('skillId' in request){const family=request.skillId.split(':')[0] as Family;result=armorFamily(family)?await this.handlers.onLearnArmorSkill(request.skillId as ArmorSkillId):await this.handlers.onLearnWeaponSkill(request.skillId as WeaponSkillId);}else result=armorFamily(request.family)?await this.handlers.onResetArmorSkills(request.family):await this.handlers.onResetWeaponSkills(request.family);}
  catch{result={ok:false,code:'WEAPON_SKILL_UPDATE_UNCERTAIN',message:'Brak potwierdzenia. Otwórz drzewko ponownie, aby sprawdzić zapis.'};}
  if(this.destroyed||version!==this.requestVersion||this.character?.playerId!==playerId)return;
  this.saving=false;
  if(result.ok&&result.character.playerId===playerId){if(this.dataVersion===dataVersion)this.character=structuredClone(result.character);this.status='skillId' in request?'Nauczono umiejętności.':'Zresetowano umiejętności tej rodziny.';this.handlers.onChanged?.(result);}
  else this.status=result.ok?'Połączenie postaci zmieniło się. Otwórz drzewko ponownie.':result.message;
  this.render();
 }
 private movePointer(event:PointerEvent):void{
  const previous=this.pointers.get(event.pointerId);if(!previous)return;
  const dx=event.clientX-previous.x,dy=event.clientY-previous.y;this.dragDistance+=Math.hypot(dx,dy);if(this.dragDistance>5)this.viewport.setPointerCapture?.(event.pointerId);
  if(this.pointers.size===2){const other=[...this.pointers.entries()].find(([id])=>id!==event.pointerId)![1];const before=Math.hypot(previous.x-other.x,previous.y-other.y),after=Math.hypot(event.clientX-other.x,event.clientY-other.y);if(before>2)this.zoom(this.camera.zoom*after/before);this.camera.x+=dx/2;this.camera.y+=dy/2;}
  else{this.camera.x+=dx;this.camera.y+=dy;}
  this.pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});this.applyCamera();
 }
 private zoom(value:number,x=0,y=0):void{const next=Math.max(.25,Math.min(1.75,value)),ratio=next/this.camera.zoom;this.camera.x=x-(x-this.camera.x)*ratio;this.camera.y=y-(y-this.camera.y)*ratio;this.camera.zoom=next;this.applyCamera();}
 private fitCamera():void{const bounds=this.viewport.getBoundingClientRect();this.camera={x:0,y:0,zoom:Math.max(.25,Math.min(.85,Math.min(bounds.width||600,bounds.height||560)/1100))};this.fitted=true;this.applyCamera();}
 private applyCamera():void{this.map.style.transform=`translate(calc(-50% + ${this.camera.x}px), calc(-50% + ${this.camera.y}px)) scale(${this.camera.zoom})`;this.require(' [data-zoom-label]').textContent=`${Math.round(this.camera.zoom*100)}%`;}
 get isOpen():boolean{return !this.destroyed&&!this.root.classList.contains('is-hidden');}
 get isTyping():boolean{return this.isOpen&&document.activeElement instanceof HTMLElement&&this.root.contains(document.activeElement)&&document.activeElement.matches('input,select,textarea');}
 show():void{if(this.destroyed)return;const opening=!this.isOpen;if(opening)this.returnFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;this.root.classList.remove('is-hidden');if(!this.fitted)this.fitCamera();if(opening)this.require<HTMLButtonElement>('[data-close]').focus();this.handlers.onTypingChange?.();}
 hide():void{const visible=this.isOpen;this.root.classList.add('is-hidden');this.requestVersion++;this.saving=false;this.pointers.clear();if(this.status==='Zapisywanie drzewka…')this.status='Sprawdź aktualny stan po ponownym otwarciu drzewka.';if(document.activeElement instanceof HTMLElement&&this.root.contains(document.activeElement))document.activeElement.blur();if(visible&&this.returnFocus?.isConnected)this.returnFocus.focus();this.handlers.onTypingChange?.();this.render();}
 toggle():void{if(this.isOpen)this.hide();else this.show();}
 destroy():void{this.hide();this.destroyed=true;window.removeEventListener('resize',this.onResize);this.root.remove();}
 private require<T extends HTMLElement=HTMLElement>(selector:string):T{const found=this.root.querySelector<T>(selector);if(!found)throw new Error(`Specialization element missing: ${selector}`);return found;}
}
