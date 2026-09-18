import { DEFAULT_APPEARANCE, type BattleSnapshot, type CharacterSnapshot } from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { BattleService } from "../src/battle/BattleService";

const character: CharacterSnapshot = {
  playerId: "player-1",
  nickname: "Hero",
  appearance: DEFAULT_APPEARANCE,
  level: 1,
  hp: 37,
  maxHp: 100,
  maxAp: 5,
  initiative: 10,
  severelyInjured: true,
  injuries: ["legTrauma"]
};

describe("BattleService character state and NPC turns", () => {
  it("starts the hero from the current character snapshot", () => {
    const service = new BattleService();
    const startBattle = service.startBattle as unknown as (
      character: CharacterSnapshot,
      encounterId: string
    ) => BattleSnapshot;

    const initial = startBattle.call(service, character, "encounter:wolf");
    const hero = initial.combatants.find(
      (combatant) => combatant.ownerPlayerId === character.playerId
    );

    expect(hero).toMatchObject({
      name: "Hero",
      hp: 37,
      maxHp: 100,
      maxAp: 5,
      initiative: 10,
      severelyInjured: true,
      injuries: ["legTrauma"]
    });
  });

  it("runs the wolf turn automatically and returns control to the player", () => {
    const service = new BattleService();
    const startBattle = service.startBattle as unknown as (
      character: CharacterSnapshot,
      encounterId: string
    ) => BattleSnapshot;
    const initial = startBattle.call(service, { ...character, hp: 100, severelyInjured: false, injuries: [] }, "encounter:wolf");

    const hero = initial.combatants.find(
      (combatant) => combatant.ownerPlayerId === character.playerId
    );
    const wolf = initial.combatants.find((combatant) => combatant.ownerPlayerId === undefined);

    expect(hero).toBeDefined();
    expect(wolf).toBeDefined();
    if (!hero || !wolf) throw new Error("Expected hero and wolf combatants.");

    const result = service.applyCommand(character.playerId, {
      type: "endTurn",
      combatantId: hero.id
    });

    expect(result.result.ok).toBe(true);
    expect(result.snapshot?.activeCombatantId).toBe(hero.id);
  });
});
