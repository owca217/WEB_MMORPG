import { getCharacterStatistics, type BattleCommand, type BattleSnapshot, type CharacterSnapshot } from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import { BattleService } from "../src/battle/BattleService";
import { findPath, hexDistance, hexKey, hexNeighbors } from "../src/battle/hex";
import { hasLineOfSight } from "../src/battle/lineOfSight";

function leveledCharacter(level: number): CharacterSnapshot {
  const statistics = getCharacterStatistics(level);
  return {
    playerId: "player-1", nickname: "Hero", level,
    hp: statistics.maxHp, maxHp: statistics.maxHp,
    maxAp: statistics.maxAp, initiative: statistics.initiative,
    severelyInjured: false, injuries: []
  };
}

function chooseHeroCommand(snapshot: BattleSnapshot): BattleCommand {
  const hero = snapshot.combatants.find((combatant) => combatant.ownerPlayerId === "player-1")!;
  const enemies = snapshot.combatants.filter((combatant) => !combatant.ownerPlayerId && combatant.hp > 0)
    .sort((a, b) => a.hp - b.hp || a.id.localeCompare(b.id));
  const adjacent = enemies.find((enemy) => hexDistance(hero.position, enemy.position) === 1);
  if (adjacent && hero.ap >= 2) {
    return { type: "meleeAttack", combatantId: hero.id, targetId: adjacent.id };
  }

  const blockers = new Set(snapshot.blockedCells.map(hexKey));
  const shot = enemies.find((enemy) => hexDistance(hero.position, enemy.position) <= 6 &&
    hasLineOfSight(hero.position, enemy.position, blockers));
  if (shot && hero.ap >= (hero.injuries.includes("brokenArm") ? 4 : 3)) {
    return { type: "rangedAttack", combatantId: hero.id, targetId: shot.id };
  }

  if (!adjacent && hero.ap >= (hero.injuries.includes("legTrauma") ? 2 : 1)) {
    const allowed = new Set(snapshot.cells.map(hexKey));
    for (const combatant of snapshot.combatants) {
      if (combatant.id !== hero.id && combatant.hp > 0) blockers.add(hexKey(combatant.position));
    }
    const paths = enemies.flatMap((enemy) => hexNeighbors(enemy.position)
      .filter((cell) => allowed.has(hexKey(cell)) && !blockers.has(hexKey(cell)))
      .map((cell) => findPath(hero.position, cell, blockers, allowed))
      .filter((path): path is NonNullable<typeof path> => path !== null && path.length > 0))
      .sort((a, b) => a.length - b.length);
    if (paths[0]?.[0]) return { type: "move", combatantId: hero.id, target: paths[0][0] };
  }
  return { type: "endTurn", combatantId: hero.id };
}

function simulateBattle(level: number) {
  const service = new BattleService();
  let snapshot = service.startBattle(leveledCharacter(level), "encounter:wolf");
  const actions = { meleeAttack: 0, rangedAttack: 0, move: 0, endTurn: 0, healSelf: 0 };
  for (let guard = 0; guard < 2_000; guard += 1) {
    const command = chooseHeroCommand(snapshot);
    actions[command.type] += 1;
    const result = service.applyCommand("player-1", command);
    if (!result.result.ok || !result.snapshot) throw new Error(`Hero command rejected: ${JSON.stringify(result.result)}`);
    snapshot = result.snapshot;
    if (result.finished) return { ...result, round: snapshot.round, actions, service, command };
  }
  throw new Error("Battle simulation exceeded the action guard.");
}

const character: CharacterSnapshot = {
  playerId: "player-1",
  nickname: "Hero",
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

  it("derives absent hero combat statistics from level without healing current HP or injuries", () => {
    const initial = new BattleService().startBattle({
      ...leveledCharacter(5), hp: 37, severelyInjured: true, injuries: ["concussion"]
    }, "encounter:wolf");
    const hero = initial.combatants.find((combatant) => combatant.ownerPlayerId);
    const wolf = initial.combatants.find((combatant) => !combatant.ownerPlayerId)!;

    expect(hero).toMatchObject({ level: 5, hp: 37, injuries: ["concussion"],
      combatStats: { meleeDamage: 28, rangedDamage: 19, armor: 8 } });
    expect(wolf.initiative).toBeLessThan(hero!.initiative - 2);
  });

  it("isolates battle snapshots and supplied character statistics", () => {
    const service = new BattleService();
    const statistics = getCharacterStatistics(5);
    statistics.meleeDamage = 70;
    const initial = service.startBattle({ ...leveledCharacter(5), statistics }, "encounter:wolf");
    const hero = initial.combatants.find((combatant) => combatant.ownerPlayerId)!;
    expect(hero.combatStats?.meleeDamage).toBe(70);
    statistics.meleeDamage = 999;
    hero.combatStats!.meleeDamage = 888;
    hero.injuries.push("bleeding");
    const storedHero = service.getSnapshot("player-1")!.combatants.find((combatant) => combatant.ownerPlayerId)!;
    expect(storedHero.combatStats?.meleeDamage).toBe(70);
    expect(storedHero.injuries).toEqual([]);
  });

  it.each([{ level: 1, count: 1 }, { level: 9, count: 1 }, { level: 10, count: 2 },
    { level: 24, count: 2 }, { level: 25, count: 3 }, { level: 40, count: 3 }])(
    "starts a level $level pack with $count wolves on distinct valid cells", ({ level, count }) => {
      const initial = new BattleService().startBattle(leveledCharacter(level), "encounter:wolf");
      const wolves = initial.combatants.filter((combatant) => !combatant.ownerPlayerId);
      const starts = initial.combatants.map((combatant) => hexKey(combatant.position));
      expect(wolves).toHaveLength(count);
      expect(new Set(starts).size).toBe(starts.length);
      for (const wolf of wolves) {
        expect(wolf.level).toBe(level);
        expect(wolf.maxHp).toBeGreaterThan(100);
        expect(wolf.combatStats?.meleeDamage).toBeGreaterThan(0);
        expect(wolf.initiative).toBeLessThan(leveledCharacter(level).initiative);
        expect(initial.cells.map(hexKey)).toContain(hexKey(wolf.position));
        expect(initial.blockedCells.map(hexKey)).not.toContain(hexKey(wolf.position));
      }
    }
  );

  it("keeps higher-level battles longer and winnable using melee, ranged attacks and paths", () => {
    const levels = [1, 5, 10, 25, 40, 100];
    const outcomes = levels.map(simulateBattle);
    for (const outcome of outcomes) {
      expect(outcome.victory).toBe(true);
      expect(outcome.playerOutcome!.hp).toBeGreaterThan(0);
      expect(outcome.actions.meleeAttack).toBeGreaterThan(0);
      expect(outcome.actions.rangedAttack).toBeGreaterThan(0);
      expect(outcome.actions.move).toBeGreaterThan(0);
    }
    expect(outcomes[0]!.round).toBeGreaterThanOrEqual(4);
    for (let index = 1; index < outcomes.length; index += 1) {
      expect(outcomes[index]!.round).toBeGreaterThan(outcomes[index - 1]!.round);
    }
  });

  it.each([{ level: 1, reward: 40 }, { level: 10, reward: 350 }, { level: 25, reward: 1200 }])(
    "returns $reward XP only for the command that wins a level $level battle", ({ level, reward }) => {
      const victory = simulateBattle(level);
      expect(victory.experienceReward).toBe(reward);
      const repeated = victory.service.applyCommand("player-1", victory.command);
      expect(repeated.result).toMatchObject({ ok: false, code: "BATTLE_FINISHED" });
      expect(repeated.experienceReward).toBeUndefined();
    }
  );

  it("does not reward unfinished commands or defeat", () => {
    const service = new BattleService();
    const initial = service.startBattle({ ...leveledCharacter(25), hp: 1 }, "encounter:wolf");
    const hero = initial.combatants.find((combatant) => combatant.ownerPlayerId)!;
    let result = service.applyCommand("player-1", { type: "endTurn", combatantId: hero.id });
    expect(result.finished).toBe(false);
    expect(result.experienceReward).toBeUndefined();
    for (let guard = 0; guard < 20 && !result.finished; guard += 1) {
      result = service.applyCommand("player-1", { type: "endTurn", combatantId: hero.id });
    }
    expect(result.finished).toBe(true);
    expect(result.victory).toBe(false);
    expect(result.playerOutcome!.hp).toBe(0);
    expect(result.playerOutcome!.injuries.length).toBeGreaterThan(0);
    expect(result.experienceReward).toBeUndefined();
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
