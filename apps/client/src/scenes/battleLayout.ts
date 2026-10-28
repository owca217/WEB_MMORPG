import type { HexCoord } from "@web-mmorpg/shared";

export interface LayoutRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export function axialToPixel({ q, r }: HexCoord, size: number): { x: number; y: number } {
  return { x: size * Math.sqrt(3) * (q + r / 2), y: size * 1.5 * r };
}

/** Fit the entire arena, including label clearance, outside the DOM controls. */
export function calculateBattleLayout(
  width: number,
  height: number,
  cells: readonly HexCoord[],
  hud: LayoutRect | undefined,
  insets: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 }
) {
  const x = insets.left + 12;
  const y = insets.top + 12;
  let right = width - insets.right - 12;
  let bottom = height - insets.bottom - 12;
  // Keep this breakpoint aligned with the compact landscape HUD in style.css.
  if (height <= 500 && width > height) {
    right = Math.min(right, (hud?.x ?? right - 230) - 12);
  } else {
    bottom = Math.min(bottom, (hud?.y ?? bottom - 180) - 12);
  }
  const arena: LayoutRect = {
    x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y)
  };
  const points = (cells.length ? cells : [{ q: 0, r: 0 }]).map((cell) => axialToPixel(cell, 1));
  const minX = Math.min(...points.map((point) => point.x)) - Math.sqrt(3) / 2;
  const maxX = Math.max(...points.map((point) => point.x)) + Math.sqrt(3) / 2;
  const minY = Math.min(...points.map((point) => point.y)) - 1;
  const maxY = Math.max(...points.map((point) => point.y)) + 1;
  const hexSize = Math.min(
    34,
    Math.max(1, arena.width - 32) / (maxX - minX),
    Math.max(1, arena.height - 32) / (maxY - minY)
  );
  return {
    arena,
    hexSize,
    centerX: x + arena.width / 2 - (minX + maxX) * hexSize / 2,
    centerY: y + arena.height / 2 - (minY + maxY) * hexSize / 2,
    labelFontSize: Math.max(10, Math.min(13, Math.round(hexSize * 13 / 34)))
  };
}
