/* @vitest-environment jsdom */
import type { BattleSnapshot, CombatantSnapshot, WeaponSkillId } from "@web-mmorpg/shared";
import { afterEach, expect, it, vi } from "vitest";
import { BattleWeaponSkills } from "../src/ui/BattleWeaponSkills";

const hero:CombatantSnapshot={id:"hero",ownerPlayerId:"player",side:"player",name:"Alicja",hp:60,maxHp:100,ap:5,maxAp:5,initiative:10,position:{q:0,r:0},injuries:[],severelyInjured:false,combatStats:{meleeDamage:40,rangedDamage:0,armor:0,healingPower:20},weaponSkills:["sword:power"]};
const enemy:CombatantSnapshot={...hero,id:"enemy",side:"enemy",name:"Wilk",hp:100,position:{q:1,r:0},weaponSkills:[]};
delete enemy.ownerPlayerId;
const battle=(own=hero,others=[enemy]):BattleSnapshot=>({id:"battle",round:1,activeCombatantId:own.id,turnOrder:[own.id,...others.map(x=>x.id)],cells:[],blockedCells:[],coverCells:[],combatants:[own,...others],finished:false});
function button(selector:string){const value=document.querySelector<HTMLButtonElement>(selector);if(!value)throw new Error(`Missing ${selector}`);return value;}
afterEach(()=>document.body.replaceChildren());

it("uses only learned active techniques with a valid target, and guards a pending turn",()=>{
 const use=vi.fn(),view=new BattleWeaponSkills(use);document.body.append(view.element);const snapshot=battle();
 view.update(snapshot,hero,true);
 expect(button('[data-use-weapon-skill]').disabled).toBe(false);
 button('[data-use-weapon-skill]').click();button('[data-use-weapon-skill]').click();
 expect(use).toHaveBeenCalledExactlyOnceWith("sword:power","enemy");
 view.update(snapshot,hero,false);expect(button('[data-use-weapon-skill]').disabled).toBe(true);
 const waiting={...hero,weaponSkillCooldowns:{"sword:power":2} as Partial<Record<WeaponSkillId,number>>};
 view.update(battle(waiting),waiting,true);
 expect(button('[data-use-weapon-skill]').disabled).toBe(true);
 expect(document.querySelector('[data-skill-battle-preview]')?.textContent).toContain("2");
 view.destroy();
});

it("allows selecting a living ally for staff techniques and preserves the target after snapshots",()=>{
 const use=vi.fn(),view=new BattleWeaponSkills(use);document.body.append(view.element);
 const healer={...hero,weaponSkills:["staff:power"] as WeaponSkillId[]};const ally={...hero,id:"ally",name:"Borys",hp:30,weaponSkills:[],position:{q:1,r:0}};
 view.update(battle(healer,[ally,enemy]),healer,true);
 const target=document.querySelector<HTMLSelectElement>('[data-skill-target]')!;
 expect([...target.options].map(x=>x.value)).toEqual(["hero","ally"]);
 target.value="ally";target.dispatchEvent(new Event("change"));
 view.update(battle(healer,[{...ally,hp:25},enemy]),healer,true);
 expect(document.querySelector<HTMLSelectElement>('[data-skill-target]')?.value).toBe("ally");
 button('[data-use-weapon-skill]').click();expect(use).toHaveBeenCalledExactlyOnceWith("staff:power","ally");
 view.destroy();
});

it("keeps compact techniques in a temporary overlay and closes it with phone Back",()=>{
 const view=new BattleWeaponSkills(vi.fn());document.body.append(view.element);view.setCompact(true);view.update(battle(),hero,true);
 expect(document.querySelector<HTMLElement>('.battle-weapon-skills__panel')?.hidden).toBe(true);
 button('[data-toggle-skills]').click();expect(document.querySelector<HTMLElement>('.battle-weapon-skills__panel')?.hidden).toBe(false);
 const back=new Event("game-ui-back",{cancelable:true});document.dispatchEvent(back);
 expect(back.defaultPrevented).toBe(true);expect(document.querySelector<HTMLElement>('.battle-weapon-skills__panel')?.hidden).toBe(true);view.destroy();
});
