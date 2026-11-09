import { hexKey, type BattleSnapshot } from "@web-mmorpg/shared";
import type Phaser from "phaser";
import { getEnvironmentTextureKey, VEGETATION_FRAMES, type TerrainTextureId, type VegetationTextureId } from "../world/environmentAssets";
import { axialToPixel, battleHexBounds, battleHexPolygon, type calculateBattleLayout } from "./battleLayout";
import { battleObjectDepth } from "./battleVisuals";

type BattleLayout = ReturnType<typeof calculateBattleLayout>;
type PropId = "mossy-rocks" | "fallen-log";
const PROPS: readonly PropId[] = ["mossy-rocks", "fallen-log"];
const PROP_FRAMES: Record<PropId, { x: number; y: number; width: number; height: number }> = {
  "mossy-rocks": { x: 140, y: 230, width: 980, height: 802 },
  "fallen-log": { x: 147, y: 440, width: 919, height: 439 }
};
export function getBattlePropTextureKey(id: PropId): string { return `battle-prop:${id}`; }

export function preloadBattleProps(scene: Phaser.Scene): void {
  for (const id of PROPS) {
    const key = getBattlePropTextureKey(id);
    if (!scene.textures.exists(key)) scene.load.image(key, `${import.meta.env.BASE_URL}assets/battle/${id}.png`);
  }
}

export function registerBattlePropFrames(scene: Phaser.Scene): void {
  for (const id of PROPS) {
    const key = getBattlePropTextureKey(id);
    if (!scene.textures.exists(key)) continue;
    const texture = scene.textures.get(key);
    if (texture.has("prop")) continue;
    const frame = PROP_FRAMES[id];
    texture.add("prop", 0, frame.x, frame.y, frame.width, frame.height);
  }
}

/** Bake ground only when its geometry changes; turns and pointer previews reuse the texture. */
export class BattleEnvironmentRenderer {
  private readonly textureKey = "battle:projected-ground";
  private signature = "";
  private bounds: { x: number; y: number; width: number; height: number } | undefined;

  constructor(private readonly scene: Phaser.Scene) {}

  render(snapshot: BattleSnapshot, layout: BattleLayout, objects: Phaser.GameObjects.GameObject[]): boolean {
    const ground = this.renderGround(snapshot, layout, objects);
    this.renderPlants(snapshot, layout, objects);
    this.renderProps(snapshot, layout, objects);
    return ground;
  }

  destroy(): void {
    if (this.scene.textures.exists(this.textureKey)) this.scene.textures.remove(this.textureKey);
    this.signature = "";
    this.bounds = undefined;
  }

  private renderGround(snapshot: BattleSnapshot, layout: BattleLayout, objects: Phaser.GameObjects.GameObject[]): boolean {
    if (!snapshot.cells.length || typeof this.scene.textures.createCanvas !== "function") return false;
    const key = [layout.hexSize, snapshot.cells.map(hexKey).join(";"), snapshot.blockedCells.map(hexKey).join(";"), snapshot.coverCells.map(hexKey).join(";")].join("|");
    if (this.signature !== key || !this.scene.textures.exists(this.textureKey)) {
      this.destroy();
      const { hexSize } = layout;
      const vertices = snapshot.cells.flatMap(cell => {
        const center = axialToPixel(cell, hexSize);
        return battleHexPolygon(center.x, center.y, hexSize);
      });
      const edge = Math.max(2, hexSize * 0.13);
      const minX = Math.floor(Math.min(...vertices.map(point => point.x))) - 2;
      const minY = Math.floor(Math.min(...vertices.map(point => point.y))) - 2;
      const maxX = Math.ceil(Math.max(...vertices.map(point => point.x))) + 2;
      const maxY = Math.ceil(Math.max(...vertices.map(point => point.y))) + edge + 2;
      const width = maxX - minX, height = maxY - minY;
      const resolution = 2;
      const texture = this.scene.textures.createCanvas(this.textureKey, Math.ceil(width * resolution), Math.ceil(height * resolution));
      if (!texture) return false;
      const ctx = texture.getContext();
      ctx.scale(resolution, resolution);
      ctx.translate(-minX, -minY);
      // The raised edge is painted once underneath the textured top surface.
      ctx.fillStyle = "#263126";
      for (const cell of snapshot.cells) {
        const center = axialToPixel(cell, hexSize);
        this.path(ctx, battleHexPolygon(center.x, center.y + edge, hexSize));
        ctx.fill();
      }
      const blocked = new Set(snapshot.blockedCells.map(hexKey));
      const cover = new Set(snapshot.coverCells.map(hexKey));
      ctx.save();
      // This is the same projection used by the cell polygons and hit zones.
      ctx.transform(Math.sqrt(3) / 2, 0.5, -Math.sqrt(3) / 2, 0.5, 0, 0);
      const patterns = new Map<TerrainTextureId, CanvasPattern>();
      for (const id of ["meadow-grass", "worn-earth", "forest-floor"] as const) {
        const textureKey = getEnvironmentTextureKey(id);
        if (!this.scene.textures.exists(textureKey)) continue;
        const source = this.scene.textures.get(textureKey).getSourceImage() as HTMLImageElement;
        if (!source.width || !source.height) continue;
        const pattern = ctx.createPattern(source, "repeat");
        if (!pattern) continue;
        const scale = hexSize * 4 / source.width;
        pattern.setTransform({ a: scale, d: scale });
        patterns.set(id, pattern);
      }
      for (const cell of snapshot.cells) {
        const cellKey = hexKey(cell);
        const x = hexSize * Math.sqrt(3) * (cell.q + cell.r / 2), y = hexSize * 1.5 * cell.r;
        const points = Array.from({ length: 6 }, (_, i) => {
          const angle = (60 * i - 30) * Math.PI / 180;
          return { x: x + hexSize * Math.cos(angle), y: y + hexSize * Math.sin(angle) };
        });
        this.path(ctx, points);
        ctx.fillStyle = patterns.get("meadow-grass") ?? "#536d3c";
        ctx.fill();
        const detail = blocked.has(cellKey) ? "forest-floor" : cover.has(cellKey) ? "worn-earth" : undefined;
        if (detail) {
          ctx.globalAlpha = 0.65;
          ctx.fillStyle = patterns.get(detail) ?? "#73634a";
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        // A light tonal variation preserves the hex rhythm without replacing the artwork.
        ctx.globalAlpha = (cell.q + cell.r) % 2 === 0 ? 0.035 : 0.015;
        ctx.fillStyle = "#d1d6a0";
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      texture.refresh();
      this.bounds = { x: minX, y: minY, width, height };
      this.signature = key;
    }
    if (!this.bounds) return false;
    const { x, y, width, height } = this.bounds;
    objects.push(this.scene.add.image(layout.centerX + x, layout.centerY + y, this.textureKey)
      .setOrigin(0).setDisplaySize(width, height).setDepth(-10000));
    return true;
  }

  private path(ctx: CanvasRenderingContext2D, points: readonly { x: number; y: number }[]): void {
    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);
    for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
  }

  private renderProps(snapshot: BattleSnapshot, layout: BattleLayout, objects: Phaser.GameObjects.GameObject[]): void {
    const bounds = battleHexBounds(layout.hexSize);
    for (const [cells, id] of [[snapshot.blockedCells, "mossy-rocks"], [snapshot.coverCells, "fallen-log"]] as const) {
      const textureKey = getBattlePropTextureKey(id);
      if (!this.scene.textures.exists(textureKey)) continue;
      if (!this.scene.textures.get(textureKey).has("prop")) continue;
      const frame = PROP_FRAMES[id];
      const scale = Math.min(bounds.width * 0.9 / frame.width, layout.hexSize * (id === "mossy-rocks" ? 1.3 : 0.85) / frame.height);
      const width = frame.width * scale, height = frame.height * scale;
      for (const cell of cells) {
        const position = axialToPixel(cell, layout.hexSize);
        const x = layout.centerX + position.x, y = layout.centerY + position.y + layout.hexSize * 0.12;
        objects.push(this.scene.add.image(x, y, textureKey, "prop")
          .setOrigin(0.5, 0.88).setDisplaySize(width, height)
          .setDepth(battleObjectDepth(y)));
      }
    }
  }

  private renderPlants(snapshot: BattleSnapshot, layout: BattleLayout, objects: Phaser.GameObjects.GameObject[]): void {
    const occupied = new Set(snapshot.combatants.map(unit => hexKey(unit.position)));
    const cellKeys = new Set(snapshot.cells.map(hexKey));
    const edgeCells = snapshot.cells.filter(cell => !occupied.has(hexKey(cell))
      && [[1,0],[-1,0],[0,1],[0,-1],[1,-1],[-1,1]].some(([q,r]) => !cellKeys.has(hexKey({ q: cell.q + q!, r: cell.r + r! }))));
    for (const [index, cell] of edgeCells.entries()) {
      if (index % 4 !== 0) continue;
      const id: VegetationTextureId = index % 8 === 0 ? "ground-plants" : "shrubs";
      const textureKey = getEnvironmentTextureKey(id);
      if (!this.scene.textures.exists(textureKey) || !this.scene.textures.get(textureKey).has("plant")) continue;
      const position = axialToPixel(cell, layout.hexSize);
      const frame = VEGETATION_FRAMES[id], height = layout.hexSize * (id === "shrubs" ? 0.5 : 0.32);
      const x = layout.centerX + position.x + layout.hexSize * 0.45, y = layout.centerY + position.y + layout.hexSize * 0.22;
      objects.push(this.scene.add.image(x, y, textureKey, "plant")
        .setOrigin(0.5, 1).setDisplaySize(height * frame.width / frame.height, height)
        .setDepth(battleObjectDepth(y)));
    }
  }
}
