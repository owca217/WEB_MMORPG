import { emptyCharacterEquipment, emptyEquipmentSlots, type InventoryItem, type PlayerStateSnapshot } from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { PlayerStateStore } from "../src/state/PlayerStateStore";

const snapshot: PlayerStateSnapshot = {
  character: {
    playerId: "p1",
    nickname: "Owczy",
    level: 1,
    hp: 100,
    maxHp: 100,
    maxAp: 5,
    initiative: 10,
    severelyInjured: false,
    injuries: []
  },
  inventory: { items: [] }
};

describe("PlayerStateStore", () => {
  it("retains the server gold balance alongside inventory updates",()=>{
    const store=new PlayerStateStore();store.set({...snapshot,gold:75});
    expect(store.get()?.gold).toBe(75);
    store.set({...store.get()!,inventory:{items:[]}});
    expect(store.get()?.gold).toBe(75);
  });
  it("publishes and retains the latest player state", () => {
    const store = new PlayerStateStore();
    const seen: string[] = [];
    const unsubscribe = store.subscribe((state) => seen.push(state.character.nickname));

    store.set(snapshot);

    expect(store.get()).toEqual(snapshot);
    expect(seen).toEqual(["Owczy"]);

    unsubscribe();
    store.set({
      ...snapshot,
      character: { ...snapshot.character, nickname: "Other" }
    });
    expect(seen).toEqual(["Owczy"]);
  });

  it("returns defensive copies so UI code cannot mutate shared state", () => {
    const store = new PlayerStateStore();
    const state:PlayerStateSnapshot={...snapshot,character:{...snapshot.character,weaponTraining:{experience:{sword:5,axe:0,hammer:0,dagger:0,spear:0,bow:0,crossbow:0,staff:0,shield:0},loadout:{melee:"sword",ranged:"bow"}}}};
    store.subscribe(received=>{received.character.weaponTraining!.experience.axe=100;});
    store.set(state);
    state.character.weaponTraining!.experience.sword=0;

    const received = store.get();
    if (!received) throw new Error("Expected player state");
    received.character.hp = 1;
    received.character.weaponTraining!.loadout.melee="axe";

    expect(store.get()?.character.hp).toBe(100);
    expect(store.get()?.character.weaponTraining?.experience.sword).toBe(5);
    expect(store.get()?.character.weaponTraining?.experience.axe).toBe(0);
    expect(store.get()?.character.weaponTraining?.loadout.melee).toBe("sword");
  });

  it("retains four container assignments and isolates them from input, subscribers and readers", () => {
    const store = new PlayerStateStore();
    const state: PlayerStateSnapshot = { ...snapshot, inventory: {
      items: [], containerSlots: ["chest-1", null, "chest-3", null]
    } };
    store.subscribe((received) => { received.inventory.containerSlots![0] = null; });
    store.set(state);
    state.inventory.containerSlots![2] = null;
    const first = store.get()!;
    expect(first.inventory.containerSlots).toEqual(["chest-1", null, "chest-3", null]);
    first.inventory.containerSlots![0] = null;
    expect(store.get()?.inventory.containerSlots).toEqual(["chest-1", null, "chest-3", null]);
  });

  it("preserves gear assignments and isolates nested equipment metadata from all state consumers", () => {
    const store = new PlayerStateStore();
    const weapon: InventoryItem = {
      instanceId: "sword-1", itemId: "sword", itemDefinitionId: "sword", name: "Miecz",
      category: "weapon", description: "", quantity: 1, rarity: "COMMON", upgradeLevel: 0,
      equippedSlot: "mainHand", equipment: { slot: "mainHand", weaponFamily: "sword", twoHanded: false,
        minimumLevel: 1, modifiers: [{ statCode: "PHYSICAL_DAMAGE", modifierType: "flat", value: 5 }] }
    };
    const state: PlayerStateSnapshot = {
      ...snapshot, character: { ...snapshot.character, equipment: { ...emptyCharacterEquipment(), mainHand: weapon } },
      inventory: { items: [weapon], equipmentSlots: { ...emptyEquipmentSlots(), mainHand: weapon.instanceId } }
    };
    store.subscribe(received => {
      received.inventory.equipmentSlots!.mainHand = null;
      received.inventory.items[0]!.equipment!.modifiers[0]!.value = 100;
      received.character.equipment!.mainHand!.equipment!.modifiers[0]!.value = 200;
      received.character.equipment!.helmet = received.character.equipment!.mainHand;
    });
    store.set(state);
    state.inventory.equipmentSlots!.mainHand = null;
    weapon.equipment!.minimumLevel = 99;
    weapon.equipment!.modifiers[0]!.value = 300;
    state.character.equipment!.mainHand = null;

    const first = store.get()!;
    expect(first.inventory.equipmentSlots!.mainHand).toBe("sword-1");
    expect(first.inventory.items[0]!.equipment!.minimumLevel).toBe(1);
    expect(first.inventory.items[0]!.equipment!.modifiers[0]!.value).toBe(5);
    expect(first.character.equipment!.mainHand!.equipment!.modifiers[0]!.value).toBe(5);
    expect(first.character.equipment!.helmet).toBeNull();
    first.inventory.equipmentSlots!.mainHand = null;
    first.inventory.items[0]!.equipment!.modifiers[0]!.value = 400;
    first.character.equipment!.mainHand!.equipment!.modifiers[0]!.value = 500;
    first.character.equipment!.mainHand = null;

    const second = store.get()!;
    expect(second.inventory.equipmentSlots!.mainHand).toBe("sword-1");
    expect(second.inventory.items[0]!.equipment!.modifiers[0]!.value).toBe(5);
    expect(second.character.equipment!.mainHand!.equipment!.modifiers[0]!.value).toBe(5);
  });
});
