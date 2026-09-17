import type { PlayerId, WorldPlayerSnapshot, WorldStateSnapshot } from "@web-mmorpg/shared";
import Phaser from "phaser";
import { moveTowardTarget, resolveKeyboardIntent } from "../input/WorldInput";
import { gameSocket } from "../net/GameSocket";

interface PlayerView {
  body: Phaser.GameObjects.Arc;
  label: Phaser.GameObjects.Text;
}

interface WorldSceneData {
  playerId: PlayerId;
}

export class WorldScene extends Phaser.Scene {
  private playerId: PlayerId = "";
  private readonly playerViews = new Map<PlayerId, PlayerView>();
  private readonly encounterViews = new Map<string, Phaser.GameObjects.Arc>();
  private unsubscribeWorld?: () => void;
  private unsubscribeRejected?: () => void;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;
  private pointerTarget: { x: number; y: number } | null = null;
  private localPosition = { x: 300, y: 450 };
  private latestSnapshot?: WorldStateSnapshot;
  private lastIntentSentAt = 0;

  constructor() {
    super("WorldScene");
  }

  init(data: WorldSceneData): void {
    this.playerId = data.playerId;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x1f3522);
    this.cameras.main.setBounds(0, 0, 1600, 900);
    this.physics.world.setBounds(0, 0, 1600, 900);

    const grid = this.add.grid(800, 450, 1600, 900, 64, 64, 0x27472c, 1, 0x355b3a, 0.35);
    grid.setDepth(-10);

    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys("W,A,S,D") as Record<
        "W" | "A" | "S" | "D",
        Phaser.Input.Keyboard.Key
      >;
    }

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.pointerTarget = { x: pointer.worldX, y: pointer.worldY };
    });

    this.unsubscribeWorld = gameSocket.onWorldState((snapshot) => this.renderWorld(snapshot));
    this.unsubscribeRejected = gameSocket.onCommandRejected(({ message }) => {
      this.showToast(message);
    });

    // Request a fresh authoritative snapshot after this scene has subscribed.
    gameSocket.sendMoveIntent(this.localPosition);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeWorld?.();
      this.unsubscribeRejected?.();
    });
  }

  update(_time: number, delta: number): void {
    const keyboardIntent = resolveKeyboardIntent({
      left: Boolean(this.cursors?.left.isDown || this.wasd?.A.isDown),
      right: Boolean(this.cursors?.right.isDown || this.wasd?.D.isDown),
      up: Boolean(this.cursors?.up.isDown || this.wasd?.W.isDown),
      down: Boolean(this.cursors?.down.isDown || this.wasd?.S.isDown)
    });

    const hasKeyboardIntent = keyboardIntent.dx !== 0 || keyboardIntent.dy !== 0;
    const speed = 220;
    const travel = (speed * delta) / 1000;

    if (hasKeyboardIntent) {
      this.pointerTarget = null;
      this.localPosition = {
        x: Phaser.Math.Clamp(this.localPosition.x + keyboardIntent.dx * travel, 0, 1600),
        y: Phaser.Math.Clamp(this.localPosition.y + keyboardIntent.dy * travel, 0, 900)
      };
    } else if (this.pointerTarget) {
      this.localPosition = moveTowardTarget(this.localPosition, this.pointerTarget, travel);
      if (Phaser.Math.Distance.Between(
        this.localPosition.x,
        this.localPosition.y,
        this.pointerTarget.x,
        this.pointerTarget.y
      ) < 2) {
        this.pointerTarget = null;
      }
    }

    const localView = this.playerViews.get(this.playerId);
    if (localView) {
      localView.body.setPosition(this.localPosition.x, this.localPosition.y);
      localView.label.setPosition(this.localPosition.x, this.localPosition.y - 30);
    }

    if ((hasKeyboardIntent || this.pointerTarget) && this.time.now - this.lastIntentSentAt >= 50) {
      this.lastIntentSentAt = this.time.now;
      gameSocket.sendMoveIntent(this.localPosition);
    }
  }

  private renderWorld(snapshot: WorldStateSnapshot): void {
    this.latestSnapshot = snapshot;
    const presentPlayers = new Set(snapshot.players.map((player) => player.id));

    for (const [id, view] of this.playerViews) {
      if (presentPlayers.has(id)) continue;
      view.body.destroy();
      view.label.destroy();
      this.playerViews.delete(id);
    }

    for (const player of snapshot.players) {
      const view = this.playerViews.get(player.id) ?? this.createPlayerView(player);
      view.body.setPosition(player.x, player.y);
      view.label.setPosition(player.x, player.y - 30).setText(player.nickname);

      if (player.id === this.playerId) {
        this.localPosition = { x: player.x, y: player.y };
        this.cameras.main.startFollow(view.body, true, 0.12, 0.12);
      }
    }

    for (const encounter of snapshot.encounters) {
      if (this.encounterViews.has(encounter.id)) continue;

      const marker = this.add.circle(encounter.x, encounter.y, 28, 0x8b3f35, 0.95);
      marker.setStrokeStyle(3, 0xd8a16c);
      marker.setInteractive({ useHandCursor: true });
      marker.on("pointerup", () => {
        this.pointerTarget = null;
        gameSocket.startEncounter(encounter.id);
      });
      this.add.text(encounter.x, encounter.y - 42, encounter.label, {
        fontFamily: "sans-serif",
        fontSize: "16px",
        color: "#ffe4c2",
        backgroundColor: "#241812aa",
        padding: { x: 5, y: 3 }
      }).setOrigin(0.5);
      this.encounterViews.set(encounter.id, marker);
    }
  }

  private createPlayerView(player: WorldPlayerSnapshot): PlayerView {
    const isLocal = player.id === this.playerId;
    const body = this.add.circle(player.x, player.y, 16, isLocal ? 0x78b9ff : 0xd6d3c9);
    body.setStrokeStyle(2, isLocal ? 0xe2f2ff : 0x525252);
    const label = this.add.text(player.x, player.y - 30, player.nickname, {
      fontFamily: "sans-serif",
      fontSize: "14px",
      color: "#ffffff",
      backgroundColor: "#00000088",
      padding: { x: 4, y: 2 }
    }).setOrigin(0.5);

    const view = { body, label };
    this.playerViews.set(player.id, view);
    return view;
  }

  private showToast(message: string): void {
    const toast = this.add.text(this.cameras.main.centerX, 70, message, {
      fontFamily: "sans-serif",
      fontSize: "16px",
      color: "#ffffff",
      backgroundColor: "#8a2828dd",
      padding: { x: 12, y: 8 }
    }).setScrollFactor(0).setOrigin(0.5).setDepth(100);

    this.time.delayedCall(2500, () => toast.destroy());
  }
}
