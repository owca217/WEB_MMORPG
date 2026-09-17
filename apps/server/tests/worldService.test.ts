import { describe, expect, it } from "vitest";
import { InventoryService } from "../src/inventory/InventoryService";
import { LootService } from "../src/loot/LootService";
import { SessionStore } from "../src/session/SessionStore";
import { WorldService } from "../src/world/WorldService";

function createTestWorld() {
  return new WorldService();
}

describe("WorldService", () => {
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

    const result = world.movePlayer("p1", { x: 1000, y: 450 }, 1000);

    expect(result.x).toBeCloseTo(520, 5);
    expect(result.y).toBeCloseTo(450, 5);
  });

  it("starts the wolf encounter only inside activation radius", () => {
    const world = createTestWorld();
    world.addPlayer({ id: "p1", nickname: "Owczy" }, 0);
    world.movePlayer("p1", { x: 1050, y: 450 }, 100000);

    expect(world.startEncounter("p1", "wolf-pack-01").id).toBe("wolf-pack-01");
  });

  it("rejects an encounter when player is too far away", () => {
    const world = createTestWorld();
    world.addPlayer({ id: "p1", nickname: "Owczy" }, 0);

    expect(() => world.startEncounter("p1", "wolf-pack-01")).toThrow(
      "ENCOUNTER_OUT_OF_RANGE"
    );
  });

  it("requires the authored forest settlement and NPC interaction API", () => {
    const sessions = new SessionStore();
    const login = sessions.login("Owczy");

    expect(login).toMatchObject({ ok: true, locationId: "forest-settlement-01" });
    expect(typeof (createTestWorld() as unknown as { interactNpc?: unknown }).interactNpc).toBe(
      "function"
    );
  });
});

describe("SessionStore", () => {
  it("validates nickname and rejects duplicate active nicknames", () => {
    const sessions = new SessionStore();

    expect(sessions.login("ab")).toMatchObject({ ok: false, code: "INVALID_NICKNAME" });
    expect(sessions.login("Owczy")).toMatchObject({ ok: true, locationId: "meadow-01" });
    expect(sessions.login("owczy")).toMatchObject({ ok: false, code: "NICKNAME_IN_USE" });
  });
});

describe("Inventory and loot", () => {
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
