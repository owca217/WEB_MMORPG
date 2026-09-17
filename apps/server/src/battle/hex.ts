import type { HexCoord } from "@web-mmorpg/shared";

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
