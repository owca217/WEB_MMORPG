export const WALK_DIRECTIONS = [
  "south", "southwest", "west", "northwest", "north", "northeast", "east", "southeast"
] as const;
export type WalkDirection = typeof WALK_DIRECTIONS[number];
export const WALK_PHASES = [0, 1, 2, 1] as const;
const FRAME_MS = 125;

export function directionFromMovement(dx: number, dy: number, previous: WalkDirection): WalkDirection {
  if (dx === 0 && dy === 0) return previous;
  // Screen coordinates: south = +y, clockwise sectors start at east.
  const sectors: readonly WalkDirection[] = ["east", "southeast", "south", "southwest", "west", "northwest", "north", "northeast"];
  const sector = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return sectors[(sector + 8) % 8]!;
}

export class WalkAnimation {
  direction: WalkDirection = "south";
  private elapsed = 0;
  private moving = false;

  get frameName(): string {
    const phase = this.moving ? WALK_PHASES[Math.floor(this.elapsed / FRAME_MS)]! : 1;
    return `${this.direction}-${phase}`;
  }

  update(dx: number, dy: number, delta: number): void {
    if (Math.hypot(dx, dy) < 0.01) {
      this.moving = false;
      this.elapsed = 0;
      return;
    }
    this.direction = directionFromMovement(dx, dy, this.direction);
    this.moving = true;
    this.elapsed = (this.elapsed + Math.max(0, delta)) % (FRAME_MS * WALK_PHASES.length);
  }
}
