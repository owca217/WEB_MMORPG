import {
  resolveCharacterSkin,
  type CharacterSkinId,
  type EncounterSnapshot,
  type NpcSnapshot,
  type PlayerId,
  type WorldPlayerSnapshot,
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

interface PlayerView {
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  sprite: Phaser.GameObjects.Sprite | undefined;
  fallback: Phaser.GameObjects.Container | undefined;
  skinId: CharacterSkinId | undefined;
  direction: CharacterDirection;
  targetX: number;
  targetY: number;
}

export class WorldEntitiesRenderer {
  onNpcSelected?: (npcId: string) => void;
  onEncounterSelected?: (encounterId: string) => void;

  private readonly playerViews = new Map<PlayerId, PlayerView>();
  private readonly npcViews = new Map<string, Phaser.GameObjects.Container>();
  private readonly encounterViews = new Map<string, Phaser.GameObjects.Container>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly localPlayerId: PlayerId
  ) {}

  render(snapshot: WorldStateSnapshot): void {
    this.renderPlayers(snapshot.players);
    this.renderNpcs(snapshot.npcs);
    this.renderEncounters(snapshot.encounters);
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

  destroy(): void {
    for (const view of this.playerViews.values()) view.container.destroy(true);
    for (const view of this.npcViews.values()) view.destroy(true);
    for (const view of this.encounterViews.values()) view.destroy(true);
    this.playerViews.clear();
    this.npcViews.clear();
    this.encounterViews.clear();
  }

  private renderPlayers(players: WorldPlayerSnapshot[]): void {
    const present = new Set(players.map((player) => player.id));
    for (const [id, view] of this.playerViews) {
      if (present.has(id)) continue;
      view.container.destroy(true);
      this.playerViews.delete(id);
    }

    for (const player of players) {
      let view = this.playerViews.get(player.id);
      if (!view) {
        view = this.createPlayer(player);
        this.playerViews.set(player.id, view);
      }
      view.targetX = player.x;
      view.targetY = player.y;
      view.label.setText(player.nickname);
      this.setPlayerSkin(view, resolveCharacterSkin(player.appearance).id, player.id === this.localPlayerId);
      if (player.id !== this.localPlayerId) continue;
      if (view.container.x === 0 && view.container.y === 0) {
        view.container.setPosition(player.x, player.y);
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
    const accent = npc.kind === "healer" ? 0x9b594e : 0x6f7f9e;
    const body = this.scene.add.rectangle(0, 2, 22, 30, accent).setStrokeStyle(2, 0x302b26);
    const head = this.scene.add.circle(0, -18, 9, 0xcfa06d).setStrokeStyle(2, 0x3f3328);
    const symbol = this.scene.add.text(0, 4, npc.kind === "healer" ? "+" : "!", {
      fontFamily: "sans-serif",
      fontSize: "15px",
      color: "#fff5cf",
      fontStyle: "bold"
    }).setOrigin(0.5);
    const label = this.scene.add.text(0, -42, npc.name, {
      fontFamily: "sans-serif",
      fontSize: "13px",
      color: "#fff1c9",
      backgroundColor: "#1d1b15c9",
      padding: { x: 5, y: 2 }
    }).setOrigin(0.5);
    container.add([shadow, body, head, symbol, label]);
    container.setSize(54, 68).setInteractive({ useHandCursor: true });
    container.on("pointerup", () => this.onNpcSelected?.(npc.id));
    return container;
  }

  private renderEncounters(encounters: EncounterSnapshot[]): void {
    const present = new Set(encounters.map((encounter) => encounter.id));
    for (const [id, view] of this.encounterViews) {
      if (present.has(id)) continue;
      view.destroy(true);
      this.encounterViews.delete(id);
    }

    for (const encounter of encounters) {
      if (this.encounterViews.has(encounter.id)) continue;
      this.encounterViews.set(encounter.id, this.createEncounter(encounter));
    }
  }

  private createEncounter(encounter: EncounterSnapshot): Phaser.GameObjects.Container {
    const container = this.scene.add.container(encounter.x, encounter.y).setDepth(17);
    const shadow = this.scene.add.ellipse(0, 14, 88, 30, 0x111611, 0.35);
    const wolves = [-25, 0, 25].map((x, index) => {
      const wolf = this.scene.add.ellipse(x, index === 1 ? -2 : 6, 31, 19, index === 1 ? 0x5b5d58 : 0x4b4e49);
      wolf.setStrokeStyle(2, 0x292d2a);
      return wolf;
    });
    const label = this.scene.add.text(0, -36, "Wilki", {
      fontFamily: "Georgia, serif",
      fontSize: "15px",
      color: "#f2c8af",
      backgroundColor: "#2d1c17cc",
      padding: { x: 6, y: 3 }
    }).setOrigin(0.5);
    container.add([shadow, ...wolves, label]);
    container.setSize(110, 70).setInteractive({ useHandCursor: true });
    container.on("pointerup", () => this.onEncounterSelected?.(encounter.id));
    return container;
  }
}
