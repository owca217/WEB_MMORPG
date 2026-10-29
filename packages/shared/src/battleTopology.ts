import type { HexCoord } from "./battle";

const DIRECTIONS: HexCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 }
];

export const hexKey = ({ q, r }: HexCoord): string => `${q},${r}`;

export function hexNeighbors(coord: HexCoord): HexCoord[] {
  return DIRECTIONS.map((direction) => ({
    q: coord.q + direction.q,
    r: coord.r + direction.r
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

export function findPath(
  start: HexCoord,
  goal: HexCoord,
  blocked: ReadonlySet<string>,
  allowed?: ReadonlySet<string>
): HexCoord[] | null {
  const startKey = hexKey(start);
  const goalKey = hexKey(goal);

  if (blocked.has(goalKey)) return null;
  if (allowed && (!allowed.has(startKey) || !allowed.has(goalKey))) return null;
  if (startKey === goalKey) return [];

  const queue: HexCoord[] = [start];
  let queueIndex = 0;
  const cameFrom = new Map<string, HexCoord | null>([[startKey, null]]);
  const fallbackRadius = hexDistance(start, goal) + blocked.size + 2;

  while (queueIndex < queue.length) {
    const current = queue[queueIndex++];
    if (!current) break;

    for (const next of hexNeighbors(current)) {
      const key = hexKey(next);
      if (cameFrom.has(key) || blocked.has(key)) continue;
      if (allowed && !allowed.has(key)) continue;
      if (!allowed && hexDistance(start, next) > fallbackRadius) continue;

      cameFrom.set(key, current);

      if (key === goalKey) {
        const path: HexCoord[] = [next];
        let cursor = current;

        while (hexKey(cursor) !== startKey) {
          path.push(cursor);
          const previous = cameFrom.get(hexKey(cursor));
          if (!previous) break;
          cursor = previous;
        }

        return path.reverse();
      }

      queue.push(next);
    }
  }

  return null;
}




interface CubeCoord {
  x: number;
  y: number;
  z: number;
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

    if (blockers.has(hexKey(cubeToAxial(rounded)))) {
      return false;
    }
  }

  return true;
}
