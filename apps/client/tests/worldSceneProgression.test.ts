/* @vitest-environment jsdom */

import { EventEmitter } from "node:events";
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
