import { describe, expect, it } from "vitest";
import { CharacterService } from "../src/character/CharacterService";
import { BattleService } from "../src/battle/BattleService";
import { armorItem, combatEquipment } from "./combatEquipmentFixtures";

describe("equipment specialization character state", () => {
  it("preserves historical level and XP while rewards and hydration never grow the naked baseline", () => {
    const service = new CharacterService(), fresh = service.createPlayer("fresh", "Fresh");
    const historical = service.hydrate({ ...fresh, playerId: "old", level: 100, experience: 495000, hp: 40, injuries: ["bleeding"] });
    expect(historical.statistics).toEqual(fresh.statistics);
    expect(service.awardExperience("old", 400)).toMatchObject({ level: 100, experience: 495000, hp: 40, maxHp: 100, injuries: ["bleeding"] });
    expect(service.hydrate({ ...fresh, level: 4, experience: 0 })).toMatchObject({ level: 4, experience: 0 });
  });

  it("trains and clones armor independently and synchronizes derived stats without healing", () => {
    const service = new CharacterService(), fresh = service.createPlayer("hero", "Hero");
    const equipment = combatEquipment("sword"), chest = armorItem("chest", [{ statCode: "MAX_HP", modifierType: "flat", value: 100 }]);
    chest.equipment!.armorFamily = "cloth"; equipment.chest = chest;
    service.hydrate({ ...fresh, equipment, hp: 40 });
    const trained = service.trainArmor("hero", "cloth", 25250);
    expect(trained).toMatchObject({ hp: 40, maxHp: 220, statistics: { maxHp: 220 }, armorTraining: { experience: { cloth: 25250, leather: 0, plate: 0 } } });
    trained.armorTraining!.experience.cloth = 0;
    const afterWeapon = service.trainWeapon("hero", "sword", 25);
    expect(afterWeapon.armorTraining?.experience.cloth).toBe(25250);
    expect(afterWeapon.maxHp).toBe(afterWeapon.statistics!.maxHp);
    expect(service.setArmorTraining("hero", { experience: { cloth: 0 } })).toMatchObject({ hp: 40, maxHp: 200 });
    for (const value of [-1, 0.5, NaN, Infinity]) expect(() => service.trainArmor("hero", "cloth", value)).toThrow("INVALID_ARMOR_EXPERIENCE");
    expect(() => service.trainArmor("hero", "unknown" as "cloth", 1)).toThrow("INVALID_ARMOR_FAMILY");
  });

  it("uses encounter difficulty independently from historical character level", () => {
    const service = new CharacterService(), fresh = service.createPlayer("hero", "Hero");
    const low = new BattleService().startBattle(fresh, "wolf-pack-01");
    const high = new BattleService().startBattle({ ...fresh, level: 100 }, "wolf-pack-01");
    expect(high.combatants.filter(actor => actor.side === "enemy").map(actor => ({ hp: actor.maxHp, level: actor.level, damage: actor.combatStats?.meleeDamage })))
      .toEqual(low.combatants.filter(actor => actor.side === "enemy").map(actor => ({ hp: actor.maxHp, level: actor.level, damage: actor.combatStats?.meleeDamage })));
  });
});
