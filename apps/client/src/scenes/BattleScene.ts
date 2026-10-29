import {
  areBattleEnemies,
  getBattleAttackPreview,
  getReachableBattleCells,
  hexKey,
  type InventorySnapshot,
  type InventoryUpdateResult,
  type BattleSnapshot,
  type CombatantSnapshot,
  type EntityId,
  type HexCoord,
  type PlayerId
} from "@web-mmorpg/shared";
import Phaser from "phaser";
import { gameSocket } from "../net/GameSocket";
import { playerStateStore } from "../state/PlayerStateStore";
import { BattleHud } from "../ui/BattleHud";
import { BattleAttackCard } from "../ui/BattleAttackCard";
import { ChatController } from "../ui/ChatController";
import { SocialController } from "../ui/SocialController";
import { axialToPixel, battleHexBounds, battleHexPolygon, calculateBattleLayout, type SafeInsets } from "./battleLayout";

export { axialToPixel } from "./battleLayout";

const hexPolygon = (x: number, y: number, size: number): Phaser.Math.Vector2[] =>
  battleHexPolygon(x, y, size).map(point => new Phaser.Math.Vector2(point.x, point.y));

interface BattleSceneData {
  playerId: PlayerId;
  snapshot: BattleSnapshot;
}

export class BattleScene extends Phaser.Scene {
  private playerId: PlayerId = "";
  private snapshot: BattleSnapshot | null = null;
  private hud: BattleHud | null = null;
  private attackCard: BattleAttackCard | null = null;
  private selectedTargetId: string | null = null;
  private layout: ReturnType<typeof calculateBattleLayout> | null = null;
  private pendingCommand = false;
  private pendingItem = false;
  private modePending=false;
  private modeVersion=0;
  private disposed = true;
  private chat: ChatController | null = null;
  private social:SocialController|null=null;
  private readonly renderObjects: Phaser.GameObjects.GameObject[] = [];
  private unsubscribeState: (() => void) | undefined;
  private unsubscribeEnded: (() => void) | undefined;
  private unsubscribeRejected: (() => void) | undefined;
  private unsubscribePlayer: (() => void) | undefined;
  private unsubscribeReauthenticated:(()=>void)|undefined;
  private hudObserver: ResizeObserver | undefined;
  private readonly onResize = () => this.renderSnapshot();

  constructor() {
    super("BattleScene");
  }

  init(data: BattleSceneData): void {
    this.playerId = data.playerId;
    this.snapshot = data.snapshot;
    this.selectedTargetId = null;
    this.pendingCommand = false;
    this.pendingItem = false;
    this.modePending=false;this.modeVersion+=1;
  }

  create(): void {
    this.disposed = false;
    this.cameras.main.setBackgroundColor(0x17191e);

    this.hud = new BattleHud({
      onUseItem: (instanceId) => this.useItem(instanceId),
      onInventoryChanged: (inventory) => this.applyInventory(inventory),
      onEndTurn: () => this.requestEndTurn(),
      onToggleAuto:()=>{void this.toggleAuto();}
    });
    this.attackCard = new BattleAttackCard((targetId) => this.requestAttack(targetId));
    this.chat = new ChatController({nearbyAvailable:false,onTypingChange:()=>this.updateKeyboardCapture()});
    this.social=new SocialController({inBattle:true,onTypingChange:()=>this.updateKeyboardCapture(),onInventoryChanged:inventory=>this.applyInventory(inventory)});
    this.scale.on("resize", this.onResize);
    const hudElement = document.querySelector<HTMLElement>(".battle-hud");
    if (hudElement && typeof ResizeObserver !== "undefined") {
      this.hudObserver = new ResizeObserver(this.onResize);
      this.hudObserver.observe(hudElement);
    }

    this.unsubscribeState = gameSocket.onBattleState((snapshot) => {
      this.snapshot = snapshot;
      this.pendingCommand = false;
      this.renderSnapshot();
    });
    this.unsubscribeEnded = gameSocket.onBattleEnded((payload) => {
      this.scene.start("WorldScene", {
        playerId: this.playerId,
        battleResult: {
          outcome: payload.outcome,
          experienceGained: payload.experienceGained ?? 0,
          levelsGained: payload.levelsGained ?? 0,
          level: payload.character.level,
          ...(payload.partyBonusExperience ? {partyBonusExperience:payload.partyBonusExperience} : {}),
          ...(payload.goldGained ? {goldGained:payload.goldGained} : {})
        }
      });
    });
    this.unsubscribeRejected = gameSocket.onCommandRejected(({ message }) => {
      this.pendingCommand = false;
      this.refreshHud();
      this.refreshAttackCard();
      this.hud?.setStatus(message);
    });
    this.unsubscribePlayer = gameSocket.onPlayerState((state) => {
      if (state.character.playerId !== this.playerId) return;
      playerStateStore.set(state);
      this.refreshHud();
    });
    this.unsubscribeReauthenticated=gameSocket.onReauthenticated(result=>{
      if(result.ok && !this.disposed)this.scene.start("WorldScene",{playerId:result.characterId});
    });

    this.renderSnapshot();
    gameSocket.requestPlayerState();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.disposed = true;
      this.modeVersion+=1;
      this.unsubscribeState?.();
      this.unsubscribeEnded?.();
      this.unsubscribeRejected?.();
      this.unsubscribePlayer?.();
      this.unsubscribeReauthenticated?.();
      this.scale.off("resize", this.onResize);
      this.hudObserver?.disconnect();
      this.hudObserver = undefined;
      this.hud?.destroy();
      this.hud = null;
      this.attackCard?.destroy();
      this.attackCard = null;
      this.chat?.destroy();
      this.chat = null;
      this.social?.destroy();this.social=null;
      this.layout = null;
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
    this.layout = layout;
    const { centerX, centerY, hexSize } = layout;

    const graphics = this.add.graphics();
    this.renderObjects.push(graphics);

    const blockedKeys = new Set(snapshot.blockedCells.map((cell) => `${cell.q},${cell.r}`));
    const coverKeys = new Set(snapshot.coverCells.map((cell) => `${cell.q},${cell.r}`));
    const actor = this.ownCombatant();
    const reachable = new Set(actor ? getReachableBattleCells(snapshot, actor.id).map(hexKey) : []);

    for (const cell of snapshot.cells) {
      const local = axialToPixel(cell, hexSize);
      const x = centerX + local.x;
      const y = centerY + local.y;
      const key = `${cell.q},${cell.r}`;

      // Raised edges make the projected ground plane readable without changing hex topology.
      graphics.fillStyle(0x20291f, 1);
      graphics.fillPoints(hexPolygon(x, y + Math.max(2, hexSize * 0.14), hexSize - 1), true);
      const fill = blockedKeys.has(key) ? 0x454b44 : reachable.has(key) ? 0x48774d : (cell.q + cell.r) % 2 ? 0x343e32 : 0x3b4538;
      graphics.fillStyle(fill, 1);
      graphics.fillPoints(hexPolygon(x, y, hexSize - 1), true);
      graphics.lineStyle(reachable.has(key) ? 2 : 1, reachable.has(key) ? 0x98c87f : 0x75806b, 0.9);
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
        const { width, height } = battleHexBounds(hexSize);
        const zone = this.add.zone(x, y, width, height).setInteractive(
          new Phaser.Geom.Polygon(battleHexPolygon(width / 2, height / 2, hexSize)),
          Phaser.Geom.Polygon.Contains
        );
        zone.on("pointerover", () => this.previewCell(cell));
        zone.on("pointerup", (pointer: Phaser.Input.Pointer) => this.selectCell(cell, pointer?.wasTouch ?? false));
        this.renderObjects.push(zone);
      }
    }

    for (const combatant of snapshot.combatants) {
      this.renderCombatant(combatant, layout);
    }
    this.refreshAttackCard();
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

    const body = this.add.circle(x, y - hexSize * 0.16, Math.max(4, hexSize * 0.38), fill, 1);
    body.setStrokeStyle(active ? 4 : 2, active ? 0xffdf77 : 0x17191e);
    // Labels may share space at phone sizes; every unit remains visible above them.
    body.setDepth(2);
    body.setInteractive();
    body.on("pointerover", () => this.previewCell(combatant.position));
    body.on("pointerup", (pointer: Phaser.Input.Pointer) => this.selectCell(combatant.position, pointer?.wasTouch ?? false));

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
    if (!snapshot || snapshot.finished || snapshot.autoBattle || this.modePending || this.pendingCommand || this.pendingItem) return undefined;
    return snapshot.combatants.find(
      (combatant) =>
        combatant.id === snapshot.activeCombatantId &&
        combatant.ownerPlayerId === this.playerId && combatant.hp > 0
    );
  }

  private requestMove(target: HexCoord): void {
    const active = this.activeOwnedCombatant();
    if (!active || !this.snapshot || !getReachableBattleCells(this.snapshot, active.id).some(cell => hexKey(cell) === hexKey(target))) return;
    this.selectedTargetId = null;
    this.pendingCommand = true;
    this.refreshHud();
    this.attackCard?.hide();

    gameSocket.sendBattleCommand({
      type: "move",
      combatantId: active.id,
      target
    });
  }

  private requestAttack(targetId: EntityId): void {
    const active = this.activeOwnedCombatant();
    const preview = active && this.snapshot ? getBattleAttackPreview(this.snapshot, active.id, targetId) : null;
    if (!active || !preview?.available) return;
    this.pendingCommand = true;
    this.refreshHud();
    this.refreshAttackCard();

    gameSocket.sendBattleCommand({
      type: preview.type,
      combatantId: active.id,
      targetId
    });
  }

  private requestEndTurn(): void {
    const active = this.activeOwnedCombatant();
    if (!active) return;
    this.pendingCommand = true;
    this.refreshHud();
    this.refreshAttackCard();

    gameSocket.sendBattleCommand({
      type: "endTurn",
      combatantId: active.id
    });
  }

  private refreshHud(): void {
    const snapshot = this.snapshot;
    if (!snapshot || !this.hud) return;
    const player = playerStateStore.get();
    const state = player?.character.playerId === this.playerId ? player : null;
    const own = this.ownCombatant();
    const ownedTurn=Boolean(own && own.hp>0 && !snapshot.finished && snapshot.activeCombatantId===own.id && !this.pendingCommand && !this.pendingItem && !this.modePending);
    this.hud.update(own, ownedTurn, state?.inventory ?? { items: [] }, state?.character);
    this.hud.setAutoBattle(Boolean(snapshot.autoBattle),this.modePending);
  }

  private ownCombatant(): CombatantSnapshot | undefined {
    return this.snapshot?.combatants.find(unit => unit.ownerPlayerId === this.playerId);
  }
  private updateKeyboardCapture():void {
    const keyboard=this.input?.keyboard;if(!keyboard)return;
    const typing=Boolean(this.chat?.isTyping || this.social?.isTyping);
    keyboard.resetKeys?.();keyboard.enabled=!typing;
    if(typing)keyboard.disableGlobalCapture?.();else keyboard.enableGlobalCapture?.();
  }

  private enemyAt(cell: HexCoord): CombatantSnapshot | undefined {
    const own = this.ownCombatant();
    return own && this.snapshot?.combatants.find(unit => hexKey(unit.position) === hexKey(cell) && areBattleEnemies(own, unit));
  }

  private previewCell(cell: HexCoord): void {
    const target = this.enemyAt(cell);
    if (!target) return;
    this.selectedTargetId = target.id;
    this.refreshAttackCard();
  }

  private selectCell(cell: HexCoord, touch: boolean): void {
    const target = this.enemyAt(cell);
    if (target) {
      this.selectedTargetId = target.id;
      this.refreshAttackCard();
      if (!touch) this.requestAttack(target.id);
    } else this.requestMove(cell);
  }

  private refreshAttackCard(): void {
    if(this.snapshot?.autoBattle || this.modePending){this.attackCard?.hide();return;}
    const own = this.ownCombatant();
    const target = this.snapshot?.combatants.find(unit => unit.id === this.selectedTargetId);
    const preview = own && target && this.snapshot ? getBattleAttackPreview(this.snapshot, own.id, target.id) : null;
    if (!preview || !target || !this.layout) { this.attackCard?.hide(); return; }
    const local = axialToPixel(target.position, this.layout.hexSize);
    this.attackCard?.show(this.pendingCommand || this.pendingItem ? { ...preview, available: false, reason: "Oczekiwanie na serwer…" } : preview,
      target.name, this.layout.centerX + local.x, this.layout.centerY + local.y, this.layout.arena);
  }

  private async useItem(instanceId: string): Promise<InventoryUpdateResult> {
    const active = this.activeOwnedCombatant();
    if (!active) return { ok: false, code: "NOT_ACTIVE_TURN", message: "Przedmiotu możesz użyć w swojej turze." };
    this.pendingItem = true;
    this.refreshAttackCard();
    try { return await gameSocket.useBattleItem(active.id, instanceId); }
    finally {
      this.pendingItem = false;
      if (!this.disposed) { this.refreshHud(); this.refreshAttackCard(); }
    }
  }

  private async toggleAuto():Promise<void> {
    if(!this.snapshot || this.snapshot.finished || this.modePending || this.pendingCommand || this.pendingItem || this.hud?.busy)return;
    const version=this.modeVersion;
    this.modePending=true;this.selectedTargetId=null;
    this.refreshHud();this.refreshAttackCard();
    try {
      const result=await gameSocket.setBattleAuto(!this.snapshot.autoBattle);
      if(this.disposed || version!==this.modeVersion)return;
      if(result.ok)this.snapshot=result.snapshot;
      else this.hud?.setStatus(result.message);
    }finally {
      if(!this.disposed && version===this.modeVersion){this.modePending=false;this.renderSnapshot();}
    }
  }

  private applyInventory(inventory: InventorySnapshot): void {
    const state = playerStateStore.get();
    if (state?.character.playerId === this.playerId) playerStateStore.set({ ...state, inventory });
    this.refreshHud();
  }

  private clearRenderObjects(): void {
    for (const object of this.renderObjects.splice(0)) object.destroy();
  }
}
