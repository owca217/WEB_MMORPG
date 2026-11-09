/* @vitest-environment jsdom */
import { MAX_WEAPON_EXPERIENCE, normalizeWeaponTraining, type CharacterSnapshot } from '@web-mmorpg/shared';
import { afterEach, expect, it, vi } from 'vitest';
import { SpecializationPanel } from '../src/ui/SpecializationPanel';
import { closeForegroundGamePanel, isGameWindowOpen } from '../src/ui/gameWindows';
const training=normalizeWeaponTraining({experience:{sword:MAX_WEAPON_EXPERIENCE,staff:MAX_WEAPON_EXPERIENCE}});
const hero:CharacterSnapshot={playerId:'hero',nickname:'Alicja',level:90,hp:100,maxHp:100,maxAp:5,initiative:10,severelyInjured:false,injuries:[],weaponTraining:training};
function button(selector:string){const value=document.querySelector<HTMLButtonElement>(selector);if(!value)throw new Error(`Missing ${selector}`);return value;}
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
function handlers(){return {onLearnWeaponSkill:vi.fn(),onResetWeaponSkills:vi.fn(),onLearnArmorSkill:vi.fn(),onResetArmorSkills:vi.fn()};}
afterEach(()=>document.body.replaceChildren());
it('opens an independent radial board and preserves family, node, camera and action status through snapshots',async()=>{
 const actions=handlers(),gate=deferred<any>();actions.onLearnWeaponSkill.mockReturnValue(gate.promise);
 const panel=new SpecializationPanel(actions);panel.update(hero);panel.show();
 expect(isGameWindowOpen()).toBe(true);expect(document.querySelectorAll('[data-skill-family]')).toHaveLength(13);
 expect(document.querySelectorAll('[data-specialization-node]')).toHaveLength(52);
 button('[data-skill-family="staff"]').click();button('[data-specialization-node="staff:power"]').click();
 button('[data-zoom-in]').click();const transform=document.querySelector<HTMLElement>('[data-specialization-map]')!.style.transform;
 button('[data-learn-skill="staff:power"]').click();button('[data-learn-skill="staff:power"]').click();
 expect(actions.onLearnWeaponSkill).toHaveBeenCalledExactlyOnceWith('staff:power');
 expect(button('[data-learn-skill="staff:power"]').disabled).toBe(true);
 gate.resolve({ok:true,character:{...hero,weaponTraining:{...training,learnedSkills:['staff:power']}}});await Promise.resolve();await Promise.resolve();
 panel.update({...hero,weaponTraining:{...training,learnedSkills:['staff:power']}});
 expect(button('[data-skill-family="staff"]').getAttribute('aria-pressed')).toBe('true');
 expect(button('[data-specialization-node="staff:power"]').getAttribute('aria-pressed')).toBe('true');
 expect(document.querySelector<HTMLElement>('[data-specialization-map]')!.style.transform).toBe(transform);
 expect(document.querySelector('[data-skill-status]')?.textContent).toContain('Nauczono');
 expect(button('[data-reset-skills]').disabled).toBe(false);expect(closeForegroundGamePanel()).toBe(true);expect(isGameWindowOpen()).toBe(false);panel.destroy();
});
it('routes armor learning and resetting through separate authoritative handlers',async()=>{
 const actions=handlers();actions.onLearnArmorSkill.mockResolvedValue({ok:true,character:{...hero,armorTraining:{experience:{cloth:MAX_WEAPON_EXPERIENCE,leather:0,plate:0},learnedSkills:['cloth:power']}}});
 actions.onResetArmorSkills.mockResolvedValue({ok:true,character:{...hero,armorTraining:{experience:{cloth:MAX_WEAPON_EXPERIENCE,leather:0,plate:0},learnedSkills:[]}}});
 const panel=new SpecializationPanel(actions);panel.update({...hero,armorTraining:{experience:{cloth:MAX_WEAPON_EXPERIENCE,leather:0,plate:0}}});panel.show();
 button('[data-skill-family="cloth"]').click();button('[data-specialization-node="cloth:power"]').click();button('[data-learn-skill="cloth:power"]').click();await Promise.resolve();await Promise.resolve();
 expect(actions.onLearnArmorSkill).toHaveBeenCalledExactlyOnceWith('cloth:power');button('[data-reset-skills]').click();await Promise.resolve();await Promise.resolve();
 expect(actions.onResetArmorSkills).toHaveBeenCalledExactlyOnceWith('cloth');expect(document.querySelector('[data-skill-status]')?.textContent).toContain('Zresetowano');panel.destroy();
});
it('blocks pointer propagation, supports keyboard camera controls and ignores replies after close or character replacement',async()=>{
 const actions=handlers(),gate=deferred<any>(),changed=vi.fn();actions.onLearnWeaponSkill.mockReturnValue(gate.promise);
 const panel=new SpecializationPanel({...actions,onChanged:changed});panel.update(hero);panel.show();const listener=vi.fn();document.addEventListener('pointerdown',listener);
 button('[data-specialization-node="sword:power"]').dispatchEvent(new Event('pointerdown',{bubbles:true}));expect(listener).not.toHaveBeenCalled();document.removeEventListener('pointerdown',listener);
 const viewport=document.querySelector<HTMLElement>('[data-specialization-viewport]')!;viewport.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));expect(document.querySelector<HTMLElement>('[data-specialization-map]')!.style.transform).toContain('-40px');
 button('[data-specialization-node="sword:power"]').click();button('[data-learn-skill="sword:power"]').click();panel.hide();panel.update({...hero,playerId:'other'});gate.resolve({ok:true,character:hero});await Promise.resolve();await Promise.resolve();expect(changed).not.toHaveBeenCalled();panel.destroy();
});
