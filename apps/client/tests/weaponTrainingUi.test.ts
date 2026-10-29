/* @vitest-environment jsdom */
import type { CharacterSnapshot } from "@web-mmorpg/shared";
import { afterEach, expect, it, vi } from "vitest";
import { CharacterPanel } from "../src/ui/CharacterPanel";

const character:CharacterSnapshot={playerId:"hero",nickname:"Alicja",level:1,hp:100,maxHp:100,maxAp:5,initiative:10,severelyInjured:false,injuries:[]};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
afterEach(()=>document.body.replaceChildren());

it("keeps pointer events inside the character panel from reaching world input listeners",()=>{
  const panel=new CharacterPanel();panel.update(character);panel.show();
  const worldPointer=vi.fn();
  const types=["pointerdown","pointerup","mousedown","mouseup","touchstart","touchend"];
  for(const type of types)document.addEventListener(type,worldPointer);
  try {
    const select=document.querySelector<HTMLSelectElement>("[data-weapon-melee]")!;
    for(const type of types)select.dispatchEvent(new Event(type,{bubbles:true}));
    expect(worldPointer).not.toHaveBeenCalled();
    document.body.dispatchEvent(new Event("pointerup",{bubbles:true}));
    expect(worldPointer).toHaveBeenCalledTimes(1);
  }finally{
    for(const type of types)document.removeEventListener(type,worldPointer);
    panel.destroy();
  }
});

it("shows separate weapon levels, earned progress and damage bonuses with legacy defaults",()=>{
  const panel=new CharacterPanel();panel.update(character);panel.show();
  expect(document.querySelectorAll("[data-weapon-family]")).toHaveLength(9);
  expect(document.querySelector<HTMLSelectElement>("[data-weapon-melee]")?.value).toBe("sword");
  expect(document.querySelector<HTMLSelectElement>("[data-weapon-ranged]")?.value).toBe("bow");
  expect(document.querySelector('[data-weapon-family="sword"]')?.textContent).toContain("0/100");
  panel.update({...character,weaponTraining:{experience:{sword:5,axe:0,hammer:0,dagger:0,spear:0,bow:25250,crossbow:0,staff:0,shield:0},loadout:{melee:"sword",ranged:"bow"}}});
  expect(document.querySelector('[data-weapon-family="sword"] [data-weapon-level]')?.textContent).toBe("1/100");
  expect(document.querySelector('[data-weapon-family="sword"] [data-weapon-bonus]')?.textContent).toContain("0,25%");
  expect(document.querySelector('[data-weapon-family="bow"] [data-weapon-level]')?.textContent).toBe("100/100");
  expect(document.querySelector('[data-weapon-family="bow"] [role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("100");
  expect(document.querySelector('[data-weapon-family="axe"] [data-weapon-level]')?.textContent).toBe("0/100");
  expect(document.querySelector('[data-stat="rangedDamage"]')?.textContent).toBe("19");
  panel.destroy();
});

it("saves explicit styles once, keeps unsaved selection on updates, and applies only acknowledged character state",async()=>{
  const result=deferred<any>(),request=vi.fn(()=>result.promise),changed=vi.fn();
  const panel=new CharacterPanel({onSetWeaponLoadout:request,onChanged:changed});panel.update(character);panel.show();
  const melee=document.querySelector<HTMLSelectElement>("[data-weapon-melee]")!;
  melee.value="axe";melee.dispatchEvent(new Event("change",{bubbles:true}));
  panel.update({...character,hp:99});
  expect(document.querySelector<HTMLSelectElement>("[data-weapon-melee]")?.value).toBe("axe");
  document.querySelector<HTMLButtonElement>("[data-save-weapon-style]")!.click();
  document.querySelector<HTMLButtonElement>("[data-save-weapon-style]")!.click();
  expect(request).toHaveBeenCalledExactlyOnceWith({melee:"axe",ranged:"bow"});
  expect(document.querySelector<HTMLSelectElement>("[data-weapon-melee]")?.matches(":disabled")).toBe(true);
  expect(changed).not.toHaveBeenCalled();
  const acknowledged={...character,hp:99,weaponTraining:{experience:{sword:0,axe:0,hammer:0,dagger:0,spear:0,bow:0,crossbow:0,staff:0,shield:0},loadout:{melee:"axe",ranged:"bow"}}};
  result.resolve({ok:true,character:acknowledged});await vi.waitFor(()=>expect(changed).toHaveBeenCalledExactlyOnceWith(acknowledged));
  expect(document.querySelector<HTMLButtonElement>("[data-save-weapon-style]")?.disabled).toBe(false);
  panel.destroy();
});

it("shows a rejected save and ignores a late acknowledgement after closing or destroying the panel",async()=>{
  const changed=vi.fn(),result=deferred<any>();
  const request=vi.fn().mockResolvedValueOnce({ok:false,code:"IN_BATTLE",message:"Zmiana stylu podczas walki jest niedostępna."}).mockReturnValueOnce(result.promise);
  const panel=new CharacterPanel({onSetWeaponLoadout:request,onChanged:changed});panel.update(character);panel.show();
  document.querySelector<HTMLButtonElement>("[data-save-weapon-style]")!.click();
  await vi.waitFor(()=>expect(document.querySelector("[data-weapon-style-status]")?.textContent).toContain("podczas walki"));
  expect(changed).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>("[data-save-weapon-style]")!.click();panel.hide();panel.show();
  expect(document.querySelector<HTMLButtonElement>("[data-save-weapon-style]")?.disabled).toBe(false);
  panel.destroy();
  result.resolve({ok:true,character:{...character,nickname:"Late"}});await Promise.resolve();await Promise.resolve();
  expect(changed).not.toHaveBeenCalled();
});

it("selects support and defense styles and describes their distinct bonuses",async()=>{
 const request=vi.fn().mockResolvedValue({ok:false,code:"TEST",message:"Brak"});
 const panel=new CharacterPanel({onSetWeaponLoadout:request,onChanged:vi.fn()});panel.update(character);panel.show();
 expect(document.querySelector('[data-weapon-family="staff"] [data-weapon-bonus]')?.textContent).toContain("leczenia");
 expect(document.querySelector('[data-weapon-family="shield"] [data-weapon-bonus]')?.textContent).toContain("redukcji");
 for(const [mode,value] of [["support","staff"],["defense","shield"]]){
  const select=document.querySelector<HTMLSelectElement>(`[data-weapon-${mode}]`)!;select.value=value!;select.dispatchEvent(new Event("change",{bubbles:true}));
 }
 panel.update({...character,hp:80});
 expect(document.querySelector<HTMLSelectElement>('[data-weapon-support]')?.value).toBe("staff");
 document.querySelector<HTMLButtonElement>('[data-save-weapon-style]')!.click();
 expect(request).toHaveBeenCalledWith({melee:"sword",ranged:"bow",support:"staff",defense:"shield"});panel.destroy();
});
