/* @vitest-environment jsdom */

import { EventEmitter } from "node:events";
import type { InventorySnapshot, PlayerStateSnapshot } from "@web-mmorpg/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("phaser", () => ({ default: {
  Scene: class {}, Scenes: { Events: { SHUTDOWN: "shutdown" } }
} }));
// These renderers only draw the map; keep the scene lifecycle, transport and DOM HUD real.
vi.mock("../src/world/ForestSettlementRenderer", () => ({ ForestSettlementRenderer: class {
  render() {} destroy() {}
} }));
vi.mock("../src/world/WorldEntitiesRenderer", () => ({ WorldEntitiesRenderer: class {
  destroy() {}
} }));

import { gameSocket } from "../src/net/GameSocket";
import { WorldScene } from "../src/scenes/WorldScene";
import { playerStateStore } from "../src/state/PlayerStateStore";

let transport: EventEmitter;

beforeEach(() => {
  document.body.replaceChildren();
  transport = new EventEmitter();
  vi.spyOn(gameSocket, "connect").mockReturnValue(
    transport as unknown as ReturnType<typeof gameSocket.connect>
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it("displays the battle summary after scene creation and clears it on the next entry", () => {
  const scene = new WorldScene();
  const events = new EventEmitter();
  Object.assign(scene, {
    events,
    cameras: { main: { setBackgroundColor() {}, setBounds() {} } },
    physics: { world: { setBounds() {} } },
    textures: { exists: () => false },
    input: { on() {} }
  });
  scene.init({ playerId: "hero", battleResult: {
    outcome: "victory", experienceGained: 80, levelsGained: 1, level: 2
  } });
  scene.create();

  expect(document.querySelector("[data-battle-result]")?.textContent).toContain("+80 XP");
  expect(document.querySelector("[data-battle-result]")?.textContent).toContain("poziom 2");
  expect(transport.listenerCount("playerState")).toBe(1);
  events.emit("shutdown");
  expect(document.querySelector(".world-hud")).toBeNull();
  expect(transport.listenerCount("playerState")).toBe(0);

  scene.init({ playerId: "hero" });
  scene.create();
  expect(document.querySelector<HTMLElement>("[data-battle-result]")?.hidden).toBe(true);
  expect(transport.listenerCount("playerState")).toBe(1);
  events.emit("shutdown");
});

it("opens the HUD container slot and applies the acknowledged inventory to the HUD and stored player state", async () => {
  const scene = new WorldScene();
  const events = new EventEmitter();
  Object.assign(scene, {
    events,
    cameras: { main: { setBackgroundColor() {}, setBounds() {} } },
    physics: { world: { setBounds() {} } },
    textures: { exists: () => false },
    input: { on() {} }
  });
  const inventory: InventorySnapshot = {
    items: [{ instanceId: "bag", itemId: "bag", itemDefinitionId: "bag", name: "Torba podróżna", quantity: 1,
      category: "container", description: "Torba", rarity: "COMMON", upgradeLevel: 0 }],
    containerSlots: [null, null, null, null]
  };
  const state: PlayerStateSnapshot = {
    character: { playerId: "hero", nickname: "Owczy", level: 1, experience: 0, hp: 100, maxHp: 100,
      maxAp: 4, initiative: 10, severelyInjured: false, injuries: [] },
    inventory
  };
  let request: unknown;
  let acknowledge!: (result: unknown) => void;
  Object.assign(transport, {
    timeout: () => ({ emitWithAck: (event: string, payload: unknown) => {
      request = { event, payload };
      return new Promise((resolve) => { acknowledge = resolve; });
    } })
  });
  scene.init({ playerId: "hero" });
  scene.create();
  transport.emit("playerState", state);
  document.querySelector<HTMLButtonElement>('[data-container-slot="2"]')!.click();

  expect(document.querySelector("[data-container-picker]")?.classList.contains("is-hidden")).toBe(false);
  document.querySelector<HTMLButtonElement>('[data-container-instance="bag"]')!.click();
  expect(request).toEqual({ event: "setContainerSlot", payload: { slotIndex: 2, itemInstanceId: "bag" } });
  expect(document.querySelector('[data-container-slot="2"]')?.textContent).toContain("Pusty");

  const acknowledged: InventorySnapshot = { ...inventory, containerSlots: [null, null, "bag", null] };
  acknowledge({ ok: true, inventory: acknowledged });
  await vi.waitFor(() => expect(document.querySelector('[data-container-slot="2"]')?.textContent).toContain("Torba podróżna"));
  expect(playerStateStore.get()?.inventory).toEqual(acknowledged);
  events.emit("shutdown");
  expect(document.querySelector("[data-container-picker]")).toBeNull();
});
