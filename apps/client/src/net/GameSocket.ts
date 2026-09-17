import type {
  BattleCommand,
  BattleSnapshot,
  ClientToServerEvents,
  InventorySnapshot,
  LoginResult,
  ServerToClientEvents,
  WorldStateSnapshot
} from "@web-mmorpg/shared";
import { io, type Socket } from "socket.io-client";

type GameClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export class GameSocket {
  private socket: GameClientSocket | null = null;

  connect(): GameClientSocket {
    if (this.socket) return this.socket;

    const serverUrl = import.meta.env.VITE_GAME_SERVER_URL ?? "http://localhost:3001";
    this.socket = io(serverUrl, { transports: ["websocket"] });
    return this.socket;
  }

  async login(nickname: string): Promise<LoginResult> {
    const socket = this.connect();
    return socket.emitWithAck("login", { nickname });
  }

  sendMoveIntent(position: { x: number; y: number }): void {
    this.connect().emit("moveIntent", position);
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

  onBattleEnded(handler: (payload: { inventory: InventorySnapshot }) => void): () => void {
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
}

export const gameSocket = new GameSocket();
