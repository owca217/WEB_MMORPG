/* @vitest-environment jsdom */
import { MAX_WEAPON_EXPERIENCE, normalizeWeaponTraining, type CharacterSnapshot } from "@web-mmorpg/shared";
import { afterEach, expect, it, vi } from "vitest";
import { CharacterPanel } from "../src/ui/CharacterPanel";
import { WeaponSkillTreeView } from "../src/ui/WeaponSkillTreeView";

const training=normalizeWeaponTraining({experience:{sword:MAX_WEAPON_EXPERIENCE,staff:MAX_WEAPON_EXPERIENCE}});
const hero:CharacterSnapshot={playerId:"hero",nickname:"Alicja",level:2,hp:100,maxHp:130,maxAp:5,initiative:10,severelyInjured:false,injuries:[],weaponTraining:training};
function button(selector:string){const value=document.querySelector<HTMLButtonElement>(selector);if(!value)throw new Error(`Missing ${selector}`);return value;}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
afterEach(()=>document.body.replaceChildren());

it("shows separate point budgets, prerequisites and keeps the selected family on snapshot updates",()=>{
 const view=new WeaponSkillTreeView({onLearn:vi.fn(),onReset:vi.fn()});document.body.append(view.element);
 view.update(training,{editable:true,busy:false});
 expect(document.querySelector('[data-skill-points]')?.textContent).toContain("20");
 expect(button('[data-learn-skill="sword:ultimate"]').disabled).toBe(true);
 expect(document.querySelector('[data-skill-node="sword:ultimate"]')?.textContent).toContain("Najpierw");
 button('[data-skill-family="staff"]').click();
 view.update(training,{editable:true,busy:true});
 expect(button('[data-skill-family="staff"]').getAttribute("aria-pressed")).toBe("true");
 expect(button('[data-learn-skill="staff:power"]').disabled).toBe(true);
 view.update({...training,learnedSkills:["staff:power"]},{editable:true,busy:false});
 expect(button('[data-reset-skills]').disabled).toBe(false);
 expect(document.querySelector('[data-skill-points]')?.textContent).toContain("18");
 expect(button('[data-learn-skill="staff:ultimate"]').disabled).toBe(false);
});

it("learns once, waits for authoritative results, and ignores a late reply after character replacement",async()=>{
 const gate=deferred<any>(),learn=vi.fn().mockReturnValue(gate.promise),changed=vi.fn();
 const panel=new CharacterPanel({onSetEquipmentSlot:vi.fn(),onLearnWeaponSkill:learn,onResetWeaponSkills:vi.fn(),onSkillsChanged:changed});
 panel.update(hero);panel.show();button('[data-character-tab="proficiency"]').click();
 button('[data-learn-skill="sword:power"]').click();button('[data-learn-skill="sword:power"]').click();
 expect(learn).toHaveBeenCalledExactlyOnceWith("sword:power");
 expect(document.querySelector('[data-skill-node="sword:power"]')?.getAttribute("data-learned")).toBe("false");
 panel.update({...hero,playerId:"other"});
 gate.resolve({ok:true,character:{...hero,weaponTraining:{...training,learnedSkills:["sword:power"]}}});
 await Promise.resolve();await Promise.resolve();
 expect(changed).not.toHaveBeenCalled();
 expect(document.querySelector('[data-skill-node="sword:power"]')?.getAttribute("data-learned")).toBe("false");panel.destroy();
});
