import {
  areBattleEnemies,
  getBattleAttackPreview,
  getEnemyDefinition,
  getBattleHealingPreview,
  getReachableBattleCells,
  getWeaponSkillPreview,
  hexKey,
  type InventorySnapshot,
  type InventoryUpdateResult,
  type BattleSnapshot,
  type CombatantSnapshot,
  type EntityId,
  type HexCoord,
  type PlayerId,
  type WeaponSkillId
} from "@web-mmorpg/shared";
import Phaser from "phaser";
import { getCharacterSkinTextureKey } from "../characters/characterSkinAssets";
import { preloadCharacterSkins, registerCharacterSkinAnimations } from "../characters/characterSkinSprites";
import { getEnemySkinAsset, getEnemySkinDisplaySize, getEnemySkinTextureKey, preloadEnemySkins, registerEnemySkinFrames } from "../characters/enemySkinAssets";
import { gameSocket } from "../net/GameSocket";
import { playerStateStore } from "../state/PlayerStateStore";
import { BattleHud } from "../ui/BattleHud";
import { BattleAttackCard } from "../ui/BattleAttackCard";
import { ChatController } from "../ui/ChatController";
import { SocialController } from "../ui/SocialController";
import { preloadEnvironmentAssets, registerEnvironmentFrames } from "../world/environmentAssets";
import { BattleEnvironmentRenderer, getBattlePropTextureKey, preloadBattleProps, registerBattlePropFrames } from "./BattleEnvironmentRenderer";
import { axialToPixel, battleHexBounds, battleHexPolygon, calculateBattleLayout, type SafeInsets } from "./battleLayout";
import { battleCharacterSize, battleCharacterSkin, battleEnemyId, battleObjectDepth, registerBattleCharacterFrames } from "./battleVisuals";

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
  private selectedHealingTargetId:string|null=null;
  private selectedTargetId: string | null = null;
  private boardZoomed = false;
  private layout: ReturnType<typeof calculateBattleLayout> | null = null;
  private pendingCommand = false;
  private pendingItem = false;
  private modePending=false;
  private modeVersion=0;
  private disposed = true;
  private chat: ChatController | null = null;
  private social:SocialController|null=null;
  private readonly renderObjects: Phaser.GameObjects.GameObject[] = [];
  private environment: BattleEnvironmentRenderer | undefined;
  private targetMarker: Phaser.GameObjects.Graphics | undefined;
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
    this.boardZoomed = false;
    this.selectedHealingTargetId=null;
    this.pendingCommand = false;
    this.pendingItem = false;
    this.modePending=false;this.modeVersion+=1;
  }

  preload(): void {
    preloadEnemySkins(this);
    preloadCharacterSkins(this);
    preloadEnvironmentAssets(this);
    preloadBattleProps(this);
  }

  create(): void {
    registerEnemySkinFrames(this);
    registerCharacterSkinAnimations(this);
    registerBattleCharacterFrames(this);
    registerEnvironmentFrames(this);
    registerBattlePropFrames(this);
    this.environment = new BattleEnvironmentRenderer(this);
    this.disposed = false;
    this.cameras.main.setBackgroundColor(0x101d1a);

    this.hud = new BattleHud({
      onUseItem: (instanceId) => this.useItem(instanceId),
      onInventoryChanged: (inventory) => this.applyInventory(inventory),
      onEndTurn: () => this.requestEndTurn(),
      onHealSelf: () => this.requestHealSelf(),
      onUseWeaponSkill:(skillId,targetId)=>this.requestWeaponSkill(skillId,targetId),
      onSelectHealingTarget: id=>this.selectHealingTarget(id),
      onTypingChange:()=>this.updateKeyboardCapture(),
      onToggleAuto:()=>{void this.toggleAuto();},
      onToggleZoom: () => { this.boardZoomed = !this.boardZoomed; this.renderSnapshot(); },
      onLayoutChanged: this.onResize
    });
    this.attackCard = new BattleAttackCard((targetId) => this.requestAttack(targetId), this.hud.attackCardHost);
    this.chat = new ChatController({nearbyAvailable:false,onTypingChange:()=>this.updateKeyboardCapture()});
    this.social=new SocialController({inBattle:true,onTypingChange:()=>this.updateKeyboardCapture(),onInventoryChanged:inventory=>this.applyInventory(inventory)});
    this.scale.on("resize", this.onResize);
    if (typeof ResizeObserver !== "undefined") {
      this.hudObserver = new ResizeObserver(this.onResize);
      for (const element of this.hud.layoutElements) this.hudObserver.observe(element);
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
      // Reconnects to battles created before appearance metadata still get the owner's skin.
      if (this.ownCombatant()?.skinId === undefined) this.renderSnapshot();
      else this.refreshHud();
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
      this.boardZoomed = false;
      this.clearRenderObjects();
      this.environment?.destroy();
      this.environment = undefined;
    });
  }

  private renderSnapshot(): void {
    const snapshot = this.snapshot;
    if (!snapshot || this.disposed) return;

    this.cameras.main.setViewport(0, 0, this.scale.width, this.scale.height);
    this.hud?.setViewport(this.scale.width, this.scale.height);
    const compact = this.scale.width < 1100 || this.scale.height < 600;
    if (!compact) this.boardZoomed = false;
    this.hud?.setBoardZoomed(this.boardZoomed);
    this.refreshHud();
    this.clearRenderObjects();
    const styles = getComputedStyle(document.documentElement);
    const insets = Object.fromEntries(
      ["top", "right", "bottom", "left"].map((edge) => [
        edge, Number.parseFloat(styles.getPropertyValue(`--safe-area-${edge}`)) || 0
      ])
    ) as unknown as SafeInsets;
    const layout = calculateBattleLayout(
      this.scale.width, this.scale.height, snapshot.cells,
      this.hud?.getLayoutRegions(), insets, this.boardZoomed ? 1.8 : 1
    );
    this.layout = layout;
    const { centerX, centerY, hexSize } = layout;

    const texturedGround = this.environment?.render(snapshot, layout, this.renderObjects) ?? false;
    const graphics = this.add.graphics().setDepth(-9000);
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

      if (!texturedGround) {
        graphics.fillStyle(0x263126, 1);
        graphics.fillPoints(hexPolygon(x, y + Math.max(2, hexSize * 0.13), hexSize - 1), true);
        graphics.fillStyle(blockedKeys.has(key) ? 0x485442 : (cell.q + cell.r) % 2 ? 0x4b633c : 0x526b40, 1);
        graphics.fillPoints(hexPolygon(x, y, hexSize - 1), true);
      }
      if (reachable.has(key)) {
        graphics.fillStyle(0x96c88b, 0.12);
        graphics.fillPoints(hexPolygon(x, y, hexSize - 1), true);
      }
      graphics.lineStyle(reachable.has(key) ? 1.5 : 1, reachable.has(key) ? 0xa8d593 : 0xd1d6b0, reachable.has(key) ? 0.6 : 0.24);
      graphics.strokePoints(hexPolygon(x, y, hexSize - 1), true);

      if (blockedKeys.has(key) && !this.textures.exists(getBattlePropTextureKey("mossy-rocks"))) {
        graphics.fillStyle(0x515a4b, 1);
        graphics.fillEllipse(x, y, hexSize * 0.95, hexSize * 0.65);
      } else if (coverKeys.has(key) && !this.textures.exists(getBattlePropTextureKey("fallen-log"))) {
        graphics.fillStyle(0x826b49, 0.85);
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

    this.targetMarker = this.add.graphics().setDepth(-8000);
    this.renderObjects.push(this.targetMarker);
    const player = playerStateStore.get();
    const ownAppearance = player?.character.playerId === this.playerId ? player.character.appearance : undefined;
    for (const combatant of snapshot.combatants) {
      this.renderCombatant(combatant, layout, ownAppearance);
    }
    this.refreshAttackCard();
  }

  private renderCombatant(
    combatant: CombatantSnapshot,
    { centerX, centerY, hexSize, labelFontSize, arena }: ReturnType<typeof calculateBattleLayout>,
    ownAppearance?: Record<string, unknown>
  ): void {
    const local = axialToPixel(combatant.position, hexSize);
    const x = centerX + local.x;
    const y = centerY + local.y;
    const owned = combatant.ownerPlayerId === this.playerId;
    const active = combatant.id === this.snapshot?.activeCombatantId;
    const ally=combatant.side==="player" && this.ownCombatant()?.side==="player";
    const fill = combatant.hp <= 0 ? 0x555555 : owned ? 0x5fa6e8 : ally ? 0x6fac75 : 0xcf6a61;
    const enemyId = battleEnemyId(combatant);
    // Legacy wolves reuse the artwork without inheriting a different enemy's name or level.
    const enemy = combatant.enemyId ? getEnemyDefinition(combatant.enemyId) : undefined;
    const skin = enemyId ? getEnemySkinAsset(enemyId) : undefined;
    const skinId = battleCharacterSkin(combatant, this.playerId, ownAppearance);
    const textureKey = skin ? getEnemySkinTextureKey(skin.id) : skinId ? getCharacterSkinTextureKey(skinId) : "";
    const facing = combatant.side === "enemy" ? "west" : "east";
    const frame = skin ? "idle" : `battle:${facing}`;
    const hasSprite = Boolean(textureKey && this.textures.exists(textureKey) && this.textures.get(textureKey).has(frame));
    const footY = y + hexSize * 0.12;
    const ground = this.add.graphics().setDepth(-7500);
    ground.fillStyle(0x07110c, combatant.hp > 0 ? 0.44 : 0.2);
    ground.fillEllipse(x, footY + 1, hexSize * 0.9, hexSize * 0.32);
    ground.lineStyle(active ? 2 : 1.5, active ? 0xe8c873 : fill, active ? 0.95 : 0.65);
    ground.strokeEllipse(x, footY, hexSize * 1.03, hexSize * 0.4);
    this.renderObjects.push(ground);

    let visibleHeight = hexSize * 0.8;
    if (hasSprite && (skin || skinId)) {
      const bounds = battleHexBounds(hexSize);
      const size = skin
        ? getEnemySkinDisplaySize(skin, bounds.width * (skin.shape === "humanoid" ? 0.72 : 0.9), hexSize * (skin.shape === "humanoid" ? 1.8 : 1.3))
        : battleCharacterSize(skinId!, facing, hexSize);
      visibleHeight = size.height;
      const sprite = this.add.sprite(x, footY, textureKey, frame)
        .setOrigin(0.5, 1).setDisplaySize(size.width, size.height).setDepth(battleObjectDepth(footY));
      if (combatant.hp <= 0) sprite.setAlpha(0.4).setTint(0x777777);
      if (combatant.hp > 0) {
        // Tall sprites overlap rear hexes; transparent atlas pixels must pass input through.
        sprite.setInteractive({ useHandCursor: true, pixelPerfect: true, alphaTolerance: 16 });
        sprite.on("pointerover", () => this.previewCell(combatant.position));
        sprite.on("pointerup", (pointer: Phaser.Input.Pointer) => this.selectCell(combatant.position, pointer?.wasTouch ?? false));
      }
      this.renderObjects.push(sprite);
    } else {
      const body = this.add.circle(x, y - hexSize * 0.16, Math.max(4, hexSize * 0.38), fill);
      body.setStrokeStyle(active ? 3 : 2, active ? 0xe8c873 : 0x17271e).setDepth(battleObjectDepth(footY));
      if (combatant.hp > 0) {
        body.setInteractive();
        body.on("pointerover", () => this.previewCell(combatant.position));
        body.on("pointerup", (pointer: Phaser.Input.Pointer) => this.selectCell(combatant.position, pointer?.wasTouch ?? false));
      }
      this.renderObjects.push(body);
    }

    const compact = hexSize < 30;
    const fullName = enemy?.name ?? combatant.name;
    const name = compact && fullName.length > 12 ? `${fullName.slice(0, 11)}…` : fullName;
    const caption = `${name}${enemy ? ` · poz. ${enemy.level}` : ""}`;
    const labelY = footY - visibleHeight - 9;
    const label = this.add.text(x, labelY, caption, {
      fontFamily: "Georgia, serif",
      fontSize: `${Math.max(9, labelFontSize - 1)}px`,
      color: owned ? "#e4f2fa" : ally ? "#dcf0d6" : "#f1e5d2",
      backgroundColor: "#101b16cc",
      padding: { x: 4, y: 2 }
    }).setOrigin(0.5, 1).setDepth(10000 + footY);
    label.setPosition(
      Math.max(arena.x + label.width / 2, Math.min(x, arena.x + arena.width - label.width / 2)),
      Math.max(arena.y + label.height, Math.min(labelY, arena.y + arena.height))
    );

    const barWidth = Math.max(18, Math.min(54, hexSize * 1.5));
    const barY = Math.max(arena.y + label.height + 2, labelY + 3);
    const hpBar = this.add.graphics().setDepth(10001 + footY);
    hpBar.fillStyle(0x101713, 0.95);
    hpBar.fillRoundedRect(x - barWidth / 2 - 1, barY - 1, barWidth + 2, 5, 2);
    hpBar.fillStyle(combatant.hp <= 0 ? 0x687166 : owned ? 0x81b6cf : ally ? 0x82b77a : 0xc57c65, 1);
    hpBar.fillRoundedRect(x - barWidth / 2, barY, barWidth * Math.max(0, Math.min(1, combatant.hp / Math.max(1, combatant.maxHp))), 3, 1);
    this.renderObjects.push(label, hpBar);
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

  private requestHealSelf():void {
    const active=this.activeOwnedCombatant();
    const targetId=this.selectedHealingTargetId??active?.id;
    if(!active || !this.snapshot || !targetId || !getBattleHealingPreview(this.snapshot,active.id,targetId).available)return;
    this.pendingCommand=true;this.selectedTargetId=null;this.attackCard?.hide();this.refreshHud();
    gameSocket.sendBattleCommand(targetId===active.id ? {type:"healSelf",combatantId:active.id} : {type:"healAlly",combatantId:active.id,targetId});
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

  private requestWeaponSkill(skillId:WeaponSkillId,targetId?:string):void {
    const active=this.activeOwnedCombatant();
    if(!active||!this.snapshot||!getWeaponSkillPreview(this.snapshot,active.id,skillId,targetId).available)return;
    this.pendingCommand=true;this.selectedTargetId=null;this.attackCard?.hide();this.refreshHud();
    gameSocket.sendBattleCommand({type:"useWeaponSkill",combatantId:active.id,skillId,...(targetId?{targetId}:{})});
  }

  private refreshHud(): void {
    if (!this.selectedTargetId) this.targetMarker?.clear();
    const snapshot = this.snapshot;
    if (!snapshot || !this.hud) return;
    const player = playerStateStore.get();
    const state = player?.character.playerId === this.playerId ? player : null;
    const own = this.ownCombatant();
    const ownedTurn=Boolean(own && own.hp>0 && !snapshot.finished && snapshot.activeCombatantId===own.id && !this.pendingCommand && !this.pendingItem && !this.modePending);
    const members=this.teamMembers();
    const healingTarget=members.find(member=>member.id===this.selectedHealingTargetId && member.hp>0)??own;
    this.selectedHealingTargetId=healingTarget?.id??null;
    this.hud.update(own, ownedTurn, state?.inventory ?? { items: [] }, state?.character,
      own ? getBattleHealingPreview(snapshot,own.id,this.selectedHealingTargetId??own.id) : undefined,
      {members,activeCombatantId:snapshot.activeCombatantId,healingTargetId:this.selectedHealingTargetId??""});
    this.hud.setBattleContext(snapshot, this.pendingCommand || this.pendingItem);
    this.hud.setAutoBattle(Boolean(snapshot.autoBattle),this.modePending);
  }

  private ownCombatant(): CombatantSnapshot | undefined {
    return this.snapshot?.combatants.find(unit => unit.ownerPlayerId === this.playerId);
  }
  private updateKeyboardCapture():void {
    const keyboard=this.input?.keyboard;if(!keyboard)return;
    const typing=Boolean(this.chat?.isTyping || this.social?.isTyping || this.hud?.isTyping);
    keyboard.resetKeys?.();keyboard.enabled=!typing;
    if(typing)keyboard.disableGlobalCapture?.();else keyboard.enableGlobalCapture?.();
  }

  private teamMembers():CombatantSnapshot[] {
    const own=this.ownCombatant();
    return own ? this.snapshot?.combatants.filter(unit=>unit.id===own.id || (own.side==="player" && unit.side==="player"))??[] : [];
  }
  private selectHealingTarget(id:string):void {
    const own=this.ownCombatant(),target=this.teamMembers().find(unit=>unit.id===id && unit.hp>0);
    if(!own || !target || !(own.combatStats?.healingPower))return;
    this.selectedHealingTargetId=id;this.selectedTargetId=null;this.attackCard?.hide();this.refreshHud();
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
    const ally=this.teamMembers().find(unit=>unit.hp>0 && hexKey(unit.position)===hexKey(cell));
    if(ally){
      this.selectedTargetId=null;this.targetMarker?.clear();this.attackCard?.hide();
      if(this.ownCombatant()?.combatStats?.healingPower)this.selectHealingTarget(ally.id);
      else this.hud?.setStatus(`${ally.name}: ${ally.hp}/${ally.maxHp} HP · Drużyna`);
      return;
    }
    const target = this.enemyAt(cell);
    if (target) {
      this.selectedTargetId = target.id;
      this.refreshAttackCard();
      if (!touch) this.requestAttack(target.id);
    } else this.requestMove(cell);
  }

  private refreshAttackCard(): void {
    this.targetMarker?.clear();
    const selected = this.snapshot?.combatants.find(unit => unit.id === this.selectedTargetId && unit.hp > 0);
    if (selected && this.layout && !this.snapshot?.autoBattle && !this.modePending) {
      const local = axialToPixel(selected.position, this.layout.hexSize);
      this.targetMarker?.lineStyle(2, 0xe6ac80, 0.95);
      this.targetMarker?.strokePoints(hexPolygon(this.layout.centerX + local.x, this.layout.centerY + local.y, this.layout.hexSize - 2), true);
    }
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
    this.targetMarker = undefined;
  }
}
