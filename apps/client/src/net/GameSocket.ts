import type {
  BattleCommand,
  BattleSnapshot,
  CharacterSnapshot,
  ClientToServerEvents,
  InventorySnapshot,
  LoginResult,
  NpcInteractionPayload,
  PartyInvitePayload,
  PartySnapshot,
  PlayerId,
  PlayerStateSnapshot,
  ServerToClientEvents,
  WorldStateSnapshot
} from "@web-mmorpg/shared";
import { io, type ManagerOptions, type Socket, type SocketOptions } from "socket.io-client";
import { authSessionStore } from "../state/AuthSessionStore";

type GameClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type ConnectionState = "connected" | "connecting" | "disconnected";

export interface BattleEndedPayload {
  outcome: "victory" | "defeat";
  inventory: InventorySnapshot;
  character: CharacterSnapshot;
}

export function resolveSocketAuth(
  token: string | null,
  persistentAccounts: boolean
): Pick<Partial<ManagerOptions & SocketOptions>, "auth"> | Record<string, never> {
  if (!persistentAccounts) return {};
  if (!token) throw new Error("AUTH_TOKEN_REQUIRED");
  return { auth: { token } };
}

const persistentAccountsEnabled =
  import.meta.env.VITE_PERSISTENT_ACCOUNTS === "true";

export class GameSocket {
  private socket: GameClientSocket | null = null;
  private connectionState: ConnectionState = "connecting";
  private readonly connectionHandlers = new Set<(state: ConnectionState) => void>();

  connect(token = authSessionStore.getToken()): GameClientSocket {
    if (this.socket) return this.socket;

    const serverUrl = import.meta.env.VITE_GAME_SERVER_URL ?? "http://localhost:3001";
    const authOptions = resolveSocketAuth(token, persistentAccountsEnabled);
    const socket = io(serverUrl, {
      transports: ["websocket"],
      ...authOptions
    });
    this.socket = socket;

    socket.on("connect", () => this.setConnectionState("connected"));
    socket.on("disconnect", () => this.setConnectionState("disconnected"));
    socket.on("connect_error", () => this.setConnectionState("disconnected"));
    socket.io.on("reconnect_attempt", () => this.setConnectionState("connecting"));
    socket.io.on("reconnect_failed", () => this.setConnectionState("disconnected"));
    socket.on("sessionReplaced", () => {
      authSessionStore.clear();
      socket.disconnect();
      if (this.socket === socket) this.socket = null;
      this.setConnectionState("disconnected");
      if (typeof window !== "undefined") window.location.reload();
    });

    return socket;
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    socket?.disconnect();
    this.setConnectionState("disconnected");
  }

  async login(nickname: string): Promise<LoginResult> {
    const socket = this.connect();
    return socket.emitWithAck("login", { nickname });
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

  inviteToParty(targetPlayerId: PlayerId): void {
    this.connect().emit("inviteToParty", { targetPlayerId });
  }

  respondPartyInvite(inviteId: string, accept: boolean): void {
    this.connect().emit("respondPartyInvite", { inviteId, accept });
  }

  leaveParty(): void {
    this.connect().emit("leaveParty");
  }

  requestPartyState(): void {
    this.connect().emit("requestPartyState");
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

  onPartyInviteReceived(handler: (payload: PartyInvitePayload) => void): () => void {
    const socket = this.connect();
    socket.on("partyInviteReceived", handler);
    return () => socket.off("partyInviteReceived", handler);
  }

  onPartyInviteResolved(
    handler: (payload: {
      targetPlayerId: PlayerId;
      targetNickname: string;
      accepted: boolean;
    }) => void
  ): () => void {
    const socket = this.connect();
    socket.on("partyInviteResolved", handler);
    return () => socket.off("partyInviteResolved", handler);
  }

  onPartyState(handler: (snapshot: PartySnapshot | null) => void): () => void {
    const socket = this.connect();
    socket.on("partyState", handler);
    return () => socket.off("partyState", handler);
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

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    for (const handler of this.connectionHandlers) handler(state);
  }
}

export const gameSocket = new GameSocket();
