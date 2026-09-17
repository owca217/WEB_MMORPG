import type {
  ArenaProfile,
  GeneratedArena,
  HexCoord
} from "@web-mmorpg/shared";
import { hexKey } from "./hex";

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;

  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], random: () => number): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = items[index];
    const swap = items[swapIndex];
    if (current === undefined || swap === undefined) continue;
    items[index] = swap;
    items[swapIndex] = current;
  }
}

export function generateArena(
  profile: ArenaProfile,
  seed: number
): GeneratedArena {
  const cells: HexCoord[] = [];

  for (let q = -profile.radius; q <= profile.radius; q += 1) {
    const minR = Math.max(-profile.radius, -q - profile.radius);
    const maxR = Math.min(profile.radius, -q + profile.radius);

    for (let r = minR; r <= maxR; r += 1) {
      cells.push({ q, r });
    }
  }

  const playerStartCells = cells.filter(
    (cell) => cell.q <= -profile.radius + 1
  );
  const enemyStartCells = cells.filter(
    (cell) => cell.q >= profile.radius - 1
  );

  const reserved = new Set(
    [...playerStartCells, ...enemyStartCells].map(hexKey)
  );

  const candidates = cells.filter((cell) => !reserved.has(hexKey(cell)));
  shuffle(candidates, mulberry32(seed));

  const blockedCells = candidates.slice(0, profile.obstacleCount);
  const coverCells = candidates.slice(
    profile.obstacleCount,
    profile.obstacleCount + profile.coverCount
  );

  return {
    cells,
    blockedCells,
    coverCells,
    playerStartCells,
    enemyStartCells
  };
}
