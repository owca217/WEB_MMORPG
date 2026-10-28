export type CharacterDirection = "south" | "west" | "east" | "north";

const DIRECTION_ROWS: Record<CharacterDirection, number> = {
  south: 0,
  west: 1,
  east: 2,
  north: 3
};

export function resolveCharacterMotion(
  dx: number,
  dy: number,
  direction: CharacterDirection
): { direction: CharacterDirection; moving: boolean } {
  if (Math.hypot(dx, dy) <= 0.1) return { direction, moving: false };
  const nextDirection = Math.abs(dx) > Math.abs(dy)
    ? (dx < 0 ? "west" : "east")
    : (dy < 0 ? "north" : "south");
  return { direction: nextDirection, moving: true };
}

export function getCharacterAnimationFrames(direction: CharacterDirection): [number, number, number, number] {
  const first = DIRECTION_ROWS[direction] * 4;
  return [first, first + 1, first + 2, first + 3];
}
