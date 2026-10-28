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
import { axialToPixel, calculateBattleLayout, type SafeInsets } from "./battleLayout";

export { axialToPixel } from "./battleLayout";

interface BattleSceneData {
  playerId: PlayerId;
  snapshot: BattleSnapshot;
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
  private unsubscribeEnded: (() => void) | undefined;
  private unsubscribeRejected: (() => void) | undefined;
  private hudObserver: ResizeObserver | undefined;
  private readonly onResize = () => this.renderSnapshot();

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
    this.scale.on("resize", this.onResize);
    const hudElement = document.querySelector<HTMLElement>(".battle-hud");
    if (hudElement && typeof ResizeObserver !== "undefined") {
      this.hudObserver = new ResizeObserver(this.onResize);
      this.hudObserver.observe(hudElement);
    }

    this.unsubscribeState = gameSocket.onBattleState((snapshot) => {
      this.snapshot = snapshot;
      this.attackMode = null;
      this.renderSnapshot();
    });
    this.unsubscribeEnded = gameSocket.onBattleEnded((payload) => {
      this.scene.start("WorldScene", {
        playerId: this.playerId,
        battleResult: {
          outcome: payload.outcome,
          experienceGained: payload.experienceGained ?? 0,
          levelsGained: payload.levelsGained ?? 0,
          level: payload.character.level
        }
      });
    });
    this.unsubscribeRejected = gameSocket.onCommandRejected(({ message }) => {
      this.hud?.setStatus(message);
    });

    this.renderSnapshot();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeState?.();
      this.unsubscribeEnded?.();
      this.unsubscribeRejected?.();
      this.scale.off("resize", this.onResize);
      this.hudObserver?.disconnect();
      this.hudObserver = undefined;
      this.hud?.destroy();
      this.hud = null;
      this.clearRenderObjects();
    });
  }

  private renderSnapshot(): void {
    const snapshot = this.snapshot;
    if (!snapshot) return;

    this.refreshHud();
    this.clearRenderObjects();
    const hud = document.querySelector<HTMLElement>(".battle-hud")?.getBoundingClientRect();
    const styles = getComputedStyle(document.documentElement);
    const insets = Object.fromEntries(
      ["top", "right", "bottom", "left"].map((edge) => [
        edge, Number.parseFloat(styles.getPropertyValue(`--safe-area-${edge}`)) || 0
      ])
    ) as unknown as SafeInsets;
    const layout = calculateBattleLayout(
      this.scale.width, this.scale.height, snapshot.cells,
      hud?.width ? hud : undefined, insets
    );
    const { centerX, centerY, hexSize } = layout;

    const graphics = this.add.graphics();
    this.renderObjects.push(graphics);

    const blockedKeys = new Set(snapshot.blockedCells.map((cell) => `${cell.q},${cell.r}`));
    const coverKeys = new Set(snapshot.coverCells.map((cell) => `${cell.q},${cell.r}`));

    for (const cell of snapshot.cells) {
      const local = axialToPixel(cell, hexSize);
      const x = centerX + local.x;
      const y = centerY + local.y;
      const key = `${cell.q},${cell.r}`;

      graphics.lineStyle(1, 0x5c6470, 0.9);
      graphics.strokePoints(hexPolygon(x, y, hexSize - 1), true);

      if (blockedKeys.has(key)) {
        graphics.fillStyle(0x3e3b3a, 1);
        graphics.fillCircle(x, y, hexSize * 0.48);
      } else if (coverKeys.has(key)) {
        graphics.fillStyle(0x826b49, 1);
        graphics.fillRoundedRect(
          x - hexSize * 0.42,
          y,
          hexSize * 0.84,
          hexSize * 0.32,
          5
        );
      }

      if (!blockedKeys.has(key)) {
        const width = hexSize * Math.sqrt(3);
        const zone = this.add.zone(x, y, width, hexSize * 2).setInteractive(
          new Phaser.Geom.Polygon(hexPolygon(width / 2, hexSize, hexSize)),
          Phaser.Geom.Polygon.Contains
        );
        zone.on("pointerup", () => {
          const target = this.snapshot?.combatants.find((combatant) =>
            combatant.position.q === cell.q && combatant.position.r === cell.r && combatant.hp > 0
          );
          if (this.attackMode && target) this.requestAttack(target.id);
          else this.requestMove(cell);
        });
        this.renderObjects.push(zone);
      }
    }

    for (const combatant of snapshot.combatants) {
      this.renderCombatant(combatant, layout);
    }
  }

  private renderCombatant(
    combatant: CombatantSnapshot,
    { centerX, centerY, hexSize, labelFontSize, arena }: ReturnType<typeof calculateBattleLayout>
  ): void {
    const local = axialToPixel(combatant.position, hexSize);
    const x = centerX + local.x;
    const y = centerY + local.y;
    const owned = combatant.ownerPlayerId === this.playerId;
    const active = combatant.id === this.snapshot?.activeCombatantId;
    const fill = combatant.hp <= 0 ? 0x555555 : owned ? 0x5fa6e8 : 0xcf6a61;

    const body = this.add.circle(x, y, hexSize * 0.38, fill, 1);
    body.setStrokeStyle(active ? 4 : 2, active ? 0xffdf77 : 0x17191e);
    // Labels may share space at phone sizes; every unit remains visible above them.
    body.setDepth(2);

    const compact = hexSize < 30;
    const name = compact && combatant.name.length > 12 ? `${combatant.name.slice(0, 11)}…` : combatant.name;
    const caption = `${name}${compact ? "\n" : " "}${combatant.hp}/${combatant.maxHp}`;
    const label = this.add.text(x, y - hexSize * 0.5, caption, {
      fontFamily: "sans-serif",
      fontSize: `${labelFontSize}px`,
      color: "#ffffff",
      backgroundColor: "#000000aa",
      padding: { x: 4, y: 2 }
    }).setOrigin(0.5, 1).setDepth(1);
    label.setPosition(
      Math.max(arena.x + label.width / 2, Math.min(x, arena.x + arena.width - label.width / 2)),
      Math.max(arena.y + label.height, Math.min(y - hexSize * 0.5, arena.y + arena.height))
    );

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
