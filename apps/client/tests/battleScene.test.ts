/* @vitest-environment jsdom */

import { EventEmitter } from "node:events";
import type { BattleSnapshot } from "@web-mmorpg/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Phaser rendering requires a browser canvas; the scene and DOM HUD stay real.
vi.mock("phaser", () => ({
  default: {
    Scene: class {},
    Scenes: { Events: { SHUTDOWN: "shutdown" } }
  }
}));

import { gameSocket, type BattleEndedPayload } from "../src/net/GameSocket";
import { BattleScene } from "../src/scenes/BattleScene";

const initialBattle: BattleSnapshot = {
  id: "battle:hero:wolf-pack-01",
  round: 1,
  activeCombatantId: "hero:character-1",
  turnOrder: ["hero:character-1"],
  cells: [],
  blockedCells: [],
  coverCells: [],
  combatants: [{
    id: "hero:character-1",
    ownerPlayerId: "character-1",
    name: "Hero",
    hp: 100,
    maxHp: 100,
    ap: 5,
    maxAp: 5,
    initiative: 10,
    position: { q: 0, r: 0 },
    severelyInjured: false,
    injuries: []
  }],
  finished: false
};

function createScene() {
  const scene = new BattleScene();
  const events = new EventEmitter();
  const start = vi.fn(() => events.emit("shutdown"));
  const drawable = () => ({
    destroy() {},
    setOrigin() { return this; },
    setStrokeStyle() { return this; },
    setInteractive() { return this; },
    on() { return this; }
  });

  Object.assign(scene, {
    cameras: { main: { setBackgroundColor() {}, centerX: 400, centerY: 300 } },
    add: { graphics: drawable, circle: drawable, text: drawable },
    events,
    scene: { start }
  });
  scene.init({ playerId: "character-1", snapshot: initialBattle });
  scene.create();
  return { scene, events, start };
}

describe("BattleScene completion", () => {
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

  it.each(["victory", "defeat"] as const)(
    "returns to the world after the server confirms %s",
    (outcome) => {
      const { start } = createScene();
      expect(document.querySelector(".battle-hud")).not.toBeNull();

      transport.emit("battleState", { ...initialBattle, finished: true });
      expect(start).not.toHaveBeenCalled();

      const completed: BattleEndedPayload = {
        outcome,
        inventory: { items: [] },
        character: {
          playerId: "character-1",
          nickname: "Hero",
          level: 1,
          hp: outcome === "victory" ? 71 : 25,
          maxHp: 100,
          maxAp: 5,
          initiative: 10,
          severelyInjured: outcome === "defeat",
          injuries: outcome === "defeat" ? ["legTrauma"] : []
        }
      };
      transport.emit("battleEnded", completed);

      expect(start).toHaveBeenCalledExactlyOnceWith("WorldScene", {
        playerId: "character-1",
        battleResult: { outcome, experienceGained: 0, levelsGained: 0, level: 1 }
      });
      expect(document.querySelector(".battle-hud")).toBeNull();

      // A completed scene must not react again while another scene is active.
      transport.emit("battleEnded", completed);
      expect(start).toHaveBeenCalledTimes(1);
    }
  );

  it("carries awarded XP and the final level into the world without retaining battle listeners", () => {
    const { start } = createScene();
    transport.emit("battleEnded", {
      outcome: "victory", experienceGained: 80, levelsGained: 1,
      inventory: { items: [] },
      character: {
        playerId: "character-1", nickname: "Hero", level: 2, experience: 150,
        hp: 101, maxHp: 130, maxAp: 5, initiative: 10,
        severelyInjured: false, injuries: []
      }
    } satisfies BattleEndedPayload);

    expect(start).toHaveBeenCalledExactlyOnceWith("WorldScene", {
      playerId: "character-1",
      battleResult: { outcome: "victory", experienceGained: 80, levelsGained: 1, level: 2 }
    });
    expect(transport.listenerCount("battleEnded")).toBe(0);
    expect(transport.listenerCount("battleState")).toBe(0);
    const next = createScene();
    expect(transport.listenerCount("battleEnded")).toBe(1);
    next.events.emit("shutdown");
    expect(transport.listenerCount("battleEnded")).toBe(0);
  });
});
