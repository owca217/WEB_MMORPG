import { describe, expect, it } from "vitest";
import { getCharacterStatistics, type CharacterSnapshot } from "@web-mmorpg/shared";
import { WorldService } from "../src/world/WorldService";
import { BattleService } from "../src/battle/BattleService";
import { LootService } from "../src/loot/LootService";
import { getEncounterDefinition } from "../src/world/encounterDefinitions";

describe("eastern forest world", () => {
  it("crosses the east teleport, lands outside the return zone and can walk back", () => {
    const world = new WorldService();
    world.addPlayer({ id: "traveler", nickname: "Traveler", x: 1480, y: 450 }, 0);
    expect(world.movePlayer("traveler", { x: 1530, y: 450 }, 1000)).toMatchObject({ x: 150, y: 600 });
    expect(world.getPlayerLocationId("traveler")).toBe("eastern-forest-01");
    world.movePlayer("traveler", { x: 150, y: 600 }, 1000);
    expect(world.getPlayerLocationId("traveler")).toBe("eastern-forest-01");
    expect(world.movePlayer("traveler", { x: 50, y: 600 }, 2000)).toMatchObject({ x: 1450, y: 450 });
    expect(world.getPlayerLocationId("traveler")).toBe("forest-settlement-01");
  });

  it("uses forest bounds and keeps encounters and NPCs scoped to the active location", () => {
    const world = new WorldService();
    world.addPlayer({ id: "traveler", nickname: "Traveler", locationId: "eastern-forest-01", x: 1320, y: 455 }, 0);
    expect(() => world.startEncounter("traveler", "wolf-pack-01")).toThrow("ENCOUNTER_NOT_FOUND");
    expect(() => world.interactNpc("traveler", "merchant-miro")).toThrow("NPC_NOT_FOUND");
    expect(world.movePlayer("traveler", { x: 9999, y: 9999 }, 100000)).toMatchObject({ x: 2000, y: 1200 });
    const forest = world.snapshot("eastern-forest-01");
    expect(forest.location).toMatchObject({ width: 2000, height: 1200, theme: "dense-forest" });
    expect(forest.encounters).toHaveLength(4);
    expect(forest.teleports).toEqual([expect.objectContaining({ id: "forest-west", destinationLocationId: "forest-settlement-01" })]);
    expect(world.snapshot("forest-settlement-01").players).toHaveLength(0);
  });

  it("rejects nonfinite movement without corrupting the player position", () => {
    const world = new WorldService();
    world.addPlayer({ id: "traveler", nickname: "Traveler", x: 400, y: 450 }, 0);
    expect(() => world.movePlayer("traveler", { x: Number.NaN, y: 450 }, 1000)).toThrow("INVALID_MOVE_INTENT");
    expect(() => world.movePlayer("traveler", { x: 400, y: Number.POSITIVE_INFINITY }, 1000)).toThrow("INVALID_MOVE_INTENT");
    expect(world.getPlayer("traveler")).toMatchObject({ x: 400, y: 450 });
  });

  it("exposes authoritative encounter availability and refuses engaged or respawning spawns", () => {
    const world = new WorldService();
    world.addPlayer({ id: "traveler", nickname: "Traveler", locationId: "eastern-forest-01", x: 480, y: 410 });
    world.setEncounterAvailability("forest-boars-01", { status: "engaged" });
    expect(() => world.startEncounter("traveler", "forest-boars-01")).toThrow("ENCOUNTER_BUSY");
    world.setEncounterAvailability("forest-boars-01", { status: "respawning", respawnAt: 180000 });
    expect(() => world.startEncounter("traveler", "forest-boars-01")).toThrow("ENCOUNTER_RESPAWNING");
    const snapshot = world.snapshot("eastern-forest-01");
    expect(snapshot.encounters.find(e => e.id === "forest-boars-01")).toMatchObject({ status: "respawning", respawnAt: 180000 });
    snapshot.encounters[0]!.status = "alive";
    expect(() => world.startEncounter("traveler", "forest-boars-01")).toThrow("ENCOUNTER_RESPAWNING");
    world.setEncounterAvailability("forest-boars-01", { status: "alive" });
    expect(world.startEncounter("traveler", "forest-boars-01").id).toBe("forest-boars-01");
  });
});

const hero = (id: string): CharacterSnapshot => ({ playerId: id, nickname: id, level: 1, hp: 100, maxHp: 100, maxAp: 5, initiative: 10, injuries: [], severelyInjured: false, statistics: getCharacterStatistics(1) });
describe("forest encounter definitions", () => {
  it("gives each new enemy its own name, minimum level and combat statistics", () => {
    const encounters = ["forest-boars-01", "forest-spiders-01", "forest-wolves-01"];
    const enemies = encounters.map(id => new BattleService().startBattle(hero("a"), id).combatants.find(c => c.side === "enemy")!);
    expect(enemies.map(e => e.name)).toEqual(["Dzik", "Pająk leśny", "Wilk leśny"]);
    expect(enemies.map(e => e.level)).toEqual([3, 4, 5]);
    expect(new Set(enemies.map(e => `${e.maxHp}:${e.combatStats?.meleeDamage}:${e.combatStats?.armor}`)).size).toBe(3);
    for (const id of ["forest-boars-01", "forest-spiders-01", "forest-wolves-01", "forest-boars-02"]) expect(getEncounterDefinition(id)?.respawnMs).toBe(180000);
    expect(getEncounterDefinition("wolf-pack-01")).toMatchObject({ goldReward: 15 });
    expect(getEncounterDefinition("wolf-pack-01")?.respawnMs).toBeUndefined();
    expect(getEncounterDefinition("unknown")).toBeUndefined();
  });

  it("scales the forest arena with party size while preserving each hero's own level", () => {
    const battle = new BattleService().startPartyBattle([hero("a"), hero("b"), hero("c")], "forest-boars-02");
    expect(battle.combatants.filter(c => c.side === "enemy")).toHaveLength(3);
    expect(battle.combatants.filter(c => c.side === "player").every(c => c.level === 1)).toBe(true);
    expect(new Set(battle.combatants.map(c => `${c.position.q},${c.position.r}`)).size).toBe(6);
  });

  it("rewards only existing catalog items, and only wolves drop wolf pelts", () => {
    const loot = new LootService();
    expect(loot.rollEncounterLoot("forest-wolves-01", 1)).toEqual(expect.arrayContaining([expect.objectContaining({ itemId: "wolf-pelt" })]));
    expect(loot.rollEncounterLoot("forest-boars-01", 1)).toEqual([{ itemId: "field-bandage", quantity: 2 }]);
    expect(loot.rollEncounterLoot("forest-spiders-01", 1)).toEqual([{ itemId: "field-bandage", quantity: 2 }]);
  });
});
