import Phaser from "phaser";
import { FOREST_SETTLEMENT_LAYOUT } from "./ForestSettlementLayout";

export class ForestSettlementRenderer {
  private readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  render(): void {
    this.destroy();

    const ground = this.scene.add.rectangle(
      FOREST_SETTLEMENT_LAYOUT.width / 2,
      FOREST_SETTLEMENT_LAYOUT.height / 2,
      FOREST_SETTLEMENT_LAYOUT.width,
      FOREST_SETTLEMENT_LAYOUT.height,
      0x3f6139
    ).setDepth(-30);
    this.objects.push(ground);

    const settlement = FOREST_SETTLEMENT_LAYOUT.settlement;
    const clearing = this.scene.add.rectangle(
      settlement.x + settlement.width / 2,
      settlement.y + settlement.height / 2,
      settlement.width,
      settlement.height,
      0x667b49,
      0.9
    ).setDepth(-28);
    this.objects.push(clearing);

    const path = this.scene.add.graphics().setDepth(-26);
    path.lineStyle(70, 0x8b744e, 1);
    path.beginPath();
    path.moveTo(250, 470);
    path.lineTo(930, 470);
    path.lineTo(1325, 455);
    path.strokePath();
    path.lineStyle(42, 0xa38a5e, 0.7);
    path.beginPath();
    path.moveTo(250, 470);
    path.lineTo(930, 470);
    path.lineTo(1325, 455);
    path.strokePath();
    this.objects.push(path);

    for (const building of FOREST_SETTLEMENT_LAYOUT.buildings) {
      const base = this.scene.add.rectangle(
        building.x,
        building.y,
        building.width,
        building.height,
        building.kind === "healer" ? 0x675341 : 0x594637
      ).setStrokeStyle(5, 0x2d241e).setDepth(-18);
      const roof = this.scene.add.triangle(
        building.x,
        building.y - building.height * 0.54,
        -building.width * 0.55,
        building.height * 0.25,
        0,
        -building.height * 0.25,
        building.width * 0.55,
        building.height * 0.25,
        building.kind === "healer" ? 0x6f332d : 0x493026
      ).setStrokeStyle(4, 0x2d241e).setDepth(-17);
      this.objects.push(base, roof);
    }

    const fence = this.scene.add.graphics().setDepth(-16);
    fence.lineStyle(8, 0x60482f, 1);
    fence.strokeRect(110, 170, 800, 550);
    fence.fillStyle(0x60482f, 1);
    for (let x = 130; x <= 890; x += 45) {
      if (x > 850 && x < 930) continue;
      fence.fillRect(x, 165, 7, 22);
      fence.fillRect(x, 705, 7, 22);
    }
    this.objects.push(fence);

    const gate = FOREST_SETTLEMENT_LAYOUT.gate;
    const gateMarker = this.scene.add.rectangle(
      gate.x + gate.width / 2,
      gate.y + gate.height / 2,
      gate.width,
      gate.height,
      0x7b5a37,
      0.18
    ).setDepth(-19);
    this.objects.push(gateMarker);

    for (const tree of FOREST_SETTLEMENT_LAYOUT.trees) {
      const shadow = this.scene.add.ellipse(tree.x + 4, tree.y + 20, 54, 26, 0x18261a, 0.34).setDepth(-13);
      const trunk = this.scene.add.rectangle(tree.x, tree.y + 12, 15, 40, 0x5a3c28).setDepth(-11);
      const crown = this.scene.add.circle(tree.x, tree.y - 8, 34, 0x254a2d).setStrokeStyle(3, 0x18351f).setDepth(-10);
      const crown2 = this.scene.add.circle(tree.x + 20, tree.y, 24, 0x315a35).setDepth(-9);
      this.objects.push(shadow, trunk, crown, crown2);
    }

    for (const rock of FOREST_SETTLEMENT_LAYOUT.rocks) {
      const stone = this.scene.add.ellipse(rock.x, rock.y, 44, 30, 0x686e65).setStrokeStyle(3, 0x444a44).setDepth(-8);
      this.objects.push(stone);
    }

    const forestShade = this.scene.add.rectangle(1450, 450, 300, 900, 0x173a24, 0.18).setDepth(-25);
    this.objects.push(forestShade);

    const title = this.scene.add.text(175, 785, "Osada Zielony Brzeg", {
      fontFamily: "Georgia, serif",
      fontSize: "26px",
      color: "#f0dfb7",
      backgroundColor: "#283321bb",
      padding: { x: 12, y: 7 }
    }).setDepth(-5);
    this.objects.push(title);
  }

  destroy(): void {
    for (const object of this.objects.splice(0)) object.destroy();
  }
}
