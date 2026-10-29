import type { CharacterSnapshot, InventorySnapshot } from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { BattleService } from "../src/battle/BattleService";

const character: CharacterSnapshot = {
  playerId: "player-1", nickname: "Hero", level: 1, hp: 81, maxHp: 100,
  maxAp: 5, initiative: 10, severelyInjured: true, injuries: ["bleeding"]
};
const inventory: InventorySnapshot = { items: [] };
const heroId = "hero:player-1";
const hero = (service: BattleService) => service.getSnapshot(character.playerId)!.combatants.find((entry) => entry.id === heroId)!;

describe("battle consumables", () => {
  it("heals up to maximum HP, charges two AP and preserves injuries after persistence succeeds", async () => {
    const service = new BattleService();
    service.startBattle(character, "wolves");
    const result = await service.useConsumable(character.playerId, heroId, async (prepare) => {
      expect(prepare({ healHp: 30 })).toEqual({ hp: 100, severelyInjured: true, injuries: ["bleeding"] });
      expect(hero(service)).toMatchObject({ hp: 81, ap: 5 });
      return inventory;
    });
    expect(hero(service)).toMatchObject({ hp: 100, ap: 3, severelyInjured: true, injuries: ["bleeding"] });
    expect(result.inventory).toBe(inventory);
    expect(result.snapshot.activeCombatantId).toBe(heroId);
  });

  it("keeps live battle HP and AP unchanged when persistence fails and allows retry", async () => {
    const service = new BattleService();
    service.startBattle(character, "wolves");
    await expect(service.useConsumable(character.playerId, heroId, async (prepare) => {
      prepare({ healHp: 30 });
      throw new Error("DATABASE_UNAVAILABLE");
    })).rejects.toThrow("DATABASE_UNAVAILABLE");
    expect(hero(service)).toMatchObject({ hp: 81, ap: 5 });
    await service.useConsumable(character.playerId, heroId, async (prepare) => {
      prepare({ healHp: 30 });
      return inventory;
    });
    expect(hero(service)).toMatchObject({ hp: 100, ap: 3 });
  });

  it("blocks commands and another use while the first transaction is pending", async () => {
    const service = new BattleService();
    service.startBattle(character, "wolves");
    let commit!: () => void;
    const committed = new Promise<void>((resolve) => { commit = resolve; });
    const pending = service.useConsumable(character.playerId, heroId, async (prepare) => {
      prepare({ healHp: 30 });
      await committed;
      return inventory;
    });
    expect(service.applyCommand(character.playerId, { type: "endTurn", combatantId: heroId }).result)
      .toMatchObject({ ok: false, code: "BATTLE_ACTION_PENDING" });
    await expect(service.useConsumable(character.playerId, heroId, async () => inventory))
      .rejects.toThrow("BATTLE_ACTION_PENDING");
    commit();
    await pending;
    expect(hero(service)).toMatchObject({ hp: 100, ap: 3 });
  });

  it("rejects enemy ownership, insufficient AP and effects with no benefit", async () => {
    const service = new BattleService();
    service.startBattle({ ...character, hp: 100 }, "wolves");
    const consume = async (prepare: (effects: { healHp?: number; restoreAp?: number }) => unknown) => {
      prepare({ healHp: 30 });
      return inventory;
    };
    await expect(service.useConsumable(character.playerId, "wolf:wolves", consume)).rejects.toThrow("NOT_OWNER");
    await expect(service.useConsumable(character.playerId, heroId, consume)).rejects.toThrow("ITEM_NO_EFFECT");
    expect(hero(service).ap).toBe(5);
    service.startBattle({ ...character, maxAp: 1 }, "wolves");
    await expect(service.useConsumable(character.playerId, heroId, consume)).rejects.toThrow("INSUFFICIENT_AP");
    expect(hero(service)).toMatchObject({ hp: 81, ap: 1 });
  });

  it("restores AP from a useful published effect without exceeding max AP", async () => {
    const service = new BattleService();
    service.startBattle(character, "wolves");
    const use = (effects: { healHp?: number; restoreAp?: number }) => service.useConsumable(character.playerId, heroId, async (prepare) => {
      prepare(effects);
      return inventory;
    });
    await expect(use({ restoreAp: 8 })).rejects.toThrow("ITEM_NO_EFFECT");
    await use({ healHp: 1 });
    expect(hero(service).ap).toBe(3);
    await use({ restoreAp: 8 });
    expect(hero(service)).toMatchObject({ hp: 82, ap: 5 });
  });
});
