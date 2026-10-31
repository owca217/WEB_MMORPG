import type { HexCoord } from "@web-mmorpg/shared";
import { describe, expect, it } from "vitest";
import * as layoutHelpers from "../src/scenes/battleLayout";

const { axialToPixel, calculateBattleLayout } = layoutHelpers;
const cells: HexCoord[] = [];
for (let q = -4; q <= 4; q += 1) {
  for (let r = -4; r <= 4; r += 1) {
    if (Math.abs(q + r) <= 4) cells.push({ q, r });
  }
}

describe("isometric battle geometry", () => {
  it("tilts both ground axes while keeping the ground flatter than its width", () => {
    const across = axialToPixel({ q: 1, r: 0 }, 20);
    const down = axialToPixel({ q: 0, r: 1 }, 20);
    expect(across.x).toBeGreaterThan(0);
    expect(across.y).toBeGreaterThan(0);
    expect(down.x).toBeLessThan(0);
    expect(down.y).toBeGreaterThan(across.y);
    expect(across.y / across.x).toBeCloseTo(1 / Math.sqrt(3));
  });

  it("projects hex outlines and touch bounds onto the same shared edges", () => {
    expect(layoutHelpers.battleHexPolygon).toBeTypeOf("function");
    const polygon = layoutHelpers.battleHexPolygon(0, 0, 20);
    const neighbor = axialToPixel({ q: 1, r: 0 }, 20);
    const adjacent = layoutHelpers.battleHexPolygon(neighbor.x, neighbor.y, 20);
    const shared = polygon.filter((point) => adjacent.some((other) =>
      Math.hypot(point.x - other.x, point.y - other.y) < 0.00001
    ));
    expect(polygon).toHaveLength(6);
    expect(shared).toHaveLength(2);
    const bounds = layoutHelpers.battleHexBounds(20);
    expect(bounds.width).toBeGreaterThan(bounds.height * 1.5);
    expect(bounds.x).toBeCloseTo(-23.660254);
    expect(bounds.y).toBeCloseTo(-13.660254);
    for (const point of polygon) {
      expect(point.x).toBeGreaterThanOrEqual(bounds.x - 0.00001);
      expect(point.x).toBeLessThanOrEqual(bounds.x + bounds.width + 0.00001);
      expect(point.y).toBeGreaterThanOrEqual(bounds.y - 0.00001);
      expect(point.y).toBeLessThanOrEqual(bounds.y + bounds.height + 0.00001);
    }
  });
});

describe("battle arena between the measured header, right details and action dock", () => {
  it.each([
    { width: 1280, height: 720, hud: {
      sidebar: { x: 988, y: 80, width: 280, height: 628 },
      header: { x: 12, y: 12, width: 964, height: 92 }, actions: { x: 12, y: 596, width: 964, height: 112 } },
      insets: { top: 0, right: 0, bottom: 0, left: 0 }, minimumSize: 30 },
    { width: 844, height: 390, hud: {
      header: { x: 32, y: 12, width: 780, height: 88 }, actions: { x: 32, y: 290, width: 780, height: 76 } },
      insets: { top: 0, right: 20, bottom: 12, left: 20 }, minimumSize: 10 },
    { width: 390, height: 844, hud: {
      header: { x: 12, y: 24, width: 366, height: 126 }, actions: { x: 12, y: 654, width: 366, height: 160 } },
      insets: { top: 12, right: 0, bottom: 18, left: 0 }, minimumSize: 10 }
  ])("keeps all cells and unit labels within the available $width × $height viewport", ({
    width, height, hud, insets, minimumSize
  }) => {
    const layout = calculateBattleLayout(width, height, cells, hud, insets);
    const { arena, hexSize } = layout;
    expect(arena.x).toBeGreaterThanOrEqual(insets.left + 12);
    if (hud.sidebar) expect(arena.x + arena.width).toBeLessThanOrEqual(hud.sidebar.x - 12);
    expect(arena.x + arena.width).toBeLessThanOrEqual(width - insets.right - 12);
    expect(arena.y).toBeGreaterThanOrEqual(hud.header.y + hud.header.height + 12);
    expect(arena.y + arena.height).toBeLessThanOrEqual(hud.actions.y - 12);
    expect(hexSize).toBeGreaterThanOrEqual(minimumSize);
    for (const cell of cells) {
      const local = axialToPixel(cell, hexSize);
      const x = layout.centerX + local.x;
      const y = layout.centerY + local.y;
      for (const point of layoutHelpers.battleHexPolygon(x, y, hexSize)) {
        expect(point.x).toBeGreaterThanOrEqual(arena.x);
        expect(point.x).toBeLessThanOrEqual(arena.x + arena.width);
        expect(point.y).toBeGreaterThanOrEqual(arena.y);
        expect(point.y).toBeLessThanOrEqual(arena.y + arena.height);
      }
      expect(y - hexSize * 0.5 - 32).toBeGreaterThanOrEqual(arena.y);
      expect(y + hexSize * 0.42).toBeLessThanOrEqual(arena.y + arena.height);
    }
  });

  it("reserves compact header and dock before measurement and handles an empty arena", () => {
    const layout = calculateBattleLayout(844, 390, [], undefined);
    expect(layout.sidebar.width).toBe(0);
    expect(layout.arena.x).toBe(12);
    expect(layout.arena.y).toBe(layout.header.y + layout.header.height + 12);
    expect(layout.arena.y + layout.arena.height).toBe(layout.actions.y - 12);
    expect(Number.isFinite(layout.centerX)).toBe(true);
    expect(Number.isFinite(layout.centerY)).toBe(true);
    expect(layout.hexSize).toBeGreaterThan(0);
  });
});
