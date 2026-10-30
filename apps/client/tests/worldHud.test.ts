/* @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorldHud } from "../src/ui/WorldHud";
import { emptyCharacterEquipment, getCharacterStatistics, type CharacterSnapshot, type InventoryItem } from "@web-mmorpg/shared";

beforeEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("opens the permanent backpack from the left HUD slot with the bundled icon and retains three ordinary empty slots",()=>{
  vi.stubEnv("BASE_URL","/WEB_MMORPG/");
  const onContainerSlot=vi.fn(),hud=new WorldHud({onContainerSlot,onCharacter:vi.fn(),onAdmin:vi.fn()});
  const backpack:InventoryItem={instanceId:"permanent",itemId:"permanent-backpack",itemDefinitionId:"permanent-backpack",name:"Plecak podróżnika",category:"container",description:"",quantity:1,rarity:"COMMON",quality:"NORMAL",upgradeLevel:0,permanentContainer:true,containerCapacity:16,iconUrl:"/wrong-root-url.png"};
  hud.updateInventory({items:[backpack],containerSlots:["permanent",null,null,null]});
  const left=document.querySelector<HTMLButtonElement>('[data-container-slot="0"]')!;
  expect(left.getAttribute("aria-label")).toContain("Otwórz plecak");
  expect(left.title).toContain("16 miejsc");expect(left.title).toContain("na stałe");
  expect(left.querySelector("img")?.getAttribute("src")).toBe("/WEB_MMORPG/assets/items/permanent-backpack.png");
  expect(left.querySelector<HTMLElement>("[data-item-quality]")?.dataset.itemQuality).toBe("NORMAL");
  left.click();expect(onContainerSlot).toHaveBeenCalledWith(0);
  left.querySelector("img")!.dispatchEvent(new Event("error"));
  expect(left.querySelector("svg")).not.toBeNull();expect(left.querySelector("[data-item-quality]")).not.toBeNull();
  for(const slot of document.querySelectorAll<HTMLButtonElement>('[data-container-slot]:not([data-container-slot="0"])')) {
    expect(slot.classList.contains("is-empty")).toBe(true);expect(slot.querySelector("img")).toBeNull();expect(slot.querySelector("[data-item-quality]")).toBeNull();
  }
  hud.destroy();
});

describe("WorldHud session controls", () => {
  it("keeps four container slots directly in the HUD and opens the clicked slot", () => {
    const onContainerSlot = vi.fn();
    const hud = new WorldHud({ onContainerSlot, onCharacter: vi.fn(), onAdmin: vi.fn() });
    const slots = document.querySelectorAll<HTMLButtonElement>(".world-hud [data-container-slot]");

    expect(slots).toHaveLength(4);
    expect(document.querySelector(".world-hud [data-inventory]")).toBeNull();
    expect([...document.querySelectorAll(".world-hud button")].some((button) => button.textContent === "Ekwipunek")).toBe(false);
    expect([...slots].map((slot) => slot.getAttribute("aria-label"))).toEqual([
      "Ładowanie plecaka. Odśwież plecak", "Pojemnik 2: pusty. Wybierz pojemnik",
      "Pojemnik 3: pusty. Wybierz pojemnik", "Pojemnik 4: pusty. Wybierz pojemnik"
    ]);
    for (const slot of slots) {
      expect(slot.classList.contains("is-empty")).toBe(true);
      expect(slot.querySelector(".container-icon--muted svg")).not.toBeNull();
      expect(slot.querySelector(".world-hud__container-number")).toBeNull();
      expect(slot.querySelector(".world-hud__container-name")).toBeNull();
      expect(slot.textContent?.trim()).toBe("");
    }
    slots[2]!.click();
    expect(onContainerSlot).toHaveBeenCalledWith(2);
    hud.destroy();
  });

  it("renders equipped containers from the inventory snapshot with safe names and an icon fallback", () => {
    const hud = new WorldHud({ onCharacter: vi.fn(), onAdmin: vi.fn() });
    const container: InventoryItem = {
      instanceId: "bag", itemId: "bag-definition", itemDefinitionId: "bag-definition",
      category: "container", name: "<img src=x onerror=alert(1)>", description: "", quantity: 1,
      rarity: "COMMON", upgradeLevel: 0, iconUrl: "/missing-bag.png"
    };
    hud.updateInventory({ items: [container], containerSlots: [null, "bag", null, null] });

    const equipped = document.querySelector<HTMLButtonElement>('[data-container-slot="1"]')!;
    expect(equipped.textContent).toContain(container.name);
    expect(equipped.querySelectorAll("img")).toHaveLength(1);
    const icon = equipped.querySelector("img")!;
    icon.dispatchEvent(new Event("error"));
    expect(equipped.querySelector("img")).toBeNull();
    expect(equipped.querySelector("[data-container-icon] svg")).not.toBeNull();

    hud.updateInventory({ items: [container], containerSlots: [null, null, null, null] });
    expect(equipped.textContent?.trim()).toBe("");
    expect(equipped.getAttribute("aria-label")).toBe("Pojemnik 2: pusty. Wybierz pojemnik");
    hud.destroy();
  });

  it("minimizes on phones, keeps live updates and actions after restore, and restores the panel on desktop", () => {
    const viewportEvents = new EventTarget();
    const media = {
      matches: true,
      addEventListener: viewportEvents.addEventListener.bind(viewportEvents),
      removeEventListener: vi.fn(viewportEvents.removeEventListener.bind(viewportEvents))
    };
    vi.stubGlobal("matchMedia", vi.fn(() => media));
    const onContainerSlot = vi.fn();
    const onCharacter = vi.fn();
    const onAdmin = vi.fn();
    const onLogout = vi.fn();
    const hud = new WorldHud({ onContainerSlot, onCharacter, onAdmin, onLogout });
    const toggle = document.querySelector<HTMLButtonElement>("[data-hud-toggle]")!;
    const content = document.querySelector<HTMLElement>("[data-hud-content]")!;

    expect(toggle.hidden).toBe(false);
    toggle.click();
    expect(content.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Rozwiń panel gry");
    expect(toggle.querySelector("svg")).not.toBeNull();

    hud.update({
      character: { playerId: "hero", nickname: "Owczy", level: 2, experience: 250,
        hp: 95, maxHp: 120, maxAp: 5, initiative: 10, severelyInjured: false, injuries: [] },
      inventory: { items: [{ instanceId: "bag", itemId: "bag", itemDefinitionId: "bag", name: "Torba podróżna",
        category: "container", description: "Torba", quantity: 1, rarity: "COMMON", upgradeLevel: 0 }],
        containerSlots: [null, "bag", null, null] }
    });
    hud.updateSession("ADMIN");
    toggle.click();

    expect(content.hidden).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector("[data-experience]")?.textContent).toContain("150 / 200");
    expect(document.querySelector('[data-container-slot="1"]')?.textContent).toContain("Torba podróżna");
    expect(document.querySelector<HTMLButtonElement>("[data-admin]")?.hidden).toBe(false);
    document.querySelector<HTMLButtonElement>('[data-container-slot="1"]')!.click();
    document.querySelector<HTMLButtonElement>("[data-character]")!.click();
    document.querySelector<HTMLButtonElement>("[data-admin]")!.click();
    document.querySelector<HTMLButtonElement>("[data-logout]")!.click();
    expect(onContainerSlot).toHaveBeenCalledWith(1);
    expect(onCharacter).toHaveBeenCalledTimes(1);
    expect(onAdmin).toHaveBeenCalledTimes(1);
    expect(onLogout).toHaveBeenCalledTimes(1);

    toggle.click();
    media.matches = false;
    viewportEvents.dispatchEvent(new Event("change"));
    expect(content.hidden).toBe(false);
    expect(toggle.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    hud.destroy();
    expect(media.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("derives ADMIN button visibility from the current SessionView role", () => {
    const hud = new WorldHud({
      onInventory: vi.fn(),
      onCharacter: vi.fn(),
      onAdmin: vi.fn(),
      onLogout: vi.fn()
    });
    const admin = document.querySelector<HTMLButtonElement>("[data-admin]");
    if (!admin) throw new Error("Admin button missing");

    hud.updateSession("PLAYER");
    expect(admin.hidden).toBe(true);
    hud.updateSession("ADMIN");
    expect(admin.hidden).toBe(false);
    hud.destroy();
  });

  it("exposes a logout action in the world HUD", () => {
    const onLogout = vi.fn();
    const hud = new WorldHud({
      onInventory: vi.fn(),
      onCharacter: vi.fn(),
      onAdmin: vi.fn(),
      onLogout
    });

    const logout = document.querySelector<HTMLButtonElement>("[data-logout]");
    expect(logout).not.toBeNull();
    logout?.click();
    expect(onLogout).toHaveBeenCalledTimes(1);
    hud.destroy();
  });
});

it("offers healing only for a usable equipped staff and positive authoritative healing power",()=>{
 const onHealing=vi.fn(),hud=new WorldHud({onCharacter:vi.fn(),onAdmin:vi.fn(),onHealing});
 const character:CharacterSnapshot={playerId:"hero",nickname:"Hero",level:1,hp:50,maxHp:100,maxAp:5,initiative:10,severelyInjured:false,injuries:[],statistics:{...getCharacterStatistics(1),healingPower:20},weaponTraining:{experience:{sword:0,axe:0,hammer:0,dagger:0,spear:0,bow:0,crossbow:0,staff:0,shield:0},loadout:{melee:"sword",ranged:"bow",support:"staff"}}};
 hud.update({character,inventory:{items:[]}});
 const healing=document.querySelector<HTMLButtonElement>('[data-healing]')!;
 expect(healing.hidden).toBe(true);healing.click();expect(onHealing).not.toHaveBeenCalled();
 const staff:InventoryItem={instanceId:"staff",itemId:"staff",itemDefinitionId:"staff",name:"Kostur",description:"",quantity:1,category:"weapon",rarity:"COMMON",upgradeLevel:0,equippedSlot:"mainHand",equipment:{slot:"mainHand",weaponFamily:"staff",twoHanded:true,minimumLevel:1,modifiers:[]}};
 const equipped={...character,equipment:{...emptyCharacterEquipment(),mainHand:staff}};
 hud.update({character:equipped,inventory:{items:[staff]}});
 expect(healing.hidden).toBe(false);healing.click();expect(onHealing).toHaveBeenCalledOnce();
 hud.update({character:{...equipped,statistics:{...getCharacterStatistics(1),healingPower:0}},inventory:{items:[staff]}});
 expect(healing.hidden).toBe(true);
 hud.update({character:{...equipped,equipment:{...emptyCharacterEquipment(),mainHand:{...staff,durability:0}}},inventory:{items:[staff]}});
 expect(healing.hidden).toBe(true);hud.destroy();
});
