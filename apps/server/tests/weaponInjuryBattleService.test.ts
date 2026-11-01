import { expect, it } from "vitest";
import { type CharacterSnapshot } from "@web-mmorpg/shared";
import { BattleService } from "../src/battle/BattleService";
import { type BattleState } from "../src/battle/BattleEngine";
import { combatEquipment } from "./combatEquipmentFixtures";

const character = (): CharacterSnapshot => ({ playerId: "p", nickname: "Hero", level: 1, hp: 50, maxHp: 100, maxAp: 8, initiative: 10, severelyInjured: false, injuries: ["legTrauma"], equipment: combatEquipment("sword") });
function live(service: BattleService): BattleState {
  return (service as unknown as { battlesByPlayer: Map<string, { state: BattleState }> }).battlesByPlayer.get("p")!.state;
}

it.each(["sword","wand"] as const)("copies a validated equipped %s roll into battle and exposes its temporary proc", family => {
  const service = new BattleService(), hero = character();
  hero.equipment=combatEquipment(family);
  hero.equipment!.mainHand!.quality = "EXCELLENT";
  hero.equipment!.mainHand!.injuryUpgrade = { kind: "bleeding", chancePercent: 15, duration: 2 };
  service.startBattle(hero, "wolves");
  const battle = live(service), actor = battle.combatants["hero:p"]!, enemy = Object.values(battle.combatants).find(unit => unit.side === "enemy")!;
  battle.injuryRandomState = 1; battle.arena.blockedCells = []; actor.position = { q: 0, r: 0 }; enemy.position = { q: 1, r: 0 };
  const result = service.applyCommand("p", { type: family==="wand"?"rangedAttack":"meleeAttack", combatantId: actor.id, targetId: enemy.id });
  expect(result.result.ok).toBe(true);
  expect(result.snapshot?.combatants.find(unit => unit.id === enemy.id)?.temporaryInjuries).toEqual([{ kind: "bleeding", remainingTurns: 2 }]);
  expect(actor.weaponInjuryUpgrade).not.toBe(hero.equipment!.mainHand!.injuryUpgrade);
});

it.each(["quality", "duration", "broken"])("ignores an equipped injury roll with invalid %s", invalid => {
  const service = new BattleService(), hero = character(), weapon = hero.equipment!.mainHand!;
  weapon.quality = invalid === "quality" ? "NORMAL" : "EXCELLENT";
  weapon.injuryUpgrade = { kind: "bleeding", chancePercent: 15, duration: invalid === "duration" ? 5 : 2 };
  if (invalid === "broken") weapon.durability = 0;
  service.startBattle(hero, "wolves");
  expect(live(service).combatants["hero:p"]!.weaponInjuryUpgrade).toBeUndefined();
});

it("reduces potion healing and saves only permanent injuries while keeping battle timers", async () => {
  const service = new BattleService(); service.startBattle(character(), "wolves");
  live(service).combatants["hero:p"]!.temporaryInjuries = [{ kind: "abdominalWound", remainingTurns: 3 }, { kind: "poison", remainingTurns: 2 }];
  const result = await service.useConsumable("p", "hero:p", async prepare => {
    expect(prepare({ healHp: 20 })).toEqual({ hp: 65, severelyInjured: false, injuries: ["legTrauma"] });
    return { items: [] };
  });
  expect(result.playerOutcome.injuries).toEqual(["legTrauma"]);
  expect(result.snapshot.combatants.find(unit => unit.id === "hero:p")?.temporaryInjuries).toHaveLength(2);
});

it("discards temporary injuries from disconnect outcomes", () => {
  const service = new BattleService(); service.startBattle(character(), "wolves");
  live(service).combatants["hero:p"]!.temporaryInjuries = [{ kind: "handInjury", remainingTurns: null }];
  expect(service.detachPlayer("p").outcome).toEqual({ hp: 50, severelyInjured: false, injuries: ["legTrauma"] });
});

it("keeps original defeat injury selection and removes temporary effects from terminal snapshots", () => {
  const service = new BattleService(); service.startBattle(character(), "wolves");
  const battle = live(service), actor = battle.combatants["hero:p"]!, enemy = Object.values(battle.combatants).find(unit => unit.side === "enemy")!;
  actor.hp = 1; actor.temporaryInjuries = [{ kind: "handInjury", remainingTurns: null }];
  enemy.position = { q: 1, r: 0 }; actor.position = { q: 0, r: 0 }; battle.arena.blockedCells = [];
  const result = service.applyCommand("p", { type: "endTurn", combatantId: actor.id });
  expect(result.finished).toBe(true);
  expect(result.playerOutcome?.injuries.length).toBeGreaterThan(0);
  expect(result.playerOutcome?.injuries).not.toContain("handInjury");
  expect(result.snapshot?.combatants.flatMap(unit => unit.temporaryInjuries ?? [])).toEqual([]);
});
