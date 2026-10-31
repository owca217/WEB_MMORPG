import type { ContainerSlotIndex, EquipmentUpdateRequest, EquipmentUpdateResult, EncounterSnapshot, InventorySnapshot, PlayerStateSnapshot, NpcInteractionPayload, NpcSnapshot, PlayerId, WorldPlayerSnapshot, WorldStateSnapshot } from "@web-mmorpg/shared";
import { EQUIPMENT_SLOTS, PERMANENT_BACKPACK_SLOT_INDEX, findNearestWalkablePosition, findWorldPath, resolveWorldMovement, type WorldPoint } from "@web-mmorpg/shared";
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
import { HealingPanel } from "../ui/HealingPanel";
import { CharacterPanel } from "../ui/CharacterPanel";
import { DialoguePanel } from "../ui/DialoguePanel";
import { MerchantPanel } from "../ui/ShopPanel";
import { EncounterMenu } from "../ui/EncounterMenu";
import { NpcMenu } from "../ui/NpcMenu";
import { PlayerContextMenu } from "../ui/PlayerContextMenu";
import { OptionsPanel } from "../ui/OptionsPanel";
import { isPrimaryMovementPointer } from "../ui/interactionPreferences";
import { ContainerPicker } from "../ui/ContainerPicker";
import { ContainerContentsPanel } from "../ui/ContainerContentsPanel";
import { WorldHud } from "../ui/WorldHud";
import { calculateWorldLayout, type WorldInsets, type WorldRect } from "../ui/worldLayout";
import { isGameWindowOpen } from "../ui/gameWindows";
import { getPermanentBackpack } from "../ui/PermanentBackpack";
import { ChatController } from "../ui/ChatController";
import { SocialController } from "../ui/SocialController";
import { FOREST_SETTLEMENT_LAYOUT } from "../world/ForestSettlementLayout";
import { ForestSettlementRenderer } from "../world/ForestSettlementRenderer";
import { EasternForestRenderer } from "../world/EasternForestRenderer";
import { WorldEntitiesRenderer } from "../world/WorldEntitiesRenderer";
import { preloadEnvironmentAssets, registerEnvironmentFrames } from "../world/environmentAssets";

interface WorldSceneData {
  playerId: PlayerId;
  battleResult?: BattleResultSummary;
}

const WORLD_ERROR_LABELS: Record<string, string> = {
  ENCOUNTER_OUT_OF_RANGE: "Podejdź bliżej do przeciwnika.",
  ENCOUNTER_RESPAWNING: "Ten przeciwnik jeszcze się nie odrodził.",
  ENCOUNTER_ENGAGED: "Ta grupa przeciwników już walczy.",
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
  private navigationPath:WorldPoint[]=[];
  private navigationKey:string|null=null;
  private pendingFinalIntent=false;
  private localPosition: { x: number; y: number } = { ...FOREST_SETTLEMENT_LAYOUT.spawn };
  private authoritativePosition: { x: number; y: number } | null = null;
  private lastIntentSentAt = 0;
  private cameraFollowing = false;
  private backgroundRenderer: ForestSettlementRenderer | EasternForestRenderer | undefined;
  private locationId:string|null=null;
  private worldBounds:{width:number;height:number}={width:1600,height:900};
  private serverTimeOffset=0;
  private lastCountdownSecond=-1;
  private entitiesRenderer: WorldEntitiesRenderer | undefined;
  private hud: WorldHud | undefined;
  private containerPicker: ContainerPicker | undefined;
  private containerContents: ContainerContentsPanel | undefined;
  private selectedContainerSlot: ContainerSlotIndex = PERMANENT_BACKPACK_SLOT_INDEX;
  private inlineContainerSelected = false;
  private healingPanel:HealingPanel|undefined;
  private characterPanel: CharacterPanel | undefined;
  private playerStateRevision=0;
  private equipmentRequestVersion=0;
  private equipmentPending=false;
  private dialoguePanel: DialoguePanel | undefined;
  private merchantPanel: MerchantPanel | undefined;
  private merchantRequestVersion = 0;
  private encounterMenu:EncounterMenu|undefined;
  private encounters:EncounterSnapshot[]=[];
  private selectedEncounterId:string|null=null;
  private npcMenu:NpcMenu|undefined;
  private npcs:NpcSnapshot[]=[];
  private selectedNpcId:string|null=null;
  private pendingDialogueNpcId:string|null=null;
  private pendingNpcAction:{npcId:string;action:"talk"|"shop";lastDistance:number;progressAt:number;lastConfirmedPosition?:WorldPoint}|null=null;
  private adminPanel: AdminPanel | undefined;
  private chat: ChatController | undefined;
  private social:SocialController|undefined;
  private optionsPanel:OptionsPanel|undefined;
  private playerMenu:PlayerContextMenu|undefined;
  private worldPlayers:WorldPlayerSnapshot[]=[];
  private selectedPlayerId:string|null=null;
  private mapViewport: WorldRect | undefined;
  private readonly onChatResize = () => { this.containerContents?.cancelInteraction(); this.updateWorldViewport(); };
  private readonly onFormFocus = () => { queueMicrotask(() => { if (this.hud) this.updateKeyboardCapture(); }); };
  private readonly onUiShortcut = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || this.isTyping()) return;
    if (event.code !== "KeyI" && event.code !== "KeyC") return;
    event.preventDefault();
    this.cancelMovement();
    if (event.code === "KeyI") this.openContainerSlot(PERMANENT_BACKPACK_SLOT_INDEX);
    else { this.hud?.closeMenu(); this.characterPanel?.toggle(); }
  };
  private readonly cleanups: Array<() => void> = [];

  constructor() {
    super("WorldScene");
  }

  init(data: WorldSceneData): void {
    this.playerId = data.playerId;
    this.battleResult = data.battleResult;
    this.pointerTarget = null;
    this.clearNavigation();this.pendingFinalIntent=false;this.lastIntentSentAt=0;
    this.authoritativePosition = null;
    this.localPosition = { ...FOREST_SETTLEMENT_LAYOUT.spawn };
    this.cameraFollowing = false;
    this.locationId=null;this.worldBounds={width:1600,height:900};
    this.serverTimeOffset=0;this.lastCountdownSecond=-1;
    this.encounters=[];this.selectedEncounterId=null;
    this.npcs=[];this.selectedNpcId=null;this.pendingDialogueNpcId=null;
    this.pendingNpcAction=null;
    this.worldPlayers=[];this.selectedPlayerId=null;
    this.playerStateRevision=0;this.equipmentRequestVersion++;this.equipmentPending=false;
    this.selectedContainerSlot=PERMANENT_BACKPACK_SLOT_INDEX;this.inlineContainerSelected=false;
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
    this.entitiesRenderer.onTeleportSelected=point=>{
      this.dismissPlayerMenu();
      this.dismissNpcWindows();this.encounterMenu?.hide();this.selectedEncounterId=null;
      this.pointerTarget={...point};
    };
    this.encounterMenu=new EncounterMenu({onSelect:(encounterId,mode)=>{
      this.selectedEncounterId=null;
      this.pointerTarget=null;
      const encounter=this.encounters.find(item=>item.id===encounterId);
      if(encounter?.status && encounter.status!=="alive")return;
      gameSocket.startEncounter(encounterId,mode);
    }});
    this.npcMenu=new NpcMenu({onSelect:(npcId,action)=>{
      this.dismissNpcWindows();
      this.pointerTarget=null;
      const npc=this.npcs.find(item=>item.id===npcId);
      if(!npc || !this.authoritativePosition || (action==="shop" && npc.kind!=="merchant"))return;
      this.pendingNpcAction={npcId,action,lastDistance:Infinity,progressAt:this.time.now};
      this.resolvePendingNpcAction();
    }});
    this.entitiesRenderer.onNpcSelected = (npcId) => {
      this.dismissPlayerMenu();
      this.encounterMenu?.hide();this.selectedEncounterId=null;
      this.dismissNpcWindows();
      this.pointerTarget = null;
      const npc=this.npcs.find(item=>item.id===npcId);
      if(!npc)return;
      this.selectedNpcId=npcId;
      this.npcMenu?.show(npc,this.worldAnchor(npc));
    };
    this.entitiesRenderer.onEncounterSelected = (encounterId) => {
      this.dismissPlayerMenu();
      this.dismissNpcWindows();
      this.pointerTarget = null;
      const encounter=this.encounters.find(item=>item.id===encounterId);
      const anchor=encounter ? this.worldAnchor(encounter) : null;
      if(!encounter || !anchor)return;
      this.selectedEncounterId=encounterId;
      this.encounterMenu?.show(encounter,anchor,this.serverNow());
    };
    this.playerMenu=new PlayerContextMenu({
      onParty:playerId=>{if(this.worldPlayers.some(player=>player.id===playerId && player.id!==this.playerId))this.social?.inviteToParty(playerId);},
      onTrade:playerId=>{if(this.worldPlayers.some(player=>player.id===playerId && player.id!==this.playerId))this.social?.requestTrade(playerId);}
    });
    this.entitiesRenderer.onPlayerSelected=playerId=>{
      const player=this.worldPlayers.find(item=>item.id===playerId && item.id!==this.playerId);
      if(!player)return;
      this.cancelMovement();this.dismissNpcWindows();this.encounterMenu?.hide();this.selectedEncounterId=null;
      this.selectedPlayerId=playerId;
      this.playerMenu?.show(player,this.worldAnchor(player));
    };
    this.optionsPanel=new OptionsPanel({onChange:()=>{
      this.cancelMovement();this.dismissPlayerMenu();this.dismissNpcWindows();this.encounterMenu?.hide();this.selectedEncounterId=null;
    }});

    this.containerPicker = new ContainerPicker({
      onSetContainerSlot: (slotIndex, itemInstanceId) => gameSocket.setContainerSlot(slotIndex, itemInstanceId),
      onInventoryChanged: (inventory) => this.applyInventoryUpdate(inventory),
      onRefresh:()=>gameSocket.requestPlayerState()
    });
    this.containerContents = new ContainerContentsPanel({
      onMoveItem: (itemInstanceId, targetContainerInstanceId, targetPosition) => targetPosition === undefined
        ? gameSocket.moveItemToContainer(itemInstanceId, targetContainerInstanceId)
        : gameSocket.moveItemToContainer(itemInstanceId, targetContainerInstanceId, targetPosition),
      onSetContainerSlot: (slotIndex, itemInstanceId) => gameSocket.setContainerSlot(slotIndex, itemInstanceId),
      onInventoryChanged: (inventory) => this.applyInventoryUpdate(inventory),
      onRefresh:()=>gameSocket.requestPlayerState(),
      onTypingChange:()=>this.updateKeyboardCapture(),
      onEquipItem: async item=>{
        const result=await this.setEquipmentSlot({slot:item.equipment!.slot,itemInstanceId:item.instanceId});
        return result.ok?{ok:true,inventory:playerStateStore.get()?.inventory??result.inventory}:result;
      },
      onChangeContainer: (slotIndex) => {if(slotIndex!==PERMANENT_BACKPACK_SLOT_INDEX)this.containerPicker?.show(slotIndex);}
    });
    this.healingPanel=new HealingPanel({requestTargets:()=>gameSocket.requestHealingTargets(),cast:request=>gameSocket.castHealing(request)});
    this.characterPanel = new CharacterPanel({
      onSetEquipmentSlot: request=>this.setEquipmentSlot(request),
      onTypingChange:()=>this.updateKeyboardCapture()
    });
    this.dialoguePanel = new DialoguePanel({
      onHeal: (npcId) => gameSocket.healAtNpc(npcId)
    });
    this.merchantPanel = new MerchantPanel({
      onPurchase: payload => gameSocket.purchaseMerchantItem(payload),
      onPurchased: result => {
        const state=playerStateStore.get();
        if(state?.character.playerId!==this.playerId)return;
        const updated={...state,gold:result.shop.gold};
        playerStateStore.set(updated);
        this.hud?.update(updated);
        this.applyInventoryUpdate(result.inventory??updated.inventory);
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
        new AdminApi(serverUrl, () => sessionStateStore.getToken()),
        {
          getCharacterId: () => playerStateStore.get()?.character.playerId === this.playerId ? this.playerId : undefined,
          onInventoryGranted: result => {
            if (playerStateStore.get()?.character.playerId === result.characterId && this.playerId === result.characterId)
              gameSocket.requestPlayerState();
          }
        }
      );
    }

    this.hud = new WorldHud({
      onContainerSlot: (slotIndex) => { this.cancelMovement(); this.openContainerSlot(slotIndex); },
      onCharacter: () => { this.hud?.closeMenu(); this.cancelMovement(); this.characterPanel?.toggle(); },
      onEquipment:slot=>{this.hud?.closeMenu();this.cancelMovement();this.characterPanel?.showEquipment(slot);},
      onChat: () => { this.hud?.closePanel(); this.cancelMovement(); this.chat?.toggle(); },
      onSocial: () => { this.hud?.closePanel(); this.cancelMovement(); this.social?.toggle(); },
      onOptions:()=>{this.cancelMovement();this.dismissPlayerMenu();this.dismissNpcWindows();this.encounterMenu?.hide();this.selectedEncounterId=null;this.optionsPanel?.show();},
      onParty:()=>this.social?.openParty(),
      onTrade:()=>this.social?.openTrade(),
      onLayoutChange: () => { this.cancelMovement(); if (!this.hud?.isPanelOpen) this.containerContents?.cancelInteraction(); this.updateWorldViewport(); },
      onHealing:()=>{this.pointerTarget=null;this.pendingNpcAction=null;this.dismissNpcWindows();this.characterPanel?.hide();void this.healingPanel?.show();},
      onAdmin: () => {
        if (this.adminPanel) void this.adminPanel.showCatalog();
      },
      onLogout: () => {
        void this.logout(serverUrl);
      }
    });
    this.containerContents.mountInline(this.hud.containerContentsHost);
    this.hud.updateSession(session?.accountRole ?? "PLAYER");
    if (this.battleResult) this.hud.showBattleResult(this.battleResult);

    this.chat = new ChatController({
      nearbyAvailable: true,
      onStatusChange: status => this.hud?.updateChatStatus(status),
      onNearbyMessage: (message) => this.entitiesRenderer?.showSpeechBubble(message.senderId, message.text),
      onTypingChange: () => this.updateKeyboardCapture()
    });
    this.social=new SocialController({inBattle:false,onStatusChange:status=>this.hud?.updateSocialStatus(status),onTypingChange:()=>this.updateKeyboardCapture(),onInventoryChanged:inventory=>this.applyInventoryUpdate(inventory)});
    this.updateWorldViewport();
    this.scale?.on("resize", this.onChatResize);
    document.addEventListener("focusin", this.onFormFocus);
    document.addEventListener("focusout", this.onFormFocus);
    document.addEventListener("keydown", this.onUiShortcut);

    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys("W,A,S,D") as Record<
        "W" | "A" | "S" | "D",
        Phaser.Input.Keyboard.Key
      >;
    }

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!isPrimaryMovementPointer(pointer)) return;
      if (this.isMovementBlocked()) return;
      const map = this.mapViewport;
      if (map && Number.isFinite(pointer.x) && Number.isFinite(pointer.y)
        && (pointer.x < map.x || pointer.y < map.y || pointer.x >= map.x + map.width || pointer.y >= map.y + map.height)) return;
      this.pendingNpcAction=null;
      this.pointerTarget = {
        x: Phaser.Math.Clamp(pointer.worldX, 0, this.worldBounds.width),
        y: Phaser.Math.Clamp(pointer.worldY, 0, this.worldBounds.height)
      };
    });
    const canvas=this.game?.canvas;
    if(canvas) {
      const preventCanvasMenu=(event:Event):void=>event.preventDefault();
      canvas.addEventListener("contextmenu",preventCanvasMenu);
      this.cleanups.push(()=>canvas.removeEventListener("contextmenu",preventCanvasMenu));
    }

    this.cleanups.push(
      gameSocket.onWorldState((snapshot) => this.renderWorld(snapshot)),
      gameSocket.onPlayerState(state=>this.applyPlayerState(state)),
      gameSocket.onNpcInteraction((payload) => this.showNpcDialogue(payload)),
      gameSocket.onConnectionState((state) => {
        this.hud?.setConnectionState(state);
        if(state!=="connected"){this.pointerTarget=null;this.clearNavigation();this.pendingFinalIntent=false;this.healingPanel?.hide();this.dismissPlayerMenu();this.dismissNpcWindows();this.encounterMenu?.hide();this.selectedEncounterId=null;}
      }),
      gameSocket.onCommandRejected(({ code, message }) => {
        this.pendingDialogueNpcId=null;
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
    const typing = this.isMovementBlocked();
    if (typing) this.cancelMovement();
    const keyboardIntent = resolveKeyboardIntent({
      left: !typing && Boolean(this.cursors?.left.isDown || this.wasd?.A.isDown),
      right: !typing && Boolean(this.cursors?.right.isDown || this.wasd?.D.isDown),
      up: !typing && Boolean(this.cursors?.up.isDown || this.wasd?.W.isDown),
      down: !typing && Boolean(this.cursors?.down.isDown || this.wasd?.S.isDown)
    });

    const hasKeyboardIntent = keyboardIntent.dx !== 0 || keyboardIntent.dy !== 0;
    if(hasKeyboardIntent)this.pendingNpcAction=null;
    this.resolvePendingNpcAction();
    const speed = 220;
    const travel = (speed * delta) / 1000;
    const hadMovementIntent=hasKeyboardIntent || Boolean(this.pointerTarget || this.pendingNpcAction);

    if (hasKeyboardIntent) {
      this.pointerTarget = null;
      this.clearNavigation();
      this.localPosition = resolveWorldMovement(this.locationId??"forest-settlement-01",this.localPosition,{
        x: Phaser.Math.Clamp(
          this.localPosition.x + keyboardIntent.dx * travel,
          0,
          this.worldBounds.width
        ),
        y: Phaser.Math.Clamp(
          this.localPosition.y + keyboardIntent.dy * travel,
          0,
          this.worldBounds.height
        )
      });
    } else if (this.pendingNpcAction) {
      const npc=this.npcs.find(item=>item.id===this.pendingNpcAction!.npcId)!;
      this.followNavigation(npc,travel,Math.max(0,npc.interactionRadius-16),`npc:${npc.id}`);
    } else if (this.pointerTarget) {
      this.followNavigation(this.pointerTarget,travel,0,"pointer");
      if(this.pointerTarget && this.navigationPath.length===0) {
        this.pointerTarget = null;
        this.pendingFinalIntent=true;
      }
    } else if (this.authoritativePosition && !this.pendingFinalIntent) {
      this.clearNavigation();
      this.localPosition = resolveWorldMovement(this.locationId??"forest-settlement-01",this.localPosition,{
        x: Phaser.Math.Linear(this.localPosition.x, this.authoritativePosition.x, 0.12),
        y: Phaser.Math.Linear(this.localPosition.y, this.authoritativePosition.y, 0.12)
      });
    }

    if (this.authoritativePosition) {
      const correctionDistance = Phaser.Math.Distance.Between(
        this.localPosition.x,
        this.localPosition.y,
        this.authoritativePosition.x,
        this.authoritativePosition.y
      );
      if (correctionDistance > 120) {
        this.localPosition = resolveWorldMovement(this.locationId??"forest-settlement-01",this.localPosition,{
          x: Phaser.Math.Linear(this.localPosition.x, this.authoritativePosition.x, 0.3),
          y: Phaser.Math.Linear(this.localPosition.y, this.authoritativePosition.y, 0.3)
        });
      }
    }

    this.entitiesRenderer?.setLocalPlayerPosition(this.localPosition.x, this.localPosition.y);
    this.entitiesRenderer?.updateRemotePlayers();
    const selected=this.encounters.find(item=>item.id===this.selectedEncounterId);
    if(selected)this.encounterMenu?.reposition(this.worldAnchor(selected));
    const countdownSecond=Math.floor(this.serverNow()/1000);
    if(countdownSecond!==this.lastCountdownSecond) {
      this.lastCountdownSecond=countdownSecond;
      this.entitiesRenderer?.updateEncounters(this.serverNow());
      if(selected)this.encounterMenu?.update(selected,this.serverNow());
    }
    const selectedNpc=this.npcs.find(item=>item.id===this.selectedNpcId);
    if(selectedNpc)this.npcMenu?.reposition(this.worldAnchor(selectedNpc));
    const selectedPlayer=this.worldPlayers.find(item=>item.id===this.selectedPlayerId);
    if(selectedPlayer)this.playerMenu?.reposition(this.worldAnchor(selectedPlayer));

    if ((hadMovementIntent || this.pendingFinalIntent) && this.time.now - this.lastIntentSentAt >= 50) {
      this.lastIntentSentAt = this.time.now;
      gameSocket.sendMoveIntent({...this.localPosition,...(this.locationId ? {locationId:this.locationId} : {})});
      this.pendingFinalIntent=false;
    }
  }

  private clearNavigation():void {
    this.navigationKey=null;
    this.navigationPath=[];
  }

  private cancelMovement(): void {
    this.pointerTarget=null;this.pendingNpcAction=null;this.clearNavigation();this.pendingFinalIntent=false;
  }

  private dismissPlayerMenu():void {
    this.playerMenu?.hide();this.selectedPlayerId=null;
  }

  private followNavigation(target:WorldPoint,travel:number,arrivalRadius:number,kind:string):void {
    const zone=this.locationId??"forest-settlement-01";
    const key=`${zone}:${kind}:${target.x}:${target.y}:${arrivalRadius}`;
    if(this.navigationKey!==key) {
      const path=findWorldPath(zone,this.localPosition,target,{arrivalRadius});
      if(path===null) {
        this.pointerTarget=null;this.pendingNpcAction=null;this.clearNavigation();
        this.showToast("Nie można dojść w to miejsce.");return;
      }
      this.navigationKey=key;this.navigationPath=path.map(point=>({...point}));
    }
    let remaining=travel;
    while(remaining>0 && this.navigationPath.length>0) {
      const waypoint=this.navigationPath[0]!;
      const next=moveTowardTarget(this.localPosition,waypoint,remaining);
      const moved=resolveWorldMovement(zone,this.localPosition,next);
      const distance=Math.hypot(moved.x-this.localPosition.x,moved.y-this.localPosition.y);
      this.localPosition=moved;remaining=Math.max(0,remaining-distance);
      if(Math.hypot(waypoint.x-moved.x,waypoint.y-moved.y)<0.01)this.navigationPath.shift();
      else if(distance<0.001) {
        this.pointerTarget=null;this.pendingNpcAction=null;this.clearNavigation();
        this.showToast("Droga jest zablokowana. Wybierz inne miejsce.");break;
      }else break;
    }
  }

  private openContainerSlot(slotIndex: ContainerSlotIndex): void {
    if (this.containerContents?.isBusy) return;
    const state = playerStateStore.get();
    const inventory = state?.character.playerId === this.playerId ? state.inventory : undefined;
    this.selectedContainerSlot=slotIndex;
    this.hud?.showContainerSlot(slotIndex);
    if(slotIndex===PERMANENT_BACKPACK_SLOT_INDEX && (!inventory||!getPermanentBackpack(inventory))) {
      this.inlineContainerSelected=false;
      this.containerContents?.show(PERMANENT_BACKPACK_SLOT_INDEX);this.containerPicker?.hide();gameSocket.requestPlayerState();return;
    }
    const instanceId = inventory?.containerSlots?.[slotIndex];
    const container = inventory?.items.find((item) => item.instanceId === instanceId);
    if (container && (container.containerCapacity ?? 0) > 0) {
      this.containerPicker?.hide();
      this.containerContents?.show(slotIndex);
      this.inlineContainerSelected=true;
    } else {
      this.inlineContainerSelected=false;
      this.containerContents?.show(slotIndex);
      this.containerPicker?.show(slotIndex);
    }
  }

  private syncInlineContainer(inventory: InventorySnapshot): void {
    const container = this.selectedContainerSlot === PERMANENT_BACKPACK_SLOT_INDEX ? getPermanentBackpack(inventory)
      : inventory.items.find(item => item.instanceId === inventory.containerSlots?.[this.selectedContainerSlot] && (item.containerCapacity ?? 0) > 0);
    if (!container) { this.inlineContainerSelected=false; return; }
    if (this.inlineContainerSelected || this.containerContents?.isBusy) return;
    this.containerContents?.show(this.selectedContainerSlot);
    this.hud?.showContainerSlot(this.selectedContainerSlot, false);
    this.containerPicker?.hide();
    this.inlineContainerSelected=true;
  }

  private showNpcDialogue(payload:NpcInteractionPayload):void {
    if(payload.npcId!==this.pendingDialogueNpcId)return;
    this.pendingDialogueNpcId=null;
    this.dialoguePanel?.show(payload);
  }

  private resolvePendingNpcAction():void {
    const pending=this.pendingNpcAction;
    if(!pending)return;
    const npc=this.npcs.find(item=>item.id===pending.npcId);
    if(!npc){this.pendingNpcAction=null;return;}
    if(!this.authoritativePosition)return;
    const distance=Math.hypot(npc.x-this.authoritativePosition.x,npc.y-this.authoritativePosition.y);
    if(distance<=npc.interactionRadius) {
      // Prediction can arrive before the server. Only its snapshot permits the interaction.
      this.pendingNpcAction=null;
      this.clearNavigation();
      if(pending.action==="talk") {
        this.pendingDialogueNpcId=npc.id;
        gameSocket.interactNpc(npc.id);
      }else if(npc.kind==="merchant")void this.openShop(npc.id);
    }else if(distance<pending.lastDistance-0.5 || (pending.lastConfirmedPosition && Math.hypot(this.authoritativePosition.x-pending.lastConfirmedPosition.x,this.authoritativePosition.y-pending.lastConfirmedPosition.y)>0.5)) {
      pending.lastDistance=distance;
      pending.progressAt=this.time.now;
    }else if(this.time.now-pending.progressAt>=5000) {
      this.pendingNpcAction=null;
      this.clearNavigation();
      this.showToast("Nie udało się podejść do tej postaci. Spróbuj ponownie.");
    }
    pending.lastConfirmedPosition={...this.authoritativePosition};
  }

  private dismissNpcWindows():void {
    this.merchantRequestVersion+=1;
    this.pendingDialogueNpcId=null;
    this.selectedNpcId=null;
    this.pendingNpcAction=null;
    this.npcMenu?.hide();
    this.merchantPanel?.hide();
    this.dialoguePanel?.hide();
  }

  private async openShop(npcId:string):Promise<void> {
    const version=++this.merchantRequestVersion;
    this.dialoguePanel?.hide();
    const result=await gameSocket.requestMerchantShop(npcId);
    if(version!==this.merchantRequestVersion || !this.merchantPanel)return;
    if(result.ok)this.merchantPanel.show(result.shop);
    else this.showToast(result.message);
  }

  private applyPlayerState(state:PlayerStateSnapshot):void {
    if(state.character.playerId!==this.playerId)return;
    this.playerStateRevision++;
    playerStateStore.set(state);this.hud?.update(state);
    this.containerPicker?.update(state.inventory);
    this.containerContents?.update(state.inventory,state.character);
    this.syncInlineContainer(state.inventory);
    this.characterPanel?.update(state.character,state.inventory);
    if(state.character.equipment?.mainHand?.equipment?.weaponFamily!=="staff")this.healingPanel?.hide();
    if(state.gold!==undefined)this.merchantPanel?.updateGold(state.gold);
  }

  private async setEquipmentSlot(request:EquipmentUpdateRequest):Promise<EquipmentUpdateResult> {
    if(this.equipmentPending)return {ok:false,code:"EQUIPMENT_ACTION_PENDING",message:"Poczekaj na zakończenie zmiany uzbrojenia."};
    const version=this.equipmentRequestVersion,revision=this.playerStateRevision,playerId=this.playerId;
    this.equipmentPending=true;
    try {
      const result=await gameSocket.setEquipmentSlot(request);
      const state=playerStateStore.get();
      if(version!==this.equipmentRequestVersion || playerId!==this.playerId || state?.character.playerId!==playerId)return {ok:false,code:"SESSION_REPLACED",message:"Połączenie postaci zmieniło się. Otwórz panel ponownie."};
      if(result.ok) {
        if(revision===this.playerStateRevision)this.applyPlayerState({...state,character:result.character,inventory:result.inventory});
        else gameSocket.requestPlayerState();
      }
      return result;
    }finally{if(version===this.equipmentRequestVersion)this.equipmentPending=false;}
  }

  private applyInventoryUpdate(inventory: InventorySnapshot): void {
    const state = playerStateStore.get();
    if (state?.character.playerId === this.playerId) {
      const equipment=state.character.equipment;
      const stale=equipment && EQUIPMENT_SLOTS.some(slot=>{
        const expected=equipment[slot]?.instanceId??null;
        const assigned=inventory.items.filter(item=>item.equippedSlot===slot);
        return assigned.length>1 || (assigned[0]?.instanceId??null)!==expected
          || (inventory.equipmentSlots!==undefined && (inventory.equipmentSlots[slot]??null)!==expected);
      });
      if(stale) {
        // Inventory-only replies can arrive after a newer equipment playerState.
        inventory=state.inventory;
        gameSocket.requestPlayerState();
      } else playerStateStore.set({ ...state, inventory });
    }
    this.hud?.updateInventory(inventory);
    this.containerPicker?.update(inventory);
    this.containerContents?.update(inventory,state?.character.playerId===this.playerId?state.character:undefined);
    this.syncInlineContainer(inventory);
    if(state?.character.playerId===this.playerId)this.characterPanel?.update(state.character,inventory);
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
    const changed=this.locationId!==null && this.locationId!==snapshot.locationId;
    if(snapshot.serverTime!==undefined)this.serverTimeOffset=snapshot.serverTime-Date.now();
    if(this.locationId!==snapshot.locationId) {
      this.locationId=snapshot.locationId;
      this.worldBounds={width:snapshot.location?.width??1600,height:snapshot.location?.height??900};
      this.cameras.main.setBounds(0,0,this.worldBounds.width,this.worldBounds.height);
      this.physics.world.setBounds(0,0,this.worldBounds.width,this.worldBounds.height);
      this.backgroundRenderer?.destroy();
      this.backgroundRenderer=snapshot.location?.theme==="dense-forest" ? new EasternForestRenderer(this) : new ForestSettlementRenderer(this);
      this.backgroundRenderer.render();
      this.hud?.setLocation(snapshot.location?.name??"Osada Zielony Brzeg");
    }
    if(changed) {
      this.dismissPlayerMenu();
      this.pointerTarget=null;this.authoritativePosition=null;
      this.clearNavigation();this.pendingFinalIntent=false;
      this.dismissNpcWindows();this.encounterMenu?.hide();this.selectedEncounterId=null;
      this.characterPanel?.hide();this.healingPanel?.hide();this.containerPicker?.hide();this.containerContents?.hide();
      this.cameras.main.stopFollow?.();this.cameraFollowing=false;
    }
    this.worldPlayers=snapshot.players.map(player=>({...player}));
    if(this.selectedPlayerId && !this.worldPlayers.some(player=>player.id===this.selectedPlayerId))this.dismissPlayerMenu();
    this.npcs=snapshot.npcs.map(item=>({...item}));
    if(this.selectedNpcId && !this.npcs.some(item=>item.id===this.selectedNpcId))this.dismissNpcWindows();
    if(this.pendingDialogueNpcId && !this.npcs.some(item=>item.id===this.pendingDialogueNpcId))this.pendingDialogueNpcId=null;
    if(this.pendingNpcAction && !this.npcs.some(item=>item.id===this.pendingNpcAction!.npcId))this.pendingNpcAction=null;
    this.encounters=snapshot.encounters.map(item=>({...item}));
    if(this.selectedEncounterId && !this.encounters.some(item=>item.id===this.selectedEncounterId)) {
      this.encounterMenu?.hide();this.selectedEncounterId=null;
    }
    const selected=this.encounters.find(item=>item.id===this.selectedEncounterId);
    if(selected)this.encounterMenu?.update(selected,this.serverNow());
    this.entitiesRenderer?.render(snapshot);
    const local = snapshot.players.find((player) => player.id === this.playerId);
    if (!local) {this.pendingNpcAction=null;this.authoritativePosition=null;return;}

    if (!this.authoritativePosition) {
      this.localPosition = findNearestWalkablePosition(snapshot.locationId,{x:local.x,y:local.y});
      this.entitiesRenderer?.setLocalPlayerPosition(this.localPosition.x,this.localPosition.y);
    }
    this.authoritativePosition = { x: local.x, y: local.y };
    if(changed)this.cameras.main.centerOn?.(local.x,local.y);
    this.resolvePendingNpcAction();

    if (!this.cameraFollowing) {
      const followTarget = this.entitiesRenderer?.getLocalPlayerObject();
      if (followTarget) {
        this.cameras.main.startFollow(followTarget, true, 0.16, 0.16);
        this.cameraFollowing = true;
      }
    }
  }

  private serverNow():number {return Date.now()+this.serverTimeOffset;}

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
    this.equipmentRequestVersion++;this.equipmentPending=false;
    this.clearNavigation();this.pendingFinalIntent=false;
    this.healingPanel?.destroy();this.healingPanel=undefined;
    this.npcMenu?.destroy();this.npcMenu=undefined;
    this.npcs=[];this.selectedNpcId=null;this.pendingDialogueNpcId=null;
    this.pendingNpcAction=null;
    this.encounterMenu?.destroy();this.encounterMenu=undefined;
    this.encounters=[];this.selectedEncounterId=null;
    this.merchantRequestVersion+=1;
    this.merchantPanel?.destroy();this.merchantPanel=undefined;
    this.scale?.off("resize", this.onChatResize);
    document.removeEventListener("focusin", this.onFormFocus);
    document.removeEventListener("focusout", this.onFormFocus);
    document.removeEventListener("keydown", this.onUiShortcut);
    this.chat?.destroy();
    this.chat = undefined;
    this.social?.destroy();this.social=undefined;
    this.optionsPanel?.destroy();this.optionsPanel=undefined;
    this.playerMenu?.destroy();this.playerMenu=undefined;
    this.worldPlayers=[];this.selectedPlayerId=null;
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
    this.cameras.main?.setViewport?.(0, 0, this.scale?.width ?? window.innerWidth, this.scale?.height ?? window.innerHeight);
    this.mapViewport = undefined;
  }

  private updateWorldViewport(): void {
    const styles = getComputedStyle(document.documentElement);
    const insets = Object.fromEntries(["top", "right", "bottom", "left"].map(edge =>
      [edge, Number.parseFloat(styles.getPropertyValue(`--safe-area-${edge}`)) || 0]
    )) as unknown as WorldInsets;
    const { map } = calculateWorldLayout(this.scale?.width ?? window.innerWidth, this.scale?.height ?? window.innerHeight, insets);
    this.mapViewport = map;
    this.cameras.main?.setViewport?.(map.x, map.y, map.width, map.height);
    this.updateChatViewport();
  }

  private updateChatViewport(): void {
    const zoom = this.cameras.main?.zoom || 1;
    this.chat?.updateViewport({width: (this.mapViewport?.width ?? this.scale?.width ?? window.innerWidth) / zoom, height: (this.mapViewport?.height ?? this.scale?.height ?? window.innerHeight) / zoom});
  }
  private worldAnchor(encounter:{x:number;y:number}):{x:number;y:number} {
    const camera=this.cameras.main;
    const x=encounter.x-(camera.scrollX??0),y=encounter.y-(camera.scrollY??0);
    const point=camera.getViewMatrix?.().transformPoint(encounter.x,encounter.y)??{x:x*(camera.zoom??1)+(camera.x??0),y:y*(camera.zoom??1)+(camera.y??0)};
    const canvas=this.game?.canvas?.getBoundingClientRect();
    const width=this.scale?.width??window.innerWidth,height=this.scale?.height??window.innerHeight;
    return {x:(canvas?.left??0)+point.x*(canvas?.width??width)/width,y:(canvas?.top??0)+point.y*(canvas?.height??height)/height};
  }
  private updateKeyboardCapture():void {
    this.pointerTarget=null;
    this.clearNavigation();this.pendingFinalIntent=false;
    const keyboard=this.input.keyboard;if(!keyboard)return;
    const typing=this.isTyping();
    if(typing)this.pendingNpcAction=null;
    keyboard.resetKeys?.();keyboard.enabled=!typing;
    if(typing)keyboard.disableGlobalCapture?.();else keyboard.enableGlobalCapture?.();
  }

  private isTyping(): boolean {
    const active=document.activeElement;
    return Boolean(this.chat?.isTyping || this.social?.isTyping || this.merchantPanel?.isTyping || this.characterPanel?.isTyping || this.containerContents?.isTyping
      || (active instanceof HTMLElement && (active.matches("input, textarea, select") || active.isContentEditable)));
  }

  private isMovementBlocked(): boolean {
    return this.isTyping() || Boolean(this.hud?.isPanelOpen) || isGameWindowOpen();
  }
}
