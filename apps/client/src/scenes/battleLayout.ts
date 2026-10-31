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

export interface BattleHudRegions {
  header?: LayoutRect;
  sidebar?: LayoutRect;
  actions?: LayoutRect;
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

/** Fit the ground between measured HUD regions, including a persistent target/action dock. */
export function calculateBattleLayout(
  width: number,
  height: number,
  cells: readonly HexCoord[],
  hud: BattleHudRegions | LayoutRect | undefined,
  insets: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 },
  zoom = 1
) {
  const finite = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
  const left = finite(insets.left) + 12;
  const top = finite(insets.top) + 12;
  const right = Math.max(left + 1, finite(width) - finite(insets.right) - 12);
  const bottom = Math.max(top + 1, finite(height) - finite(insets.bottom) - 12);
  const availableWidth = right - left;
  const compact = width < 1100 || height < 600;
  const portrait = width < 600;
  const regions: BattleHudRegions = hud && "width" in hud ? { sidebar: hud } : hud ?? {};
  const measured = (rect: LayoutRect | undefined): rect is LayoutRect => Boolean(rect
    && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0);
  // Match the fixed CSS footprints until ResizeObserver delivers real rectangles.
  const sidebar = measured(regions.sidebar) ? regions.sidebar : {
    x: compact ? right : Math.max(left, right - 280),
    y: top + 68,
    width: compact ? 0 : Math.min(280, availableWidth),
    height: Math.max(1, bottom - top - 68)
  };
  const arenaRight = Math.max(left + 1, Math.min(right, sidebar.width > 0 ? sidebar.x - 12 : right));
  const header = measured(regions.header) ? regions.header : {
    x: left, y: top, width: arenaRight - left, height: compact ? portrait ? 134 : 96 : 92
  };
  const dockHeight = compact ? portrait ? 160 : 76 : 112;
  const actions = measured(regions.actions) ? regions.actions : {
    x: left, y: Math.max(top, bottom - dockHeight), width: arenaRight - left, height: dockHeight
  };
  const arenaBottom = Math.max(top + 1, Math.min(bottom, actions.y - 12));
  const y = Math.min(arenaBottom - 1, Math.max(top, header.y + header.height + 12));
  const arena: LayoutRect = {
    x: left, y, width: arenaRight - left, height: Math.max(1, arenaBottom - y)
  };
  const points = (cells.length ? cells : [{ q: 0, r: 0 }]).map((cell) => axialToPixel(cell, 1));
  const hexBounds = battleHexBounds(1);
  const minX = Math.min(...points.map((point) => point.x)) + hexBounds.x;
  const maxX = Math.max(...points.map((point) => point.x)) + hexBounds.x + hexBounds.width;
  const minY = Math.min(...points.map((point) => point.y)) + hexBounds.y;
  const maxY = Math.max(...points.map((point) => point.y)) + hexBounds.y + hexBounds.height;
  const sidePadding = Math.min(12, arena.width * 0.08);
  const topPadding = Math.min(40, Math.max(0, arena.height - 1));
  const bottomPadding = Math.min(12, arena.height * 0.08, (arena.height - topPadding) * 0.2);
  const groundHeight = arena.height - topPadding - bottomPadding;
  const fitHexSize = Math.min(
    44,
    (arena.width - 2 * sidePadding) / (maxX - minX),
    groundHeight / (maxY - minY)
  );
  const zoomScale = Number.isFinite(zoom) ? Math.max(1, Math.min(1.8, zoom)) : 1;
  const hexSize = fitHexSize * zoomScale;
  const arenaCenterX = arena.x + arena.width / 2;
  const arenaCenterY = arena.y + arena.height / 2;
  const fitCenterX = arenaCenterX - (minX + maxX) * fitHexSize / 2;
  const fitCenterY = y + topPadding + groundHeight / 2 - (minY + maxY) * fitHexSize / 2;
  return {
    arena,
    sidebar,
    header,
    actions,
    hexSize,
    centerX: arenaCenterX + (fitCenterX - arenaCenterX) * zoomScale,
    centerY: arenaCenterY + (fitCenterY - arenaCenterY) * zoomScale,
    labelFontSize: Math.max(10, Math.min(13, Math.round(hexSize * 13 / 34)))
  };
}
