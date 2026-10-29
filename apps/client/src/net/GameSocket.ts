import type {
  BattleCommand,
  BattleSnapshot,
  CharacterSnapshot,
  ClientToServerEvents,
  InventorySnapshot,
  NpcInteractionPayload,
  PlayerStateSnapshot,
  ServerToClientEvents,
  SetContainerSlotResult,
  SocketAuthResult,
  WorldStateSnapshot
} from "@web-mmorpg/shared";
import { io, type Socket } from "socket.io-client";
import { resolveGameServerUrl } from "../hosting";

type GameClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type ConnectionState = "connected" | "connecting" | "disconnected";

export interface BattleEndedPayload {
  outcome: "victory" | "defeat";
  inventory: InventorySnapshot;
  character: CharacterSnapshot;
  experienceGained?: number;
  levelsGained?: number;
}

export interface BattleResultSummary {
  outcome: BattleEndedPayload["outcome"];
  experienceGained: number;
  levelsGained: number;
  level: number;
}

export class GameSocket {
  private socket: GameClientSocket | null = null;
  private sessionToken: string | null = null;
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
    if (result.ok) this.sessionToken = sessionToken;
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
    this.setConnectionState("disconnected");
  }

  sendMoveIntent(position: { x: number; y: number }): void {
    this.connect().emit("moveIntent", position);
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

  startEncounter(encounterId: string): void {
    this.connect().emit("startEncounter", { encounterId });
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
