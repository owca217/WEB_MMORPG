export interface WorldRect { x: number; y: number; width: number; height: number }
export interface WorldInsets { top: number; right: number; bottom: number; left: number }

export const COMPACT_WORLD_QUERY = "(max-width: 1099px), (max-height: 599px)";

/** Phaser keeps a full-size canvas; only the world camera occupies this map rectangle. */
export function calculateWorldLayout(
  width: number,
  height: number,
  insets: WorldInsets = { top: 0, right: 0, bottom: 0, left: 0 }
) {
  const compact = width < 1100 || height < 600;
  const headerHeight = compact ? 56 : 40;
  const footerHeight = compact ? 56 : 52;
  const sidebarWidth = compact ? 0 : 280;
  const map: WorldRect = {
    x: insets.left,
    y: insets.top + headerHeight,
    width: Math.max(1, width - insets.left - insets.right - sidebarWidth),
    height: Math.max(1, height - insets.top - insets.bottom - headerHeight - footerHeight)
  };
  const sidebar: WorldRect = { x: map.x + map.width, y: map.y, width: sidebarWidth, height: map.height };
  return { compact, map, sidebar, headerHeight, footerHeight };
}
