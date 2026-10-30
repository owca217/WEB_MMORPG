import { expect, it } from "vitest";
import { getCharacterStatistics, type CharacterSnapshot, type BattleSnapshot } from "@web-mmorpg/shared";
import { BattleService } from "../src/battle/BattleService";
import { combatEquipment } from "./combatEquipmentFixtures";
const hero = (id: string, hp = 100): CharacterSnapshot => ({ playerId: id, nickname: id, level: 1, hp, maxHp: 100, maxAp: 5, initiative: 10, severelyInjured: false, injuries: [], statistics: getCharacterStatistics(1) });
it("creates one shared arena with five distinct player starts and five scaled enemies", () => {
  const service = new BattleService(); const snapshot = service.startPartyBattle(["a", "b", "c", "d", "e"].map(id => hero(id)), "wolf-pack-01");
  expect(service.getParticipantIds("a")).toEqual(["a", "b", "c", "d", "e"]);
  expect(snapshot.combatants.filter(c => c.side === "player")).toHaveLength(5); expect(snapshot.combatants.filter(c => c.side === "enemy")).toHaveLength(5);
  expect(new Set(snapshot.combatants.map(c => `${c.position.q},${c.position.r}`)).size).toBe(10);
  expect(service.getSnapshot("e")?.id).toBe(snapshot.id); expect(service.getSnapshot("e")?.participantIds).toEqual(["a", "b", "c", "d", "e"]);
});
it("gives repeated encounters distinct battle IDs for settlement and stale-response guards", () => {
  const service = new BattleService();
  const first = service.startPartyBattle([hero("a"), hero("b")], "wolf-pack-01");
  service.removeBattleForPlayer("a"); service.removeBattleForPlayer("b");
  const second = service.startPartyBattle([hero("a"), hero("b")], "wolf-pack-01");
  expect(second.id).not.toBe(first.id);
});
it("enforces each player's ownership and own turn while sharing mutations", () => {
  const service = new BattleService(), initial = service.startPartyBattle([hero("a"), hero("b")], "wolf-pack-01");
  expect(service.getActivePlayerId("b")).toBe("a");
  expect(service.applyCommand("b", { type: "endTurn", combatantId: "hero:a" }).result).toMatchObject({ ok: false, code: "NOT_OWNER" });
  expect(service.applyCommand("b", { type: "endTurn", combatantId: "hero:b" }).result).toMatchObject({ ok: false, code: "NOT_ACTIVE_TURN" });
  const applied = service.applyCommand("a", { type: "endTurn", combatantId: initial.activeCombatantId }); expect(applied.result.ok).toBe(true);
  expect(service.getActivePlayerId("a")).toBe("b"); expect(service.getSnapshot("a")?.combatants).toEqual(service.getSnapshot("b")?.combatants);
});
it("keeps Auto individual and executes only the currently active owner's Auto", () => {
  const service = new BattleService(); service.startPartyBattle([hero("a"), hero("b")], "wolf-pack-01"); service.setAuto("a", true);
  expect(service.getSnapshot("a")?.autoBattle).toBe(true); expect(service.getSnapshot("b")?.autoBattle).not.toBe(true);
  expect(service.applyAutoCommand("b").result.ok).toBe(false);
  const result = service.applyAutoCommand("a"); expect(result.result.ok).toBe(true);
  service.setAuto("a", false); expect(service.isAuto("a")).toBe(false);
});
it("reports terminal outcomes for every remaining participant and the original roster size", () => {
  const service = new BattleService(); const chars = [hero("a"), hero("b")]; for (const c of chars) c.statistics!.meleeDamage = c.statistics!.rangedDamage = 1000;
  service.startPartyBattle(chars, "wolf-pack-01"); service.setAuto("a", true); service.setAuto("b", true);
  let terminal;
  for (let i = 0; i < 300; i++) { const id = service.getActivePlayerId("a")!; const applied = service.applyAutoCommand(id); expect(applied.result.ok).toBe(true); if (applied.finished) { terminal = applied; break; } }
  expect(terminal?.victory).toBe(true); expect(terminal?.initialParticipantCount).toBe(2); expect(Object.keys(terminal?.playerOutcomes ?? {}).sort()).toEqual(["a", "b"]); expect(terminal?.experienceReward).toBe(80);
});
it("detaches an active leaver, advances the shared turn and preserves the others' battle", () => {
  const service = new BattleService(); service.startPartyBattle([hero("a", 70), hero("b")], "wolf-pack-01");
  const removed = service.detachPlayer("a"); expect(removed.outcome?.hp).toBe(70); expect(service.hasBattle("a")).toBe(false);
  expect(service.getParticipantIds("b")).toEqual(["b"]); expect(removed.applied?.participantIds).toEqual(["b"]); expect(service.getActivePlayerId("b")).toBe("b");
  expect(service.getSnapshot("b")?.combatants.some(c => c.ownerPlayerId === "a")).toBe(false);
});
it("shares the asynchronous item lock across all aliases and refuses detach while it is pending", async () => {
  const service = new BattleService(); service.startPartyBattle([hero("a", 50), hero("b")], "wolf-pack-01"); let done!: () => void;
  const wait = new Promise<void>(resolve => { done = resolve; });
  const operation = service.useConsumable("a", "hero:a", async prepare => { prepare({ healHp: 10 }); await wait; return { items: [] }; });
  expect(service.isItemUsePending("b")).toBe(true); expect(service.applyCommand("b", { type: "endTurn", combatantId: "hero:b" }).result).toMatchObject({ ok: false, code: "BATTLE_ACTION_PENDING" });
  expect(() => service.detachPlayer("a")).toThrow("BATTLE_ACTION_PENDING"); done(); await operation;
  expect(service.getSnapshot("b")?.combatants.find(c => c.ownerPlayerId === "a")?.hp).toBe(60); expect(service.isItemUsePending("b")).toBe(false);
});
it("heals an allied hero and records the equipped staff only for the caster at battle end", () => {
  const service = new BattleService(), caster = hero("a"); caster.equipment=combatEquipment("staff");
  service.startPartyBattle([caster, hero("b", 40)], "wolf-pack-01");
  const result = service.applyCommand("a", { type: "healAlly", combatantId: "hero:a", targetId: "hero:b" });
  expect(result.result.ok).toBe(true); expect(service.getSnapshot("b")?.combatants.find(c => c.id === "hero:b")?.hp).toBe(60);
  expect(result.trainingAwards).toBeUndefined();expect(result.usedWeaponFamilies).toBeUndefined();
  service.setAuto("a",true);service.setAuto("b",true);let terminal;
  for(let i=0;i<400;i++){const applied=service.applyAutoCommand(service.getActivePlayerId("a")!);expect(applied.result.ok).toBe(true);if(applied.finished){terminal=applied;break;}}
  expect(terminal?.usedWeaponFamilies).toEqual({a:["staff"],b:[]});
});
it("attributes NPC shield blocks to the damaged teammate even when another player ended the turn", () => {
  const service = new BattleService(), a = hero("a"); a.equipment=combatEquipment("sword",true);
  service.startPartyBattle([a, hero("b")], "wolf-pack-01"); service.setAuto("a", true); service.setAuto("b", true);
  let found = false,blocks=0,terminal;
  for (let i = 0; i < 400; i++) {
    const id = service.getActivePlayerId("a")!, result = service.applyAutoCommand(id); expect(result.result.ok).toBe(true);
    const next=result.result.ok?(result.result.state.combatants["hero:a"]?.shieldBlocks??0):blocks;
    if(id==="b"&&next>blocks)found=true;blocks=next;
    expect(result.trainingAwards).toBeUndefined();
    if (result.finished) {terminal=result;break;}
  }
  expect(found).toBe(true);expect(terminal?.usedWeaponFamilies?.a).toContain("shield");expect(terminal?.usedWeaponFamilies?.b).not.toContain("shield");
});
