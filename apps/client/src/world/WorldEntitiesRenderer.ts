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
import { drawCharacterSprite } from "../appearance/drawCharacterSprite";
import { SPRITE_WIDTH, SPRITE_HEIGHT } from "../appearance/characterSprites";
import { appearanceVisuals } from "../appearance/appearanceVisuals";
import { WalkAnimation } from "../appearance/walkAnimation";
import { drawWalkAtlas, WALK_ATLAS_HEIGHT, WALK_ATLAS_WIDTH, WALK_FRAME_NAMES, WALK_SHEETS } from "../appearance/walkSprites";

interface PlayerView {
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
  walk: WalkAnimation;
  sprite?: Phaser.GameObjects.Image;
  equipment?: Phaser.GameObjects.Image;
  appearanceKey: string;
}

export class WorldEntitiesRenderer {
  onNpcSelected?: (npcId: string) => void;
  onEncounterSelected?: (encounterId: string) => void;
  onPlayerContextMenu?: (
    player: WorldPlayerSnapshot,
    screen: { x: number; y: number }
  ) => void;

  private readonly spriteTextures = new Set<string>();
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

  update(delta: number, localMovement: { dx: number; dy: number }): void {
    for (const [id, view] of this.playerViews) {
      let movement = localMovement;
      if (id !== this.localPlayerId) {
        const dx = view.targetX - view.container.x, dy = view.targetY - view.container.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 0.5 || distance > 400) {
          view.container.setPosition(view.targetX, view.targetY);
          movement = { dx: 0, dy: 0 };
        } else {
          const blend = 1 - Math.pow(0.75, Math.max(0, delta) / (1000 / 60));
          movement = { dx: dx * blend, dy: dy * blend };
          view.container.x += movement.dx;
          view.container.y += movement.dy;
        }
      }
      view.walk.update(movement.dx, movement.dy, delta);
      const frame = view.walk.frameName;
      if (view.sprite && view.sprite.frame.name !== frame) {
        view.sprite.setFrame(frame);
        view.equipment?.setFrame(frame);
      }
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
    for (const key of this.spriteTextures) this.scene.textures.remove(key);
    this.spriteTextures.clear();
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
      if (view.appearanceKey !== JSON.stringify(player.appearance)) {
        this.applyWalkingSprite(view, player);
      }
      if (player.id !== this.localPlayerId) continue;
      if (view.container.x === 0 && view.container.y === 0) {
        view.container.setPosition(player.x, player.y);
      }
    }
    // Walk atlases are larger than static portraits; release them when nobody uses them.
    const activeTextures = new Set([...this.playerViews.values()].flatMap(view =>
      [view.sprite?.texture.key, view.equipment?.texture.key]));
    for (const key of this.spriteTextures) {
      if (!key.startsWith("character-walk-") || activeTextures.has(key)) continue;
      this.scene.textures.remove(key);
      this.spriteTextures.delete(key);
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

    // Use the same layered renderer as the creator, including saved eye expressions.
    if (!WALK_SHEETS.every(sheet => this.scene.textures.exists(sheet.key)) && this.scene.textures.exists("character-base-atlas")) {
      const key = `character-sprite:${JSON.stringify(player.appearance)}`;
      if (!this.scene.textures.exists(key)) {
        const texture = this.scene.textures.createCanvas(key, SPRITE_WIDTH, SPRITE_HEIGHT);
        if (texture) {
          drawCharacterSprite(texture.getContext(), this.scene.textures.get("character-base-atlas").getSourceImage() as HTMLImageElement, player.appearance);
          texture.refresh();
          texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
          this.spriteTextures.add(key);
        }
      }
      if (this.scene.textures.exists(key)) {
        for (const object of [outfit, face, leftEye, rightEye, hair, facialHair, marking]) {
          container.remove(object, true);
        }
        const sprite = this.scene.add.image(0, 24, key).setOrigin(0.5, 1).setScale(0.6);
        container.addAt(sprite, 1);
        label.setY(-52);
      }
    }

    if (!local) {
      container.setSize(54, 72).setInteractive({ useHandCursor: true });
      container.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
        if (!pointer.rightButtonDown()) return;
        this.onPlayerContextMenu?.(player, {
          x: pointer.x,
          y: pointer.y
        });
      });
    }

    const view: PlayerView = {
      container, label, targetX: player.x, targetY: player.y,
      walk: new WalkAnimation(), appearanceKey: JSON.stringify(player.appearance)
    };
    if (this.applyWalkingSprite(view, player)) {
      // Replace the legacy avatar while retaining its label, shadow and interaction target.
      for (const object of [...container.list]) {
        if ([shadow, facing, label, view.sprite, view.equipment].some(retained => retained === object)) continue;
        container.remove(object, true);
      }
    }
    return view;
  }

  private applyWalkingSprite(view: PlayerView, player: WorldPlayerSnapshot): boolean {
    if (!WALK_SHEETS.every(sheet => this.scene.textures.exists(sheet.key))) return false;
    const appearanceKey = JSON.stringify(player.appearance);
    const bodyKey = `character-walk-body:${appearanceKey}`, outfitKey = `character-walk-outfit:${appearanceKey}`;
    if (!this.scene.textures.exists(bodyKey)) {
      const body = this.scene.textures.createCanvas(bodyKey, WALK_ATLAS_WIDTH, WALK_ATLAS_HEIGHT);
      const outfit = this.scene.textures.createCanvas(outfitKey, WALK_ATLAS_WIDTH, WALK_ATLAS_HEIGHT);
      if (!body || !outfit) return false;
      const sources = WALK_SHEETS.map(sheet => this.scene.textures.get(sheet.key).getSourceImage() as HTMLImageElement);
      drawWalkAtlas(body.getContext(), outfit.getContext(), sources, player.appearance);
      for (const texture of [body, outfit]) {
        WALK_FRAME_NAMES.forEach((name, index) => texture.add(name, 0,
          (index % 3) * SPRITE_WIDTH, Math.floor(index / 3) * SPRITE_HEIGHT, SPRITE_WIDTH, SPRITE_HEIGHT));
        texture.refresh();
        texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
        this.spriteTextures.add(texture.key);
      }
    }
    if (view.sprite && view.equipment) {
      view.sprite.setTexture(bodyKey, view.walk.frameName);
      view.equipment.setTexture(outfitKey, view.walk.frameName);
    } else {
      view.sprite = this.scene.add.image(0, 24, bodyKey, view.walk.frameName).setOrigin(0.5, 1).setScale(0.6);
      view.equipment = this.scene.add.image(0, 24, outfitKey, view.walk.frameName).setOrigin(0.5, 1).setScale(0.6);
      view.container.addAt(view.sprite, 1);
      view.container.addAt(view.equipment, 2);
    }
    view.label.setY(-52);
    view.appearanceKey = appearanceKey;
    return true;
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
