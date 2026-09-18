import type { PlayerId, WorldStateSnapshot } from "@web-mmorpg/shared";
import Phaser from "phaser";
import { VirtualJoystick } from "../input/VirtualJoystick";
import { moveTowardTarget, resolveKeyboardIntent } from "../input/WorldInput";
import { apiClient } from "../net/ApiClient";
import { gameSocket } from "../net/GameSocket";
import { playerStateStore } from "../state/PlayerStateStore";
import { CharacterPanel } from "../ui/CharacterPanel";
import { DialoguePanel } from "../ui/DialoguePanel";
import { InventoryPanel } from "../ui/InventoryPanel";
import { WorldHud } from "../ui/WorldHud";
import { FOREST_SETTLEMENT_LAYOUT } from "../world/ForestSettlementLayout";
import { ForestSettlementRenderer } from "../world/ForestSettlementRenderer";
import { WorldEntitiesRenderer } from "../world/WorldEntitiesRenderer";

interface WorldSceneData {
  playerId: PlayerId;
}

const persistentAccountsEnabled =
  import.meta.env.VITE_PERSISTENT_ACCOUNTS === "true";

const WORLD_ERROR_LABELS: Record<string, string> = {
  ENCOUNTER_OUT_OF_RANGE: "Podejdź bliżej do wilków.",
  NPC_OUT_OF_RANGE: "Podejdź bliżej do tej postaci.",
  NPC_NOT_FOUND: "Nie znaleziono tej postaci.",
  HEAL_REJECTED: "Leczenie nie jest teraz dostępne."
};

export class WorldScene extends Phaser.Scene {
  private playerId: PlayerId = "";
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd?: Record<"W" | "A" | "S" | "D", Phaser.Input.Keyboard.Key>;
  private pointerTarget: { x: number; y: number } | null = null;
  private localPosition: { x: number; y: number } = { ...FOREST_SETTLEMENT_LAYOUT.spawn };
  private authoritativePosition: { x: number; y: number } | null = null;
  private lastIntentSentAt = 0;
  private cameraFollowing = false;
  private backgroundRenderer: ForestSettlementRenderer | undefined;
  private entitiesRenderer: WorldEntitiesRenderer | undefined;
  private hud: WorldHud | undefined;
  private inventoryPanel: InventoryPanel | undefined;
  private characterPanel: CharacterPanel | undefined;
  private dialoguePanel: DialoguePanel | undefined;
  private joystick: VirtualJoystick | undefined;
  private readonly cleanups: Array<() => void> = [];

  constructor() {
    super("WorldScene");
  }

  init(data: WorldSceneData): void {
    this.playerId = data.playerId;
    this.pointerTarget = null;
    this.authoritativePosition = null;
    this.localPosition = { ...FOREST_SETTLEMENT_LAYOUT.spawn };
    this.cameraFollowing = false;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x29452d);
    this.cameras.main.setBounds(
      0,
      0,
      FOREST_SETTLEMENT_LAYOUT.width,
      FOREST_SETTLEMENT_LAYOUT.height
    );
    this.physics.world.setBounds(
      0,
      0,
      FOREST_SETTLEMENT_LAYOUT.width,
      FOREST_SETTLEMENT_LAYOUT.height
    );

    this.backgroundRenderer = new ForestSettlementRenderer(this);
    this.backgroundRenderer.render();

    this.entitiesRenderer = new WorldEntitiesRenderer(this, this.playerId);
    this.entitiesRenderer.onNpcSelected = (npcId) => {
      this.pointerTarget = null;
      gameSocket.interactNpc(npcId);
    };
    this.entitiesRenderer.onEncounterSelected = (encounterId) => {
      this.pointerTarget = null;
      gameSocket.startEncounter(encounterId);
    };

    this.inventoryPanel = new InventoryPanel();
    this.characterPanel = new CharacterPanel();
    this.dialoguePanel = new DialoguePanel({
      onHeal: (npcId) => gameSocket.healAtNpc(npcId)
    });
    this.hud = new WorldHud({
      onInventory: () => this.inventoryPanel?.toggle(),
      onCharacter: () => this.characterPanel?.toggle(),
      ...(persistentAccountsEnabled
        ? {
            onLogout: () => {
              gameSocket.disconnect();
              void apiClient.logout().finally(() => {
                if (typeof window !== "undefined") window.location.reload();
              });
            }
          }
        : {})
    });
    this.joystick = new VirtualJoystick();

    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys("W,A,S,D") as Record<
        "W" | "A" | "S" | "D",
        Phaser.Input.Keyboard.Key
      >;
    }

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      this.pointerTarget = {
        x: Phaser.Math.Clamp(pointer.worldX, 0, FOREST_SETTLEMENT_LAYOUT.width),
        y: Phaser.Math.Clamp(pointer.worldY, 0, FOREST_SETTLEMENT_LAYOUT.height)
      };
    });

    this.cleanups.push(
      gameSocket.onWorldState((snapshot) => this.renderWorld(snapshot)),
      gameSocket.onPlayerState((state) => {
        playerStateStore.set(state);
        this.hud?.update(state);
        this.inventoryPanel?.update(state.inventory);
        this.characterPanel?.update(state.character);
      }),
      gameSocket.onNpcInteraction((payload) => this.dialoguePanel?.show(payload)),
      gameSocket.onConnectionState((state) => this.hud?.setConnectionState(state)),
      gameSocket.onCommandRejected(({ code, message }) => {
        this.showToast(WORLD_ERROR_LABELS[code] ?? message);
      }),
      gameSocket.onBattleStarted((snapshot) => {
        this.scene.start("BattleScene", { playerId: this.playerId, snapshot });
      })
    );

    gameSocket.requestWorldState();
    gameSocket.requestPlayerState();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.cleanup());
  }

  update(_time: number, delta: number): void {
    const keyboardIntent = resolveKeyboardIntent({
      left: Boolean(this.cursors?.left.isDown || this.wasd?.A.isDown),
      right: Boolean(this.cursors?.right.isDown || this.wasd?.D.isDown),
      up: Boolean(this.cursors?.up.isDown || this.wasd?.W.isDown),
      down: Boolean(this.cursors?.down.isDown || this.wasd?.S.isDown)
    });
    const analogIntent = this.joystick?.getIntent() ?? { dx: 0, dy: 0 };
    const hasKeyboardIntent = keyboardIntent.dx !== 0 || keyboardIntent.dy !== 0;
    const directionalIntent = hasKeyboardIntent ? keyboardIntent : analogIntent;
    const hasDirectionalIntent = directionalIntent.dx !== 0 || directionalIntent.dy !== 0;
    const speed = 220;
    const travel = (speed * delta) / 1000;

    if (hasDirectionalIntent) {
      this.pointerTarget = null;
      this.localPosition = {
        x: Phaser.Math.Clamp(
          this.localPosition.x + directionalIntent.dx * travel,
          0,
          FOREST_SETTLEMENT_LAYOUT.width
        ),
        y: Phaser.Math.Clamp(
          this.localPosition.y + directionalIntent.dy * travel,
          0,
          FOREST_SETTLEMENT_LAYOUT.height
        )
      };
    } else if (this.pointerTarget) {
      this.localPosition = moveTowardTarget(this.localPosition, this.pointerTarget, travel);
      if (
        Phaser.Math.Distance.Between(
          this.localPosition.x,
          this.localPosition.y,
          this.pointerTarget.x,
          this.pointerTarget.y
        ) < 2
      ) {
        this.pointerTarget = null;
      }
    } else if (this.authoritativePosition) {
      this.localPosition = {
        x: Phaser.Math.Linear(this.localPosition.x, this.authoritativePosition.x, 0.12),
        y: Phaser.Math.Linear(this.localPosition.y, this.authoritativePosition.y, 0.12)
      };
    }

    if (this.authoritativePosition) {
      const correctionDistance = Phaser.Math.Distance.Between(
        this.localPosition.x,
        this.localPosition.y,
        this.authoritativePosition.x,
        this.authoritativePosition.y
      );
      if (correctionDistance > 120) {
        this.localPosition = {
          x: Phaser.Math.Linear(this.localPosition.x, this.authoritativePosition.x, 0.3),
          y: Phaser.Math.Linear(this.localPosition.y, this.authoritativePosition.y, 0.3)
        };
      }
    }

    this.entitiesRenderer?.setLocalPlayerPosition(this.localPosition.x, this.localPosition.y);
    this.entitiesRenderer?.updateRemotePlayers();

    if ((hasDirectionalIntent || this.pointerTarget) && this.time.now - this.lastIntentSentAt >= 50) {
      this.lastIntentSentAt = this.time.now;
      gameSocket.sendMoveIntent(this.localPosition);
    }
  }

  private renderWorld(snapshot: WorldStateSnapshot): void {
    this.entitiesRenderer?.render(snapshot);
    const local = snapshot.players.find((player) => player.id === this.playerId);
    if (!local) return;

    if (!this.authoritativePosition) {
      this.localPosition = { x: local.x, y: local.y };
      this.entitiesRenderer?.setLocalPlayerPosition(local.x, local.y);
    }
    this.authoritativePosition = { x: local.x, y: local.y };

    if (!this.cameraFollowing) {
      const followTarget = this.entitiesRenderer?.getLocalPlayerObject();
      if (followTarget) {
        this.cameras.main.startFollow(followTarget, true, 0.16, 0.16);
        this.cameraFollowing = true;
      }
    }
  }

  private showToast(message: string): void {
    const toast = this.add.text(this.cameras.main.centerX, 92, message, {
      fontFamily: "sans-serif",
      fontSize: "16px",
      color: "#fff5e3",
      backgroundColor: "#6b332bdd",
      padding: { x: 12, y: 8 }
    }).setScrollFactor(0).setOrigin(0.5).setDepth(100);

    this.time.delayedCall(2500, () => toast.destroy());
  }

  private cleanup(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.joystick?.destroy();
    this.hud?.destroy();
    this.inventoryPanel?.destroy();
    this.characterPanel?.destroy();
    this.dialoguePanel?.destroy();
    this.entitiesRenderer?.destroy();
    this.backgroundRenderer?.destroy();
    this.joystick = undefined;
    this.hud = undefined;
    this.inventoryPanel = undefined;
    this.characterPanel = undefined;
    this.dialoguePanel = undefined;
    this.entitiesRenderer = undefined;
    this.backgroundRenderer = undefined;
  }
}
