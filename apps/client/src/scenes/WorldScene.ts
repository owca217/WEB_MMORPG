import type { ContainerSlotIndex, EncounterSnapshot, InventorySnapshot, NpcInteractionPayload, PlayerId, WorldStateSnapshot } from "@web-mmorpg/shared";
import Phaser from "phaser";
import { preloadCharacterSkins, registerCharacterSkinAnimations } from "../characters/characterSkinSprites";
import { preloadNpcSkins, registerNpcSkinFrames } from "../characters/npcSkinAssets";
import { resolveGameServerUrl } from "../hosting";
import { moveTowardTarget, resolveKeyboardIntent } from "../input/WorldInput";
import { AdminApi } from "../net/AdminApi";
import { AuthApi } from "../net/AuthApi";
import { gameSocket, type BattleResultSummary } from "../net/GameSocket";
import { playerStateStore } from "../state/PlayerStateStore";
import { sessionStateStore } from "../state/SessionStateStore";
import { logoutSession } from "../state/logoutSession";
import { AdminPanel } from "../ui/AdminPanel";
import { CharacterPanel } from "../ui/CharacterPanel";
import { DialoguePanel } from "../ui/DialoguePanel";
import { MerchantPanel } from "../ui/ShopPanel";
import { EncounterMenu } from "../ui/EncounterMenu";
import { ContainerPicker } from "../ui/ContainerPicker";
import { ContainerContentsPanel } from "../ui/ContainerContentsPanel";
import { WorldHud } from "../ui/WorldHud";
import { ChatController } from "../ui/ChatController";
import { SocialController } from "../ui/SocialController";
import { FOREST_SETTLEMENT_LAYOUT } from "../world/ForestSettlementLayout";
import { ForestSettlementRenderer } from "../world/ForestSettlementRenderer";
import { WorldEntitiesRenderer } from "../world/WorldEntitiesRenderer";
import { preloadEnvironmentAssets, registerEnvironmentFrames } from "../world/environmentAssets";

interface WorldSceneData {
  playerId: PlayerId;
  battleResult?: BattleResultSummary;
}

const WORLD_ERROR_LABELS: Record<string, string> = {
  ENCOUNTER_OUT_OF_RANGE: "Podejdź bliżej do wilków.",
  NPC_OUT_OF_RANGE: "Podejdź bliżej do tej postaci.",
  NPC_NOT_FOUND: "Nie znaleziono tej postaci.",
  HEAL_REJECTED: "Leczenie nie jest teraz dostępne."
};

export class WorldScene extends Phaser.Scene {
  private playerId: PlayerId = "";
  private battleResult: BattleResultSummary | undefined;
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
  private containerPicker: ContainerPicker | undefined;
  private containerContents: ContainerContentsPanel | undefined;
  private characterPanel: CharacterPanel | undefined;
  private dialoguePanel: DialoguePanel | undefined;
  private merchantPanel: MerchantPanel | undefined;
  private merchantRequestVersion = 0;
  private encounterMenu:EncounterMenu|undefined;
  private encounters:EncounterSnapshot[]=[];
  private selectedEncounterId:string|null=null;
  private adminPanel: AdminPanel | undefined;
  private chat: ChatController | undefined;
  private social:SocialController|undefined;
  private readonly onChatResize = () => this.updateChatViewport();
  private readonly cleanups: Array<() => void> = [];

  constructor() {
    super("WorldScene");
  }

  init(data: WorldSceneData): void {
    this.playerId = data.playerId;
    this.battleResult = data.battleResult;
    this.pointerTarget = null;
    this.authoritativePosition = null;
    this.localPosition = { ...FOREST_SETTLEMENT_LAYOUT.spawn };
    this.cameraFollowing = false;
    this.encounters=[];this.selectedEncounterId=null;
  }

  preload(): void {
    const pendingAssets=preloadCharacterSkins(this)+preloadNpcSkins(this)+preloadEnvironmentAssets(this);
    if(pendingAssets===0)return;

    this.cameras.main.setBackgroundColor(0x101b15);
    const loadingLabel = this.add.text(this.scale.width / 2, this.scale.height / 2, "Wczytywanie świata… 0%", {
      fontFamily: "Georgia, serif",
      fontSize: "22px",
      color: "#f3e3b6",
      backgroundColor: "#17291f",
      padding: { x: 24, y: 16 }
    }).setOrigin(0.5).setScrollFactor(0).setDepth(1000);
    const onProgress = (progress: number): void => {
      loadingLabel.setText(`Wczytywanie świata… ${Math.round(progress * 100)}%`);
    };
    const clearLoading = (): void => {
      this.load.off(Phaser.Loader.Events.PROGRESS, onProgress);
      this.load.off(Phaser.Loader.Events.COMPLETE, clearLoading);
      this.events.off(Phaser.Scenes.Events.SHUTDOWN, clearLoading);
      loadingLabel.destroy();
    };
    this.load.on(Phaser.Loader.Events.PROGRESS, onProgress);
    this.load.once(Phaser.Loader.Events.COMPLETE, clearLoading);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, clearLoading);
  }

  create(): void {
    registerCharacterSkinAnimations(this);
    registerNpcSkinFrames(this);
    registerEnvironmentFrames(this);
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
    this.encounterMenu=new EncounterMenu({onSelect:(encounterId,mode)=>{
      this.selectedEncounterId=null;
      this.pointerTarget=null;
      gameSocket.startEncounter(encounterId,mode);
    }});
    this.entitiesRenderer.onNpcSelected = (npcId) => {
      this.encounterMenu?.hide();this.selectedEncounterId=null;
      this.pointerTarget = null;
      gameSocket.interactNpc(npcId);
    };
    this.entitiesRenderer.onEncounterSelected = (encounterId) => {
      this.pointerTarget = null;
      const encounter=this.encounters.find(item=>item.id===encounterId);
      const anchor=encounter ? this.encounterAnchor(encounter) : null;
      if(!encounter || !anchor)return;
      this.selectedEncounterId=encounterId;
      this.encounterMenu?.show({...encounter,label:encounter.id==="wolf-pack-01" ? "Wilki" : encounter.label},anchor);
    };

    this.containerPicker = new ContainerPicker({
      onSetContainerSlot: (slotIndex, itemInstanceId) => gameSocket.setContainerSlot(slotIndex, itemInstanceId),
      onInventoryChanged: (inventory) => this.applyInventoryUpdate(inventory)
    });
    this.containerContents = new ContainerContentsPanel({
      onMoveItem: (itemInstanceId, targetContainerInstanceId) => gameSocket.moveItemToContainer(itemInstanceId, targetContainerInstanceId),
      onInventoryChanged: (inventory) => this.applyInventoryUpdate(inventory),
      onChangeContainer: (slotIndex) => this.containerPicker?.show(slotIndex)
    });
    this.characterPanel = new CharacterPanel();
    this.dialoguePanel = new DialoguePanel({
      onHeal: (npcId) => gameSocket.healAtNpc(npcId)
    });
    this.merchantPanel = new MerchantPanel({
      onPurchase: payload => gameSocket.purchaseMerchantItem(payload),
      onPurchased: result => {
        const state=playerStateStore.get();
        if(state?.character.playerId!==this.playerId)return;
        const updated={...state,gold:result.shop.gold,inventory:result.inventory??state.inventory};
        playerStateStore.set(updated);
        this.hud?.update(updated);
        this.applyInventoryUpdate(updated.inventory);
      },
      onTypingChange:()=>this.updateKeyboardCapture()
    });

    const session = sessionStateStore.getSession();
    const serverUrl = resolveGameServerUrl(
      import.meta.env.VITE_GAME_SERVER_URL,
      import.meta.env.DEV
    );
    if (session?.accountRole === "ADMIN") {
      this.adminPanel = new AdminPanel(
        new AdminApi(serverUrl, () => sessionStateStore.getToken())
      );
    }

    this.hud = new WorldHud({
      onContainerSlot: (slotIndex) => this.openContainerSlot(slotIndex),
      onCharacter: () => this.characterPanel?.toggle(),
      onAdmin: () => {
        if (this.adminPanel) void this.adminPanel.showCatalog();
      },
      onLogout: () => {
        void this.logout(serverUrl);
      }
    });
    this.hud.updateSession(session?.accountRole ?? "PLAYER");
    if (this.battleResult) this.hud.showBattleResult(this.battleResult);

    this.chat = new ChatController({
      nearbyAvailable: true,
      onNearbyMessage: (message) => this.entitiesRenderer?.showSpeechBubble(message.senderId, message.text),
      onTypingChange: () => this.updateKeyboardCapture()
    });
    this.social=new SocialController({inBattle:false,onTypingChange:()=>this.updateKeyboardCapture(),onInventoryChanged:inventory=>this.applyInventoryUpdate(inventory)});
    this.updateChatViewport();
    this.scale?.on("resize", this.onChatResize);

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
        if(state.character.playerId!==this.playerId)return;
        playerStateStore.set(state);
        this.hud?.update(state);
        this.containerPicker?.update(state.inventory);
        this.containerContents?.update(state.inventory);
        this.characterPanel?.update(state.character);
        if(state.gold!==undefined)this.merchantPanel?.updateGold(state.gold);
      }),
      gameSocket.onNpcInteraction((payload) => {void this.openNpc(payload);}),
      gameSocket.onConnectionState((state) => {
        this.hud?.setConnectionState(state);
        if(state!=="connected"){this.merchantRequestVersion+=1;this.merchantPanel?.hide();this.encounterMenu?.hide();this.selectedEncounterId=null;}
      }),
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
    const typing = Boolean(this.chat?.isTyping || this.social?.isTyping || this.merchantPanel?.isTyping);
    if (typing) this.pointerTarget = null;
    const keyboardIntent = resolveKeyboardIntent({
      left: !typing && Boolean(this.cursors?.left.isDown || this.wasd?.A.isDown),
      right: !typing && Boolean(this.cursors?.right.isDown || this.wasd?.D.isDown),
      up: !typing && Boolean(this.cursors?.up.isDown || this.wasd?.W.isDown),
      down: !typing && Boolean(this.cursors?.down.isDown || this.wasd?.S.isDown)
    });

    const hasKeyboardIntent = keyboardIntent.dx !== 0 || keyboardIntent.dy !== 0;
    const speed = 220;
    const travel = (speed * delta) / 1000;

    if (hasKeyboardIntent) {
      this.pointerTarget = null;
      this.localPosition = {
        x: Phaser.Math.Clamp(
          this.localPosition.x + keyboardIntent.dx * travel,
          0,
          FOREST_SETTLEMENT_LAYOUT.width
        ),
        y: Phaser.Math.Clamp(
          this.localPosition.y + keyboardIntent.dy * travel,
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
    const selected=this.encounters.find(item=>item.id===this.selectedEncounterId);
    if(selected)this.encounterMenu?.reposition(this.encounterAnchor(selected));

    if ((hasKeyboardIntent || this.pointerTarget) && this.time.now - this.lastIntentSentAt >= 50) {
      this.lastIntentSentAt = this.time.now;
      gameSocket.sendMoveIntent(this.localPosition);
    }
  }

  private openContainerSlot(slotIndex: ContainerSlotIndex): void {
    const state = playerStateStore.get();
    const inventory = state?.character.playerId === this.playerId ? state.inventory : undefined;
    const instanceId = inventory?.containerSlots?.[slotIndex];
    const container = inventory?.items.find((item) => item.instanceId === instanceId);
    if (container && (container.containerCapacity ?? 0) > 0) {
      this.containerPicker?.hide();
      this.containerContents?.show(slotIndex);
    } else {
      this.containerContents?.hide();
      this.containerPicker?.show(slotIndex);
    }
  }

  private async openNpc(payload: NpcInteractionPayload):Promise<void> {
    const version=++this.merchantRequestVersion;
    if(payload.kind!=="merchant") {
      this.merchantPanel?.hide();
      this.dialoguePanel?.show(payload);
      return;
    }
    this.dialoguePanel?.hide();
    const result=await gameSocket.requestMerchantShop(payload.npcId);
    if(version!==this.merchantRequestVersion || !this.merchantPanel)return;
    if(result.ok)this.merchantPanel.show(result.shop);
    else this.showToast(result.message);
  }

  private applyInventoryUpdate(inventory: InventorySnapshot): void {
    const state = playerStateStore.get();
    if (state?.character.playerId === this.playerId) playerStateStore.set({ ...state, inventory });
    this.hud?.updateInventory(inventory);
    this.containerPicker?.update(inventory);
    this.containerContents?.update(inventory);
  }

  private async logout(serverUrl: string): Promise<void> {
    const authApi = new AuthApi(serverUrl);
    await logoutSession({
      token: sessionStateStore.getToken(),
      logout: (token) => authApi.logout(token),
      disconnect: () => gameSocket.disconnect(),
      reset: () => sessionStateStore.reset(),
      onFinished: () => this.scene.start("AuthScene")
    });
  }

  private renderWorld(snapshot: WorldStateSnapshot): void {
    this.encounters=snapshot.encounters.map(item=>({...item}));
    if(this.selectedEncounterId && !this.encounters.some(item=>item.id===this.selectedEncounterId)) {
      this.encounterMenu?.hide();this.selectedEncounterId=null;
    }
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
    this.encounterMenu?.destroy();this.encounterMenu=undefined;
    this.encounters=[];this.selectedEncounterId=null;
    this.merchantRequestVersion+=1;
    this.merchantPanel?.destroy();this.merchantPanel=undefined;
    this.scale?.off("resize", this.onChatResize);
    this.chat?.destroy();
    this.chat = undefined;
    this.social?.destroy();this.social=undefined;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.adminPanel?.destroy();
    this.hud?.destroy();
    this.containerPicker?.destroy();
    this.containerContents?.destroy();
    this.characterPanel?.destroy();
    this.dialoguePanel?.destroy();
    this.entitiesRenderer?.destroy();
    this.backgroundRenderer?.destroy();
    this.adminPanel = undefined;
    this.hud = undefined;
    this.containerPicker = undefined;
    this.containerContents = undefined;
    this.characterPanel = undefined;
    this.dialoguePanel = undefined;
    this.entitiesRenderer = undefined;
    this.backgroundRenderer = undefined;
  }

  private updateChatViewport(): void {
    const zoom = this.cameras.main.zoom || 1;
    this.chat?.updateViewport({width: (this.scale?.width ?? window.innerWidth) / zoom, height: (this.scale?.height ?? window.innerHeight) / zoom});
  }
  private encounterAnchor(encounter:EncounterSnapshot):{x:number;y:number} {
    const camera=this.cameras.main;
    const x=encounter.x-(camera.scrollX??0),y=encounter.y-(camera.scrollY??0);
    const point=camera.getViewMatrix?.().transformPoint(encounter.x,encounter.y)??{x:x*(camera.zoom??1)+(camera.x??0),y:y*(camera.zoom??1)+(camera.y??0)};
    const canvas=this.game?.canvas?.getBoundingClientRect();
    const width=this.scale?.width??window.innerWidth,height=this.scale?.height??window.innerHeight;
    return {x:(canvas?.left??0)+point.x*(canvas?.width??width)/width,y:(canvas?.top??0)+point.y*(canvas?.height??height)/height};
  }
  private updateKeyboardCapture():void {
    this.pointerTarget=null;
    const keyboard=this.input.keyboard;if(!keyboard)return;
    const typing=Boolean(this.chat?.isTyping || this.social?.isTyping || this.merchantPanel?.isTyping);
    keyboard.resetKeys?.();keyboard.enabled=!typing;
    if(typing)keyboard.disableGlobalCapture?.();else keyboard.enableGlobalCapture?.();
  }
}
