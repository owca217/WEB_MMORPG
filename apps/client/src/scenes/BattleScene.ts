import type {
  BattleSnapshot,
  CombatantSnapshot,
  EntityId,
  HexCoord,
  PlayerId
} from "@web-mmorpg/shared";
import Phaser from "phaser";
import {
  attackPreview,
  hexKey,
  reachableCells,
  type AttackPreviewReason,
  type BattleActionMode
} from "../battle/BattlePreview";
import { gameSocket } from "../net/GameSocket";
import { BattleHud } from "../ui/BattleHud";

interface BattleSceneData {
  playerId: PlayerId;
  snapshot: BattleSnapshot;
}

const PREVIEW_LABELS: Record<AttackPreviewReason, string> = {
  INSUFFICIENT_AP: "Za mało punktów akcji.",
  OUT_OF_RANGE: "Cel jest poza zasięgiem.",
  NO_LINE_OF_SIGHT: "Przeszkoda blokuje linię strzału.",
  INVALID_TARGET: "Nie można zaatakować tego celu."
};

const SERVER_ERROR_LABELS: Record<string, string> = {
  INSUFFICIENT_AP: "Za mało punktów akcji.",
  OUT_OF_RANGE: "Cel jest poza zasięgiem.",
  NO_LINE_OF_SIGHT: "Przeszkoda blokuje linię strzału.",
  INVALID_TARGET: "Nie można zaatakować tego celu.",
  NO_PATH: "Nie można dotrzeć na to pole.",
  NOT_ACTIVE_TURN: "To nie jest twoja tura.",
  NOT_OWNER: "Nie możesz sterować tą jednostką.",
  COMBATANT_DOWN: "Ta jednostka nie może już działać.",
  BATTLE_FINISHED: "Walka jest już zakończona."
};

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
  private hud: BattleHud | undefined;
  private actionMode: BattleActionMode = "move";
  private readonly renderObjects: Phaser.GameObjects.GameObject[] = [];
  private unsubscribeState: (() => void) | undefined;
  private unsubscribeRejected: (() => void) | undefined;

  constructor() {
    super("BattleScene");
  }

  init(data: BattleSceneData): void {
    this.playerId = data.playerId;
    this.snapshot = data.snapshot;
    this.actionMode = "move";
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x1c3022);

    this.hud = new BattleHud({
      onActionMode: (mode) => {
        this.actionMode = mode;
        this.renderSnapshot();
      },
      onEndTurn: () => this.requestEndTurn()
    });

    this.unsubscribeState = gameSocket.onBattleState((snapshot) => {
      this.snapshot = snapshot;
      this.actionMode = "move";
      this.renderSnapshot();
    });
    this.unsubscribeRejected = gameSocket.onCommandRejected(({ code, message }) => {
      this.hud?.setStatus(
        SERVER_ERROR_LABELS[code] ?? message ?? "Akcja została odrzucona przez serwer."
      );
    });

    this.renderSnapshot();

    this.scale.on("resize", this.handleResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off("resize", this.handleResize, this);
      this.unsubscribeState?.();
      this.unsubscribeRejected?.();
      this.hud?.destroy();
      this.hud = undefined;
      this.clearRenderObjects();
    });
  }

  private readonly handleResize = (): void => {
    this.renderSnapshot();
  };

  private resolveHexSize(): number {
    const widthLimited = this.cameras.main.width / 15;
    const heightLimited = Math.max(22, (this.cameras.main.height - 230) / 12);
    return Phaser.Math.Clamp(Math.min(38, widthLimited, heightLimited), 22, 38);
  }

  private renderSnapshot(): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;

    this.clearRenderObjects();
    const hexSize = this.resolveHexSize();
    const centerX = this.cameras.main.centerX;
    const centerY = Math.max(165, this.cameras.main.height * 0.42);
    const activeOwned = this.activeOwnedCombatant();
    const reachable = activeOwned && this.actionMode === "move"
      ? reachableCells(snapshot, activeOwned.id)
      : new Set<string>();

    this.renderForestBackdrop();

    const graphics = this.add.graphics().setDepth(1);
    this.renderObjects.push(graphics);

    const blockedKeys = new Set(snapshot.blockedCells.map(hexKey));
    const coverKeys = new Set(snapshot.coverCells.map(hexKey));

    for (const cell of snapshot.cells) {
      const local = axialToPixel(cell, hexSize);
      const x = centerX + local.x;
      const y = centerY + local.y;
      const key = hexKey(cell);
      const blocked = blockedKeys.has(key);
      const cover = coverKeys.has(key);
      const canReach = reachable.has(key);

      graphics.fillStyle(canReach ? 0x719d59 : 0x355a3c, canReach ? 0.52 : 0.24);
      graphics.fillPoints(hexPolygon(x, y, hexSize - 2), true);
      graphics.lineStyle(canReach ? 2 : 1, canReach ? 0xb9d98b : 0x6f8768, canReach ? 0.95 : 0.55);
      graphics.strokePoints(hexPolygon(x, y, hexSize - 2), true);

      if (blocked) {
        this.renderBlocker(cell, x, y, hexSize);
      } else if (cover) {
        this.renderCover(cell, x, y, hexSize);
      }

      if (!blocked) {
        const hitSize = Math.max(44, hexSize * 1.35);
        const zone = this.add.zone(x, y, hitSize, hitSize)
          .setDepth(4)
          .setInteractive({ useHandCursor: canReach && this.actionMode === "move" });
        zone.on("pointerup", () => this.requestMove(cell));
        this.renderObjects.push(zone);
      }
    }

    for (const combatant of snapshot.combatants) {
      this.renderCombatant(combatant, centerX, centerY, hexSize, activeOwned);
    }

    this.hud?.update(snapshot, this.playerId, this.actionMode);
  }

  private renderForestBackdrop(): void {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;
    const floor = this.add.rectangle(width / 2, height / 2, width, height, 0x203c29, 1).setDepth(-20);
    const clearing = this.add.ellipse(width / 2, height * 0.42, width * 0.88, height * 0.66, 0x4b673d, 0.74).setDepth(-19);
    this.renderObjects.push(floor, clearing);

    const decoration = this.add.graphics().setDepth(-18);
    decoration.fillStyle(0x172d20, 0.8);
    for (const [xFactor, yFactor, radius] of [
      [0.05, 0.1, 46], [0.14, 0.18, 34], [0.9, 0.13, 44], [0.96, 0.28, 38],
      [0.08, 0.72, 42], [0.92, 0.68, 46]
    ] as const) {
      decoration.fillCircle(width * xFactor, height * yFactor, radius);
    }
    decoration.lineStyle(5, 0x806a48, 0.28);
    decoration.beginPath();
    decoration.moveTo(width * 0.06, height * 0.49);
    decoration.lineTo(width * 0.94, height * 0.45);
    decoration.strokePath();
    this.renderObjects.push(decoration);
  }

  private renderBlocker(cell: HexCoord, x: number, y: number, hexSize: number): void {
    const variant = Math.abs(cell.q * 7 + cell.r * 13) % 2;
    if (variant === 0) {
      const trunk = this.add.rectangle(x, y + hexSize * 0.18, hexSize * 0.24, hexSize * 0.72, 0x6e5036).setDepth(7);
      const crownA = this.add.circle(x, y - hexSize * 0.28, hexSize * 0.42, 0x24482c).setDepth(8);
      const crownB = this.add.circle(x - hexSize * 0.25, y - hexSize * 0.05, hexSize * 0.3, 0x315b35).setDepth(8);
      const crownC = this.add.circle(x + hexSize * 0.25, y - hexSize * 0.05, hexSize * 0.3, 0x315b35).setDepth(8);
      this.renderObjects.push(trunk, crownA, crownB, crownC);
      return;
    }

    const rock = this.add.ellipse(x, y + hexSize * 0.08, hexSize * 1.05, hexSize * 0.68, 0x56584f).setDepth(7);
    rock.setStrokeStyle(2, 0x7b7b6c, 0.8);
    const highlight = this.add.ellipse(x - hexSize * 0.18, y - hexSize * 0.08, hexSize * 0.35, hexSize * 0.17, 0x8c8d7e, 0.45).setDepth(8);
    this.renderObjects.push(rock, highlight);
  }

  private renderCover(cell: HexCoord, x: number, y: number, hexSize: number): void {
    const variant = Math.abs(cell.q * 11 + cell.r * 5) % 2;
    if (variant === 0) {
      const log = this.add.rectangle(x, y + hexSize * 0.14, hexSize * 1.1, hexSize * 0.26, 0x79593b).setDepth(6).setRotation(-0.16);
      log.setStrokeStyle(2, 0x4f3929, 0.8);
      this.renderObjects.push(log);
      return;
    }

    const bushA = this.add.circle(x - hexSize * 0.22, y + hexSize * 0.08, hexSize * 0.28, 0x496b3b).setDepth(6);
    const bushB = this.add.circle(x + hexSize * 0.04, y, hexSize * 0.34, 0x527844).setDepth(6);
    const bushC = this.add.circle(x + hexSize * 0.27, y + hexSize * 0.11, hexSize * 0.25, 0x3c6134).setDepth(6);
    this.renderObjects.push(bushA, bushB, bushC);
  }

  private renderCombatant(
    combatant: CombatantSnapshot,
    centerX: number,
    centerY: number,
    hexSize: number,
    activeOwned: CombatantSnapshot | undefined
  ): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;

    const local = axialToPixel(combatant.position, hexSize);
    const x = centerX + local.x;
    const y = centerY + local.y;
    const owned = combatant.ownerPlayerId === this.playerId;
    const active = combatant.id === snapshot.activeCombatantId;
    const attackMode = this.actionMode === "meleeAttack" || this.actionMode === "rangedAttack"
      ? this.actionMode
      : null;
    const preview = activeOwned && attackMode && combatant.id !== activeOwned.id
      ? attackPreview(snapshot, activeOwned.id, combatant.id, attackMode)
      : null;

    if (active) {
      const halo = this.add.circle(x, y + 2, hexSize * 0.62, 0xf1ce6d, 0.16).setDepth(11);
      halo.setStrokeStyle(3, 0xf1ce6d, 0.92);
      this.renderObjects.push(halo);
    } else if (preview?.valid) {
      const targetHalo = this.add.circle(x, y + 2, hexSize * 0.58, 0x88cf73, 0.12).setDepth(11);
      targetHalo.setStrokeStyle(3, 0xa8dd8a, 0.95);
      this.renderObjects.push(targetHalo);
    }

    const actorObjects = owned
      ? this.createHeroActor(x, y, hexSize, combatant.hp <= 0)
      : this.createWolfActor(x, y, hexSize, combatant.hp <= 0);
    for (const object of actorObjects) object.setDepth(13);
    this.renderObjects.push(...actorObjects);

    const hitTarget = this.add.zone(x, y, Math.max(48, hexSize * 1.25), Math.max(48, hexSize * 1.25))
      .setDepth(18)
      .setInteractive({ useHandCursor: Boolean(preview?.valid) });
    hitTarget.on("pointerup", () => this.requestAttack(combatant.id));
    this.renderObjects.push(hitTarget);

    const label = this.add.text(x, y - hexSize * 0.84, combatant.name, {
      fontFamily: "sans-serif",
      fontSize: `${Math.max(11, Math.round(hexSize * 0.36))}px`,
      color: owned ? "#e4f3ff" : "#ffe0d2",
      backgroundColor: "#10160fdd",
      padding: { x: 5, y: 2 }
    }).setOrigin(0.5).setDepth(20);

    const barWidth = hexSize * 1.25;
    const hpRatio = combatant.maxHp > 0 ? Math.max(0, combatant.hp / combatant.maxHp) : 0;
    const barBack = this.add.rectangle(x, y + hexSize * 0.68, barWidth, 6, 0x1d211d, 0.95).setDepth(19);
    const barFill = this.add.rectangle(
      x - barWidth / 2 + (barWidth * hpRatio) / 2,
      y + hexSize * 0.68,
      barWidth * hpRatio,
      4,
      owned ? 0x69b6e6 : 0xd16d58,
      1
    ).setDepth(20);
    this.renderObjects.push(label, barBack, barFill);
  }

  private createHeroActor(
    x: number,
    y: number,
    hexSize: number,
    down: boolean
  ): Phaser.GameObjects.GameObject[] {
    const alpha = down ? 0.42 : 1;
    const shadow = this.add.ellipse(x, y + hexSize * 0.42, hexSize * 0.8, hexSize * 0.28, 0x101610, 0.42);
    const body = this.add.rectangle(x, y + 2, hexSize * 0.34, hexSize * 0.7, 0x477da4, alpha);
    const cloak = this.add.triangle(x, y + 6, -hexSize * 0.3, hexSize * 0.25, hexSize * 0.3, hexSize * 0.25, 0, -hexSize * 0.34, 0x355d48, alpha);
    const head = this.add.circle(x, y - hexSize * 0.38, hexSize * 0.18, 0xdfb68e, alpha);
    const weapon = this.add.rectangle(x + hexSize * 0.27, y - hexSize * 0.02, 3, hexSize * 0.68, 0xb9a16a, alpha).setRotation(0.35);
    return [shadow, cloak, body, head, weapon];
  }

  private createWolfActor(
    x: number,
    y: number,
    hexSize: number,
    down: boolean
  ): Phaser.GameObjects.GameObject[] {
    const alpha = down ? 0.38 : 1;
    const shadow = this.add.ellipse(x, y + hexSize * 0.34, hexSize * 0.95, hexSize * 0.24, 0x101610, 0.4);
    const body = this.add.ellipse(x - hexSize * 0.06, y + hexSize * 0.05, hexSize * 0.82, hexSize * 0.45, 0x7b7468, alpha);
    const head = this.add.circle(x + hexSize * 0.34, y - hexSize * 0.08, hexSize * 0.24, 0x8b8274, alpha);
    const earA = this.add.triangle(x + hexSize * 0.23, y - hexSize * 0.3, -5, 8, 0, -8, 7, 7, 0x625d55, alpha);
    const earB = this.add.triangle(x + hexSize * 0.42, y - hexSize * 0.31, -5, 8, 0, -8, 7, 7, 0x625d55, alpha);
    const tail = this.add.line(x - hexSize * 0.38, y, 0, 0, -hexSize * 0.34, -hexSize * 0.16, 0x777064, alpha).setLineWidth(5);
    return [shadow, tail, body, head, earA, earB];
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
    const snapshot = this.snapshot;
    const active = this.activeOwnedCombatant();
    if (!snapshot || !active || this.actionMode !== "move") return;

    if (!reachableCells(snapshot, active.id).has(hexKey(target))) {
      this.hud?.setStatus("To pole nie jest dostępne w tej turze.");
      return;
    }

    gameSocket.sendBattleCommand({
      type: "move",
      combatantId: active.id,
      target
    });
  }

  private requestAttack(targetId: EntityId): void {
    const snapshot = this.snapshot;
    const active = this.activeOwnedCombatant();
    if (
      !snapshot ||
      !active ||
      (this.actionMode !== "meleeAttack" && this.actionMode !== "rangedAttack") ||
      targetId === active.id
    ) {
      return;
    }

    const preview = attackPreview(snapshot, active.id, targetId, this.actionMode);
    if (!preview.valid) {
      this.hud?.setStatus(
        preview.reason ? PREVIEW_LABELS[preview.reason] : "Nie można wykonać tej akcji."
      );
      return;
    }

    gameSocket.sendBattleCommand({
      type: this.actionMode,
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

  private clearRenderObjects(): void {
    for (const object of this.renderObjects.splice(0)) object.destroy();
  }
}
