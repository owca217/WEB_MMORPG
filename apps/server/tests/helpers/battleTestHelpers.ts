import type {
  BattleCommand,
  BattleSnapshot,
  PlayerId
} from "@web-mmorpg/shared";
import type { Socket } from "socket.io-client";
import { expect } from "vitest";
import {
  findPath,
  hexDistance,
  hexKey,
  hexNeighbors
} from "../../src/battle/hex";
import { hasLineOfSight } from "../../src/battle/lineOfSight";

export function onceWithTimeout<T>(
  socket: Socket,
  event: string,
  timeoutMs = 1500
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${event}`)),
      timeoutMs
    );
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

export function choosePlayerCommand(
  snapshot: BattleSnapshot,
  playerId: PlayerId
): BattleCommand {
  const hero = snapshot.combatants.find(
    (combatant) =>
      combatant.ownerPlayerId === playerId && combatant.hp > 0
  );
  const enemy = snapshot.combatants.find(
    (combatant) =>
      combatant.ownerPlayerId === undefined && combatant.hp > 0
  );
  if (!hero || !enemy) throw new Error("Expected living hero and enemy.");

  const distance = hexDistance(hero.position, enemy.position);
  if (distance === 1) {
    if (hero.ap >= 2) {
      return {
        type: "meleeAttack",
        combatantId: hero.id,
        targetId: enemy.id
      };
    }
    return { type: "endTurn", combatantId: hero.id };
  }

  const rangedCost = hero.injuries.includes("brokenArm") ? 4 : 3;
  const blockers = new Set(snapshot.blockedCells.map(hexKey));
  if (
    hero.ap >= rangedCost &&
    distance <= 6 &&
    hasLineOfSight(hero.position, enemy.position, blockers)
  ) {
    return {
      type: "rangedAttack",
      combatantId: hero.id,
      targetId: enemy.id
    };
  }

  if (hero.ap > 0) {
    const allowed = new Set(snapshot.cells.map(hexKey));
    const occupied = new Set(snapshot.blockedCells.map(hexKey));
    for (const combatant of snapshot.combatants) {
      if (combatant.id !== hero.id && combatant.hp > 0) {
        occupied.add(hexKey(combatant.position));
      }
    }

    const goals = hexNeighbors(enemy.position)
      .filter(
        (cell) =>
          allowed.has(hexKey(cell)) && !occupied.has(hexKey(cell))
      )
      .sort(
        (a, b) =>
          hexDistance(hero.position, a) -
          hexDistance(hero.position, b)
      );

    for (const goal of goals) {
      const path = findPath(
        hero.position,
        goal,
        occupied,
        allowed
      );
      if (path?.length) {
        return {
          type: "move",
          combatantId: hero.id,
          target: path[0]!
        };
      }
    }
  }

  return { type: "endTurn", combatantId: hero.id };
}

export async function winBattle(
  socket: Socket,
  initial: BattleSnapshot,
  playerId: PlayerId
) {
  let battle = initial;
  const endedPromise = onceWithTimeout<{
    outcome: "victory" | "defeat";
    inventory: {
      items: Array<{
        instanceId: string;
        itemId: string;
        quantity: number;
      }>;
    };
    character: { hp: number };
  }>(socket, "battleEnded", 4000);

  for (let step = 0; step < 40 && !battle.finished; step += 1) {
    const statePromise = onceWithTimeout<BattleSnapshot>(
      socket,
      "battleState"
    );
    socket.emit(
      "battleCommand",
      choosePlayerCommand(battle, playerId)
    );
    battle = await statePromise;
  }

  expect(battle.finished).toBe(true);
  return endedPromise;
}
