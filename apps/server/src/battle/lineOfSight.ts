import type { HexCoord } from "@web-mmorpg/shared";
import { hexDistance, hexKey } from "./hex";

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
