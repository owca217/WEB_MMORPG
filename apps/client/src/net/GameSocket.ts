import type {
  HealingRequest,
  HealingResult,
  HealingTargetsResult,
  BattleCommand,
  BattleAutoResult,
  BattleMode,
  ChatChannel,
  ChatMessage,
  ChatSendResult,
  ChatHistoryResult,
  ChatViewport,
  SocialAction,
  SocialActionResult,
  SocialSnapshot,
  MerchantPurchase,
  MerchantResult,
  BattleSnapshot,
  CharacterSnapshot,
  EquipmentUpdateRequest,
  EquipmentUpdateResult,
  ClientToServerEvents,
  InventorySnapshot,
  InventoryUpdateResult,
  NpcInteractionPayload,
  PlayerStateSnapshot,
  ServerToClientEvents,
  SetContainerSlotResult,
  SocketAuthResult,
  WorldStateSnapshot
} from "@web-mmorpg/shared";
import { io, type Socket } from "socket.io-client";
import { resolveGameServerUrl } from "../hosting";
import { chatStateStore } from "../state/ChatStateStore";
import { socialStateStore } from "../state/SocialStateStore";

type GameClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type ConnectionState = "connected" | "connecting" | "disconnected";

export interface BattleEndedPayload {
  outcome: "victory" | "defeat";
  inventory: InventorySnapshot;
  character: CharacterSnapshot;
  experienceGained?: number;
  levelsGained?: number;
  partyBonusExperience?: number;
  goldGained?: number;
}

export interface BattleResultSummary {
  outcome: BattleEndedPayload["outcome"];
  experienceGained: number;
  levelsGained: number;
  level: number;
  partyBonusExperience?: number;
  goldGained?: number;
}

export class GameSocket {
  private socket: GameClientSocket | null = null;
  private sessionToken: string | null = null;
  private socialCharacterId:string|null=null;
  private authenticationVersion = 0;
  private connectionVersion = 0;
  private authenticating = false;
  private connectionState: ConnectionState = "connecting";
  private readonly connectionHandlers = new Set<(state: ConnectionState) => void>();
  private readonly reauthenticatedHandlers = new Set<(result: SocketAuthResult) => void>();

  connect(): GameClientSocket {
    if (this.socket) return this.socket;

    const serverUrl = resolveGameServerUrl(
      import.meta.env.VITE_GAME_SERVER_URL,
      import.meta.env.DEV
    );
    const socket = io(serverUrl, { transports: ["websocket"] });
    this.socket = socket;
    socket.on("chatMessage", (message) => {
      if (this.socket === socket && !this.authenticating && this.sessionToken) chatStateStore.add(message);
    });
    socket.on("socialState",snapshot=>{
      if(this.socket===socket && !this.authenticating && this.sessionToken && snapshot.selfId===this.socialCharacterId) socialStateStore.set(snapshot);
    });

    socket.on("connect", () => {
      if (this.socket !== socket) return;
      if (this.sessionToken && !this.authenticating) {
        void this.reauthenticate(socket, this.sessionToken);
      } else if (!this.authenticating) {
        this.setConnectionState("connected");
      }
    });
    socket.on("disconnect", () => {
      if (this.socket !== socket) return;
      this.connectionVersion += 1;
      this.authenticationVersion += 1;
      this.authenticating = false;
      socialStateStore.reset();
      this.setConnectionState("disconnected");
    });
    socket.on("connect_error", () => {
      if (this.socket === socket) this.setConnectionState("disconnected");
    });
    socket.io.on("reconnect_attempt", () => {
      if (this.socket === socket) this.setConnectionState("connecting");
    });
    socket.io.on("reconnect_failed", () => {
      if (this.socket === socket) this.setConnectionState("disconnected");
    });

    return socket;
  }

  async authenticate(sessionToken: string): Promise<SocketAuthResult> {
    const socket = this.connect();
    if (this.sessionToken !== sessionToken) chatStateStore.reset();
    socialStateStore.reset();this.socialCharacterId=null;
    this.sessionToken = null;
    this.authenticating = true;
    const version = ++this.authenticationVersion;
    const connectionVersion = this.connectionVersion;
    this.setConnectionState("connecting");
    if (!socket.connected && !socket.active) socket.connect();
    const result = await this.requestAuthentication(socket, sessionToken);
    if (!this.isCurrentAuthentication(socket, version, connectionVersion)) {
      return this.authenticationFailure();
    }
    this.authenticating = false;
    if (result.ok) {this.sessionToken = sessionToken;this.socialCharacterId=result.characterId;}
    this.setConnectionState(result.ok ? "connected" : "disconnected");
    return result;
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    this.sessionToken = null;
    this.authenticationVersion += 1;
    this.authenticating = false;
    socket?.disconnect();
    chatStateStore.reset();
    socialStateStore.reset();this.socialCharacterId=null;
    this.setConnectionState("disconnected");
  }

  sendMoveIntent(position: { x: number; y: number; locationId?:string }): void {
    this.connect().emit("moveIntent", position);
  }

  async requestSocialState():Promise<SocialActionResult> {
    return this.socialRequest("requestSocialState");
  }
  async socialAction(action:SocialAction):Promise<SocialActionResult> {
    return this.socialRequest("socialAction",action);
  }
  private async socialRequest(event:"requestSocialState"|"socialAction", action?:SocialAction):Promise<SocialActionResult> {
    const socket=this.connect(),version=this.authenticationVersion;
    try {
      const result=event==="socialAction"
        ? await socket.timeout(15000).emitWithAck("socialAction",action!)
        : await socket.timeout(10000).emitWithAck("requestSocialState");
      if(this.socket!==socket || version!==this.authenticationVersion || (result.ok && result.social.selfId!==this.socialCharacterId)) {
        return {ok:false,code:"SESSION_REPLACED",message:"Połączenie zmieniło się. Odśwież panel."};
      }
      if(result.ok)socialStateStore.set(result.social);
      return result;
    }catch{return {ok:false,code:"SOCIAL_REQUEST_FAILED",message:"Nie udało się połączyć z serwerem. Spróbuj ponownie."};}
  }

  async sendChatMessage(channel: ChatChannel, text: string): Promise<ChatSendResult> {
    const socket=this.connect();
    const version=this.authenticationVersion;
    try {
      const result=await socket.timeout(10_000).emitWithAck("sendChatMessage", {channel,text});
      if(this.socket!==socket || version!==this.authenticationVersion) return {ok:false,code:"SESSION_REPLACED",message:"Połączenie zmieniło się. Spróbuj ponownie."};
      if(result.ok) chatStateStore.add(result.message);
      return result;
    } catch { return {ok:false,code:"CHAT_SEND_FAILED",message:"Nie udało się wysłać wiadomości. Sprawdź połączenie."}; }
  }

  async requestChatHistory(): Promise<ChatHistoryResult> {
    const socket=this.connect();
    const version=this.authenticationVersion;
    try {
      const result=await socket.timeout(10_000).emitWithAck("requestChatHistory");
      if(this.socket!==socket || version!==this.authenticationVersion) return {ok:false,code:"SESSION_REPLACED",message:"Połączenie zmieniło się."};
      if(result.ok) chatStateStore.merge(result.messages);
      return result;
    } catch { return {ok:false,code:"CHAT_HISTORY_FAILED",message:"Nie udało się pobrać historii czatu."}; }
  }

  updateChatViewport(viewport: ChatViewport): void { this.connect().emit("updateChatViewport",viewport); }

  onChatMessage(handler:(message:ChatMessage)=>void):()=>void {
    const socket=this.connect();
    const guarded=(message:ChatMessage):void=>{
      if(this.socket===socket && !this.authenticating && this.sessionToken) handler(message);
    };
    socket.on("chatMessage",guarded);
    return ()=>socket.off("chatMessage",guarded);
  }

  requestPlayerState(): void {
    this.connect().emit("requestPlayerState");
  }

  requestWorldState(): void {
    this.connect().emit("requestWorldState");
  }

  interactNpc(npcId: string): void {
    this.connect().emit("interactNpc", { npcId });
  }

  healAtNpc(npcId: string): void {
    this.connect().emit("healAtNpc", { npcId });
  }

  requestMerchantShop(npcId: string): Promise<MerchantResult> {
    return this.merchantRequest({ npcId });
  }

  async requestHealingTargets():Promise<HealingTargetsResult> {
    const socket=this.connect(),version=this.authenticationVersion,playerId=this.socialCharacterId;
    if(!this.sessionToken || this.authenticating || !socket.connected || !playerId)return {ok:false,code:"AUTHENTICATION_REQUIRED",message:"Połącz się z grą, aby używać kostura."};
    try {
      const result=await socket.timeout(10000).emitWithAck("requestHealingTargets");
      if(this.socket!==socket || version!==this.authenticationVersion || playerId!==this.socialCharacterId)return {ok:false,code:"SESSION_REPLACED",message:"Połączenie zmieniło się. Otwórz leczenie ponownie."};
      return result;
    }catch{return {ok:false,code:"HEAL_TARGETS_FAILED",message:"Nie udało się pobrać celów leczenia."};}
  }
  async castHealing(payload:HealingRequest):Promise<HealingResult> {
    const socket=this.connect(),version=this.authenticationVersion,playerId=this.socialCharacterId;
    if(!this.sessionToken || this.authenticating || !socket.connected || !playerId)return {ok:false,code:"AUTHENTICATION_REQUIRED",message:"Połącz się z grą, aby używać kostura."};
    try {
      const result=await socket.timeout(10000).emitWithAck("castHealing",payload);
      if(this.socket!==socket || version!==this.authenticationVersion || playerId!==this.socialCharacterId || (result.ok && (result.requestId!==payload.requestId || result.targetId!==payload.targetId)))return {ok:false,code:"SESSION_REPLACED",message:"Połączenie zmieniło się. Otwórz leczenie ponownie."};
      return result;
    }catch{return {ok:false,code:"HEAL_REQUEST_UNCERTAIN",message:"Brak potwierdzenia. Sprawdź wynik tego samego leczenia."};}
  }

  async setEquipmentSlot(payload: EquipmentUpdateRequest): Promise<EquipmentUpdateResult> {
    const socket=this.connect(),version=this.authenticationVersion,playerId=this.socialCharacterId;
    if(!this.sessionToken || this.authenticating || !socket.connected || !playerId)return {ok:false,code:"AUTHENTICATION_REQUIRED",message:"Połącz się z grą, aby zmienić uzbrojenie."};
    try {
      const result=await socket.timeout(10000).emitWithAck("setEquipmentSlot",payload);
      if(this.socket!==socket || version!==this.authenticationVersion || playerId!==this.socialCharacterId || (result.ok && result.character.playerId!==playerId))return {ok:false,code:"SESSION_REPLACED",message:"Połączenie postaci zmieniło się. Otwórz panel ponownie."};
      return result;
    }catch{return {ok:false,code:"EQUIPMENT_UPDATE_UNCERTAIN",message:"Brak potwierdzenia zmiany. Otwórz panel ponownie i sprawdź uzbrojenie."};}
  }

  purchaseMerchantItem(payload: MerchantPurchase): Promise<MerchantResult> {
    return this.merchantRequest(payload);
  }

  private async merchantRequest(payload: { npcId: string } | MerchantPurchase): Promise<MerchantResult> {
    const socket = this.connect();
    const version = this.authenticationVersion;
    if (!this.sessionToken || this.authenticating || !socket.connected) {
      return { ok: false, code: "AUTHENTICATION_REQUIRED", message: "Połącz się z grą, aby otworzyć sklep." };
    }
    try {
      const result = "requestId" in payload
        ? await socket.timeout(15_000).emitWithAck("purchaseMerchantItem", payload)
        : await socket.timeout(10_000).emitWithAck("requestMerchantShop", payload);
      if (this.socket !== socket || version !== this.authenticationVersion) {
        return { ok: false, code: "SESSION_REPLACED", message: "Połączenie zmieniło się. Otwórz sklep ponownie." };
      }
      return result;
    } catch {
      return { ok: false, code: "MERCHANT_REQUEST_UNCERTAIN", message: "Brak potwierdzenia z serwera. Ponów ten zakup, aby sprawdzić jego wynik bez ponownej opłaty." };
    }
  }

  async setContainerSlot(slotIndex: number, itemInstanceId: string | null): Promise<SetContainerSlotResult> {
    try {
      return await this.connect().timeout(10_000).emitWithAck("setContainerSlot", { slotIndex, itemInstanceId });
    } catch {
      return {
        ok: false,
        code: "CONTAINER_SLOT_UPDATE_FAILED",
        message: "Nie udało się zapisać pojemnika. Sprawdź połączenie i spróbuj ponownie."
      };
    }
  }

  async moveItemToContainer(itemInstanceId: string, targetContainerInstanceId: string | null, targetPosition?: number): Promise<InventoryUpdateResult> {
    try {
      return await this.connect().timeout(10_000).emitWithAck("moveItemToContainer", {
        itemInstanceId, targetContainerInstanceId,
        ...(targetPosition === undefined ? {} : { targetPosition })
      });
    } catch {
      return {
        ok: false, code: "CONTAINER_ITEM_MOVE_FAILED",
        message: "Nie udało się przenieść przedmiotu. Sprawdź połączenie i spróbuj ponownie."
      };
    }
  }

  startEncounter(encounterId: string, mode: BattleMode = "manual"): void {
    this.connect().emit("startEncounter", { encounterId, mode });
  }

  async setBattleAuto(enabled: boolean): Promise<BattleAutoResult> {
    const socket=this.connect(),version=this.authenticationVersion;
    if(!this.sessionToken || this.authenticating || !socket.connected) {
      return {ok:false,code:"AUTHENTICATION_REQUIRED",message:"Połącz się ponownie, aby zmienić tryb walki."};
    }
    try {
      const result=await socket.timeout(10_000).emitWithAck("setBattleAuto",{enabled});
      if(this.socket!==socket || version!==this.authenticationVersion) {
        return {ok:false,code:"SESSION_REPLACED",message:"Połączenie zmieniło się. Odśwież walkę."};
      }
      return result;
    } catch {
      return {ok:false,code:"AUTO_MODE_REQUEST_FAILED",message:"Nie otrzymano potwierdzenia zmiany trybu walki."};
    }
  }

  async useBattleItem(combatantId: string, itemInstanceId: string): Promise<InventoryUpdateResult> {
    try {
      return await this.connect().timeout(10_000).emitWithAck("useBattleItem", { combatantId, itemInstanceId });
    } catch {
      return { ok: false, code: "BATTLE_ITEM_FAILED", message: "Nie udało się użyć przedmiotu. Sprawdź połączenie." };
    }
  }

  sendBattleCommand(command: BattleCommand): void {
    this.connect().emit("battleCommand", command);
  }

  onWorldState(handler: (snapshot: WorldStateSnapshot) => void): () => void {
    const socket = this.connect();
    socket.on("worldState", handler);
    return () => socket.off("worldState", handler);
  }

  onPlayerState(handler: (snapshot: PlayerStateSnapshot) => void): () => void {
    const socket = this.connect();
    socket.on("playerState", handler);
    return () => socket.off("playerState", handler);
  }

  onNpcInteraction(handler: (payload: NpcInteractionPayload) => void): () => void {
    const socket = this.connect();
    socket.on("npcInteraction", handler);
    return () => socket.off("npcInteraction", handler);
  }

  onBattleStarted(handler: (snapshot: BattleSnapshot) => void): () => void {
    const socket = this.connect();
    socket.on("battleStarted", handler);
    return () => socket.off("battleStarted", handler);
  }

  onBattleState(handler: (snapshot: BattleSnapshot) => void): () => void {
    const socket = this.connect();
    socket.on("battleState", handler);
    return () => socket.off("battleState", handler);
  }

  onBattleEnded(handler: (payload: BattleEndedPayload) => void): () => void {
    const socket = this.connect();
    socket.on("battleEnded", handler);
    return () => socket.off("battleEnded", handler);
  }

  onCommandRejected(
    handler: (payload: { code: string; message: string }) => void
  ): () => void {
    const socket = this.connect();
    socket.on("commandRejected", handler);
    return () => socket.off("commandRejected", handler);
  }

  onConnectionState(handler: (state: ConnectionState) => void): () => void {
    this.connectionHandlers.add(handler);
    handler(this.connectionState);
    return () => this.connectionHandlers.delete(handler);
  }

  onReauthenticated(handler: (result: SocketAuthResult) => void): () => void {
    this.reauthenticatedHandlers.add(handler);
    return () => this.reauthenticatedHandlers.delete(handler);
  }

  private async reauthenticate(socket: GameClientSocket, sessionToken: string): Promise<void> {
    this.authenticating = true;
    const version = ++this.authenticationVersion;
    const connectionVersion = this.connectionVersion;
    this.setConnectionState("connecting");
    const result = await this.requestAuthentication(socket, sessionToken);
    if (!this.isCurrentAuthentication(socket, version, connectionVersion)) return;
    this.authenticating = false;
    if (result.ok) {
      this.socialCharacterId=result.characterId;
      this.setConnectionState("connected");
      socket.emit("requestWorldState");
      socket.emit("requestPlayerState");
    } else {
      this.sessionToken = null;
      socket.disconnect();
      this.setConnectionState("disconnected");
    }
    for (const handler of this.reauthenticatedHandlers) handler(result);
  }

  private async requestAuthentication(
    socket: GameClientSocket,
    sessionToken: string
  ): Promise<SocketAuthResult> {
    try {
      return await socket.timeout(15_000).emitWithAck("authenticate", { sessionToken });
    } catch {
      return this.authenticationFailure();
    }
  }

  private isCurrentAuthentication(
    socket: GameClientSocket,
    version: number,
    connectionVersion: number
  ): boolean {
    return this.socket === socket && this.authenticationVersion === version &&
      this.connectionVersion === connectionVersion;
  }

  private authenticationFailure(): SocketAuthResult {
    return {
      ok: false,
      code: "AUTHENTICATION_FAILED",
      message: "The gameplay session could not be authenticated. Try connecting again."
    };
  }

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    for (const handler of this.connectionHandlers) handler(state);
  }
}

export const gameSocket = new GameSocket();
