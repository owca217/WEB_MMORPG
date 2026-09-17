export interface DirectionKeys {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

export interface DirectionIntent {
  dx: number;
  dy: number;
}

export function resolveKeyboardIntent(keys: DirectionKeys): DirectionIntent {
  const dx = Number(keys.right) - Number(keys.left);
  const dy = Number(keys.down) - Number(keys.up);
  const length = Math.hypot(dx, dy) || 1;

  return {
    dx: dx / length,
    dy: dy / length
  };
}

export function moveTowardTarget(
  current: { x: number; y: number },
  target: { x: number; y: number },
  distance: number
): { x: number; y: number } {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const length = Math.hypot(dx, dy);
  if (length === 0 || distance <= 0) return { ...current };

  const step = Math.min(distance, length);
  return {
    x: current.x + (dx / length) * step,
    y: current.y + (dy / length) * step
  };
}
