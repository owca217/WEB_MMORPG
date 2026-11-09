import {
  emptyCharacterEquipment, getCharacterStatistics, getEquipmentCombatStatistics,
  getEquipmentItemProperties, type CharacterSnapshot, type InventoryItem
} from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { BattleService } from "../src/battle/BattleService";
import { WorldService } from "../src/world/WorldService";
import { getEncounterDefinition } from "../src/world/encounterDefinitions";
import { LootService } from "../src/loot/LootService";
import { BASIC_EQUIPMENT_ITEMS } from "../src/items/basicEquipment";
import { PROGRESSION_WEAPON_ITEMS } from "../src/items/progressionWeaponItems";

const enemies = [
  { id: "feral-rat", level: 1, hp: 110, damage: 9, armor: 0, reward: 40 },
  { id: "forest-wolf", level: 3, hp: 170, damage: 15, armor: 4, reward: 70 },
  { id: "wild-boar", level: 5, hp: 230, damage: 18, armor: 8, reward: 100 },
  { id: "forest-bandit", level: 7, hp: 280, damage: 23, armor: 12, reward: 130 },
  { id: "outlaw-guard", level: 10, hp: 340, damage: 27, armor: 16, reward: 160 }
];

function catalogEquipment() {
  const equipment = emptyCharacterEquipment();
  const weapon = PROGRESSION_WEAPON_ITEMS.find((item) => item.itemId === "progression-two-handed-30")!;
  const pieces = [
    { ...weapon, specialData: { ...weapon.specialData }, stats: [...weapon.stats!] },
    ...BASIC_EQUIPMENT_ITEMS.filter((item) => item.armorFamily === "plate").map((item) => ({
      ...item, specialData: { armorSlot: item.subcategoryId, armorFamily: item.armorFamily }
    }))
  ];
  for (const piece of pieces) {
    const properties = getEquipmentItemProperties({ category: piece.categoryId,
      subcategory: piece.subcategoryId!, minimumLevel: 1, stats: piece.stats, specialData: piece.specialData })!;
    const item: InventoryItem = {
      instanceId: `fixture-${piece.itemId}`, itemId: piece.itemId, itemDefinitionId: piece.itemId,
      name: piece.name, quantity: 1, category: piece.categoryId, description: "Real catalog gear fixture",
      rarity: "COMMON", upgradeLevel: 0, equipment: properties, equippedSlot: properties.slot
    };
    equipment[properties.slot] = item;
  }
  return equipment;
}

function character(level: number, geared = false): CharacterSnapshot {
  const equipment = geared ? catalogEquipment() : emptyCharacterEquipment();
  const statistics = getEquipmentCombatStatistics(getCharacterStatistics(level), undefined, equipment);
  return { playerId: "hero", nickname: "Bohater", level, statistics,
    hp: statistics.maxHp, maxHp: statistics.maxHp, maxAp: statistics.maxAp,
    initiative: statistics.initiative, severelyInjured: false, injuries: [], equipment };
}

describe("level 1–10 enemy encounters", () => {
  it("preserves authored XP-only enemies without changing legacy or eastern loot and gold", () => {
    const loot = new LootService();
    for (const enemy of enemies) {
      const id = `${enemy.id}-01`;
      expect(getEncounterDefinition(id)).toMatchObject({ enemyId: enemy.id, goldReward: 0 });
      expect(loot.rollEncounterLoot(id, 12345)).toEqual([]);
    }
    expect(getEncounterDefinition("wolf-pack-01")?.goldReward).toBe(15);
    expect(loot.rollEncounterLoot("wolf-pack-01", 12345)).toEqual([{ itemId: "wolf-pelt", quantity: 1 }, { itemId: "field-bandage", quantity: 2 }]);
    expect(getEncounterDefinition("forest-boars-01")?.goldReward).toBe(18);
    expect(loot.rollEncounterLoot("forest-boars-01", 12345)).toEqual([{ itemId: "field-bandage", quantity: 2 }]);
  });
  it.each(enemies)("exposes $id as a reachable encounter with fixed statistics", (enemy) => {
    const world = new WorldService();
    const encounter = world.snapshot().encounters.find(item => item.id === `${enemy.id}-01`);
    expect(encounter).toBeDefined();
    if (!encounter) throw new Error("Missing encounter");
    world.addPlayer({ id: "hero", nickname: "Bohater", x: encounter.x, y: encounter.y });
    expect(world.startEncounter("hero", encounter.id)).toEqual(encounter);
    const snapshots = [1, 100].flatMap(level => [false, true]
      .map(geared => new BattleService().startBattle(character(level, geared), encounter.id)));
    for (const snapshot of snapshots) {
      const opponents = snapshot.combatants.filter(unit => unit.side === "enemy");
      expect(opponents).toHaveLength(1);
      expect(opponents[0]).toMatchObject({ enemyId: enemy.id, level: enemy.level, hp: enemy.hp, maxHp: enemy.hp,
        maxAp: 4, combatStats: { meleeDamage: enemy.damage, rangedDamage: 0, armor: enemy.armor } });
    }
  });

  it.each(enemies)("resolves $id identically with the same real gear at historical levels 1 and 100", (enemy) => {
    const outcomes: unknown[] = [];
    for (const level of [1, 100]) {
      const service = new BattleService();
      const hero = character(level, true);
      expect(hero.statistics).toMatchObject({ maxHp: 185, meleeDamage: 100, armor: 27 });
      let snapshot = service.startBattle(hero, `${enemy.id}-01`);
      service.setAuto("hero", true);
      let completed = false;
      for (let action = 0; action < 500; action += 1) {
        const result = service.applyAutoCommand("hero");
        expect(result.result.ok).toBe(true);
        if (!result.snapshot) throw new Error("Missing battle snapshot");
        snapshot = result.snapshot;
        if (!result.finished) {
          expect(result.experienceReward).toBeUndefined();
          continue;
        }
        expect(result.victory).toBe(true);
        expect(result.playerOutcome!.hp).toBeGreaterThan(0);
        expect(result.playerOutcome!.hp).toBeLessThanOrEqual(hero.maxHp);
        expect(result.experienceReward).toBe(enemy.reward);
        outcomes.push({ hp: result.playerOutcome!.hp, round: snapshot.round, actions: action + 1 });
        expect(service.applyAutoCommand("hero").experienceReward).toBeUndefined();
        completed = true;
        break;
      }
      expect(completed).toBe(true);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
  });

  it("resolves the faster enemy opening before accepting player commands", () => {
    const service = new BattleService();
    const snapshot = service.startBattle({ ...character(1), injuries: ["concussion"] }, "outlaw-guard-01");
    expect(snapshot.combatants.find(unit => unit.id === snapshot.activeCombatantId)?.ownerPlayerId).toBe("hero");
    service.setAuto("hero", true);
    expect(service.applyAutoCommand("hero").result.ok).toBe(true);
  });
});
