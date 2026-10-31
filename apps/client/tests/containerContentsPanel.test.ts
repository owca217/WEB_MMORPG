/* @vitest-environment jsdom */
import type { CharacterSnapshot, InventoryItem, InventorySnapshot, InventoryUpdateResult } from "@web-mmorpg/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ContainerContentsPanel } from "../src/ui/ContainerContentsPanel";
import { CharacterPanel } from "../src/ui/CharacterPanel";
import { closeForegroundGamePanel, isGameWindowOpen } from "../src/ui/gameWindows";
function item(instanceId: string, changes: Partial<InventoryItem> = {}): InventoryItem { return { instanceId, itemId: instanceId, itemDefinitionId: instanceId, name: `Przedmiot ${instanceId}`, quantity: 1, category: "material", description: "Opis", rarity: "COMMON", upgradeLevel: 0, ...changes }; }
function bag(instanceId = "pack", capacity = 16): InventoryItem { return item(instanceId, { name: instanceId === "pack" ? "Plecak podróżnika" : "Torba", category: "container", containerCapacity: capacity, ...(instanceId === "pack" ? { permanentContainer: true } : {}) }); }
function inventory(items: InventoryItem[]): InventorySnapshot { return { items, containerSlots: ["pack", "bag", null, null] }; }
function button(selector: string): HTMLButtonElement { const value = document.querySelector<HTMLButtonElement>(selector); if (!value)
    throw new Error(`Missing ${selector}`); return value; }
function inspect(id: string): void { button(`[data-container-item="${id}"]`).click(); }
function move(instanceId="wood",containerId="bag"): void {
    let target=document.querySelector<HTMLButtonElement>(`[data-container-drop-target="${containerId}"]`);
    if(!target){target=document.createElement("button");target.dataset.containerDropTarget=containerId;document.body.append(target);}
    button(`[data-container-item="${instanceId}"]`).dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true,cancelable:true}));
    target.focus();target.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));
}
const panels: ContainerContentsPanel[] = [];
function panel(handlers: Partial<ConstructorParameters<typeof ContainerContentsPanel>[0]> = {}): ContainerContentsPanel { const value = new ContainerContentsPanel({ onMoveItem: vi.fn(), onInventoryChanged: vi.fn(), onChangeContainer: vi.fn(), ...handlers }); panels.push(value); return value; }
function inlinePanel(handlers: Partial<ConstructorParameters<typeof ContainerContentsPanel>[0]> = {}): ContainerContentsPanel {
    const host=document.createElement("section");host.dataset.inlineInventoryHost="";document.body.append(host);
    const value=panel(handlers);value.mountInline(host);return value;
}
beforeEach(() => document.body.replaceChildren());
afterEach(() => { panels.splice(0).forEach(value => value.destroy()); vi.restoreAllMocks(); });

it("reserves explicit positions and fills only legacy unpositioned holes in stable order",()=>{
    const value=inlinePanel();value.update(inventory([bag(),item("legacy-a",{containerInstanceId:"pack"}),item("at-zero",{containerInstanceId:"pack",containerPosition:0}),item("legacy-b",{containerInstanceId:"pack"}),item("at-seven",{containerInstanceId:"pack",containerPosition:7})]));value.show(0);
    expect(document.querySelector('[data-container-item="at-zero"]')?.closest('[data-container-position]')?.getAttribute("data-container-position")).toBe("0");
    expect(document.querySelector('[data-container-item="legacy-a"]')?.closest('[data-container-position]')?.getAttribute("data-container-position")).toBe("1");
    expect(document.querySelector('[data-container-item="legacy-b"]')?.closest('[data-container-position]')?.getAttribute("data-container-position")).toBe("2");
    const empty=document.querySelector<HTMLElement>('[data-container-position="3"]')!;
    expect(empty.tabIndex).toBe(0);expect(empty.getAttribute("aria-label")).toContain("4");expect(empty.querySelector('[data-container-item]')).toBeNull();
    const occupied=document.querySelector<HTMLElement>('[data-container-position="7"]')!;
    expect(occupied.tabIndex).toBe(0);expect(occupied.getAttribute("aria-label")).toContain("Przedmiot at-seven");
    expect(document.querySelector('[data-container-grid]')?.hasAttribute("data-container-drop-target")).toBe(false);
});

it("keeps a moved item's old cell until its position acknowledgement leaves a persistent hole",async()=>{
    let finish!:(result:InventoryUpdateResult)=>void;
    const changed=vi.fn(),onMoveItem=vi.fn(()=>new Promise<InventoryUpdateResult>(resolve=>{finish=resolve;}));
    const value=inlinePanel({onMoveItem,onInventoryChanged:changed});
    const initial=inventory([bag(),item("wood",{containerInstanceId:"pack",containerPosition:1})]);value.update(initial);value.show(0);
    button('[data-container-item="wood"]').dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true,cancelable:true}));
    const target=document.querySelector<HTMLElement>('[data-container-position="9"]')!;target.focus();target.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));
    expect(onMoveItem).toHaveBeenCalledExactlyOnceWith("wood","pack",9);
    expect(document.querySelector('[data-container-item="wood"]')?.closest('[data-container-position]')?.getAttribute("data-container-position")).toBe("1");
    const updated=inventory([bag(),item("wood",{containerInstanceId:"pack",containerPosition:9})]);finish({ok:true,inventory:updated});
    await vi.waitFor(()=>expect(changed).toHaveBeenCalledWith(updated));
    expect(document.querySelector('[data-container-item="wood"]')?.closest('[data-container-position]')?.getAttribute("data-container-position")).toBe("9");
    expect(document.querySelector('[data-container-position="1"] [data-container-item]')).toBeNull();
});

it("applies an authoritative occupied-cell swap in a full bag without compacting its cells",async()=>{
    const children=Array.from({length:8},(_,index)=>item(`child-${index}`,{containerInstanceId:"bag",containerPosition:index}));
    const updated=inventory([bag(),bag("bag",8),...children.map((entry,index)=>({...entry,containerPosition:index===0?7:index===7?0:index}))]);
    const onMoveItem=vi.fn().mockResolvedValue({ok:true,inventory:updated}),value=inlinePanel({onMoveItem});value.update(inventory([bag(),bag("bag",8),...children]));value.show(1);
    button('[data-container-item="child-0"]').dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true,cancelable:true}));
    const target=document.querySelector<HTMLElement>('[data-container-position="7"]')!;target.focus();target.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));
    await vi.waitFor(()=>expect(document.querySelector('[data-container-position="7"] [data-container-item="child-0"]')).not.toBeNull());
    expect(onMoveItem).toHaveBeenCalledExactlyOnceWith("child-0","bag",7);expect(document.querySelector('[data-container-position="0"] [data-container-item="child-7"]')).not.toBeNull();expect(document.querySelectorAll('[data-storage-cell]')).toHaveLength(8);
});

it("uses global target positions on later pages and keeps explicit holes before them",async()=>{
    const updated=inventory([bag(),bag("bag",100),item("wood",{containerInstanceId:"bag",containerPosition:62})]);
    const onMoveItem=vi.fn().mockResolvedValue({ok:true,inventory:updated}),value=inlinePanel({onMoveItem});value.update(inventory([bag(),bag("bag",100),item("wood",{containerInstanceId:"bag",containerPosition:45})]));value.show(1);
    expect(document.querySelector('[data-container-item="wood"]')).toBeNull();button('[data-container-page-next]').click();
    expect(document.querySelector('[data-container-position="45"] [data-container-item="wood"]')).not.toBeNull();
    button('[data-container-item="wood"]').dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true,cancelable:true}));
    const target=document.querySelector<HTMLElement>('[data-container-position="62"]')!;target.focus();target.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));
    await vi.waitFor(()=>expect(document.querySelector('[data-container-position="62"] [data-container-item="wood"]')).not.toBeNull());
    expect(onMoveItem).toHaveBeenCalledExactlyOnceWith("wood","bag",62);expect(document.querySelector('[data-container-position="45"] [data-container-item]')).toBeNull();
});
it("mounts full contents as an inline region and leaves focus and rail contents intact on show/hide",()=>{
    const launcher=document.createElement("button");document.body.append(launcher);launcher.focus();
    const value=inlinePanel();value.update(inventory([bag(),item("wood",{containerInstanceId:"pack"})]));value.show(0);
    const root=document.querySelector<HTMLElement>('[data-container-contents]')!;
    expect(root.parentElement?.hasAttribute("data-inline-inventory-host")).toBe(true);
    expect(root.getAttribute("role")).toBe("region");expect(root.classList.contains("game-panel")).toBe(false);
    expect(document.querySelector("body > .game-panel")).toBeNull();expect(isGameWindowOpen()).toBe(false);
    expect(button('[data-container-contents] [data-close]').hidden).toBe(true);
    expect(document.activeElement).toBe(launcher);value.hide();
    expect(root.classList.contains("is-hidden")).toBe(false);expect(document.querySelectorAll('[data-storage-cell]')).toHaveLength(16);
    expect(button('[data-container-item="wood"]')).toBeTruthy();expect(document.activeElement).toBe(launcher);
});
it("lets inline Escape reach the HUD while native Back closes detached details first",()=>{
    const value=inlinePanel();value.update(inventory([bag(),item("wood",{containerInstanceId:"pack"})]));value.show(0);
    const hudEscape=vi.fn(),host=document.querySelector('[data-inline-inventory-host]')!;
    host.addEventListener("keydown",hudEscape);
    button('[data-container-item="wood"]').dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));expect(hudEscape).toHaveBeenCalledOnce();
    inspect("wood");expect(isGameWindowOpen()).toBe(true);expect(closeForegroundGamePanel()).toBe(true);
    expect(isGameWindowOpen()).toBe(false);expect(document.activeElement).toBe(button('[data-container-item="wood"]'));
    inspect("wood");document.querySelector('[data-container-item-actions]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));
    expect(document.querySelector<HTMLElement>('[data-container-item-actions]')!.hidden).toBe(true);
    expect(hudEscape).toHaveBeenCalledOnce();expect(document.querySelector('[data-container-contents]')?.classList.contains("is-hidden")).toBe(false);
});
it("moves inline bag contents with busy slot locks and refreshes after a newer authoritative push",async()=>{
    let finish!:(result:InventoryUpdateResult)=>void;
    const changed=vi.fn(),refresh=vi.fn(),onMoveItem=vi.fn(()=>new Promise<InventoryUpdateResult>(resolve=>{finish=resolve;}));
    const value=inlinePanel({onMoveItem,onInventoryChanged:changed,onRefresh:refresh});
    const initial=inventory([bag(),bag("bag",8),item("wood",{containerInstanceId:"pack"})]);value.update(initial);value.show(0);
    move();expect(value.isBusy).toBe(true);value.show(1);value.showPending();
    expect(document.querySelector('[data-container-contents-title]')?.textContent).toBe("Plecak podróżnika");
    value.update(inventory([bag(),bag("bag",8),item("fresh",{containerInstanceId:"pack"})]));
    finish({ok:true,inventory:initial});await vi.waitFor(()=>expect(refresh).toHaveBeenCalledOnce());
    expect(value.isBusy).toBe(false);expect(changed).not.toHaveBeenCalled();expect(button('[data-container-item="fresh"]')).toBeTruthy();
    value.show(1);expect(document.querySelector('[data-container-grid] [data-container-position="0"]')?.getAttribute("data-container-drop-target")).toBe("bag");
});
it("opens inline pending from another bag and returns to the permanent backpack after a move",async()=>{
    const initial=inventory([bag(),bag("bag",8),item("wood")]);
    const updated=inventory([bag(),bag("bag",8),item("wood",{containerInstanceId:"pack"})]);
    const moved=vi.fn().mockResolvedValue({ok:true,inventory:updated});const value=inlinePanel({onMoveItem:moved});value.update(initial);value.show(1);value.showPending();
    expect(button('[data-container-pending]').getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelectorAll('[data-container-item]')).toHaveLength(1);move("wood","pack");
    await vi.waitFor(()=>expect(value.isBusy).toBe(false));expect(moved).toHaveBeenCalledExactlyOnceWith("wood","pack");
    expect(document.querySelectorAll('[data-storage-cell]')).toHaveLength(16);expect(isGameWindowOpen()).toBe(false);
});
it("equips inline through details, ignores an ACK invalidated by hide and unlocks the visible rail",async()=>{
    let finish!:(result:InventoryUpdateResult)=>void;
    const hero:CharacterSnapshot={playerId:"hero",nickname:"Hero",level:1,hp:100,maxHp:100,maxAp:5,initiative:10,severelyInjured:false,injuries:[]};
    const sword=item("sword",{containerInstanceId:"pack",equipment:{slot:"mainHand",weaponFamily:"sword",twoHanded:false,minimumLevel:1,modifiers:[]}});
    const changed=vi.fn(),equip=vi.fn(()=>new Promise<InventoryUpdateResult>(resolve=>{finish=resolve;}));
    const value=inlinePanel({onEquipItem:equip,onInventoryChanged:changed});const initial=inventory([bag(),sword]);value.update(initial,hero);value.show(0);
    inspect("sword");button('[data-container-equip="sword"]').click();expect(value.isBusy).toBe(true);value.hide();
    expect(value.isBusy).toBe(false);expect(button('[data-container-item="sword"]').disabled).toBe(false);
    finish({ok:true,inventory:inventory([bag()])});await Promise.resolve();await Promise.resolve();expect(changed).not.toHaveBeenCalled();
    expect(button('[data-container-item="sword"]')).toBeTruthy();expect(document.querySelector('[data-container-contents-feedback][data-state="pending"]')).toBeNull();
});
it("cancels an inline drag or detached details on rail collapse without dropping a live equipment ACK",async()=>{
    let finish!:(result:InventoryUpdateResult)=>void;
    const hero:CharacterSnapshot={playerId:"hero",nickname:"Hero",level:1,hp:100,maxHp:100,maxAp:5,initiative:10,severelyInjured:false,injuries:[]};
    const sword=item("sword",{containerInstanceId:"pack",equipment:{slot:"mainHand",weaponFamily:"sword",twoHanded:false,minimumLevel:1,modifiers:[]}});
    const equipped={...sword,equippedSlot:"mainHand" as const};delete equipped.containerInstanceId;
    const changed=vi.fn(),value=inlinePanel({onEquipItem:()=>new Promise(resolve=>{finish=resolve;}),onInventoryChanged:changed});value.update(inventory([bag(),sword]),hero);value.show(0);
    button('[data-container-item="sword"]').dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true,cancelable:true}));
    expect(value.isBusy).toBe(true);expect(document.querySelector('[data-inventory-drag-ghost]')).not.toBeNull();value.cancelInteraction();
    expect(value.isBusy).toBe(false);expect(document.querySelector('[data-inventory-drag-ghost]')).toBeNull();
    inspect("sword");button('[data-container-equip="sword"]').click();value.cancelInteraction();
    expect(value.isBusy).toBe(true);expect(document.querySelector<HTMLElement>('[data-container-item-actions]')!.hidden).toBe(true);
    const updated=inventory([bag(),equipped]);finish({ok:true,inventory:updated});await vi.waitFor(()=>expect(changed).toHaveBeenCalledExactlyOnceWith(updated));
    expect(value.isBusy).toBe(false);expect(document.querySelector('[data-container-item="sword"]')).toBeNull();expect(document.querySelectorAll('[data-storage-cell]')).toHaveLength(16);
});
it("clears the selected inline bag when switching to a missing permanent backpack",()=>{
    const value=inlinePanel();value.update(inventory([bag(),bag("bag",8),item("wood",{containerInstanceId:"bag"})]));value.show(1);
    value.update({items:[bag("bag",8),item("wood",{containerInstanceId:"bag"})],containerSlots:[null,"bag",null,null]});value.show(0);
    expect(document.querySelectorAll('[data-storage-cell]')).toHaveLength(0);
    expect(document.querySelector('[data-container-grid]')?.hasAttribute("data-container-drop-target")).toBe(false);
    expect(document.querySelector('[data-container-item="wood"]')).toBeNull();expect(document.querySelector<HTMLElement>('[data-container-contents-empty]')?.hidden).toBe(false);
    expect(document.querySelector('[data-container-contents]')?.classList.contains("is-hidden")).toBe(false);
});
it("consumes cancelable native Back only for an active inline drag and removes its listener on destroy",()=>{
    const value=inlinePanel();value.update(inventory([bag(),item("wood",{containerInstanceId:"pack"})]));value.show(0);
    button('[data-container-item="wood"]').dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true,cancelable:true}));
    expect(value.isBusy).toBe(true);document.dispatchEvent(new Event("game-ui-back"));expect(value.isBusy).toBe(true);
    const back=new Event("game-ui-back",{cancelable:true});document.dispatchEvent(back);
    expect(back.defaultPrevented).toBe(true);expect(value.isBusy).toBe(false);expect(document.querySelector('[data-inventory-drag-ghost]')).toBeNull();
    const idleBack=new Event("game-ui-back",{cancelable:true});document.dispatchEvent(idleBack);expect(idleBack.defaultPrevented).toBe(false);
    value.destroy();const destroyedBack=new Event("game-ui-back",{cancelable:true});document.dispatchEvent(destroyedBack);expect(destroyedBack.defaultPrevented).toBe(false);
    const modal=panel();modal.update(inventory([bag(),item("wood",{containerInstanceId:"pack"})]));modal.show(0);
    button('[data-container-item="wood"]').dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true,cancelable:true}));
    const modalBack=new Event("game-ui-back",{cancelable:true});document.dispatchEvent(modalBack);expect(modalBack.defaultPrevented).toBe(false);
});
it("renders only sixteen backpack cells and opens item actions without removing it", () => {
    const onMoveItem = vi.fn(), value = panel({ onMoveItem });
    value.update(inventory([bag(), item("medicine", { category: "medical", containerInstanceId: "pack", consumableEffects: { healHp: 30,restoreAp:2 } })]));
    value.show(0);
    expect(document.querySelectorAll("[data-storage-cell]")).toHaveLength(16);
    expect(document.querySelector("[data-container-candidates-section]")).toBeNull();
    expect(document.body.textContent).not.toContain("Włóż do pojemnika");
    expect(button("[data-change-container]").hidden).toBe(true);
    inspect("medicine");
    expect(onMoveItem).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLElement>("[data-container-item-actions]")?.hidden).toBe(false);
    expect(document.querySelector("[data-container-item-actions]")?.textContent).toContain("Do użycia w walce");
    expect(document.querySelector("[data-container-item-actions]")?.textContent).toContain("Ilość: 1");
    expect(document.querySelector("[data-container-item-actions]")?.textContent).toContain("30 HP");
    expect(document.querySelector("[data-container-item-actions]")?.textContent).toContain("2 PA");
    expect(document.querySelector("[data-container-move]")).toBeNull();expect(document.querySelector("[data-container-move-target]")).toBeNull();
});
it("shows only framed icons and a bottom-corner count for stacks while retaining accessible item names",()=>{
    const value=panel();value.update(inventory([bag(),item("single",{containerInstanceId:"pack",quality:"GOOD"}),item("stack",{containerInstanceId:"pack",quantity:37,quality:"PERFECT"})]));value.show(0);
    const single=button('[data-container-item="single"]'),stack=button('[data-container-item="stack"]');
    expect(single.querySelector("strong")).toBeNull();expect(single.querySelector("[data-container-quantity]")).toBeNull();expect(single.textContent?.trim()).toBe("");
    expect(single.querySelector(".inventory-item-icon")).not.toBeNull();expect(single.dataset.itemQuality).toBe("GOOD");expect(single.getAttribute("role")).toBeNull();expect(single.getAttribute("aria-label")).toContain("Przedmiot single ×1");
    expect(stack.querySelector("[data-container-quantity]")?.textContent).toBe("37");expect(stack.textContent?.trim()).toBe("37");expect(stack.dataset.itemQuality).toBe("PERFECT");expect(document.querySelector('[data-container-grid] [data-container-equip]')).toBeNull();
});
it("shows pending items in the header grid and returns when an acknowledged move empties it", async () => {
    const initial = inventory([bag(), bag("bag", 8), item("wood"), item("equipped", { equippedSlot: "mainHand" }), item("contained", { containerInstanceId: "pack" })]);
    let finish!: (result: InventoryUpdateResult) => void;
    const onMoveItem = vi.fn(() => new Promise<InventoryUpdateResult>(resolve => { finish = resolve; })), onInventoryChanged = vi.fn();
    const value = panel({ onMoveItem, onInventoryChanged });
    value.update(initial);
    value.show(0);
    expect(button("[data-container-pending]").textContent).toContain("Oczekujące (1)");
    button("[data-container-pending]").click();
    expect(document.querySelectorAll("[data-container-item]")).toHaveLength(1);
    inspect("wood");
    move("wood","pack");
    expect(onMoveItem).toHaveBeenCalledExactlyOnceWith("wood", "pack");
    expect(button('[data-container-item="wood"]').disabled).toBe(true);
    const updated = inventory(initial.items.map(entry => entry.instanceId === "wood" ? { ...entry, containerInstanceId: "pack" } : entry));
    finish({ ok: true, inventory: updated });
    await vi.waitFor(() => expect(onInventoryChanged).toHaveBeenCalledWith(updated));
    expect(button("[data-container-pending]").hidden).toBe(true);
    expect(document.querySelectorAll("[data-storage-cell]")).toHaveLength(16);
    expect(button('[data-container-item="wood"]')).toBeTruthy();
});
it("moves stored items only to an explicit equipped bag and retains them on failure", async () => {
    const side = { ...bag("bag", 8), quantity: 5 },other=item("stone",{containerInstanceId:"pack"}), initial = inventory([bag(), side, item("wood", { containerInstanceId: "pack" }),other]);
    const onMoveItem = vi.fn().mockResolvedValueOnce({ ok: false, code: "CONTAINER_FULL", message: "Brak wolnego miejsca." }).mockResolvedValueOnce({ ok: true, inventory: inventory([bag(), side, item("wood", { containerInstanceId: "bag" }),other]) });
    const value = panel({ onMoveItem });
    value.update(initial);
    value.show(0);
    inspect("wood");
    expect(document.querySelector("[data-container-move-target]")).toBeNull();
    move();
    await vi.waitFor(() => expect(document.querySelector("[data-container-contents-feedback]")?.textContent).toContain("Brak wolnego miejsca"));
    expect(button('[data-container-item="wood"]')).toBeTruthy();
    inspect("stone");expect(document.querySelector('[data-container-item-actions]')?.textContent).not.toContain("Brak wolnego miejsca.");expect(document.querySelector('[data-container-contents-feedback]')?.textContent).toBe("");
    inspect("wood");
    move();
    await vi.waitFor(() => expect(document.querySelector('[data-container-item="wood"]')).toBeNull());
    expect(onMoveItem.mock.calls).toEqual([["wood", "bag"], ["wood", "bag"]]);
    inspect("stone");expect(document.querySelector('[data-container-item-actions]')?.textContent).not.toContain("Przeniesiono przedmiot.");expect(document.querySelector('[data-container-contents-feedback][data-state]')).toBeNull();
});
it("keeps overflow visible when bags are full and leaves only metadata in ordinary item details", () => {
    const full = Array.from({ length: 16 }, (_, index) => item(`child-${index}`, { containerInstanceId: "pack" }));
    const value = panel();
    value.update(inventory([bag(), ...full, item("overflow"), bag("nested", 8), item("inside", { containerInstanceId: "nested" })]));
    value.show(0);
    button("[data-container-pending]").click();
    inspect("overflow");
    expect(document.querySelector("[data-container-move]")).toBeNull();
    inspect("nested");
    expect(document.querySelector("[data-container-item-actions]")?.textContent).toContain("Pojemność: 8 miejsc");
    expect(document.querySelector("[data-container-move-target]")).toBeNull();
});
it("shows complete gear details and equips through the details action without moving it to hidden storage", async () => {
    const sword = item("sword", { category: "weapon", containerInstanceId: "pack",quality:"EXCELLENT",durability:4,maxDurability:9,boundToPlayerId:"hero",upgradeLevel:2,equipment: { slot: "mainHand", weaponFamily: "sword", twoHanded: false, minimumLevel: 1, modifiers: [{statCode:"PHYSICAL_DAMAGE",modifierType:"flat",value:6}] } }), equipped = { ...sword, equippedSlot: "mainHand" as const };
    delete equipped.containerInstanceId;
    const onMoveItem = vi.fn(), onEquipItem = vi.fn().mockResolvedValue({ ok: true, inventory: inventory([bag(), equipped]) });
    const value = panel({ onMoveItem, onEquipItem });
    value.update(inventory([bag(), sword]));
    value.show(0);
    expect(document.querySelector('[data-container-grid] [data-container-equip="sword"]')).toBeNull();
    inspect("sword");
    const details=document.querySelector('[data-container-item-actions]')!;
    expect(details.querySelector(".inventory-item-icon")).not.toBeNull();expect(details.textContent).toContain("Przedmiot sword");expect(details.textContent).toContain("Jakość: Znakomita");expect(details.textContent).toContain("Ilość: 1");expect(details.textContent).toContain("Obrażenia +6");expect(details.textContent).toContain("4/9");expect(details.textContent).toContain("Ulepszenie: +2");expect(details.textContent).toContain("Przypisany");
    const equip = button('[data-container-equip="sword"]');
    expect(equip.closest('[data-container-item]')).toBeNull();
    equip.click();
    await vi.waitFor(() => expect(onEquipItem).toHaveBeenCalledWith(sword));
    expect(onMoveItem).not.toHaveBeenCalled();
    expect(document.querySelector('[data-container-item="sword"]')).toBeNull();
});
it("equips through a gear drop target only after the character meets its requirements",async()=>{
    const sword=item("sword",{containerInstanceId:"pack",equipment:{slot:"mainHand",weaponFamily:"sword",twoHanded:false,minimumLevel:3,modifiers:[]}});
    const hero:CharacterSnapshot={playerId:"hero",nickname:"Hero",level:1,hp:100,maxHp:100,maxAp:5,initiative:10,severelyInjured:false,injuries:[]};
    const equipped={...sword,equippedSlot:"mainHand" as const};delete equipped.containerInstanceId;
    const onEquipItem=vi.fn().mockResolvedValue({ok:true,inventory:inventory([bag(),equipped])}),onMoveItem=vi.fn();
    const value=panel({onEquipItem,onMoveItem});value.update(inventory([bag(),sword]),hero);value.show(0);
    const target=document.createElement("article");target.dataset.equipmentDropTarget="mainHand";target.tabIndex=0;document.body.append(target);
    const attempt=()=>{button('[data-container-item="sword"]').dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true,cancelable:true}));target.focus();target.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));};
    attempt();expect(onEquipItem).not.toHaveBeenCalled();document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true,cancelable:true}));
    value.update(inventory([bag(),sword]),{...hero,level:3});attempt();
    await vi.waitFor(()=>expect(onEquipItem).toHaveBeenCalledExactlyOnceWith(sword));expect(onMoveItem).not.toHaveBeenCalled();
    expect(document.querySelector('[data-container-item="sword"]')).toBeNull();
});
it("keeps the backpack open while dropping onto the actual character equipment window",async()=>{
    const hero:CharacterSnapshot={playerId:"hero",nickname:"Hero",level:1,hp:100,maxHp:100,maxAp:5,initiative:10,severelyInjured:false,injuries:[]};
    const sword=item("sword",{containerInstanceId:"pack",equipment:{slot:"mainHand",weaponFamily:"sword",twoHanded:false,minimumLevel:1,modifiers:[]}});
    const equipped={...sword,equippedSlot:"mainHand" as const};delete equipped.containerInstanceId;
    const initial=inventory([bag(),sword]),onEquipItem=vi.fn().mockResolvedValue({ok:true,inventory:inventory([bag(),equipped])});
    const contents=panel({onEquipItem});contents.update(initial,hero);contents.show(0);
    const bagClose=button('[data-container-contents] [data-close]');bagClose.focus();
    const character=new CharacterPanel({onSetEquipmentSlot:vi.fn()});
    try{
        character.update(hero,initial);character.show();button('[data-character-tab="equipment"]').click();
        const target=document.querySelector<HTMLElement>('[data-equipment-drop-target="mainHand"]')!;
        button('[data-container-item="sword"]').dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true,cancelable:true}));
        target.focus();target.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));
        await vi.waitFor(()=>expect(onEquipItem).toHaveBeenCalledExactlyOnceWith(sword));
        character.hide();expect(document.activeElement).toBe(bagClose);
        expect(document.querySelector('[data-container-contents]')?.classList.contains("is-hidden")).toBe(false);
        expect(document.querySelectorAll('[data-storage-cell]')).toHaveLength(16);
    }finally{character.destroy();}
});
it("assigns a container from pending to a free HUD slot and preserves its contents",async()=>{
    const full=bag("pending-bag",8),child=item("inside",{containerInstanceId:full.instanceId});
    const initial:InventorySnapshot={items:[bag(),full,child],containerSlots:["pack",null,null,null]};
    const updated:InventorySnapshot={...initial,containerSlots:["pack",null,full.instanceId,null]};
    const onSetContainerSlot=vi.fn().mockResolvedValue({ok:true,inventory:updated}),onMoveItem=vi.fn(),onInventoryChanged=vi.fn();
    const value=panel({onSetContainerSlot,onMoveItem,onInventoryChanged});value.update(initial);value.show(0);button("[data-container-pending]").click();
    const target=document.createElement("button");target.dataset.containerSlotTarget="2";document.body.append(target);
    button('[data-container-item="pending-bag"]').dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true,cancelable:true}));
    target.focus();target.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true,cancelable:true}));
    await vi.waitFor(()=>expect(onInventoryChanged).toHaveBeenCalledWith(updated));
    expect(onSetContainerSlot).toHaveBeenCalledExactlyOnceWith(2,full.instanceId);expect(onMoveItem).not.toHaveBeenCalled();expect(button("[data-container-pending]").hidden).toBe(true);
});
it("dismisses stale selection and refreshes rather than applying an ACK after newer state", async () => {
    let finish!: (result: InventoryUpdateResult) => void;
    const onMoveItem = vi.fn(() => new Promise<InventoryUpdateResult>(resolve => { finish = resolve; })), onInventoryChanged = vi.fn(), onRefresh = vi.fn();
    const value = panel({ onMoveItem, onInventoryChanged, onRefresh });
    const initial = inventory([bag(), bag("bag", 8), item("wood", { containerInstanceId: "pack" })]);
    value.update(initial);
    value.show(0);
    inspect("wood");
    move();
    const newer = inventory([bag(), bag("bag", 8), item("fresh", { containerInstanceId: "pack" })]);
    value.update(newer);
    expect(document.querySelector<HTMLElement>("[data-container-item-actions]")?.hidden).toBe(true);
    finish({ ok: true, inventory: initial });
    await vi.waitFor(() => expect(onRefresh).toHaveBeenCalledOnce());
    expect(onInventoryChanged).not.toHaveBeenCalled();
    expect(button('[data-container-item="fresh"]')).toBeTruthy();
    expect(document.querySelector('[data-container-item="wood"]')).toBeNull();
    expect(document.querySelector('[data-container-contents-feedback][data-state="pending"]')).toBeNull();
    expect(document.querySelector<HTMLElement>('[data-container-item-actions]')?.hidden).toBe(true);
});
it("contains phone pointers, renders safe text, closes the popover by Escape and restores focus", () => {
    const trigger = document.createElement("button");
    document.body.append(trigger);
    trigger.focus();
    const value = panel();
    value.update(inventory([bag(), item("wood", { name: "<b>Drewno</b>", iconUrl: "/missing.png", containerInstanceId: "pack" })]));
    value.show(0);
    inspect("wood");
    const popover = document.querySelector<HTMLElement>("[data-container-item-actions]")!;
    expect(popover.closest(".game-panel")).toBeNull();
    expect(popover.querySelector("b")).toBeNull();
    expect(popover.textContent).toContain("<b>Drewno</b>");
    const listener = vi.fn();
    document.body.addEventListener("pointerup", listener);
    document.body.addEventListener("touchend", listener);
    popover.dispatchEvent(new Event("pointerup", { bubbles: true }));
    popover.dispatchEvent(new Event("touchend", { bubbles: true }));
    expect(listener).not.toHaveBeenCalled();
    popover.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(popover.hidden).toBe(true);
    expect(document.activeElement).toBe(button('[data-container-item="wood"]'));
    document.querySelector('[data-container-contents]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).toBe(trigger);
    document.body.removeEventListener("pointerup", listener);
    document.body.removeEventListener("touchend", listener);
});
it("paginates large ordinary containers and keeps their change action", () => {
    const onChangeContainer = vi.fn(), value = panel({ onChangeContainer });
    value.update(inventory([bag(), bag("bag", 10000), ...Array.from({ length: 41 }, (_, index) => item(`child-${index}`, { containerInstanceId: "bag" }))]));
    value.show(1);
    expect(document.querySelectorAll("[data-storage-cell]")).toHaveLength(40);
    button("[data-container-page-next]").click();
    expect(button('[data-container-item="child-40"]')).toBeTruthy();
    expect(document.querySelector('[data-container-item="child-0"]')).toBeNull();
    button("[data-change-container]").click();
    expect(onChangeContainer).toHaveBeenCalledWith(1);
});
it("ignores pending responses after changing character or destruction", async () => {
    let finish!: (result: InventoryUpdateResult) => void;
    const changed = vi.fn(), value = panel({ onMoveItem: () => new Promise(resolve => { finish = resolve; }), onInventoryChanged: changed });
    const character = (playerId: string): CharacterSnapshot => ({ playerId, nickname: playerId, level: 1, hp: 100, maxHp: 100, maxAp: 5, initiative: 10, severelyInjured: false, injuries: [] });
    const initial = inventory([bag(), bag("bag", 8), item("wood", { containerInstanceId: "pack" })]);
    value.update(initial, character("one"));
    value.show(0);
    inspect("wood");
    move();
    value.update(inventory([bag()]), character("two"));
    finish({ ok: true, inventory: initial });
    await Promise.resolve();
    await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();
    expect(document.querySelector('[data-container-item="wood"]')).toBeNull();
    value.destroy();
});
