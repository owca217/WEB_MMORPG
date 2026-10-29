import { expect, it } from "vitest";
import { getBattleHealingPreview, type BattleSnapshot } from "@web-mmorpg/shared";
import { applyBattleCommand, createBattleState, type BattleState } from "../src/battle/BattleEngine";
import { generateArena } from "../src/battle/arenaGenerator";
import { chooseAutoBattleCommand } from "../src/battle/AutoBattleAi";
function state(): BattleState {
  const arena = generateArena({ radius: 4, obstacleCount: 0, coverCount: 0 }, 1);
  return createBattleState({
id: "party-heal", seed: 1, arena, combatants: [
      { id: "a", ownerPlayerId: "a", side: "player", name: "A", hp: 100, maxHp: 100, maxAp: 5, initiative: 10, position: { q: 0, r: 0 }, severelyInjured: false, injuries: [], combatStats: { meleeDamage: 20, rangedDamage: 15, armor: 0, healingPower: 25 } },
      { id: "b", ownerPlayerId: "b", side: "player", name: "B", hp: 20, maxHp: 100, maxAp: 5, initiative: 9, position: { q: 0, r: 1 }, severelyInjured: true, injuries: ["bleeding"] },
      { id: "c", ownerPlayerId: "c", side: "player", name: "C", hp: 30, maxHp: 100, maxAp: 5, initiative: 8, position: { q: 1, r: 0 }, severelyInjured: false, injuries: [] },
      { id: "enemy", side: "enemy", name: "E", hp: 20, maxHp: 100, maxAp: 4, initiative: 1, position: { q: 2, r: 0 }, severelyInjured: false, injuries: [] }
    ]
});
}
function snapshot(s: BattleState): BattleSnapshot { return { ...s, cells: s.arena.cells, blockedCells: s.arena.blockedCells, coverCells: s.arena.coverCells, combatants: Object.values(s.combatants) }; }
it("ally preview agrees with actual HP restored and shares the once-per-turn staff limit", () => {
  const s = state(); expect(getBattleHealingPreview(snapshot(s), "a", "b")).toMatchObject({ available: true, amount: 25, apCost: 3 });
  const result = applyBattleCommand(s, "a", { type: "healAlly", combatantId: "a", targetId: "b" }); if (!result.ok) throw new Error(result.code);
  expect(result.state.combatants.b).toMatchObject({ hp: 45, injuries: ["bleeding"], severelyInjured: true }); expect(result.state.combatants.a).toMatchObject({ ap: 2, healingUsedThisTurn: true });
  expect(getBattleHealingPreview(snapshot(result.state), "a", "c").available).toBe(false);
  expect(applyBattleCommand(result.state, "a", { type: "healSelf", combatantId: "a" })).toMatchObject({ ok: false, code: "HEAL_ALREADY_USED" });
});
it.each(["enemy", "down", "full", "far", "blocked"])("rejects invalid ally healing without mutation: %s", reason => {
  const s = state(); let targetId = "b";
  if (reason === "enemy") targetId = "enemy";
  if (reason === "down") s.combatants.b!.hp = 0;
  if (reason === "full") s.combatants.b!.hp = 100;
  if (reason === "far") s.combatants.b!.position = { q: 7, r: 0 };
  if (reason === "blocked") { s.combatants.b!.position = { q: 2, r: 0 }; s.arena.blockedCells = [{ q: 1, r: 0 }]; }
  const before = structuredClone(s); expect(getBattleHealingPreview(snapshot(s), "a", targetId).available).toBe(false);
  expect(applyBattleCommand(s, "a", { type: "healAlly", combatantId: "a", targetId }).ok).toBe(false); expect(s).toEqual(before);
});
it("Auto chooses the lowest-health legal ally and skips an unreachable one", () => {
  const s = state(); expect(chooseAutoBattleCommand(s, "a")).toEqual({ type: "healAlly", combatantId: "a", targetId: "b" });
  s.combatants.b!.position = { q: 7, r: 0 }; expect(chooseAutoBattleCommand(s, "a")).toEqual({ type: "healAlly", combatantId: "a", targetId: "c" });
});
