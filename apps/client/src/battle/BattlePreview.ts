import type {
  BattleSnapshot,
  CombatantSnapshot,
  EntityId,
  HexCoord
} from "@web-mmorpg/shared";

export type BattleActionMode = "move" | "meleeAttack" | "rangedAttack";

export type AttackPreviewReason =
  | "INSUFFICIENT_AP"
  | "OUT_OF_RANGE"
  | "NO_LINE_OF_SIGHT"
  | "INVALID_TARGET";

export interface AttackPreviewResult {
  valid: boolean;
  reason?: AttackPreviewReason;
  apCost: number;
}

interface CubeCoord {
  x: number;
  y: number;
  z: number;
}

const DIRECTIONS: HexCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 }
];

export function hexKey({ q, r }: HexCoord): string {
  return `${q},${r}`;
}

export function hexNeighbors({ q, r }: HexCoord): HexCoord[] {
  return DIRECTIONS.map((direction) => ({
    q: q + direction.q,
    r: r + direction.r
  }));
}

export function hexDistance(a: HexCoord, b: HexCoord): number {
  const as = -a.q - a.r;
  const bs = -b.q - b.r;
  return Math.max(
    Math.abs(a.q - b.q),
    Math.abs(a.r - b.r),
    Math.abs(as - bs)
  );
}

function axialToCube({ q, r }: HexCoord): CubeCoord {
  return { x: q, z: r, y: -q - r };
}

function cubeToAxial({ x, z }: CubeCoord): HexCoord {
  return { q: x, r: z };
}

function cubeRound(cube: CubeCoord): CubeCoord {
  let x = Math.round(cube.x);
  let y = Math.round(cube.y);
  let z = Math.round(cube.z);

  const xDiff = Math.abs(x - cube.x);
  const yDiff = Math.abs(y - cube.y);
  const zDiff = Math.abs(z - cube.z);

  if (xDiff > yDiff && xDiff > zDiff) {
    x = -y - z;
  } else if (yDiff > zDiff) {
    y = -x - z;
  } else {
    z = -x - y;
  }

  return { x, y, z };
}

export function hasLineOfSight(
  start: HexCoord,
  end: HexCoord,
  blockers: ReadonlySet<string>
): boolean {
  const distance = hexDistance(start, end);
  if (distance <= 1) return true;

  const a = axialToCube(start);
  const b = axialToCube(end);

  for (let step = 1; step < distance; step += 1) {
    const t = step / distance;
    const rounded = cubeRound({
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t
    });

    if (blockers.has(hexKey(cubeToAxial(rounded)))) return false;
  }

  return true;
}

export function reachableCells(
  snapshot: BattleSnapshot,
  combatantId: EntityId
): Set<string> {
  const actor = snapshot.combatants.find((combatant) => combatant.id === combatantId);
  if (!actor || actor.hp <= 0) return new Set();

  const allowed = new Set(snapshot.cells.map(hexKey));
  const blocked = new Set(snapshot.blockedCells.map(hexKey));
  for (const combatant of snapshot.combatants) {
    if (combatant.id !== actor.id && combatant.hp > 0) {
      blocked.add(hexKey(combatant.position));
    }
  }

  const perStep = actor.injuries.includes("legTrauma") ? 2 : 1;
  const cost = new Map<string, number>([[hexKey(actor.position), 0]]);
  const queue: HexCoord[] = [actor.position];

  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    const currentCost = cost.get(hexKey(current))!;

    for (const next of hexNeighbors(current)) {
      const key = hexKey(next);
      const nextCost = currentCost + perStep;
      if (
        !allowed.has(key) ||
        blocked.has(key) ||
        cost.has(key) ||
        nextCost > actor.ap
      ) {
        continue;
      }

      cost.set(key, nextCost);
      queue.push(next);
    }
  }

  cost.delete(hexKey(actor.position));
  return new Set(cost.keys());
}

function sameSide(a: CombatantSnapshot, b: CombatantSnapshot): boolean {
  if (a.ownerPlayerId === undefined && b.ownerPlayerId === undefined) return true;
  if (a.ownerPlayerId === undefined || b.ownerPlayerId === undefined) return false;
  return a.ownerPlayerId === b.ownerPlayerId;
}

export function attackPreview(
  snapshot: BattleSnapshot,
  combatantId: EntityId,
  targetId: EntityId,
  mode: "meleeAttack" | "rangedAttack"
): AttackPreviewResult {
  const actor = snapshot.combatants.find((combatant) => combatant.id === combatantId);
  const target = snapshot.combatants.find((combatant) => combatant.id === targetId);
  const apCost = mode === "meleeAttack"
    ? 2
    : actor?.injuries.includes("brokenArm")
      ? 4
      : 3;

  if (!actor || !target || actor.hp <= 0 || target.hp <= 0 || sameSide(actor, target)) {
    return { valid: false, reason: "INVALID_TARGET", apCost };
  }

  if (actor.ap < apCost) {
    return { valid: false, reason: "INSUFFICIENT_AP", apCost };
  }

  const distance = hexDistance(actor.position, target.position);
  if (mode === "meleeAttack") {
    if (distance !== 1) {
      return { valid: false, reason: "OUT_OF_RANGE", apCost };
    }
    return { valid: true, apCost };
  }

  if (distance > 6) {
    return { valid: false, reason: "OUT_OF_RANGE", apCost };
  }

  const blockers = new Set(snapshot.blockedCells.map(hexKey));
  if (!hasLineOfSight(actor.position, target.position, blockers)) {
    return { valid: false, reason: "NO_LINE_OF_SIGHT", apCost };
  }

  return { valid: true, apCost };
}
