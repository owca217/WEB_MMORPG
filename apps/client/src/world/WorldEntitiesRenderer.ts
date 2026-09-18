import type {
  EncounterSnapshot,
  NpcSnapshot,
  PlayerId,
  WorldPlayerSnapshot,
  WorldStateSnapshot
} from "@web-mmorpg/shared";
import Phaser from "phaser";
import {
  createFacialHairGraphic,
  createHairGraphic,
  createMarkingGraphic
} from "../appearance/AvatarGraphics";
import { appearanceVisuals } from "../appearance/appearanceVisuals";

interface PlayerView {
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
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
      view.container.x = Phaser.Math.Linear(view.container.x, view.targetX, 0.25);
      view.container.y = Phaser.Math.Linear(view.container.y, view.targetY, 0.25);
    }
  }

  setLocalPlayerPosition(x: number, y: number): void {
    this.playerViews.get(this.localPlayerId)?.container.setPosition(x, y);
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
      if (player.id !== this.localPlayerId) continue;
      if (view.container.x === 0 && view.container.y === 0) {
        view.container.setPosition(player.x, player.y);
      }
    }
  }

  private createPlayer(player: WorldPlayerSnapshot): PlayerView {
    const local = player.id === this.localPlayerId;
    const visuals = appearanceVisuals(player.appearance);
    const skinColor = Phaser.Display.Color.HexStringToColor(visuals.skin).color;
    const outfitColor = Phaser.Display.Color.HexStringToColor(visuals.outfit).color;

    const container = this.scene.add.container(player.x, player.y).setDepth(20);
    const shadow = this.scene.add.ellipse(0, 22, 34, 12, 0x101713, 0.38);
    const outfit = this.scene.add
      .rectangle(0, 13, 30 * visuals.bodyScale, 27, outfitColor)
      .setStrokeStyle(2, local ? 0xe2c76e : 0x2a3027);
    const face = this.scene.add
      .ellipse(
        0,
        -9,
        25 * visuals.bodyScale * visuals.faceScaleX,
        28 * visuals.bodyScale,
        skinColor
      )
      .setStrokeStyle(2, local ? 0xe2c76e : 0x3f3328);
    const leftEye = this.scene.add.circle(
      -visuals.eyeSpacing,
      -10,
      visuals.eyeRadius,
      0x1b1b1b
    );
    const rightEye = this.scene.add.circle(
      visuals.eyeSpacing,
      -10,
      visuals.eyeRadius,
      0x1b1b1b
    );
    const hair = createHairGraphic(
      this.scene,
      visuals.hairStyle,
      visuals.hairColor,
      visuals.bodyScale
    );
    const facialHair = createFacialHairGraphic(
      this.scene,
      visuals.facialHairStyle,
      visuals.hairColor,
      visuals.bodyScale
    );
    const marking = createMarkingGraphic(
      this.scene,
      visuals.marking,
      visuals.bodyScale
    );
    const facing = this.scene.add.triangle(
      0,
      28,
      -5,
      0,
      5,
      0,
      0,
      8,
      local ? 0xe9d27c : 0xbcae92
    );
    const label = this.scene.add
      .text(0, -43, player.nickname, {
        fontFamily: "sans-serif",
        fontSize: "13px",
        color: local ? "#fff4b8" : "#ffffff",
        backgroundColor: "#101611bb",
        padding: { x: 4, y: 2 }
      })
      .setOrigin(0.5);

    container.add([
      shadow,
      outfit,
      face,
      leftEye,
      rightEye,
      hair,
      facialHair,
      marking,
      facing,
      label
    ]);
    return { container, label, targetX: player.x, targetY: player.y };
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
