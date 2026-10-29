import type Phaser from "phaser";
import { FOREST_SETTLEMENT_LAYOUT } from "./ForestSettlementLayout";
import { getEnvironmentTextureKey, VEGETATION_FRAMES, type TerrainTextureId, type VegetationTextureId } from "./environmentAssets";

const ROAD_EDGE = [
  [240, 435], [325, 432], [410, 437], [490, 433], [575, 438], [655, 433], [735, 435],
  [820, 432], [905, 435], [985, 429], [1075, 426], [1160, 422], [1240, 423], [1327, 419],
  [1350, 438], [1350, 480], [1324, 492], [1245, 488], [1163, 494], [1079, 495], [992, 503],
  [909, 504], [823, 509], [739, 505], [655, 509], [575, 503], [493, 507], [410, 502], [325, 507], [240, 503]
] as const;

export class ForestSettlementRenderer {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly masks: Phaser.Display.Masks.GeometryMask[] = [];
  private readonly maskedSurfaces: Phaser.GameObjects.TileSprite[] = [];
  private readonly filterMasks: { surface: Phaser.GameObjects.TileSprite; mask: Phaser.Filters.Mask }[] = [];
  constructor(private readonly scene: Phaser.Scene) {}

  render(): void {
    this.destroy();
    const layout = FOREST_SETTLEMENT_LAYOUT;
    if (!this.tile("meadow-grass", 800, 450, layout.width, layout.height, -30)) {
      this.keep(this.scene.add.rectangle(800, 450, layout.width, layout.height, 0x3f6139).setDepth(-30));
    }
    // Small shared textures repeat under world-space masks rather than a giant baked map.
    const clearing = this.tile("meadow-grass", 510, 445, 840, 590, -29);
    if (clearing) {
      clearing.setTint(0xedeac1).setAlpha(0.55);
      this.mask(clearing, [[100, 180], [135, 155], [880, 160], [922, 205], [916, 690], [875, 735], [130, 728], [97, 680]]);
    } else this.keep(this.scene.add.rectangle(510, 445, 820, 570, 0x667b49, 0.7).setDepth(-29));
    const woodland = this.tile("forest-floor", 1285, 450, 630, 900, -28);
    if (woodland) this.mask(woodland, [[980, 0], [1600, 0], [1600, 900], [980, 900], [995, 810], [967, 715], [995, 620], [973, 540], [991, 420], [970, 315], [998, 215], [976, 100]]);
    const road = this.tile("worn-earth", 795, 465, 1130, 110, -26);
    if (road) this.mask(road, ROAD_EDGE);
    else {
      const path = this.keep(this.scene.add.graphics().setDepth(-26));
      path.lineStyle(70, 0x8b744e, 1).beginPath().moveTo(250, 470).lineTo(930, 470).lineTo(1325, 455).strokePath();
      path.lineStyle(42, 0xa38a5e, 0.7).beginPath().moveTo(250, 470).lineTo(930, 470).lineTo(1325, 455).strokePath();
    }
    for (const building of layout.buildings) {
      this.keep(this.scene.add.rectangle(building.x, building.y, building.width, building.height,
        building.kind === "healer" ? 0x675341 : 0x594637).setStrokeStyle(5, 0x2d241e).setDepth(-18));
      this.keep(this.scene.add.triangle(building.x, building.y - building.height * 0.54,
        -building.width * 0.55, building.height * 0.25, 0, -building.height * 0.25,
        building.width * 0.55, building.height * 0.25, building.kind === "healer" ? 0x6f332d : 0x493026)
        .setStrokeStyle(4, 0x2d241e).setDepth(-17));
    }
    const fence = this.keep(this.scene.add.graphics().setDepth(-16));
    fence.lineStyle(8, 0x60482f, 1).strokeRect(110, 170, 800, 550).fillStyle(0x60482f, 1);
    for (let x = 130; x <= 890; x += 45) {
      if (x > 850 && x < 930) continue;
      fence.fillRect(x, 165, 7, 22).fillRect(x, 705, 7, 22);
    }
    const gate = layout.gate;
    this.keep(this.scene.add.rectangle(gate.x + gate.width / 2, gate.y + gate.height / 2, gate.width, gate.height, 0x7b5a37, 0.12).setDepth(-19));
    for (const [index, tree] of layout.trees.entries()) {
      this.keep(this.scene.add.ellipse(tree.x + 5, tree.y + 20, 65, 25, 0x132219, 0.3).setDepth(-13));
      if (!this.plant(index % 2 === 0 ? "oak" : "pine", tree.x, tree.y + 26, 124 + index % 3 * 8, -10)) {
        this.keep(this.scene.add.rectangle(tree.x, tree.y + 12, 15, 40, 0x5a3c28).setDepth(-11));
        this.keep(this.scene.add.circle(tree.x, tree.y - 8, 34, 0x254a2d).setStrokeStyle(3, 0x18351f).setDepth(-10));
        this.keep(this.scene.add.circle(tree.x + 20, tree.y, 24, 0x315a35).setDepth(-9));
      }
    }
    for (const [index, shrub] of layout.shrubs.entries()) this.plant("shrubs", shrub.x, shrub.y, 35 + index % 3 * 4, -9);
    for (const [index, plant] of layout.groundPlants.entries()) this.plant("ground-plants", plant.x, plant.y, 22 + index % 3 * 3, -14);
    for (const rock of layout.rocks) this.keep(this.scene.add.ellipse(rock.x, rock.y, 44, 30, 0x686e65).setStrokeStyle(3, 0x444a44).setDepth(-8));
    if (!woodland) this.keep(this.scene.add.rectangle(1450, 450, 300, 900, 0x173a24, 0.18).setDepth(-25));
    this.keep(this.scene.add.text(175, 785, "Osada Zielony Brzeg", {
      fontFamily: "Georgia, serif", fontSize: "26px", color: "#f0dfb7", backgroundColor: "#283321bb", padding: { x: 12, y: 7 }
    }).setDepth(-5));
  }
  destroy(): void {
    for(const {surface,mask} of this.filterMasks.splice(0))surface.filters?.external.remove(mask);
    for (const surface of this.maskedSurfaces.splice(0)) surface.clearMask(false);
    for (const mask of this.masks.splice(0)) mask.destroy();
    for (const object of this.objects.splice(0)) object.destroy();
  }
  private keep<T extends Phaser.GameObjects.GameObject>(object: T): T { this.objects.push(object); return object; }
  private tile(id: TerrainTextureId, x: number, y: number, width: number, height: number, depth: number): Phaser.GameObjects.TileSprite | undefined {
    const key = getEnvironmentTextureKey(id);
    if (!this.scene.textures.exists(key)) return undefined;
    const source=this.scene.textures.get(key).getSourceImage();
    const scale=256/source.width;
    return this.keep(this.scene.add.tileSprite(x, y, width, height, key).setTileScale(scale).setDepth(depth));
  }
  private mask(surface: Phaser.GameObjects.TileSprite, vertices: readonly (readonly [number, number])[]): void {
    const graphic = this.keep(this.scene.make.graphics({ x: 0, y: 0 }, false));
    graphic.fillStyle(0xffffff).beginPath().moveTo(vertices[0]![0],vertices[0]![1]);
    for(const [x,y] of vertices.slice(1))graphic.lineTo(x,y);
    graphic.closePath().fillPath();
    if("gl" in this.scene.renderer && this.scene.renderer.gl) {
      // Phaser4 GeometryMask is Canvas-only. The external filter uses world geometry
      // viewed through the live world camera, so clipping follows camera movement.
      surface.enableFilters();
      const mask=surface.filters!.external.addMask(graphic,false,this.scene.cameras.main,"world");
      this.filterMasks.push({surface,mask});
    } else {
      const mask = graphic.createGeometryMask();
      surface.setMask(mask);this.maskedSurfaces.push(surface);this.masks.push(mask);
    }
  }
  private plant(id: VegetationTextureId, x: number, y: number, height: number, depth: number): boolean {
    const key = getEnvironmentTextureKey(id);
    if (!this.scene.textures.exists(key) || !this.scene.textures.get(key).has("plant")) return false;
    const frame = VEGETATION_FRAMES[id];
    this.keep(this.scene.add.image(x, y, key, "plant").setOrigin(0.5, 1).setDisplaySize(height * frame.width / frame.height, height).setDepth(depth));
    return true;
  }
}
