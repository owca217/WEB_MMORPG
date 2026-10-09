import type {
  BattleSnapshot,
  CombatantSnapshot,
  EntityId,
  HexCoord,
  PlayerId
} from "@web-mmorpg/shared";
import Phaser from "phaser";
import { gameSocket } from "../net/GameSocket";
import { BattleHud, type AttackMode } from "../ui/BattleHud";

const HEX_SIZE = 34;

interface BattleSceneData {
  playerId: PlayerId;
  snapshot: BattleSnapshot;
}

export function axialToPixel({ q, r }: HexCoord, size: number): { x: number; y: number } {
  return {
    x: size * Math.sqrt(3) * (q + r / 2),
    y: size * 1.5 * r
  };
}

function hexPolygon(x: number, y: number, size: number): Phaser.Math.Vector2[] {
  const points: Phaser.Math.Vector2[] = [];
  for (let index = 0; index < 6; index += 1) {
    const angle = Phaser.Math.DegToRad(60 * index - 30);
    points.push(new Phaser.Math.Vector2(
      x + size * Math.cos(angle),
      y + size * Math.sin(angle)
    ));
  }
  return points;
}

export class BattleScene extends Phaser.Scene {
  private playerId: PlayerId = "";
  private snapshot: BattleSnapshot | null = null;
  private hud: BattleHud | null = null;
  private attackMode: AttackMode = null;
  private readonly renderObjects: Phaser.GameObjects.GameObject[] = [];
  private unsubscribeState: (() => void) | undefined;
  private unsubscribeRejected: (() => void) | undefined;

  constructor() {
    super("BattleScene");
  }

  init(data: BattleSceneData): void {
    this.playerId = data.playerId;
    this.snapshot = data.snapshot;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x17191e);

    this.hud = new BattleHud({
      onAttackMode: (mode) => {
        this.attackMode = mode;
        this.refreshHud();
      },
      onEndTurn: () => this.requestEndTurn()
    });

    this.unsubscribeState = gameSocket.onBattleState((snapshot) => {
      this.snapshot = snapshot;
      this.attackMode = null;
      this.renderSnapshot();
    });
    this.unsubscribeRejected = gameSocket.onCommandRejected(({ message }) => {
      this.hud?.setStatus(message);
    });

    this.renderSnapshot();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeState?.();
      this.unsubscribeRejected?.();
      this.hud?.destroy();
      this.hud = null;
      this.clearRenderObjects();
    });
  }

  private renderSnapshot(): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;

    this.clearRenderObjects();
    const centerX = this.cameras.main.centerX;
    const centerY = this.cameras.main.centerY - 20;

    const graphics = this.add.graphics();
    this.renderObjects.push(graphics);

    const blockedKeys = new Set(snapshot.blockedCells.map((cell) => `${cell.q},${cell.r}`));
    const coverKeys = new Set(snapshot.coverCells.map((cell) => `${cell.q},${cell.r}`));

    for (const cell of snapshot.cells) {
      const local = axialToPixel(cell, HEX_SIZE);
      const x = centerX + local.x;
      const y = centerY + local.y;
      const key = `${cell.q},${cell.r}`;

      graphics.lineStyle(1, 0x5c6470, 0.9);
      graphics.strokePoints(hexPolygon(x, y, HEX_SIZE - 1), true);

      if (blockedKeys.has(key)) {
        graphics.fillStyle(0x3e3b3a, 1);
        graphics.fillCircle(x, y, HEX_SIZE * 0.48);
      } else if (coverKeys.has(key)) {
        graphics.fillStyle(0x826b49, 1);
        graphics.fillRoundedRect(
          x - HEX_SIZE * 0.42,
          y,
          HEX_SIZE * 0.84,
          HEX_SIZE * 0.32,
          5
        );
      }

      if (!blockedKeys.has(key)) {
        const zone = this.add.zone(x, y, HEX_SIZE * 1.45, HEX_SIZE * 1.45).setInteractive();
        zone.on("pointerup", () => this.requestMove(cell));
        this.renderObjects.push(zone);
      }
    }

    for (const combatant of snapshot.combatants) {
      this.renderCombatant(combatant, centerX, centerY);
    }

    this.refreshHud();
  }

  private renderCombatant(
    combatant: CombatantSnapshot,
    centerX: number,
    centerY: number
  ): void {
    const local = axialToPixel(combatant.position, HEX_SIZE);
    const x = centerX + local.x;
    const y = centerY + local.y;
    const owned = combatant.ownerPlayerId === this.playerId;
    const active = combatant.id === this.snapshot?.activeCombatantId;
    const fill = combatant.hp <= 0 ? 0x555555 : owned ? 0x5fa6e8 : 0xcf6a61;

    const body = this.add.circle(x, y, HEX_SIZE * 0.38, fill, 1);
    body.setStrokeStyle(active ? 4 : 2, active ? 0xffdf77 : 0x17191e);
    body.setInteractive({ useHandCursor: true });
    body.on("pointerup", () => this.requestAttack(combatant.id));

    const label = this.add.text(x, y - HEX_SIZE * 0.68, `${combatant.name} ${combatant.hp}/${combatant.maxHp}`, {
      fontFamily: "sans-serif",
      fontSize: "13px",
      color: "#ffffff",
      backgroundColor: "#000000aa",
      padding: { x: 4, y: 2 }
    }).setOrigin(0.5);

    this.renderObjects.push(body, label);
  }

  private activeOwnedCombatant(): CombatantSnapshot | undefined {
    const snapshot = this.snapshot;
    if (!snapshot) return undefined;
    return snapshot.combatants.find(
      (combatant) =>
        combatant.id === snapshot.activeCombatantId &&
        combatant.ownerPlayerId === this.playerId
    );
  }

  private requestMove(target: HexCoord): void {
    const active = this.activeOwnedCombatant();
    if (!active || this.attackMode) return;

    gameSocket.sendBattleCommand({
      type: "move",
      combatantId: active.id,
      target
    });
  }

  private requestAttack(targetId: EntityId): void {
    const active = this.activeOwnedCombatant();
    if (!active || !this.attackMode || targetId === active.id) return;

    gameSocket.sendBattleCommand({
      type: this.attackMode,
      combatantId: active.id,
      targetId
    });
  }

  private requestEndTurn(): void {
    const active = this.activeOwnedCombatant();
    if (!active) return;

    gameSocket.sendBattleCommand({
      type: "endTurn",
      combatantId: active.id
    });
  }

  private refreshHud(): void {
    const snapshot = this.snapshot;
    if (!snapshot || !this.hud) return;
    const active = snapshot.combatants.find(
      (combatant) => combatant.id === snapshot.activeCombatantId
    );
    this.hud.update(active, active?.ownerPlayerId === this.playerId, this.attackMode);
  }

  private clearRenderObjects(): void {
    for (const object of this.renderObjects.splice(0)) object.destroy();
  }
}
