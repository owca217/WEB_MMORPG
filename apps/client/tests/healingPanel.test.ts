/* @vitest-environment jsdom */
import { afterEach,expect,it,vi } from "vitest";
import { HealingPanel } from "../src/ui/HealingPanel";
const targets={ok:true as const,healingPower:20,cooldownMs:0,targets:[{id:"self",nickname:"Alicja",hp:50,maxHp:100,available:true},{id:"ally",nickname:"Borys",hp:70,maxHp:100,available:true},{id:"far",nickname:"Daleko",hp:40,maxHp:100,available:false,reason:"Poza zasięgiem"}]};
afterEach(()=>{document.body.replaceChildren();vi.useRealTimers();});
it("shows authoritative party targets, guards unavailable targets and retries uncertain healing with the same request",async()=>{
 const cast=vi.fn().mockResolvedValueOnce({ok:false,code:"HEAL_REQUEST_UNCERTAIN",message:"Sprawdź wynik"}).mockResolvedValueOnce({ok:true,requestId:"",targetId:"ally",restoredHp:20,cooldownMs:10000});
 const panel=new HealingPanel({requestTargets:vi.fn().mockResolvedValue(targets),cast});await panel.show();
 expect(document.querySelector('[data-heal-target="far"]')?.textContent).toContain("Poza zasięgiem");
 expect(document.querySelector<HTMLButtonElement>('[data-heal-target="far"]')?.disabled).toBe(true);
 document.querySelector<HTMLButtonElement>('[data-heal-target="ally"]')!.click();
 await vi.waitFor(()=>expect(document.querySelector('[data-healing-feedback]')?.textContent).toContain("Sprawdź wynik"));
 document.querySelector<HTMLButtonElement>('[data-heal-target="ally"]')!.click();
 await vi.waitFor(()=>expect(cast).toHaveBeenCalledTimes(2));
 expect(cast.mock.calls[1]?.[0]).toEqual(cast.mock.calls[0]?.[0]);
 expect(cast.mock.calls[0]?.[0]).toMatchObject({targetId:"ally"});panel.destroy();
});
it("ignores target responses after closing and consumes real mouse/touch input",async()=>{
 let finish!:(value:typeof targets)=>void;const late=new Promise<typeof targets>(resolve=>{finish=resolve;});
 const panel=new HealingPanel({requestTargets:()=>late,cast:vi.fn()});const opening=panel.show();
 const world=vi.fn();document.addEventListener("mouseup",world);
 document.querySelector('[data-healing-panel]')!.dispatchEvent(new Event("mouseup",{bubbles:true}));expect(world).not.toHaveBeenCalled();
 document.removeEventListener("mouseup",world);panel.hide();finish(targets);await opening;
 expect(document.querySelector<HTMLElement>('[data-healing-panel]')?.hidden).toBe(true);panel.destroy();
});
