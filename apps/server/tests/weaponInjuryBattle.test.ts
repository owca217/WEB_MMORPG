import { describe, expect, it } from "vitest";
import { getBattleAttackPreview, getBattleHealingPreview, getReachableBattleCells, type BattleCommand, type BattleSnapshot, type InjuryKind, type WeaponInjuryUpgrade } from "@web-mmorpg/shared";
import { applyBattleCommand, applyNpcBattleCommand, createBattleState, type BattleState, type CreateCombatantInput } from "../src/battle/BattleEngine";
import { chooseAutoBattleCommand } from "../src/battle/AutoBattleAi";
import { chooseWolfCommand } from "../src/battle/NpcBattleAi";

const upgrade = (kind: InjuryKind, duration: WeaponInjuryUpgrade["duration"] = 2): WeaponInjuryUpgrade => ({ kind, duration, chancePercent: 15 });
function state(hero: Partial<CreateCombatantInput> = {}, enemy: Partial<CreateCombatantInput> = {}, extras: CreateCombatantInput[] = []): BattleState {
  const cells = Array.from({ length: 9 }, (_, q) => [{ q, r: 0 }, { q, r: 1 }]).flat();
  return createBattleState({ id: "injury", seed: 1, arena: { cells, blockedCells: [], coverCells: [], playerStartCells: [{ q: 0, r: 0 }], enemyStartCells: [{ q: 1, r: 0 }] }, combatants: [
    { id: "hero", ownerPlayerId: "player", side: "player", name: "Hero", hp: 1000, maxHp: 1000, maxAp: 20, initiative: 10, position: { q: 0, r: 0 }, severelyInjured: false, injuries: [], combatStats: { meleeDamage: 100, rangedDamage: 100, armor: 0 }, ...hero },
    { id: "enemy", side: "enemy", name: "Enemy", hp: 1000, maxHp: 1000, maxAp: 20, initiative: 5, position: { q: 1, r: 0 }, severelyInjured: false, injuries: [], combatStats: { meleeDamage: 1, rangedDamage: 0, armor: 0 }, ...enemy }, ...extras
  ] });
}
function act(s: BattleState, command: BattleCommand): BattleState {
  const unit = s.combatants[command.combatantId]!;
  const result = unit.ownerPlayerId ? applyBattleCommand(s, unit.ownerPlayerId, command) : applyNpcBattleCommand(s, command);
  expect(result.ok, !result.ok ? result.code : "").toBe(true);
  if (!result.ok) throw new Error(result.code);
  return result.state;
}
const end = (s: BattleState): BattleState => act(s, { type: "endTurn", combatantId: s.activeCombatantId });
const hit = (s: BattleState, targetId = "enemy"): BattleState => act(s, { type: "meleeAttack", combatantId: "hero", targetId });
function snapshot(s: BattleState): BattleSnapshot { return { id: s.id, round: s.round, activeCombatantId: s.activeCombatantId, turnOrder: s.turnOrder, combatants: Object.values(s.combatants), cells: s.arena.cells, blockedCells: s.arena.blockedCells, coverCells: [], finished: s.finished }; }

describe("weapon injury battles", () => {
  it("rolls once per attacker/target own turn, retains source immutability, and rerolls next turn", () => {
    const initial = state({ weaponInjuryUpgrade: upgrade("bleeding") });
    const first = hit(initial);
    expect(first.combatants.enemy!.temporaryInjuries).toEqual([{ kind: "bleeding", remainingTurns: 2 }]);
    expect(initial.combatants.enemy!.temporaryInjuries ?? []).toEqual([]);
    const second = hit(first);
    expect(second.injuryRandomState).toBe(first.injuryRandomState);
    const nextTurn = hit(end(end(second)));
    expect(nextTurn.injuryRandomState).not.toBe(first.injuryRandomState);
    expect(nextTurn.combatants.enemy!.temporaryInjuries).toEqual([{ kind: "bleeding", remainingTurns: 2 }]);
    expect(nextTurn.combatants.enemy!.injuries).toEqual([]);
  });

  it("advances the random stream for another target in the same turn", () => {
    const extra = { ...state().combatants.enemy!, id: "other", position: { q: 0, r: 1 } };
    const first = hit(state({ weaponInjuryUpgrade: upgrade("bleeding") }, {}, [extra]));
    const other = hit(first, "other");
    expect(other.injuryRandomState).not.toBe(first.injuryRandomState);
    expect(other.combatants.other!.temporaryInjuries).toHaveLength(1);
  });

  it("does not retry a failed proc or advance randomness for a rejected attack", () => {
    const initial = state({ weaponInjuryUpgrade: upgrade("bleeding") });
    initial.injuryRandomState = 12345;
    expect(applyBattleCommand(initial, "player", { type: "meleeAttack", combatantId: "hero", targetId: "missing" }).ok).toBe(false);
    expect(initial.injuryRandomState).toBe(12345);
    const first = hit(initial);
    expect(first.combatants.enemy!.temporaryInjuries ?? []).toEqual([]);
    const second = hit(first);
    expect(second.injuryRandomState).toBe(first.injuryRandomState);
    expect(second.combatants.enemy!.temporaryInjuries ?? []).toEqual([]);
  });

  it("counts two complete target turns and applies DOT before expiry", () => {
    let s = hit(state({ weaponInjuryUpgrade: upgrade("bleeding") }));
    s = end(s); expect(s.combatants.enemy!.temporaryInjuries?.[0]?.remainingTurns).toBe(2);
    s = end(s); expect(s.combatants.enemy!.temporaryInjuries?.[0]?.remainingTurns).toBe(1);
    s = end(end(s));
    expect(s.combatants.enemy!.temporaryInjuries ?? []).toEqual([]);
    expect(s.combatants.enemy!.hp).toBe(890);
  });

  it.each([5, null] as const)("never shortens existing duration %s when the same kind is refreshed", remainingTurns => {
    const s = hit(state({ weaponInjuryUpgrade: upgrade("bleeding") }, { temporaryInjuries: [{ kind: "bleeding", remainingTurns }] }));
    expect(s.combatants.enemy!.temporaryInjuries).toEqual([{ kind: "bleeding", remainingTurns }]);
  });

  it("extends an existing kind at the three-kind cap without stacking", () => {
    const s = hit(state({ weaponInjuryUpgrade: upgrade("bleeding", 5) }, { temporaryInjuries: [{ kind: "bleeding", remainingTurns: 2 }, { kind: "poison", remainingTurns: 2 }, { kind: "burn", remainingTurns: 2 }] }));
    expect(s.combatants.enemy!.temporaryInjuries).toEqual([{ kind: "bleeding", remainingTurns: 5 }, { kind: "poison", remainingTurns: 2 }, { kind: "burn", remainingTurns: 2 }]);
  });

  it("retains battle-long effects across target turns", () => {
    let s = hit(state({ weaponInjuryUpgrade: upgrade("concussion", "battle") }));
    for (let i = 0; i < 6; i++) s = end(s);
    expect(s.combatants.enemy!.temporaryInjuries).toEqual([{ kind: "concussion", remainingTurns: null }]);
  });

  it("limits temporary injuries to three kinds while allowing existing kinds to refresh", () => {
    const temporaryInjuries = [{ kind: "bleeding" as const, remainingTurns: 2 }, { kind: "poison" as const, remainingTurns: 2 }, { kind: "burn" as const, remainingTurns: 2 }];
    const s = hit(state({ weaponInjuryUpgrade: upgrade("handInjury") }, { temporaryInjuries }));
    expect(s.combatants.enemy!.temporaryInjuries).toEqual(temporaryInjuries);
  });

  it("deduplicates permanent and temporary bleeding and poison at end of turn", () => {
    const initial = state({ injuries: ["bleeding", "poison"], temporaryInjuries: [{ kind: "bleeding", remainingTurns: 2 }, { kind: "poison", remainingTurns: 2 }] });
    const s = end(initial);
    expect(s.combatants.hero!.hp).toBe(975);
    expect(s.combatants.hero!.injuries).toEqual(["bleeding", "poison"]);
  });

  it("applies chest AP reduction from the very first own turn", () => {
    expect(state({ temporaryInjuries: [{ kind: "chestWound", remainingTurns: 2 }] }).combatants.hero!.ap).toBe(19);
  });

  it("charges shoulder only on the first melee attack and shows the same preview", () => {
    const initial = state({ temporaryInjuries: [{ kind: "dislocatedShoulder", remainingTurns: 2 }] });
    expect(getBattleAttackPreview(snapshot(initial), "hero", "enemy")?.apCost).toBe(3);
    const first = hit(initial); expect(first.combatants.hero!.ap).toBe(17);
    expect(getBattleAttackPreview(snapshot(first), "hero", "enemy")?.apCost).toBe(2);
    expect(hit(first).combatants.hero!.ap).toBe(15);
  });

  it("applies hand and burn damage once and matches the preview", () => {
    const initial = state({ injuries: ["handInjury"], temporaryInjuries: [{ kind: "handInjury", remainingTurns: 2 }] }, { temporaryInjuries: [{ kind: "burn", remainingTurns: 2 }] });
    expect(getBattleAttackPreview(snapshot(initial), "hero", "enemy")?.averageDamage).toBe(94);
    expect(hit(initial).combatants.enemy!.hp).toBe(906);
  });

  it("charges broken arm for ranged attacks and limits an injured eye to five cells", () => {
    const s = state({ temporaryInjuries: [{ kind: "brokenArm", remainingTurns: 2 }, { kind: "eyeInjury", remainingTurns: 2 }] }, { position: { q: 6, r: 0 } });
    expect(getBattleAttackPreview(snapshot(s), "hero", "enemy")).toMatchObject({ apCost: 4, available: false });
    expect(applyBattleCommand(s, "player", { type: "rangedAttack", combatantId: "hero", targetId: "enemy" })).toMatchObject({ ok: false, code: "OUT_OF_RANGE" });
  });

  it("caps tendon movement per own turn, including several separate commands", () => {
    let s = state({ temporaryInjuries: [{ kind: "tendonStrain", remainingTurns: 2 }] }, { position: { q: 8, r: 0 } });
    s = act(s, { type: "move", combatantId: "hero", target: { q: 2, r: 0 } });
    expect(getReachableBattleCells(snapshot(s), "hero")).not.toContainEqual({ q: 4, r: 0 });
    expect(applyBattleCommand(s, "player", { type: "move", combatantId: "hero", target: { q: 4, r: 0 } })).toMatchObject({ ok: false, code: "MOVEMENT_LIMIT" });
  });

  it("charges leg AP, thigh damage capped at six, and one back surcharge after an attack", () => {
    let s = state({ injuries: ["legTrauma", "thighWound", "backInjury"] });
    s = hit(s);
    s = act(s, { type: "move", combatantId: "hero", target: { q: 0, r: 1 } });
    expect(s.combatants.hero!.ap).toBe(15);
    s = act(s, { type: "move", combatantId: "hero", target: { q: 3, r: 1 } });
    expect(s.combatants.hero!.ap).toBe(9);
    expect(s.combatants.hero!.hp).toBe(994);
  });

  it("reduces received healing and restores deep-wound cap on expiry without healing", () => {
    let s = state({ hp: 500, temporaryInjuries: [{ kind: "deepWound", remainingTurns: 2 }, { kind: "abdominalWound", remainingTurns: 2 }], combatStats: { meleeDamage: 100, rangedDamage: 100, healingPower: 100, armor: 0 } });
    expect(s.combatants.hero!.maxHp).toBe(900);
    expect(getBattleHealingPreview(snapshot(s), "hero").amount).toBe(75);
    s = act(s, { type: "healSelf", combatantId: "hero" });
    expect(s.combatants.hero!.hp).toBe(575);
    s = end(end(end(s)));
    expect(s.combatants.hero!.maxHp).toBe(1000);
    expect(s.combatants.hero!.hp).toBe(575);
  });

  it("uses the base maximum for poison while deep wound is active", () => {
    const s = end(state({ maxHp: 101, hp: 101, temporaryInjuries: [{ kind: "deepWound", remainingTurns: 2 }, { kind: "poison", remainingTurns: 2 }] }));
    expect(s.combatants.hero).toMatchObject({ maxHp: 90, hp: 87 });
  });

  it("does not create weapon procs from healing or periodic damage", () => {
    let s = state({ hp: 500, weaponInjuryUpgrade: upgrade("handInjury"), injuries: ["bleeding"], combatStats: { meleeDamage: 100, rangedDamage: 100, healingPower: 20, armor: 0 } });
    s = act(s, { type: "healSelf", combatantId: "hero" });
    s = end(s);
    expect(s.combatants.hero!.temporaryInjuries ?? []).toEqual([]);
    expect(s.combatants.enemy!.temporaryInjuries ?? []).toEqual([]);
    expect(s.injuryRandomState).toBe(1);
  });

  it("updates upcoming concussion turn order without repeating or skipping already acted units", () => {
    const extra = { ...state().combatants.enemy!, id: "other", initiative: 4, position: { q: 0, r: 1 } };
    let s = hit(state({ weaponInjuryUpgrade: upgrade("concussion") }, {}, [extra]));
    s = end(s); expect(s.activeCombatantId).toBe("other");
    s = end(s); expect(s.activeCombatantId).toBe("enemy");
    s = end(s); expect(s.activeCombatantId).toBe("hero");
    expect(s.round).toBe(2);
  });

  it.each(["auto", "npc"])("keeps %s AI within injured movement and first-melee AP limits", kind => {
    const s = state({ position: { q: 0, r: 0 } }, { position: { q: 6, r: 0 } });
    const actor = kind === "auto" ? s.combatants.hero! : s.combatants.enemy!;
    s.activeCombatantId = actor.id; actor.ap = 2;
    actor.injuries = ["legTrauma", "tendonStrain", "dislocatedShoulder", "eyeInjury", "backInjury"];
    actor.attackedThisTurn = true; actor.movedHexesThisTurn = 3;
    const command = kind === "auto" ? chooseAutoBattleCommand(s, "player") : chooseWolfCommand(s, "enemy");
    expect(command.type).toBe("endTurn");
    expect(kind === "auto" ? applyBattleCommand(s, "player", command).ok : applyNpcBattleCommand(s, command).ok).toBe(true);
  });

  it("lets Auto plan a first shoulder attack for 3 AP followed by a 2 AP finishing attack", () => {
    const s = state({ maxAp: 5, injuries: ["dislocatedShoulder"], combatStats: { meleeDamage: 60, rangedDamage: 90, armor: 0 } }, { hp: 110 });
    const first = chooseAutoBattleCommand(s, "player");
    expect(first.type).toBe("meleeAttack");
    const afterFirst = act(s, first), second = chooseAutoBattleCommand(afterFirst, "player");
    expect(second.type).toBe("meleeAttack");
    expect(act(afterFirst, second).finished).toBe(true);
  });
});
