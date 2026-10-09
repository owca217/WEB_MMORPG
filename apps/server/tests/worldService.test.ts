import { describe, expect, it } from "vitest";
import { LootService } from "../src/loot/LootService";
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

describe("LootService", () => {
  it("returns deterministic catalog references without duplicating item presentation", () => {
    const loot = new LootService();

    expect(loot.rollEncounterLoot("wolf-pack-01", 1)).toEqual([
      { itemId: "wolf-pelt", quantity: 1 },
      { itemId: "field-bandage", quantity: 2 }
    ]);
    expect(loot.rollEncounterLoot("unknown", 1)).toEqual([]);
  });
});
