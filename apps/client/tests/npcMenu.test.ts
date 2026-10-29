/* @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { NpcMenu } from "../src/ui/NpcMenu";

afterEach(()=>{document.body.replaceChildren();vi.restoreAllMocks();});

it("waits for a conversation choice and only offers a shop for a merchant",()=>{
  const onSelect=vi.fn(()=>expect(document.querySelector<HTMLElement>("[data-npc-menu]")?.hidden).toBe(true));
  const menu=new NpcMenu({onSelect});
  menu.show({id:"boran",name:"Boran",kind:"guide"},{x:300,y:250});
  expect(onSelect).not.toHaveBeenCalled();
  const shop=document.querySelector<HTMLButtonElement>('[data-npc-action="shop"]')!;
  expect(shop.hidden).toBe(true);shop.click();expect(onSelect).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('[data-npc-action="talk"]')!.click();
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("boran","talk");
  menu.show({id:"miro",name:"Miro",kind:"merchant"},{x:300,y:250});
  expect(shop.hidden).toBe(false);shop.click();
  expect(onSelect).toHaveBeenLastCalledWith("miro","shop");
  menu.destroy();
});

it("replaces merchant options and renders NPC names as plain text",()=>{
  const onSelect=vi.fn(),menu=new NpcMenu({onSelect});
  menu.show({id:"miro",name:"Miro",kind:"merchant"},{x:300,y:250});
  const staleShop=document.querySelector<HTMLButtonElement>('[data-npc-action="shop"]')!;
  menu.show({id:"ada",name:"<img src=x onerror=alert(1)>",kind:"healer"},{x:300,y:250});
  expect(document.querySelector("[data-npc-menu] img")).toBeNull();
  expect(document.querySelector("[data-npc-label]")?.textContent).toBe("<img src=x onerror=alert(1)>");
  staleShop.click();expect(onSelect).not.toHaveBeenCalled();
  document.querySelector<HTMLButtonElement>('[data-npc-action="talk"]')!.click();
  expect(onSelect).toHaveBeenCalledExactlyOnceWith("ada","talk");
  menu.destroy();
});

it("stays in the viewport and closes outside, on Escape and after destruction without sending actions",()=>{
  const onSelect=vi.fn(),menu=new NpcMenu({onSelect});
  const npc={id:"miro",name:"Miro",kind:"merchant" as const};
  menu.show(npc,{x:window.innerWidth-1,y:window.innerHeight-1});
  const panel=document.querySelector<HTMLElement>("[data-npc-menu]")!;
  expect(parseFloat(panel.style.left)+208).toBeLessThanOrEqual(window.innerWidth);
  expect(parseFloat(panel.style.top)+128).toBeLessThanOrEqual(window.innerHeight);
  menu.reposition({x:0,y:0});expect(parseFloat(panel.style.left)).toBeGreaterThanOrEqual(0);
  expect(parseFloat(panel.style.top)).toBeGreaterThanOrEqual(0);
  document.body.dispatchEvent(new Event("pointerdown",{bubbles:true}));expect(panel.hidden).toBe(true);
  menu.show(npc,{x:300,y:250});
  document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));expect(panel.hidden).toBe(true);
  menu.show(npc,{x:300,y:250});
  const talk=document.querySelector<HTMLButtonElement>('[data-npc-action="talk"]')!;
  menu.destroy();talk.click();
  expect(document.querySelector("[data-npc-menu]")).toBeNull();expect(onSelect).not.toHaveBeenCalled();
});
