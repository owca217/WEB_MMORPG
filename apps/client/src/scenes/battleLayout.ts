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

interface BattlePoint {
  x: number;
  y: number;
}

/** Rotate the ground plane and shorten its vertical axis for an isometric view. */
function projectGroundPoint(x: number, y: number): BattlePoint {
  return { x: (x - y) * Math.sqrt(3) / 2, y: (x + y) / 2 };
}

export function axialToPixel({ q, r }: HexCoord, size: number): { x: number; y: number } {
  return projectGroundPoint(size * Math.sqrt(3) * (q + r / 2), size * 1.5 * r);
}

/** Ground outlines and interactive polygons must use the same projection as centers. */
export function battleHexPolygon(centerX: number, centerY: number, hexSize: number): BattlePoint[] {
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (60 * index - 30) * Math.PI / 180;
    const point = projectGroundPoint(hexSize * Math.cos(angle), hexSize * Math.sin(angle));
    return { x: centerX + point.x, y: centerY + point.y };
  });
}

/** The local rectangle used to position a zone around a projected hex. */
export function battleHexBounds(hexSize: number): LayoutRect {
  const points = battleHexPolygon(0, 0, hexSize);
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Fit the projected arena beside the left character panel, with room for labels. */
export function calculateBattleLayout(
  width: number,
  height: number,
  cells: readonly HexCoord[],
  hud: LayoutRect | undefined,
  insets: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 }
) {
  const left = insets.left + 12;
  const y = insets.top + 12;
  const right = Math.max(left + 1, width - insets.right - 12);
  const bottom = Math.max(y + 1, height - insets.bottom - 12);
  const availableWidth = right - left;
  // These fallbacks match the left HUD before its first DOM measurement arrives.
  const fallbackWidth = width > height
    ? height <= 500 ? Math.min(220, availableWidth * 0.29) : Math.min(280, availableWidth * 0.23)
    : Math.min(180, availableWidth * 0.31);
  const requestedWidth = hud && hud.width > 0 ? hud.x + hud.width - left : fallbackWidth;
  const gutter = Math.min(12, availableWidth * 0.04);
  const sidebar: LayoutRect = {
    x: left,
    y,
    width: Math.max(0, Math.min(requestedWidth, availableWidth - gutter - 1)),
    height: bottom - y
  };
  const x = sidebar.x + sidebar.width + gutter;
  const arena: LayoutRect = {
    x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y)
  };
  const points = (cells.length ? cells : [{ q: 0, r: 0 }]).map((cell) => axialToPixel(cell, 1));
  const hexBounds = battleHexBounds(1);
  const minX = Math.min(...points.map((point) => point.x)) + hexBounds.x;
  const maxX = Math.max(...points.map((point) => point.x)) + hexBounds.x + hexBounds.width;
  const minY = Math.min(...points.map((point) => point.y)) + hexBounds.y;
  const maxY = Math.max(...points.map((point) => point.y)) + hexBounds.y + hexBounds.height;
  const sidePadding = Math.min(12, arena.width * 0.08);
  const topPadding = Math.min(40, arena.height * 0.2);
  const bottomPadding = Math.min(12, arena.height * 0.08);
  const groundHeight = arena.height - topPadding - bottomPadding;
  const hexSize = Math.min(
    44,
    (arena.width - 2 * sidePadding) / (maxX - minX),
    groundHeight / (maxY - minY)
  );
  return {
    arena,
    sidebar,
    hexSize,
    centerX: x + arena.width / 2 - (minX + maxX) * hexSize / 2,
    centerY: y + topPadding + groundHeight / 2 - (minY + maxY) * hexSize / 2,
    labelFontSize: Math.max(10, Math.min(13, Math.round(hexSize * 13 / 34)))
  };
}
