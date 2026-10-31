/* @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { EncounterMenu } from "../src/ui/EncounterMenu";

afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();});

it("blocks unavailable encounters and refreshes an open menu without granting early respawn",()=>{
  const onSelect=vi.fn();const menu=new EncounterMenu({onSelect});
  menu.show({id:"boar",label:"Dzik",status:"respawning",respawnAt:181000},{x:300,y:250},1000);
  const attack=document.querySelector<HTMLButtonElement>('[data-encounter-mode="manual"]')!;
  expect(attack.disabled).toBe(true);
  expect(document.querySelector('[data-encounter-status]')?.textContent).toContain("03:00");
  attack.click();expect(onSelect).not.toHaveBeenCalled();
  menu.update({id:"boar",label:"Dzik",status:"respawning",respawnAt:181000},182000);
  expect(attack.disabled).toBe(true);
  menu.update({id:"boar",label:"Dzik",status:"alive"},182000);
  expect(attack.disabled).toBe(false);
  attack.click();expect(onSelect).toHaveBeenCalledExactlyOnceWith("boar","manual");
  menu.destroy();
});

it("waits for an explicit battle choice and closes before dispatching the selected mode",()=>{
  const onSelect=vi.fn(()=>expect(document.querySelector<HTMLElement>("[data-encounter-menu]")?.hidden).toBe(true));
  const menu=new EncounterMenu({onSelect});
  menu.show({id:"wolves",label:"Wilki"},{x:300,y:250});
  expect(onSelect).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('[data-encounter-mode="manual"]')!.click();
  expect(onSelect).toHaveBeenLastCalledWith("wolves","manual");
  menu.show({id:"wolves-2",label:"<img src=x onerror=alert(1)>"},{x:300,y:250});
  expect(document.querySelector("[data-encounter-menu] img")).toBeNull();
  document.querySelector<HTMLButtonElement>('[data-encounter-mode="auto"]')!.click();
  expect(onSelect).toHaveBeenLastCalledWith("wolves-2","auto");
  menu.destroy();
});

it("clamps and repositions the menu inside the viewport and dismisses outside or Escape without starting combat",()=>{
  const onSelect=vi.fn();const menu=new EncounterMenu({onSelect});
  menu.show({id:"wolves",label:"Wilki"},{x:window.innerWidth-1,y:window.innerHeight-1});
  const panel=document.querySelector<HTMLElement>("[data-encounter-menu]")!;
  expect(parseFloat(panel.style.left)).toBeGreaterThanOrEqual(0);
  expect(parseFloat(panel.style.left)+208).toBeLessThanOrEqual(window.innerWidth);
  expect(parseFloat(panel.style.top)+128).toBeLessThanOrEqual(window.innerHeight);
  menu.reposition({x:15,y:10});
  expect(parseFloat(panel.style.top)).toBeGreaterThanOrEqual(0);
  document.body.dispatchEvent(new Event("pointerdown",{bubbles:true}));
  expect(panel.hidden).toBe(true);
  menu.show({id:"wolves",label:"Wilki"},{x:300,y:250});
  document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
  expect(panel.hidden).toBe(true);expect(onSelect).not.toHaveBeenCalled();
  menu.destroy();expect(document.querySelector("[data-encounter-menu]")).toBeNull();
});


it("preserves original enemy details while current respawn gating remains authoritative",()=>{
  const selected=vi.fn(),menu=new EncounterMenu({onSelect:selected});
  menu.show({id:"feral-rat-01",label:"Przeciwnik",enemyId:"feral-rat",status:"respawning",respawnAt:181000},{x:300,y:250},1000);
  const details=document.querySelector<HTMLElement>("[data-encounter-details]")!;
  expect(details?.hidden).toBe(false);expect(details?.textContent).toContain("Wielki szczur");
  const stats=Object.fromEntries([...details.querySelectorAll("dt")].map(term=>[term.textContent,term.nextElementSibling?.textContent]));
  expect(stats).toEqual({"Poziom":"1","Zalecany poziom":"1–2","HP":"110","Obrażenia wręcz":"9","Obrażenia dystansowe":"0","Pancerz":"0","PD":"40"});
  expect(document.querySelector('[data-encounter-label]')?.textContent).toBe("Zdziczały szczur");
  const attack=document.querySelector<HTMLButtonElement>('[data-encounter-mode="manual"]')!;expect(attack.disabled).toBe(true);expect(document.querySelector('[data-encounter-status]')?.textContent).toContain("03:00");
  menu.update({id:"feral-rat-01",label:"Przeciwnik",enemyId:"feral-rat",status:"alive"},182000);attack.click();expect(selected).toHaveBeenCalledWith("feral-rat-01","manual");
  menu.show({id:"wolves",label:"Wilki"},{x:300,y:250});expect(details.hidden).toBe(true);expect(details.textContent).toBe("");menu.destroy();
});
