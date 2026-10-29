import type { PlayerStateSnapshot } from "@web-mmorpg/shared";
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
    store.set(snapshot);

    const received = store.get();
    if (!received) throw new Error("Expected player state");
    received.character.hp = 1;

    expect(store.get()?.character.hp).toBe(100);
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
});
