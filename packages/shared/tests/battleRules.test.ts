import { describe, expect, it } from "vitest";
import { getBattleAttackPreview, getReachableBattleCells, type BattleSnapshot, type CombatantSnapshot } from "../src/index";

const hero: CombatantSnapshot = { id: "hero", ownerPlayerId: "p1", side: "player", name: "Hero", hp: 100, maxHp: 100,
  ap: 5, maxAp: 5, initiative: 10, position: { q: 0, r: 0 }, severelyInjured: false, injuries: [],
  combatStats: { meleeDamage: 30, rangedDamage: 20, armor: 0 } };
const wolf: CombatantSnapshot = { ...hero, id: "wolf", ownerPlayerId: "enemy", side: "enemy", name: "Wolf",
  position: { q: 1, r: 0 }, combatStats: { meleeDamage: 10, rangedDamage: 0, armor: 100 } };
function battle(overrides: Partial<BattleSnapshot> = {}): BattleSnapshot {
  return { id: "b", round: 1, activeCombatantId: "hero", turnOrder: ["hero", "wolf"],
    cells: [{q:0,r:0},{q:1,r:0},{q:2,r:0},{q:3,r:0},{q:0,r:1},{q:1,r:1},{q:2,r:1}], blockedCells: [], coverCells: [],
    combatants: [{...hero}, {...wolf}], finished: false, ...overrides };
}
describe("battle previews and movement", () => {
  it("uses the equipped bow at adjacent range and suppresses attacks disabled by equipment",()=>{
    const state=battle();
    state.combatants[0]!.combatStats={meleeDamage:0,rangedDamage:20,armor:0,meleeEnabled:false,rangedEnabled:true};
    expect(getBattleAttackPreview(state,"hero","wolf")).toMatchObject({type:"rangedAttack",apCost:3,available:true,averageDamage:10});
    state.combatants[0]!.combatStats={meleeDamage:30,rangedDamage:0,armor:0,meleeEnabled:true,rangedEnabled:false};
    state.combatants[1]!.position={q:3,r:0};
    expect(getBattleAttackPreview(state,"hero","wolf")).toMatchObject({available:false,averageDamage:0,hitChance:0});
  });
  it("selects adjacent melee and distant ranged with the same armor-adjusted damage and costs as combat", () => {
    const state = battle();
    expect(getBattleAttackPreview(state,"hero","wolf")).toMatchObject({ type: "meleeAttack", apCost: 2, hitChance: 100, averageDamage: 15, available: true });
    state.combatants[1]!.position = { q: 3, r: 0 };
    expect(getBattleAttackPreview(state,"hero","wolf")).toMatchObject({ type: "rangedAttack", apCost: 3, hitChance: 100, averageDamage: 10, available: true });
    state.combatants[0]!.injuries = ["brokenArm"];
    state.combatants[0]!.ap = 3;
    expect(getBattleAttackPreview(state,"hero","wolf")).toMatchObject({ apCost: 4, available: false });
  });
  it("blocks impossible shots and never allows allies, dead targets or commands outside own turn", () => {
    const state = battle();
    state.combatants[1]!.position = {q:3,r:0}; state.blockedCells = [{q:1,r:0}];
    expect(getBattleAttackPreview(state,"hero","wolf")).toMatchObject({ hitChance:0, averageDamage:0, available:false });
    state.blockedCells = []; state.combatants[1]!.position = {q:7,r:0};
    expect(getBattleAttackPreview(state,"hero","wolf")?.available).toBe(false);
    state.combatants[1]!.position = {q:1,r:0}; state.activeCombatantId="wolf";
    expect(getBattleAttackPreview(state,"hero","wolf")?.available).toBe(false);
    state.activeCombatantId="hero"; state.combatants[1]!.side="player";
    expect(getBattleAttackPreview(state,"hero","wolf")).toBeNull();
    state.combatants[1]!.side="enemy"; state.combatants[1]!.hp=0;
    expect(getBattleAttackPreview(state,"hero","wolf")).toBeNull();
  });
  it("highlights only cells reachable around obstacles and living occupants within injured AP cost", () => {
    const state = battle({blockedCells:[{q:1,r:1}]});
    state.combatants[0]!.ap=2;
    expect(getReachableBattleCells(state,"hero")).toEqual([{q:0,r:1}]);
    state.combatants[1]!.hp=0;
    const reachable=getReachableBattleCells(state,"hero");
    expect(reachable).toContainEqual({q:2,r:0});
    expect(reachable).not.toContainEqual({q:0,r:0});
    expect(reachable).not.toContainEqual({q:1,r:1});
    state.combatants[0]!.injuries=["legTrauma"];
    expect(getReachableBattleCells(state,"hero")).toHaveLength(2);
    state.activeCombatantId="wolf";
    expect(getReachableBattleCells(state,"hero")).toEqual([]);
  });
});
