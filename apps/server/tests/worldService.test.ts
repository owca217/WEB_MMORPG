import { DEFAULT_APPEARANCE } from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { InventoryService } from "../src/inventory/InventoryService";
import { LootService } from "../src/loot/LootService";
import { SessionStore } from "../src/session/SessionStore";
import { WorldService } from "../src/world/WorldService";

function createTestWorld() {
  return new WorldService();
}

describe("WorldService", () => {
  it("hydrates a player at persisted coordinates instead of the canonical spawn", () => {
    const world = createTestWorld();
    world.addPlayer(
      {
        id: "p1",
        nickname: "Owczy",
        appearance: DEFAULT_APPEARANCE,
        locationId: "forest-settlement-01",
        x: 845,
        y: 612
      },
      0
    );

    expect(world.getPlayer("p1")).toMatchObject({ x: 845, y: 612 });
  });

  it("clamps player movement to world bounds", () => {
    const world = createTestWorld();
    world.addPlayer({ id: "p1", nickname: "Owczy" }, 0);

    const result = world.movePlayer("p1", { x: 9999, y: 9999 }, 100000);

    expect(result.x).toBeLessThanOrEqual(1600);
    expect(result.y).toBeLessThanOrEqual(900);
  });

  it("limits movement distance by elapsed time", () => {
    const world = createTestWorld();
    world.addPlayer({ id: "p1", nickname: "Owczy" }, 0);

    const result = world.movePlayer("p1", { x: 1000, y: 470 }, 1000);

    expect(result.x).toBeCloseTo(580, 5);
    expect(result.y).toBeCloseTo(470, 5);
  });

  it("starts the wolf encounter only inside activation radius", () => {
    const world = createTestWorld();
    world.addPlayer({ id: "p1", nickname: "Owczy" }, 0);
    world.movePlayer("p1", { x: 1320, y: 455 }, 100000);

    expect(world.startEncounter("p1", "wolf-pack-01").id).toBe("wolf-pack-01");
  });

  it("rejects an encounter when player is too far away", () => {
    const world = createTestWorld();
    world.addPlayer({ id: "p1", nickname: "Owczy" }, 0);

    expect(() => world.startEncounter("p1", "wolf-pack-01")).toThrow(
      "ENCOUNTER_OUT_OF_RANGE"
    );
  });

  it("exposes guide, healer and wolf encounter in the forest settlement", () => {
    const snapshot = new WorldService().snapshot("forest-settlement-01");

    expect(snapshot.npcs.map((npc) => npc.kind).sort()).toEqual(["guide", "healer"]);
    expect(snapshot.encounters.some((encounter) => encounter.id === "wolf-pack-01")).toBe(true);
  });

  it("allows NPC interaction only inside the configured radius", () => {
    const world = createTestWorld();
    world.addPlayer({ id: "p1", nickname: "Owczy" }, 0);

    expect(() => world.interactNpc("p1", "healer-ada")).toThrow("NPC_OUT_OF_RANGE");

    world.movePlayer("p1", { x: 720, y: 535 }, 100000);
    expect(world.interactNpc("p1", "healer-ada")).toMatchObject({
      id: "healer-ada",
      kind: "healer",
      name: "Ada"
    });
  });
});

describe("SessionStore", () => {
  it("validates nickname and rejects duplicate active nicknames", () => {
    const sessions = new SessionStore();

    expect(sessions.login("ab")).toMatchObject({ ok: false, code: "INVALID_NICKNAME" });
    expect(sessions.login("Owczy")).toMatchObject({
      ok: true,
      locationId: "forest-settlement-01"
    });
    expect(sessions.login("owczy")).toMatchObject({ ok: false, code: "NICKNAME_IN_USE" });
  });
});

describe("Inventory and loot", () => {
  it("hydrates persisted inventory state", () => {
    const inventory = new InventoryService();
    inventory.hydratePlayer("p1", {
      items: [
        {
          itemId: "wolf-pelt",
          name: "Wilcza skóra",
          description: "Zdobycz z wilka.",
          category: "material",
          quantity: 3
        }
      ]
    });

    expect(inventory.getSnapshot("p1").items).toEqual([
      expect.objectContaining({ itemId: "wolf-pelt", quantity: 3 })
    ]);
  });

  it("awards and stacks deterministic wolf loot", () => {
    const inventory = new InventoryService();
    const loot = new LootService();

    inventory.addItems("p1", loot.rollEncounterLoot("wolf-pack-01", 1));
    inventory.addItems("p1", loot.rollEncounterLoot("wolf-pack-01", 2));

    const snapshot = inventory.getSnapshot("p1");
    expect(snapshot.items.find((item) => item.itemId === "wolf-pelt")?.quantity).toBe(2);
    expect(snapshot.items.find((item) => item.itemId === "field-bandage")?.quantity).toBe(4);
  });
});
