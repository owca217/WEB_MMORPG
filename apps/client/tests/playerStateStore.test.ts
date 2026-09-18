import { DEFAULT_APPEARANCE, type PlayerStateSnapshot } from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { PlayerStateStore } from "../src/state/PlayerStateStore";

const snapshot: PlayerStateSnapshot = {
  character: {
    playerId: "p1",
    nickname: "Owczy",
    appearance: DEFAULT_APPEARANCE,
    level: 1,
    hp: 100,
    maxHp: 100,
    maxAp: 5,
    initiative: 10,
    severelyInjured: false,
    injuries: []
  },
  inventory: { items: [] },
  equipment: { items: [] }
};

describe("PlayerStateStore", () => {
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
});
