import {
  resolveCharacterSkin,
  type CharacterSkinId,
  type EncounterSnapshot,
  type NpcSnapshot,
  type PlayerId,
  type WorldPlayerSnapshot,
  type TeleportZoneSnapshot,
  type WorldStateSnapshot
} from "@web-mmorpg/shared";
import Phaser from "phaser";
import {
  getCharacterAnimationFrames,
  resolveCharacterMotion,
  type CharacterDirection
} from "../characters/characterSkinAnimation";
import { getCharacterSkinTextureKey } from "../characters/characterSkinAssets";
import { getCharacterWalkAnimationKey } from "../characters/characterSkinSprites";
import { getNpcSkinAsset, getNpcSkinTextureKey } from "../characters/npcSkinAssets";
import { encounterAvailable, encounterLabel, encounterStatusText } from "./encounterPresentation";

interface EncounterView {
  container:Phaser.GameObjects.Container;
  label:Phaser.GameObjects.Text;
  encounter:EncounterSnapshot;
}

interface PlayerView {
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  speechBubble: SpeechBubbleView | undefined;
  sprite: Phaser.GameObjects.Sprite | undefined;
  fallback: Phaser.GameObjects.Container | undefined;
  skinId: CharacterSkinId | undefined;
  direction: CharacterDirection;
  targetX: number;
  targetY: number;
}

interface SpeechBubbleView {
  container: Phaser.GameObjects.Container;
  timer: Phaser.Time.TimerEvent;
}

interface PendingSpeechBubble {
  text: string;
  expiresAt: number;
}

const SPEECH_BUBBLE_DURATION_MS = 6000;
const SPEECH_BUBBLE_OFFSET_Y = -64;
const MAX_PENDING_SPEECH_BUBBLES = 50;

export class WorldEntitiesRenderer {
  onNpcSelected?: (npcId: string) => void;
  onEncounterSelected?: (encounterId: string) => void;
  onTeleportSelected?: (point:{x:number;y:number})=>void;

  private readonly playerViews = new Map<PlayerId, PlayerView>();
  private readonly pendingSpeechBubbles = new Map<PlayerId, PendingSpeechBubble>();
  private readonly npcViews = new Map<string, Phaser.GameObjects.Container>();
  private readonly encounterViews = new Map<string, EncounterView>();
  private readonly teleportViews = new Map<string, Phaser.GameObjects.Container>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly localPlayerId: PlayerId
  ) {}

  render(snapshot: WorldStateSnapshot): void {
    this.renderPlayers(snapshot.players);
    this.renderNpcs(snapshot.npcs);
    this.renderEncounters(snapshot.encounters);
    this.updateEncounters(snapshot.serverTime??Date.now());
    this.renderTeleports(snapshot.teleports??[],snapshot.location?.width??1600);
  }

  updateRemotePlayers(): void {
    for (const [id, view] of this.playerViews) {
      if (id === this.localPlayerId) continue;
      let x = Phaser.Math.Linear(view.container.x, view.targetX, 0.25);
      let y = Phaser.Math.Linear(view.container.y, view.targetY, 0.25);
      if (Math.hypot(view.targetX - x, view.targetY - y) < 0.5) {
        x = view.targetX;
        y = view.targetY;
      }
      this.updatePlayerPosition(view, x, y);
    }
  }

  setLocalPlayerPosition(x: number, y: number): void {
    const view = this.playerViews.get(this.localPlayerId);
    if (view) this.updatePlayerPosition(view, x, y);
  }

  getLocalPlayerObject(): Phaser.GameObjects.Container | undefined {
    return this.playerViews.get(this.localPlayerId)?.container;
  }

  showSpeechBubble(playerId: PlayerId, text: string): void {
    if (!text.trim()) return;
    this.prunePendingSpeechBubbles();
    const view = this.playerViews.get(playerId);
    if (view) {
      this.createSpeechBubble(view, text, SPEECH_BUBBLE_DURATION_MS);
      return;
    }

    // Chat may arrive before the first world snapshot. Never invent a player view.
    this.pendingSpeechBubbles.delete(playerId);
    if (this.pendingSpeechBubbles.size >= MAX_PENDING_SPEECH_BUBBLES) {
      const oldestPlayerId = this.pendingSpeechBubbles.keys().next().value;
      if (oldestPlayerId !== undefined) this.pendingSpeechBubbles.delete(oldestPlayerId);
    }
    this.pendingSpeechBubbles.set(playerId, {
      text,
      expiresAt: this.scene.time.now + SPEECH_BUBBLE_DURATION_MS
    });
  }

  destroy(): void {
    for (const view of this.playerViews.values()) {
      this.clearSpeechBubble(view);
      view.container.destroy(true);
    }
    for (const view of this.npcViews.values()) view.destroy(true);
    for (const view of this.encounterViews.values()) view.container.destroy(true);
    for (const view of this.teleportViews.values()) view.destroy(true);
    this.playerViews.clear();
    this.pendingSpeechBubbles.clear();
    this.npcViews.clear();
    this.encounterViews.clear();
    this.teleportViews.clear();
  }

  private renderPlayers(players: WorldPlayerSnapshot[]): void {
    this.prunePendingSpeechBubbles();
    const present = new Set(players.map((player) => player.id));
    for (const [id, view] of this.playerViews) {
      if (present.has(id)) continue;
      this.clearSpeechBubble(view);
      view.container.destroy(true);
      this.playerViews.delete(id);
    }

    for (const player of players) {
      let view = this.playerViews.get(player.id);
      if (!view) {
        view = this.createPlayer(player);
        this.playerViews.set(player.id, view);
        const pending = this.pendingSpeechBubbles.get(player.id);
        if (pending) {
          this.pendingSpeechBubbles.delete(player.id);
          this.createSpeechBubble(view, pending.text, pending.expiresAt - this.scene.time.now);
        }
      }
      view.targetX = player.x;
      view.targetY = player.y;
      view.label.setText(player.nickname);
      this.setPlayerSkin(view, resolveCharacterSkin(player.appearance).id, player.id === this.localPlayerId);
      if (player.id !== this.localPlayerId) continue;
      if (view.container.x === 0 && view.container.y === 0) {
        this.updatePlayerPosition(view, player.x, player.y);
      }
    }
  }

  private createPlayer(player: WorldPlayerSnapshot): PlayerView {
    const local = player.id === this.localPlayerId;
    const container = this.scene.add.container(player.x, player.y).setDepth(20);
    const shadow = this.scene.add.ellipse(0, 19, 32, 12, 0x101713, 0.38);
    const facing = this.scene.add.triangle(0, 20, -5, 0, 5, 0, 0, 8, local ? 0xe9d27c : 0xbcae92);
    const label = this.scene.add.text(0, -50, player.nickname, {
      fontFamily: "sans-serif",
      fontSize: "13px",
      color: local ? "#fff4b8" : "#ffffff",
      backgroundColor: "#101611bb",
      padding: { x: 4, y: 2 }
    }).setOrigin(0.5);
    container.add([shadow, facing, label]);
    const view: PlayerView = {
      container,
      label,
      speechBubble: undefined,
      sprite: undefined,
      fallback: undefined,
      skinId: undefined,
      direction: "south",
      targetX: player.x,
      targetY: player.y
    };
    this.setPlayerSkin(view, resolveCharacterSkin(player.appearance).id, local);
    return view;
  }

  private createSpeechBubble(view: PlayerView, text: string, durationMs: number): void {
    this.clearSpeechBubble(view);
    // A separate world-space container keeps bubbles above every unit and label.
    const container = this.scene.add.container(view.container.x, view.container.y + SPEECH_BUBBLE_OFFSET_Y)
      .setDepth(30);
    const message = this.scene.add.text(0, -8, text, {
      fontFamily: "sans-serif",
      fontSize: "14px",
      color: "#30271d",
      align: "center",
      padding: { x: 10, y: 7 },
      wordWrap: { width: 200, useAdvancedWrap: true }
    }).setOrigin(0.5, 1);
    const width = message.width;
    const height = message.height;
    const background = this.scene.add.graphics();
    background.fillStyle(0xf5ebca, 0.98);
    background.fillRoundedRect(-width / 2, -height - 8, width, height, 8);
    background.lineStyle(1, 0x665942, 1);
    background.strokeRoundedRect(-width / 2, -height - 8, width, height, 8);
    background.fillTriangle(-6, -9, 6, -9, 0, 0);
    container.add([background, message]);
    const timer = this.scene.time.delayedCall(durationMs, () => {
      if (view.speechBubble?.container === container) this.clearSpeechBubble(view);
    });
    view.speechBubble = { container, timer };
  }

  private clearSpeechBubble(view: PlayerView): void {
    if (!view.speechBubble) return;
    view.speechBubble.timer.remove(false);
    view.speechBubble.container.destroy(true);
    view.speechBubble = undefined;
  }

  private prunePendingSpeechBubbles(): void {
    for (const [playerId, pending] of this.pendingSpeechBubbles) {
      if (pending.expiresAt <= this.scene.time.now) this.pendingSpeechBubbles.delete(playerId);
    }
  }

  private setPlayerSkin(view: PlayerView, skinId: CharacterSkinId, local: boolean): void {
    if (view.skinId === skinId) return;
    view.sprite?.destroy();
    view.fallback?.destroy(true);
    view.sprite = undefined;
    view.fallback = undefined;
    view.skinId = skinId;

    const textureKey = getCharacterSkinTextureKey(skinId);
    if (this.scene.textures.exists(textureKey)) {
      this.scene.textures.get(textureKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
      view.sprite = this.scene.add.sprite(0, 20, textureKey, getCharacterAnimationFrames(view.direction)[0])
        .setOrigin(0.5, 1)
        .setDisplaySize(40, 60);
      view.container.addAt(view.sprite, 2);
      return;
    }

    // Keep players visible if an asset could not be loaded.
    view.fallback = this.scene.add.container(0, 0);
    const body = this.scene.add.rectangle(0, 3, 20, 28, local ? 0x5f8d62 : 0x796c5c).setStrokeStyle(2, 0x2a3027);
    const head = this.scene.add.circle(0, -17, 9, local ? 0xd9b37a : 0xc39a6b).setStrokeStyle(2, 0x3f3328);
    view.fallback.add([body, head]);
    view.container.addAt(view.fallback, 2);
  }

  private updatePlayerPosition(view: PlayerView, x: number, y: number): void {
    const motion = resolveCharacterMotion(x - view.container.x, y - view.container.y, view.direction);
    view.direction = motion.direction;
    view.container.setPosition(x, y);
    view.speechBubble?.container.setPosition(x, y + SPEECH_BUBBLE_OFFSET_Y);
    if (!view.sprite || !view.skinId) return;

    if (motion.moving) {
      view.sprite.play(getCharacterWalkAnimationKey(view.skinId, view.direction), true);
    } else {
      view.sprite.stop();
      view.sprite.setFrame(getCharacterAnimationFrames(view.direction)[0]);
    }
  }

  private renderNpcs(npcs: NpcSnapshot[]): void {
    const present = new Set(npcs.map((npc) => npc.id));
    for (const [id, view] of this.npcViews) {
      if (present.has(id)) continue;
      view.destroy(true);
      this.npcViews.delete(id);
    }

    for (const npc of npcs) {
      if (this.npcViews.has(npc.id)) continue;
      this.npcViews.set(npc.id, this.createNpc(npc));
    }
  }

  private createNpc(npc: NpcSnapshot): Phaser.GameObjects.Container {
    const container = this.scene.add.container(npc.x, npc.y).setDepth(18);
    const shadow = this.scene.add.ellipse(0, 18, 34, 12, 0x101713, 0.34);
    container.add(shadow);
    const skin = getNpcSkinAsset(npc.id);
    const textureKey = getNpcSkinTextureKey(npc.id);
    if (skin && this.scene.textures.exists(textureKey) && this.scene.textures.get(textureKey).has("idle")) {
      this.scene.textures.get(textureKey).setFilter(Phaser.Textures.FilterMode.NEAREST);
      const sprite = this.scene.add.sprite(0, 20, textureKey, "idle")
        .setOrigin(0.5, 1)
        .setDisplaySize(56 * skin.frame.width / skin.frame.height, 56);
      container.add(sprite);
    } else {
      // NPCs remain visible and interactive when an image could not be loaded.
      const accent = npc.kind === "healer" ? 0x9b594e : npc.kind === "merchant" ? 0x9d833d : 0x6f7f9e;
      const body = this.scene.add.rectangle(0, 2, 22, 30, accent).setStrokeStyle(2, 0x302b26);
      const head = this.scene.add.circle(0, -18, 9, 0xcfa06d).setStrokeStyle(2, 0x3f3328);
      const symbol = this.scene.add.text(0, 4, npc.kind === "healer" ? "+" : npc.kind === "merchant" ? "$" : "!", {
        fontFamily: "sans-serif", fontSize: "15px", color: "#fff5cf", fontStyle: "bold"
      }).setOrigin(0.5);
      container.add([body, head, symbol]);
    }
    const role = npc.kind === "healer" ? "Uzdrowicielka" : npc.kind === "merchant" ? "Kupiec" : "Przewodnik";
    const label = this.scene.add.text(0, -55, `${npc.name}\n${role}`, {
      fontFamily: "sans-serif",
      fontSize: "12px",
      align: "center",
      color: "#fff1c9",
      backgroundColor: "#1d1b15c9",
      padding: { x: 5, y: 2 }
    }).setOrigin(0.5);
    container.add(label);
    container.setSize(54, 68).setInteractive({ useHandCursor: true });
    container.on("pointerup", () => this.onNpcSelected?.(npc.id));
    return container;
  }

  private renderEncounters(encounters: EncounterSnapshot[]): void {
    const present = new Set(encounters.map((encounter) => encounter.id));
    for (const [id, view] of this.encounterViews) {
      if (present.has(id)) continue;
      view.container.destroy(true);
      this.encounterViews.delete(id);
    }

    for (const encounter of encounters) {
      const view=this.encounterViews.get(encounter.id);
      if(view){view.encounter={...encounter};view.container.setPosition(encounter.x,encounter.y);}
      else this.encounterViews.set(encounter.id, this.createEncounter(encounter));
    }
  }

  updateEncounters(serverNow=Date.now()):void {
    for(const view of this.encounterViews.values()) {
      const status=encounterStatusText(view.encounter,serverNow);
      view.label.setText(`${encounterLabel(view.encounter)}${status ? `\n${status}` : ""}`);
      const available=encounterAvailable(view.encounter);
      view.container.setAlpha(available ? 1 : 0.55);
      if(available)view.container.setInteractive({useHandCursor:true});
      else view.container.disableInteractive();
    }
  }

  private createEncounter(encounter: EncounterSnapshot): EncounterView {
    const container = this.scene.add.container(encounter.x, encounter.y).setDepth(17);
    const shadow = this.scene.add.ellipse(0, 14, 88, 30, 0x111611, 0.35);
    const kind=encounter.enemyKind??"wolf";
    const wolves = (kind==="wolf" ? [-25,0,25] : [0]).map((x, index) => {
      if(kind==="forest-spider") {
        const spider=this.scene.add.container(x,2);
        const legs=[-1,1].flatMap(side=>[-10,0,10].map(y=>this.scene.add.rectangle(side*17,y,24,3,0x38332a)));
        spider.add([...legs,this.scene.add.ellipse(0,0,29,34,0x66523a).setStrokeStyle(2,0x2d281f),this.scene.add.circle(-4,-12,2,0xde865f),this.scene.add.circle(4,-12,2,0xde865f)]);
        return spider;
      }
      if(kind==="boar") {
        const boar=this.scene.add.container(x,2);
        boar.add([this.scene.add.ellipse(0,2,52,31,0x79563d).setStrokeStyle(2,0x392d24),this.scene.add.ellipse(24,4,18,19,0x654733),this.scene.add.triangle(27,10,-4,4,4,4,2,-5,0xe7d8a3)]);
        return boar;
      }
      const wolf = this.scene.add.ellipse(x, index === 1 ? -2 : 6, 31, 19, index === 1 ? 0x5b5d58 : 0x4b4e49);
      wolf.setStrokeStyle(2, 0x292d2a);
      return wolf;
    });
    const label = this.scene.add.text(0, -42, encounterLabel(encounter), {
      fontFamily: "Georgia, serif",
      fontSize: "15px",
      color: "#f2c8af",
      backgroundColor: "#2d1c17cc",
      padding: { x: 6, y: 3 }
    }).setOrigin(0.5);
    container.add([shadow, ...wolves, label]);
    container.setSize(110, 70).setInteractive({ useHandCursor: true });
    const view={container,label,encounter:{...encounter}};
    container.on("pointerup", () => {if(encounterAvailable(view.encounter))this.onEncounterSelected?.(encounter.id);});
    return view;
  }

  private renderTeleports(zones:TeleportZoneSnapshot[],worldWidth:number):void {
    const present=new Set(zones.map(zone=>zone.id));
    for(const [id,view] of this.teleportViews)if(!present.has(id)){view.destroy(true);this.teleportViews.delete(id);}
    for(const zone of zones) {
      if(this.teleportViews.has(zone.id))continue;
      const center={x:zone.x+zone.width/2,y:zone.y+zone.height/2};
      const view=this.scene.add.container(center.x,center.y).setDepth(16);
      const edgeRight=center.x>worldWidth/2;
      const area=this.scene.add.rectangle(0,0,zone.width,zone.height,0x82c4b4,0.18).setStrokeStyle(3,0xc2dfb0,0.9);
      const arrow=this.scene.add.text(0,-18,edgeRight ? "→" : "←",{fontFamily:"sans-serif",fontSize:"34px",color:"#f0e9b8"}).setOrigin(0.5);
      const label=this.scene.add.text(edgeRight ? -zone.width/2-10 : zone.width/2+10,25,zone.label,{fontFamily:"Georgia, serif",fontSize:"15px",color:"#f0edcf",backgroundColor:"#16251ddd",padding:{x:7,y:5}}).setOrigin(edgeRight ? 1 : 0,0.5);
      view.add([area,arrow,label]);
      view.setSize(zone.width,zone.height).setInteractive({useHandCursor:true});
      view.on("pointerup",()=>this.onTeleportSelected?.(center));
      this.teleportViews.set(zone.id,view);
    }
  }
}
